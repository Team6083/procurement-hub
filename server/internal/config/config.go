// Package config parses and validates environment configuration (spec §6.1).
//
// Format rules: durations are Go durations plus a "d" (day) unit, booleans
// are strconv.ParseBool values, lists are comma-separated with surrounding
// whitespace trimmed, and an empty value is the same as an unset one. Every
// problem is collected and returned at once.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// MetricsOff is the METRICS_LISTEN_ADDR value that disables the ops server.
const MetricsOff = "off"

type Config struct {
	ListenAddr string
	// MetricsListenAddr is empty when METRICS_LISTEN_ADDR=off.
	MetricsListenAddr string
	LogLevel          slog.Level
	ShutdownTimeout   time.Duration

	CORSAllowedOrigins []string
	FrontendURL        string

	MongoURI      string
	MongoDatabase string // taken from the MONGO_URI path

	OIDCIssuer      string
	OIDCAudience    string
	OIDCClockSkew   time.Duration
	OIDCGroupsClaim string
	AdminRoles      []string
	// AllowedRoles is nil when ALLOWED_ROLES is unset: access is unrestricted.
	AllowedRoles     []string
	RoleMappingsFile string

	// WebhookKey is the AES-256-GCM key derived from WEBHOOK_ENCRYPTION_KEY.
	WebhookKey []byte

	BaseCurrency         string
	BaseCurrencyDecimals int // -1: use the ISO 4217 default
	SupportedCurrencies  []string

	EmailEnabled bool
	SMTPHost     string
	SMTPPort     string
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
	SMTPTLSMode  string

	NotifyDigestWindow time.Duration

	LookupProvider          string
	PartfinderURL           string
	PartfinderPriceCurrency string
	LookupTimeout           time.Duration
}

