package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"go.mongodb.org/mongo-driver/v2/bson"
	"gopkg.in/yaml.v3"

	"github.com/OWNER/procurement-hub/internal/authz"
	"github.com/OWNER/procurement-hub/internal/domain"
	"github.com/OWNER/procurement-hub/internal/store"
)

type RoleMappings struct{ st *store.Store }

func NewRoleMappings(st *store.Store) *RoleMappings { return &RoleMappings{st: st} }

type ruleFile struct {
	Rules []struct {
		ID          string `yaml:"id"`
		Claim       string `yaml:"claim"`
		Pattern     string `yaml:"pattern"`
		Team        string `yaml:"team"`
		Role        string `yaml:"role"`
		Enabled     *bool  `yaml:"enabled"`
		Description string `yaml:"description"`
	} `yaml:"rules"`
}

// ParseRuleFile parses and validates a managed rules YAML document (spec §7.4).
// Rules default to enabled. Any invalid rule is an error.
func ParseRuleFile(data []byte) ([]domain.RoleMapping, error) {
	var f ruleFile
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&f); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse role mappings: %w", err)
	}
	seen := map[string]bool{}
	out := make([]domain.RoleMapping, 0, len(f.Rules))
	for i, r := range f.Rules {
		if r.ID == "" {
			return nil, fmt.Errorf("rule #%d: id is required", i+1)
		}
		if seen[r.ID] {
			return nil, fmt.Errorf("rule %q: duplicate id", r.ID)
		}
		seen[r.ID] = true
		m := domain.RoleMapping{
			ID: r.ID, Claim: domain.Claim(r.Claim), Pattern: r.Pattern, Team: r.Team,
			Role: domain.Role(r.Role), Enabled: r.Enabled == nil || *r.Enabled, Managed: true, Description: r.Description,
		}
		if err := m.Validate(); err != nil {
			return nil, fmt.Errorf("rule %q: %w", r.ID, err)
		}
		out = append(out, m)
	}
	return out, nil
}

// LoadFile syncs managed rules from path on startup. Invalid files abort startup.
func (s *RoleMappings) LoadFile(ctx context.Context, path string) error {
	if path == "" {
		return nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read ROLE_MAPPINGS_FILE: %w", err)
	}
	rules, err := ParseRuleFile(data)
	if err != nil {
		return err
	}
	return s.st.SyncManagedRoleMappings(ctx, rules)
}

func (s *RoleMappings) List(ctx context.Context, actor authz.Actor) ([]domain.RoleMapping, error) {
	if !actor.IsSystemAdmin {
		return nil, ErrForbidden
	}
	return s.st.ListRoleMappings(ctx)
}

// Create adds a UI-managed (managed=false) rule at version 1.
func (s *RoleMappings) Create(ctx context.Context, actor authz.Actor, m domain.RoleMapping) (*domain.RoleMapping, error) {
	if !actor.IsSystemAdmin {
		return nil, ErrForbidden
	}
	m.ID, m.Managed = bson.NewObjectID().Hex(), false
	if err := m.Validate(); err != nil {
		return nil, Invalid("rule", err.Error())
	}
	if err := s.st.InsertRoleMapping(ctx, &m); err != nil {
		return nil, err
	}
	return &m, nil
}

// Replace replaces all editable fields of a UI-managed rule (omitted fields
// are cleared). Managed rules are read-only.
func (s *RoleMappings) Replace(ctx context.Context, actor authz.Actor, id string, version int64, in domain.RoleMapping) (*domain.RoleMapping, error) {
	if !actor.IsSystemAdmin {
		return nil, ErrForbidden
	}
	cur, err := s.st.GetRoleMapping(ctx, id)
	if err != nil {
		return nil, mapStore(err)
	}
	if cur.Managed {
		return nil, Rule("ROLE_MAPPING_MANAGED", "Managed rules are read-only.")
	}
	in.ID, in.Managed = id, false
	if err := in.Validate(); err != nil {
		return nil, Invalid("rule", err.Error())
	}
	out, err := s.st.ReplaceRoleMapping(ctx, in, version)
	return out, mapStore(err)
}

func (s *RoleMappings) Delete(ctx context.Context, actor authz.Actor, id string, version int64) error {
	if !actor.IsSystemAdmin {
		return ErrForbidden
	}
	m, err := s.st.GetRoleMapping(ctx, id)
	if err != nil {
		return mapStore(err)
	}
	if m.Managed {
		return Rule("ROLE_MAPPING_MANAGED", "Managed rules are read-only.")
	}
	return mapStore(s.st.DeleteRoleMappingVersioned(ctx, id, version))
}
