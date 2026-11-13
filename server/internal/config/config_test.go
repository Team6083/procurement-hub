package config

import (
	"bytes"
	"encoding/base64"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"testing"
	"time"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

// testKey decodes to 32 bytes.
const testKey = "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE="

func validEnv() map[string]string {
	return map[string]string{
		"CORS_ALLOWED_ORIGINS":   "https://app.example.org, https://other.example.org/",
		"FRONTEND_URL":           "https://app.example.org",
		"WEBHOOK_ENCRYPTION_KEY": testKey,
		"MONGO_URI":              "mongodb://localhost/procurement_hub?replicaSet=rs0",
		"OIDC_ISSUER":            "https://sso.example.org/realms/example",
		"OIDC_AUDIENCE":          "procurement-hub-api",
		"ADMIN_ROLES":            "procurement-hub-api:admin",
	}
}

func TestLoadDefaults(t *testing.T) {
	c, err := Load(env(validEnv()))
	if err != nil {
		t.Fatal(err)
	}
	if c.ListenAddr != ":8080" || c.MetricsListenAddr != ":9090" || c.LogLevel != slog.LevelInfo || c.ShutdownTimeout != 30*time.Second {
		t.Fatalf("server defaults: %+v", c)
	}
	if c.BaseCurrency != "USD" || len(c.SupportedCurrencies) != 1 || c.BaseCurrencyDecimals != -1 {
		t.Fatalf("currency defaults: %+v", c)
	}
	if len(c.CORSAllowedOrigins) != 2 || c.CORSAllowedOrigins[1] != "https://other.example.org" {
		t.Fatalf("origins: %v", c.CORSAllowedOrigins)
	}
	if c.OIDCClockSkew != time.Minute || c.OIDCGroupsClaim != "groups" {
		t.Fatalf("oidc defaults: %+v", c)
	}
	if c.MongoDatabase != "procurement_hub" || c.AllowedRoles != nil || len(c.WebhookKey) != 32 {
		t.Fatalf("mongo/roles/key: %+v", c)
	}
	if c.NotifyDigestWindow != 5*time.Minute || c.LookupTimeout != 10*time.Second || c.LookupProvider != "none" ||
		c.SMTPTLSMode != "starttls" || c.EmailEnabled || c.PartfinderPriceCurrency != "USD" {
		t.Fatalf("other defaults: %+v", c)
	}
}

func TestLoadOverrides(t *testing.T) {
	m := validEnv()
	m["METRICS_LISTEN_ADDR"] = "off"
	m["LOG_LEVEL"] = "debug"
	m["SHUTDOWN_TIMEOUT"] = "1m"
	m["NOTIFY_DIGEST_WINDOW"] = "1d"
	m["BASE_CURRENCY"] = "twd"
	m["BASE_CURRENCY_DECIMALS"] = "0"
	m["SUPPORTED_CURRENCIES"] = "TWD, usd ,JPY"
	m["MONGO_URI"] = "mongodb://user:p%40ss@db1:27017,db2:27017/ph%2Dprod?replicaSet=rs0&authSource=admin"
	m["ALLOWED_ROLES"] = "staff, procurement-hub-api:user"
	c, err := Load(env(m))
	if err != nil {
		t.Fatal(err)
	}
	if c.MetricsListenAddr != "" || c.LogLevel != slog.LevelDebug || c.ShutdownTimeout != time.Minute || c.NotifyDigestWindow != 24*time.Hour {
		t.Fatalf("overrides: %+v", c)
	}
	if c.BaseCurrency != "TWD" || c.BaseCurrencyDecimals != 0 || !slices.Equal(c.SupportedCurrencies, []string{"TWD", "USD", "JPY"}) {
		t.Fatalf("currencies: %+v", c)
	}
	if c.MongoDatabase != "ph-prod" {
		t.Fatalf("database = %q", c.MongoDatabase)
	}
	if !slices.Equal(c.AllowedRoles, []string{"staff", "procurement-hub-api:user"}) {
		t.Fatalf("allowed roles = %v", c.AllowedRoles)
	}
}

func TestLoadErrors(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]string)
		want   string
	}{
		{"missing mongo", func(m map[string]string) { delete(m, "MONGO_URI") }, "MONGO_URI is required"},
		{"mongo without db", func(m map[string]string) { m["MONGO_URI"] = "mongodb://localhost/?replicaSet=rs0" }, "database name is required"},
		{"mongo without path", func(m map[string]string) { m["MONGO_URI"] = "mongodb://localhost:27017" }, "database name is required"},
		{"mongo bad scheme", func(m map[string]string) { m["MONGO_URI"] = "postgres://localhost/db" }, "mongodb://"},
		{"missing admin roles", func(m map[string]string) { delete(m, "ADMIN_ROLES") }, "ADMIN_ROLES is required"},
		{"empty admin roles", func(m map[string]string) { m["ADMIN_ROLES"] = " , " }, "ADMIN_ROLES: must name at least one role"},
		{"empty allowed roles", func(m map[string]string) { m["ALLOWED_ROLES"] = "," }, "ALLOWED_ROLES: must name at least one role"},
		{"bad allowed role", func(m map[string]string) { m["ALLOWED_ROLES"] = "client:" }, "ALLOWED_ROLES"},
		{"short key", func(m map[string]string) { m["WEBHOOK_ENCRYPTION_KEY"] = "c2hvcnQ=" }, "at least 32 bytes"},
		{"key not base64", func(m map[string]string) { m["WEBHOOK_ENCRYPTION_KEY"] = "not base64!" }, "base64"},
		{"origin with path", func(m map[string]string) { m["CORS_ALLOWED_ORIGINS"] = "https://a.example/x" }, "not an origin"},
		{"partfinder w/o url", func(m map[string]string) { m["LOOKUP_PROVIDER"] = "partfinder" }, "PARTFINDER_URL"},
		{"email w/o smtp", func(m map[string]string) { m["EMAIL_ENABLED"] = "true" }, "SMTP_HOST"},
		{"bad bool", func(m map[string]string) { m["EMAIL_ENABLED"] = "yes" }, "EMAIL_ENABLED"},
		{"bad duration", func(m map[string]string) { m["OIDC_CLOCK_SKEW"] = "x" }, "OIDC_CLOCK_SKEW"},
		{"negative duration", func(m map[string]string) { m["SHUTDOWN_TIMEOUT"] = "-1s" }, "SHUTDOWN_TIMEOUT: must not be negative"},
		{"bad currency", func(m map[string]string) { m["BASE_CURRENCY"] = "TWDD" }, "ISO 4217"},
		{"bad supported currency", func(m map[string]string) { m["SUPPORTED_CURRENCIES"] = "USD,X1" }, "SUPPORTED_CURRENCIES"},
		{"bad decimals", func(m map[string]string) { m["BASE_CURRENCY_DECIMALS"] = "9" }, "BASE_CURRENCY_DECIMALS"},
		{"bad log level", func(m map[string]string) { m["LOG_LEVEL"] = "verbose" }, "LOG_LEVEL"},
		{"uppercase log level", func(m map[string]string) { m["LOG_LEVEL"] = "INFO" }, "LOG_LEVEL"},
		{"bad listen addr", func(m map[string]string) { m["LISTEN_ADDR"] = "8080" }, "LISTEN_ADDR"},
		{"bad metrics addr", func(m map[string]string) { m["METRICS_LISTEN_ADDR"] = "none" }, "METRICS_LISTEN_ADDR"},
		{"bad frontend url", func(m map[string]string) { m["FRONTEND_URL"] = "app.example.org" }, "FRONTEND_URL"},
		{"bad smtp port", func(m map[string]string) { m["SMTP_PORT"] = "smtp" }, "SMTP_PORT"},
		{"bad tls mode", func(m map[string]string) { m["SMTP_TLS_MODE"] = "ssl" }, "SMTP_TLS_MODE"},
		{"bad lookup provider", func(m map[string]string) { m["LOOKUP_PROVIDER"] = "other" }, "LOOKUP_PROVIDER"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := validEnv()
			tt.mutate(m)
			_, err := Load(env(m))
			if err == nil || !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("want error containing %q, got %v", tt.want, err)
			}
		})
	}
}