// Load reads configuration from the given lookup function (os.Getenv in
// production) and validates it, returning every problem at once.
func Load(getenv func(string) string) (*Config, error) {
	var errs []error
	fail := func(format string, a ...any) { errs = append(errs, fmt.Errorf(format, a...)) }
	get := func(k string) string { return strings.TrimSpace(getenv(k)) }
	str := func(k, def string) string {
		if v := get(k); v != "" {
			return v
		}
		return def
	}
	required := func(k string) string {
		v := get(k)
		if v == "" {
			fail("%s is required", k)
		}
		return v
	}
	dur := func(k, def string) time.Duration {
		d, err := parseDuration(str(k, def))
		if err != nil {
			fail("%s: %v", k, err)
		} else if d < 0 {
			fail("%s: must not be negative", k)
		}
		return d
	}
	boolean := func(k string) bool {
		v := str(k, "false")
		b, err := strconv.ParseBool(v)
		if err != nil {
			fail("%s: invalid boolean %q", k, v)
		}
		return b
	}
	addr := func(k, def string) string {
		v := str(k, def)
		if _, port, err := net.SplitHostPort(v); err != nil || port == "" {
			fail("%s: %q is not a host:port address", k, v)
		}
		return v
	}
	httpURL := func(k string, v string) {
		if v == "" {
			return
		}
		if u, err := url.Parse(v); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			fail("%s: %q is not an absolute http(s) URL", k, v)
		}
	}

	c := &Config{
		ListenAddr:              addr("LISTEN_ADDR", ":8080"),
		ShutdownTimeout:         dur("SHUTDOWN_TIMEOUT", "30s"),
		FrontendURL:             required("FRONTEND_URL"),
		OIDCIssuer:              required("OIDC_ISSUER"),
		OIDCAudience:            required("OIDC_AUDIENCE"),
		OIDCClockSkew:           dur("OIDC_CLOCK_SKEW", "60s"),
		OIDCGroupsClaim:         str("OIDC_GROUPS_CLAIM", "groups"),
		RoleMappingsFile:        get("ROLE_MAPPINGS_FILE"),
		BaseCurrency:            strings.ToUpper(str("BASE_CURRENCY", "USD")),
		EmailEnabled:            boolean("EMAIL_ENABLED"),
		SMTPHost:                get("SMTP_HOST"),
		SMTPPort:                get("SMTP_PORT"),
		SMTPUsername:            get("SMTP_USERNAME"),
		SMTPPassword:            getenv("SMTP_PASSWORD"), // passwords may legitimately contain edge whitespace
		SMTPFrom:                get("SMTP_FROM"),
		SMTPTLSMode:             str("SMTP_TLS_MODE", "starttls"),
		NotifyDigestWindow:      dur("NOTIFY_DIGEST_WINDOW", "5m"),
		LookupProvider:          str("LOOKUP_PROVIDER", "none"),
		PartfinderURL:           get("PARTFINDER_URL"),
		PartfinderPriceCurrency: strings.ToUpper(str("PARTFINDER_PRICE_CURRENCY", "USD")),
		LookupTimeout:           dur("LOOKUP_TIMEOUT", "10s"),
	}
	httpURL("FRONTEND_URL", c.FrontendURL)
	httpURL("OIDC_ISSUER", c.OIDCIssuer)
	httpURL("PARTFINDER_URL", c.PartfinderURL)

	if v := str("METRICS_LISTEN_ADDR", ":9090"); v != MetricsOff {
		c.MetricsListenAddr = addr("METRICS_LISTEN_ADDR", ":9090")
	}

	var lerr error
	if c.LogLevel, lerr = parseLogLevel(str("LOG_LEVEL", "info")); lerr != nil {
		errs = append(errs, lerr)
	}

	for _, o := range splitList(required("CORS_ALLOWED_ORIGINS")) {
		u, err := url.Parse(o)
		if err != nil || u.Scheme == "" || u.Host == "" || u.Path != "" && u.Path != "/" {
			fail("CORS_ALLOWED_ORIGINS: %q is not an origin", o)
			continue
		}
		c.CORSAllowedOrigins = append(c.CORSAllowedOrigins, strings.TrimSuffix(o, "/"))
	}

	if v := required("MONGO_URI"); v != "" {
		db, err := mongoDatabase(v)
		if err != nil {
			fail("MONGO_URI: %v", err)
		}
		c.MongoURI, c.MongoDatabase = v, db
	}

	var err error
	if c.AdminRoles, err = ParseRoles("ADMIN_ROLES", required("ADMIN_ROLES")); err != nil {
		errs = append(errs, err)
	}
	if v := get("ALLOWED_ROLES"); v != "" {
		if c.AllowedRoles, err = ParseRoles("ALLOWED_ROLES", v); err != nil {
			errs = append(errs, err)
		}
	}

	if v := required("WEBHOOK_ENCRYPTION_KEY"); v != "" {
		if c.WebhookKey, err = DeriveWebhookKey(v); err != nil {
			fail("WEBHOOK_ENCRYPTION_KEY: %v", err)
		}
	}

	if !isCurrencyCode(c.BaseCurrency) {
		fail("BASE_CURRENCY: %q is not an ISO 4217 code", c.BaseCurrency)
	}
	c.BaseCurrencyDecimals = -1
	if d := get("BASE_CURRENCY_DECIMALS"); d != "" {
		n, err := strconv.Atoi(d)
		if err != nil || n < 0 || n > 4 {
			fail("BASE_CURRENCY_DECIMALS: must be an integer 0-4, got %q", d)
		}
		c.BaseCurrencyDecimals = n
	}
	c.SupportedCurrencies = []string{c.BaseCurrency}
	if s := get("SUPPORTED_CURRENCIES"); s != "" {
		c.SupportedCurrencies = nil
		for _, cur := range splitList(s) {
			cur = strings.ToUpper(cur)
			if !isCurrencyCode(cur) {
				fail("SUPPORTED_CURRENCIES: %q is not an ISO 4217 code", cur)
			}
			c.SupportedCurrencies = append(c.SupportedCurrencies, cur)
		}
	}
	if !isCurrencyCode(c.PartfinderPriceCurrency) {
		fail("PARTFINDER_PRICE_CURRENCY: %q is not an ISO 4217 code", c.PartfinderPriceCurrency)
	}

	switch c.LookupProvider {
	case "none":
	case "partfinder":
		if c.PartfinderURL == "" {
			fail("PARTFINDER_URL is required when LOOKUP_PROVIDER=partfinder")
		}
	default:
		fail("LOOKUP_PROVIDER: unknown provider %q (want none or partfinder)", c.LookupProvider)
	}

	if c.EmailEnabled {
		for _, kv := range [][2]string{{"SMTP_HOST", c.SMTPHost}, {"SMTP_PORT", c.SMTPPort}, {"SMTP_FROM", c.SMTPFrom}} {
			if kv[1] == "" {
				fail("%s is required when EMAIL_ENABLED=true", kv[0])
			}
		}
	}
	if c.SMTPPort != "" {
		if n, err := strconv.Atoi(c.SMTPPort); err != nil || n < 1 || n > 65535 {
			fail("SMTP_PORT: %q is not a port number", c.SMTPPort)
		}
	}
	switch c.SMTPTLSMode {
	case "starttls", "tls", "none":
	default:
		fail("SMTP_TLS_MODE: %q is not one of starttls, tls, none", c.SMTPTLSMode)
	}

	if len(errs) > 0 {
		return nil, &Error{Problems: errs}
	}
	return c, nil
}

