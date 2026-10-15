package main

import (
	"github.com/go-chi/chi/v5"

	"github.com/OWNER/procurement-hub/internal/audit"
	"github.com/OWNER/procurement-hub/internal/auth"
	"github.com/OWNER/procurement-hub/internal/config"
	"github.com/OWNER/procurement-hub/internal/httpapi"
	"github.com/OWNER/procurement-hub/internal/service"
	"github.com/OWNER/procurement-hub/internal/store"
)

// mountAPI registers /api/v1 routes. Only GET /meta is unauthenticated.
// It returns the batch service so background jobs can share it.
func mountAPI(r chi.Router, cfg *config.Config, st *store.Store, verifier *auth.Verifier, roleMappings *service.RoleMappings) *service.Batches {
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
	batches := service.NewBatches(st, log, cfg.SupportedCurrencies)
	items := service.NewItems(st, log, batches)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(httpapi.Authenticate(verifier, identity, teams))
		(&httpapi.TeamsAPI{Teams: teams}).Mount(r)
		(&httpapi.MeAPI{Users: users, RoleMappings: roleMappings}).Mount(r)
		(&httpapi.BatchesAPI{
			Batches: batches, Items: items, Tasks: service.NewTasks(st),
			Timeline: service.NewTimeline(st, log, batches, items),
		}).Mount(r)
	})
	return batches
}
