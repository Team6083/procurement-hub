// Package app assembles the HTTP application (middleware chain and routes) so
// that production code and HTTP-level tests share exactly the same router.
package app

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/team6083/procurement-hub/server/internal/audit"
	"github.com/team6083/procurement-hub/server/internal/config"
	"github.com/team6083/procurement-hub/server/internal/domain"
	"github.com/team6083/procurement-hub/server/internal/httpapi"
	"github.com/team6083/procurement-hub/server/internal/ops"
	"github.com/team6083/procurement-hub/server/internal/service"
	"github.com/team6083/procurement-hub/server/internal/store"
)

// Deps are the collaborators the HTTP application needs.
type Deps struct {
	Config       *config.Config
	Store        *store.Store
	Verifier     httpapi.TokenVerifier
	RoleMappings *service.RoleMappings
	Version      httpapi.Version
	Metrics      *ops.HTTPMetrics // optional
	Logger       *slog.Logger     // access log; nil means slog.Default()
}

// NewHandler builds the API router. It also returns the batch service so
// background jobs can share it.
func NewHandler(d Deps) (http.Handler, *service.Batches) {
	cfg, st := d.Config, d.Store
	r := chi.NewRouter()
	// Order matters: common headers first so every response (errors and
	// CORS preflights included) carries them; Instrument wraps everything
	// below so the access log sees the final status.
	r.Use(ops.NoSniff)
	r.Use(ops.RequestID)
	r.Use(httpapi.VersionHeaders(d.Version))
	r.Use(ops.Instrument(ops.InstrumentOptions{Metrics: d.Metrics, Logger: d.Logger}))
	r.Use(httpapi.Recover(d.Logger))
	r.Use(httpapi.CORS(cfg.CORSAllowedOrigins))
	r.Use(httpapi.MaxBody(1 << 20))

	httpapi.MountMeta(r, httpapi.MetaInfo{
		BaseCurrency:        cfg.BaseCurrency,
		SupportedCurrencies: cfg.SupportedCurrencies,
		LookupEnabled:       cfg.LookupProvider != "none",
		EmailEnabled:        cfg.EmailEnabled,
	})

	log := audit.New(st.DB)
	identity := service.NewIdentity(st, log)
	teams := service.NewTeams(st, log, cfg.BaseCurrency, cfg.SupportedCurrencies)
	users := service.NewUsers(st)
	batches := service.NewBatches(st, log, cfg.SupportedCurrencies,
		domain.Currencies{Base: cfg.BaseCurrency, BaseDecimals: cfg.BaseCurrencyDecimals})
	items := service.NewItems(st, log, batches)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(httpapi.Authenticate(d.Verifier, d.Config.AllowedRoles, identity, teams))
		(&httpapi.TeamsAPI{Teams: teams}).Mount(r)
		(&httpapi.VendorsAPI{Vendors: service.NewVendors(st, log, cfg.BaseCurrency, cfg.SupportedCurrencies)}).Mount(r)
		(&httpapi.MeAPI{Users: users, RoleMappings: d.RoleMappings}).Mount(r)
		(&httpapi.BatchesAPI{
			Batches: batches, Items: items, Tasks: service.NewTasks(st),
			Timeline: service.NewTimeline(st, log, batches, items),
		}).Mount(r)
	})
	return r, batches
}