func TestLoadReportsAllErrorsAtOnce(t *testing.T) {
	_, err := Load(env(map[string]string{"LOG_LEVEL": "loud"}))
	var cerr *Error
	if !errors.As(err, &cerr) {
		t.Fatalf("want *config.Error, got %T %v", err, err)
	}
	for _, want := range []string{
		"CORS_ALLOWED_ORIGINS is required", "FRONTEND_URL is required", "MONGO_URI is required",
		"OIDC_ISSUER is required", "OIDC_AUDIENCE is required", "ADMIN_ROLES is required",
		"WEBHOOK_ENCRYPTION_KEY is required", "LOG_LEVEL",
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("missing %q in %v", want, err)
		}
	}
	if len(cerr.Problems) != 8 {
		t.Errorf("got %d problems, want 8: %v", len(cerr.Problems), cerr.Problems)
	}
}

func TestParseRoles(t *testing.T) {
	tests := []struct {
		in      string
		want    []string
		wantErr bool
	}{
		{" realm-admin , procurement-hub-api:admin ", []string{"realm-admin", "procurement-hub-api:admin"}, false},
		{"client:role:with:colons", []string{"client:role:with:colons"}, false},
		{"single", []string{"single"}, false},
		{":admin", nil, true},
		{"client:", nil, true},
		{",,", nil, true},
	}
	for _, tt := range tests {
		got, err := ParseRoles("ADMIN_ROLES", tt.in)
		if (err != nil) != tt.wantErr {
			t.Errorf("ParseRoles(%q) error = %v, wantErr %v", tt.in, err, tt.wantErr)
		}
		if !tt.wantErr && !slices.Equal(got, tt.want) {
			t.Errorf("ParseRoles(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestParseDuration(t *testing.T) {
	tests := []struct {
		in   string
		want time.Duration
		err  bool
	}{
		{"30s", 30 * time.Second, false},
		{"1h30m", 90 * time.Minute, false},
		{"0", 0, false},
		{"90d", 90 * 24 * time.Hour, false},
		{"1d12h", 36 * time.Hour, false},
		{"1.5d", 36 * time.Hour, false},
		{"2d30m10s", 48*time.Hour + 30*time.Minute + 10*time.Second, false},
		{"-2d", -48 * time.Hour, false},
		{"", 0, true},
		{"d", 0, true},
		{"5x", 0, true},
		{"1dd", 0, true},
		{"1h-1d", 0, true},
		{"1.2.3d", 0, true},
		{"999999999d", 0, true},
	}
	for _, tt := range tests {
		got, err := parseDuration(tt.in)
		if (err != nil) != tt.err {
			t.Errorf("parseDuration(%q) error = %v, wantErr %v", tt.in, err, tt.err)
			continue
		}
		if !tt.err && got != tt.want {
			t.Errorf("parseDuration(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestDeriveWebhookKey(t *testing.T) {
	k1, err := DeriveWebhookKey(testKey)
	if err != nil || len(k1) != 32 {
		t.Fatalf("32-byte secret: %v, len %d", err, len(k1))
	}
	k2, _ := DeriveWebhookKey(testKey)
	if !bytes.Equal(k1, k2) {
		t.Fatal("derivation is not deterministic")
	}
	raw, _ := base64.StdEncoding.DecodeString(testKey)
	if bytes.Equal(k1, raw) {
		t.Fatal("derived key must differ from the input secret")
	}
	long := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 64))
	if k3, err := DeriveWebhookKey(long); err != nil || len(k3) != 32 || bytes.Equal(k3, k1) {
		t.Fatalf("64-byte secret: %v %x", err, k3)
	}
	short := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 31))
	if _, err := DeriveWebhookKey(short); err == nil {
		t.Fatal("31-byte secret must be rejected")
	}
}

func TestMaskMongoURI(t *testing.T) {
	tests := []struct{ in, want string }{
		{"mongodb://localhost/db?replicaSet=rs0", "mongodb://localhost/db?replicaSet=rs0"},
		{"mongodb://u:pw@h1,h2/db?authSource=admin", "mongodb://***@h1,h2/db?authSource=admin"},
		{"mongodb+srv://u:p%2Fw@cluster.example.org/db", "mongodb+srv://***@cluster.example.org/db"},
		{"mongodb://u:p/w@h/db", "mongodb://***@h/db"},
		{"mongodb://h/db?authMechanismProperties=AWS_SESSION_TOKEN:tok&w=1", "mongodb://h/db?authMechanismProperties=***&w=1"},
		{"garbage", "***"},
	}
	for _, tt := range tests {
		if got := MaskMongoURI(tt.in); got != tt.want {
			t.Errorf("MaskMongoURI(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestEffectiveConfigLogMasksSecrets(t *testing.T) {
	m := validEnv()
	m["MONGO_URI"] = "mongodb://dbuser:mongo-secret-pw@localhost/ph?replicaSet=rs0"
	m["SMTP_PASSWORD"] = "smtp-secret-pw"
	c, err := Load(env(m))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("effective configuration", "config", c)
	out := buf.String()
	if strings.Count(out, "\n") != 1 {
		t.Fatalf("want one log line, got %q", out)
	}
	derived := base64.StdEncoding.EncodeToString(c.WebhookKey)
	for _, secret := range []string{"mongo-secret-pw", "dbuser", "smtp-secret-pw", testKey, derived} {
		if strings.Contains(out, secret) {
			t.Errorf("log line leaks %q: %s", secret, out)
		}
	}
	for _, want := range []string{`"ALLOWED_ROLES":"unrestricted"`, `"WEBHOOK_ENCRYPTION_KEY":"***"`, `"SMTP_PASSWORD":"***"`,
		`"MONGO_URI":"mongodb://***@localhost/ph?replicaSet=rs0"`, `"METRICS_LISTEN_ADDR":":9090"`, `"LOG_LEVEL":"info"`} {
		if !strings.Contains(out, want) {
			t.Errorf("log line lacks %s: %s", want, out)
		}
	}
}
