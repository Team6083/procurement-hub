// Package config parses and validates environment configuration (spec §6.1).
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr    string
	MetricsAddr string

	FrontendOrigins []string
	FrontendURL     string

	BaseCurrency         string
	BaseCurrencyDecimals int
	SupportedCurrencies  []string
	EncryptionKey        []byte
	LogLevel             string
	MongoURI             string
	MongoDatabase        string
	OIDCIssuerURL        string
	OIDCAudience         string
	OIDCGroupsClaim      string
	OIDCRolesClaim       string
	OIDCAdminRole        string
	OIDCClockSkew        time.Duration
	RoleMappingsFile     string
	LookupProvider       string
	NotifyDigestWindow   time.Duration
	EmailEnabled         bool
	SMTPHost, SMTPFrom   string
	SMTPPort             string
	SMTPUsername         string
	SMTPPassword         string
	SMTPTLSMode          string
	PartfinderURL        string
	PartfinderPriceCurr  string
	LookupTimeout        time.Duration
}

// Load reads configuration from the given lookup function (os.Getenv in
// production) and validates it, returning every problem at once.
func Load(getenv func(string) string) (*Config, error) {
	var errs []error
	str := func(k, def string) string {
		if v := strings.TrimSpace(getenv(k)); v != "" {
			return v
		}
		return def
	}
	required := func(k string) string {
		v := strings.TrimSpace(getenv(k))
		if v == "" {
			errs = append(errs, fmt.Errorf("%s is required", k))
		}
		return v
	}
	dur := func(k, def string) time.Duration {
		d, err := time.ParseDuration(str(k, def))
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: invalid duration: %w", k, err))
		}
		return d
	}
	boolean := func(k string) bool {
		v := str(k, "false")
		b, err := strconv.ParseBool(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: invalid boolean %q", k, v))
		}
		return b
	}

	c := &Config{
		HTTPAddr:            str("APP_HTTP_ADDR", ":8080"),
		MetricsAddr:         str("APP_METRICS_ADDR", ":9090"),
		FrontendURL:         required("APP_FRONTEND_URL"),
		BaseCurrency:        strings.ToUpper(str("APP_BASE_CURRENCY", "USD")),
		LogLevel:            str("APP_LOG_LEVEL", "info"),
		MongoURI:            required("MONGODB_URI"),
		MongoDatabase:       str("MONGODB_DATABASE", "procurement_hub"),
		OIDCIssuerURL:       required("OIDC_ISSUER_URL"),
		OIDCAudience:        required("OIDC_AUDIENCE"),
		OIDCGroupsClaim:     str("OIDC_GROUPS_CLAIM", "groups"),
		OIDCRolesClaim:      str("OIDC_ROLES_CLAIM", "realm_access.roles"),
		OIDCAdminRole:       str("OIDC_ADMIN_ROLE", "system-admin"),
		OIDCClockSkew:       dur("OIDC_CLOCK_SKEW", "60s"),
		RoleMappingsFile:    str("ROLE_MAPPINGS_FILE", ""),
		LookupProvider:      str("LOOKUP_PROVIDER", "none"),
		NotifyDigestWindow:  dur("NOTIFY_DIGEST_WINDOW", "5m"),
		EmailEnabled:        boolean("EMAIL_ENABLED"),
		SMTPHost:            str("SMTP_HOST", ""),
		SMTPPort:            str("SMTP_PORT", ""),
		SMTPFrom:            str("SMTP_FROM", ""),
		SMTPUsername:        str("SMTP_USERNAME", ""),
		SMTPPassword:        getenv("SMTP_PASSWORD"),
		SMTPTLSMode:         str("SMTP_TLS_MODE", "starttls"),
		PartfinderURL:       str("PARTFINDER_URL", ""),
		PartfinderPriceCurr: strings.ToUpper(str("PARTFINDER_PRICE_CURRENCY", "USD")),
		LookupTimeout:       dur("LOOKUP_TIMEOUT", "10s"),
	}

	for _, o := range strings.Split(required("APP_FRONTEND_ORIGINS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			u, err := url.Parse(o)
			if err != nil || u.Scheme == "" || u.Host == "" || u.Path != "" && u.Path != "/" {
				errs = append(errs, fmt.Errorf("APP_FRONTEND_ORIGINS: %q is not an origin", o))
				continue
			}
			c.FrontendOrigins = append(c.FrontendOrigins, strings.TrimSuffix(o, "/"))
		}
	}

	if len(c.BaseCurrency) != 3 {
		errs = append(errs, fmt.Errorf("APP_BASE_CURRENCY: %q is not an ISO 4217 code", c.BaseCurrency))
	}
	if d := strings.TrimSpace(getenv("APP_BASE_CURRENCY_DECIMALS")); d != "" {
		n, err := strconv.Atoi(d)
		if err != nil || n < 0 || n > 4 {
			errs = append(errs, errors.New("APP_BASE_CURRENCY_DECIMALS must be an integer 0-4"))
		}
		c.BaseCurrencyDecimals = n
	} else {
		c.BaseCurrencyDecimals = -1 // use ISO default
	}

	c.SupportedCurrencies = []string{c.BaseCurrency}
	if s := strings.TrimSpace(getenv("APP_SUPPORTED_CURRENCIES")); s != "" {
		c.SupportedCurrencies = nil
		for _, cur := range strings.Split(s, ",") {
			if cur = strings.ToUpper(strings.TrimSpace(cur)); cur != "" {
				c.SupportedCurrencies = append(c.SupportedCurrencies, cur)
			}
		}
	}

	if k := required("APP_ENCRYPTION_KEY"); k != "" {
		key, err := base64.StdEncoding.DecodeString(k)
		if err != nil || len(key) != 32 {
			errs = append(errs, errors.New("APP_ENCRYPTION_KEY must be a base64-encoded 32-byte key"))
		}
		c.EncryptionKey = key
	}

	switch c.LookupProvider {
	case "none":
	case "partfinder":
		if c.PartfinderURL == "" {
			errs = append(errs, errors.New("PARTFINDER_URL is required when LOOKUP_PROVIDER=partfinder"))
		}
	default:
		errs = append(errs, fmt.Errorf("LOOKUP_PROVIDER: unknown provider %q", c.LookupProvider))
	}
	if c.EmailEnabled {
		for k, v := range map[string]string{"SMTP_HOST": c.SMTPHost, "SMTP_PORT": c.SMTPPort, "SMTP_FROM": c.SMTPFrom} {
			if v == "" {
				errs = append(errs, fmt.Errorf("%s is required when EMAIL_ENABLED=true", k))
			}
		}
	}
	switch c.SMTPTLSMode {
	case "starttls", "tls", "none":
	default:
		errs = append(errs, fmt.Errorf("SMTP_TLS_MODE: invalid value %q", c.SMTPTLSMode))
	}

	return c, errors.Join(errs...)
}
