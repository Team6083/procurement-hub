// Package app assembles the HTTP application (middleware chain and routes) so
// that production code and HTTP-level tests share exactly the same router.
package app

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/OWNER/procurement-hub/internal/audit"
	"github.com/OWNER/procurement-hub/internal/config"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/httpapi"
	"github.com/OWNER/procurement-hub/internal/service"
	"github.com/OWNER/procurement-hub/internal/store"
)

// Deps are the collaborators the HTTP application needs.
type Deps struct {
	Config       *config.Config
	Store        *store.Store
	Verifier     httpapi.TokenVerifier
	RoleMappings *service.RoleMappings
	Version      httpapi.Version
	Metrics      *httpapi.Metrics // optional
}

// NewHandler builds the API router. It also returns the batch service so
// background jobs can share it.
func NewHandler(d Deps) (http.Handler, *service.Batches) {
	cfg, st := d.Config, d.Store
	r := chi.NewRouter()
	r.Use(httpapi.VersionHeaders(d.Version))
	r.Use(httpapi.CORS(cfg.FrontendOrigins))
	if d.Metrics != nil {
		r.Use(d.Metrics.Instrument)
	}
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
		r.Use(httpapi.Authenticate(d.Verifier, identity, teams))
		(&httpapi.TeamsAPI{Teams: teams}).Mount(r)
		(&httpapi.MeAPI{Users: users, RoleMappings: d.RoleMappings}).Mount(r)
		(&httpapi.BatchesAPI{
			Batches: batches, Items: items, Tasks: service.NewTasks(st),
			Timeline: service.NewTimeline(st, log, batches, items),
		}).Mount(r)
	})
	return r, batches
}
