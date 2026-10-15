package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func validEnv() map[string]string {
	return map[string]string{
		"APP_FRONTEND_ORIGINS": "https://app.example.org, https://other.example.org/",
		"APP_FRONTEND_URL":     "https://app.example.org",
		"APP_ENCRYPTION_KEY":   "MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=",
		"MONGODB_URI":          "mongodb://localhost/?replicaSet=rs0",
		"OIDC_ISSUER_URL":      "https://sso.example.org/realms/example",
		"OIDC_AUDIENCE":        "procurement-hub",
	}
}

func TestLoadDefaults(t *testing.T) {
	c, err := Load(env(validEnv()))
	if err != nil {
		t.Fatal(err)
	}
	if c.BaseCurrency != "USD" || len(c.SupportedCurrencies) != 1 || c.BaseCurrencyDecimals != -1 {
		t.Fatalf("unexpected defaults: %+v", c)
	}
	if len(c.FrontendOrigins) != 2 || c.FrontendOrigins[1] != "https://other.example.org" {
		t.Fatalf("origins: %v", c.FrontendOrigins)
	}
	if c.OIDCClockSkew.Seconds() != 60 || c.OIDCRolesClaim != "realm_access.roles" {
		t.Fatalf("oidc defaults: %+v", c)
	}
}

func TestLoadErrors(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(map[string]string)
		want   string
	}{
		{"missing mongo", func(m map[string]string) { delete(m, "MONGODB_URI") }, "MONGODB_URI is required"},
		{"bad key", func(m map[string]string) { m["APP_ENCRYPTION_KEY"] = "c2hvcnQ=" }, "32-byte"},
		{"origin with path", func(m map[string]string) { m["APP_FRONTEND_ORIGINS"] = "https://a.example/x" }, "not an origin"},
		{"partfinder w/o url", func(m map[string]string) { m["LOOKUP_PROVIDER"] = "partfinder" }, "PARTFINDER_URL"},
		{"email w/o smtp", func(m map[string]string) { m["EMAIL_ENABLED"] = "true" }, "SMTP_HOST"},
		{"bad duration", func(m map[string]string) { m["OIDC_CLOCK_SKEW"] = "x" }, "OIDC_CLOCK_SKEW"},
		{"bad currency", func(m map[string]string) { m["APP_BASE_CURRENCY"] = "TWDD" }, "ISO 4217"},
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
