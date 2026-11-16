package config

import (
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
)

// webhookKeyInfo is the HKDF "info" label for the webhook URL key. Changing
// it changes the derived key and makes stored webhook URLs undecryptable.
const webhookKeyInfo = "procurement-hub webhook url v1"

// MinSecretBytes is the minimum decoded length of a base64 key setting.
const MinSecretBytes = 32

// DeriveWebhookKey decodes WEBHOOK_ENCRYPTION_KEY (standard base64, at least
// 32 bytes once decoded) and derives the 32-byte AES-256-GCM key used to
// encrypt team channel webhook URLs, with HKDF-SHA256.
func DeriveWebhookKey(b64 string) ([]byte, error) {
	secret, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, errors.New("must be standard base64")
	}
	if len(secret) < MinSecretBytes {
		return nil, fmt.Errorf("must decode to at least %d bytes, got %d", MinSecretBytes, len(secret))
	}
	return hkdf.Key(sha256.New, secret, nil, webhookKeyInfo, 32)
}

const masked = "***"

// LogValue renders the effective configuration for the startup log line with
// every secret masked (credentials in MONGO_URI, the webhook key,
// SMTP_PASSWORD). It is the only way Config should be logged.
func (c *Config) LogValue() slog.Value {
	metrics := c.MetricsListenAddr
	if metrics == "" {
		metrics = MetricsOff
	}
	allowed := "unrestricted"
	if c.AllowedRoles != nil {
		allowed = strings.Join(c.AllowedRoles, ",")
	}
	secret := func(set bool) string {
		if set {
			return masked
		}
		return ""
	}
	decimals := "iso"
	if c.BaseCurrencyDecimals >= 0 {
		decimals = fmt.Sprint(c.BaseCurrencyDecimals)
	}
	return slog.GroupValue(
		slog.String("LISTEN_ADDR", c.ListenAddr),
		slog.String("METRICS_LISTEN_ADDR", metrics),
		slog.String("LOG_LEVEL", strings.ToLower(c.LogLevel.String())),
		slog.String("SHUTDOWN_TIMEOUT", c.ShutdownTimeout.String()),
		slog.String("CORS_ALLOWED_ORIGINS", strings.Join(c.CORSAllowedOrigins, ",")),
		slog.String("FRONTEND_URL", c.FrontendURL),
		slog.String("MONGO_URI", MaskMongoURI(c.MongoURI)),
		slog.String("mongoDatabase", c.MongoDatabase),
		slog.String("OIDC_ISSUER", c.OIDCIssuer),
		slog.String("OIDC_AUDIENCE", c.OIDCAudience),
		slog.String("OIDC_CLOCK_SKEW", c.OIDCClockSkew.String()),
		slog.String("OIDC_GROUPS_CLAIM", c.OIDCGroupsClaim),
		slog.String("ADMIN_ROLES", strings.Join(c.AdminRoles, ",")),
		slog.String("PURCHASER_ROLES", strings.Join(c.PurchaserRoles, ",")),
		slog.String("RECEIVER_ROLES", strings.Join(c.ReceiverRoles, ",")),
		slog.String("ALLOWED_ROLES", allowed),
		slog.String("ROLE_MAPPINGS_FILE", c.RoleMappingsFile),
		slog.String("WEBHOOK_ENCRYPTION_KEY", secret(len(c.WebhookKey) > 0)),
		slog.String("BASE_CURRENCY", c.BaseCurrency),
		slog.String("BASE_CURRENCY_DECIMALS", decimals),
		slog.String("SUPPORTED_CURRENCIES", strings.Join(c.SupportedCurrencies, ",")),
		slog.Bool("EMAIL_ENABLED", c.EmailEnabled),
		slog.String("SMTP_HOST", c.SMTPHost),
		slog.String("SMTP_PORT", c.SMTPPort),
		slog.String("SMTP_USERNAME", c.SMTPUsername),
		slog.String("SMTP_PASSWORD", secret(c.SMTPPassword != "")),
		slog.String("SMTP_FROM", c.SMTPFrom),
		slog.String("SMTP_TLS_MODE", c.SMTPTLSMode),
		slog.String("NOTIFY_DIGEST_WINDOW", c.NotifyDigestWindow.String()),
		slog.String("LOOKUP_PROVIDER", c.LookupProvider),
		slog.String("PARTFINDER_URL", c.PartfinderURL),
		slog.String("PARTFINDER_PRICE_CURRENCY", c.PartfinderPriceCurrency),
		slog.String("LOOKUP_TIMEOUT", c.LookupTimeout.String()),
	)
}

// secretQueryOptions are MongoDB URI options whose values can hold secrets.
var secretQueryOptions = map[string]bool{
	"authmechanismproperties":       true,
	"tlscertificatekeyfilepassword": true,
}

// MaskMongoURI replaces the user info and secret-bearing options of a MongoDB
// connection string with "***".
func MaskMongoURI(uri string) string {
	scheme, rest, ok := strings.Cut(uri, "://")
	if !ok {
		return masked // unparseable: show nothing that could be a secret
	}
	// Mask up to the last "@" anywhere: this over-masks rather than leaking
	// a password that contains an unescaped "/", "?" or "@".
	if at := strings.LastIndex(rest, "@"); at >= 0 {
		rest = masked + rest[at:]
	}
	base, query, hasQuery := strings.Cut(rest, "?")
	if !hasQuery {
		return scheme + "://" + base
	}
	parts := strings.Split(query, "&")
	for i, p := range parts {
		k, _, _ := strings.Cut(p, "=")
		if name, err := url.QueryUnescape(k); err != nil || secretQueryOptions[strings.ToLower(name)] {
			parts[i] = k + "=" + masked
		}
	}
	return scheme + "://" + base + "?" + strings.Join(parts, "&")
}
