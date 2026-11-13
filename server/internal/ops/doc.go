// Package ops holds the operational side of the HTTP servers (spec §18.2):
// request ids, common response headers, access logs, Prometheus metrics, the
// /healthz, /readyz and /metrics endpoints, and the serve/shutdown lifecycle.
// API handlers live in package httpapi.
package ops
