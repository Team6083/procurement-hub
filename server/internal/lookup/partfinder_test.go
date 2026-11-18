package lookup

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func serve(t *testing.T, status int, body string, delay time.Duration) *Partfinder {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/lookup" || r.URL.Query().Get("q") != "ABC 1" {
			t.Errorf("unexpected request %s", r.URL)
		}
		time.Sleep(delay)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return &Partfinder{BaseURL: srv.URL, DefaultCurrency: "USD", Timeout: 200 * time.Millisecond}
}

func TestPartfinder(t *testing.T) {
	ctx := context.Background()

	r, err := serve(t, 200, `{"name":"Motor","store":"WCP","sku":"WCP-1","url":"https://x/y","inStock":true,"price":12.5,"extra":1}`, 0).Lookup(ctx, "ABC 1")
	if err != nil || r.Name != "Motor" || r.Vendor != "WCP" || r.SKU != "WCP-1" || r.URL != "https://x/y" || r.InStock == nil || !*r.InStock {
		t.Fatalf("found: %+v %v", r, err)
	}
	if r.UnitPrice.Amount.String() != "12.5" || r.UnitPrice.Currency != "USD" {
		t.Errorf("price number + default currency: %+v", r.UnitPrice)
	}

	r, err = serve(t, 200, `{"name":"M","store":"S","price":"3.20","currency":"twd"}`, 0).Lookup(ctx, "ABC 1")
	if err != nil || r.UnitPrice.Amount.String() != "3.2" || r.UnitPrice.Currency != "TWD" {
		t.Errorf("price string + currency: %+v %v", r, err)
	}

	if _, err := serve(t, 404, `{}`, 0).Lookup(ctx, "ABC 1"); !errors.Is(err, ErrNotFound) {
		t.Errorf("404: %v", err)
	}
	if _, err := serve(t, 500, `boom`, 0).Lookup(ctx, "ABC 1"); !errors.Is(err, ErrUpstream) {
		t.Errorf("500: %v", err)
	}
	if _, err := serve(t, 200, `{}`, time.Second).Lookup(ctx, "ABC 1"); !errors.Is(err, ErrTimeout) {
		t.Errorf("timeout: %v", err)
	}
}
