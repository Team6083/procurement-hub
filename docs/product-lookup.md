# Product lookup

Product lookup fills an item's name, vendor, SKU, price and URL from a SKU or a product URL. The browser never calls the provider; it calls this service, which calls the provider from the server.

## Endpoint

`GET /api/v1/lookup?q=<SKU or product URL>` (bearer token required, 30 requests per minute per user).

| Result | Response |
|---|---|
| Found | `200` with `name`, `vendorId`, `vendorName`, `sku`, `unitPrice` (`{amount, currency}` or `null`), `url`, `inStock` (`true`, `false` or `null`) |
| No result | `404 lookup_not_found` |
| `LOOKUP_PROVIDER=none` | `503 lookup_disabled` |
| Provider failed or unreachable | `503 upstream_unavailable` |
| No answer within `LOOKUP_TIMEOUT` | `504 upstream_timeout` |
| Over the limit | `429 rate_limited` |
| `q` missing | `400 invalid_request` |

Provider error bodies are written to the server log only, never returned.

The provider's store name is matched, case-insensitively, against the names and aliases of the active vendors. On a match, `vendorId` is that vendor and `vendorName` its name. Otherwise `vendorId` is `null` and `vendorName` is the store name as reported (the "other" vendor); a purchaser can later add it as an alias. `unitPrice.amount` is rounded to the currency's minor unit.

## Configuration

See [configuration.md](configuration.md): `LOOKUP_PROVIDER` (`none` or `partfinder`), `PARTFINDER_URL`, `PARTFINDER_PRICE_CURRENCY`, `LOOKUP_TIMEOUT`.

## Provider contract

A provider implements `lookup.ProductLookupProvider` (`server/internal/lookup`):

```go
type ProductLookupProvider interface {
    Lookup(ctx context.Context, query string) (*LookupResult, error)
}
```

`LookupResult` has `Name`, `Vendor` (the store name), `SKU`, `UnitPrice *Money`, `URL` and `InStock *bool`; unknown values are left empty or nil. Errors: `lookup.ErrNotFound` for no result, `lookup.ErrTimeout` for a timeout, and an error wrapping `lookup.ErrUpstream` for anything else. The service never forwards the error text.

### part-finder

The part-finder provider calls `GET {PARTFINDER_URL}/api/v1/lookup?q=...` with no authentication (part-finder is only reachable inside the cluster). Mapping:

- `404` is "no result"; any other non-2xx status or a connection failure is an upstream error; exceeding `LOOKUP_TIMEOUT` is a timeout.
- The body is a single JSON object with camelCase fields `name`, `store`, `sku`, `url`, `inStock`, `price` and optionally `currency`. `store` becomes the vendor. Unknown fields are ignored.
- `price` may be a JSON number or a numeric string. The currency is `currency` when present, else `PARTFINDER_PRICE_CURRENCY`. A missing or null `price` gives no unit price.

**Unconfirmed.** The exact field names and types of part-finder's v1 response (especially `price` and `currency`) are assumed as above, pending part-finder's `api/openapi.yaml`. All parsing is in `partfinderResponse` in `server/internal/lookup/partfinder.go`.

SSRF protection for user-supplied product URLs is part-finder's responsibility; this service only connects to `PARTFINDER_URL`.