func parseLogLevel(lvl string) (slog.Level, error) {
	switch lvl {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	}
	return 0, fmt.Errorf("LOG_LEVEL: %q is not one of debug, info, warn, error", lvl)
}

// MigrateConfig is what `procurement-hub migrate` needs.
type MigrateConfig struct {
	MongoURI      string
	MongoDatabase string
	LogLevel      slog.Level
}

// LoadMigrate reads only MONGO_URI and LOG_LEVEL (same rules as Load), so the
// migrate job can run with serve's environment or a minimal one.
func LoadMigrate(getenv func(string) string) (*MigrateConfig, error) {
	var errs []error
	c := &MigrateConfig{}
	lvl := strings.TrimSpace(getenv("LOG_LEVEL"))
	if lvl == "" {
		lvl = "info"
	}
	var err error
	if c.LogLevel, err = parseLogLevel(lvl); err != nil {
		errs = append(errs, err)
	}
	if v := strings.TrimSpace(getenv("MONGO_URI")); v == "" {
		errs = append(errs, errors.New("MONGO_URI is required"))
	} else if c.MongoDatabase, err = mongoDatabase(v); err != nil {
		errs = append(errs, fmt.Errorf("MONGO_URI: %w", err))
	} else {
		c.MongoURI = v
	}
	if len(errs) > 0 {
		return nil, &Error{Problems: errs}
	}
	return c, nil
}

// Error lists every configuration problem found by Load or LoadMigrate.
type Error struct{ Problems []error }

func (e *Error) Error() string {
	msgs := make([]string, len(e.Problems))
	for i, p := range e.Problems {
		msgs[i] = p.Error()
	}
	return "invalid configuration: " + strings.Join(msgs, "; ")
}

func (e *Error) Unwrap() []error { return e.Problems }

// ParseRoles parses a role list (ADMIN_ROLES, ALLOWED_ROLES; spec §7.3): a
// comma-separated list where a bare name is a realm role and
// "<client id>:<role>" (split on the first colon) is a client role. An empty
// list is an error; callers treat an unset variable separately.
func ParseRoles(name, value string) ([]string, error) {
	if value == "" {
		return nil, nil // the "is required" error, if any, is reported by the caller
	}
	var roles []string
	var errs []error
	for _, r := range splitList(value) {
		client, role, isClient := strings.Cut(r, ":")
		if isClient && (client == "" || role == "") {
			errs = append(errs, fmt.Errorf("%s: %q must be \"<realm role>\" or \"<client id>:<client role>\"", name, r))
			continue
		}
		roles = append(roles, r)
	}
	if len(roles) == 0 && len(errs) == 0 {
		errs = append(errs, fmt.Errorf("%s: must name at least one role", name))
	}
	return roles, errors.Join(errs...)
}

// splitList splits a comma-separated list, trimming whitespace and dropping
// empty entries.
func splitList(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func isCurrencyCode(s string) bool {
	if len(s) != 3 {
		return false
	}
	for _, r := range s {
		if r < 'A' || r > 'Z' {
			return false
		}
	}
	return true
}

// mongoDatabase extracts the database name from a MongoDB connection string
// path. It parses only as much as needed: the driver validates the rest when
// connecting (and resolves mongodb+srv hosts, which needs DNS).
func mongoDatabase(uri string) (string, error) {
	rest, ok := strings.CutPrefix(uri, "mongodb://")
	if !ok {
		if rest, ok = strings.CutPrefix(uri, "mongodb+srv://"); !ok {
			return "", errors.New("must start with mongodb:// or mongodb+srv://")
		}
	}
	beforeQuery, _, _ := strings.Cut(rest, "?")
	if at := strings.LastIndex(beforeQuery, "@"); at >= 0 {
		rest = rest[at+1:] // drop the user info
	}
	hosts, path, hasPath := strings.Cut(rest, "/")
	if hosts == "" || strings.Contains(hosts, "?") {
		return "", errors.New("missing host or the / before the database name")
	}
	db, _, _ := strings.Cut(path, "?")
	if !hasPath || db == "" {
		return "", errors.New("the database name is required in the URI path (mongodb://host/<database>)")
	}
	db, err := url.PathUnescape(db)
	if err != nil {
		return "", fmt.Errorf("invalid database name: %w", err)
	}
	return db, nil
}
