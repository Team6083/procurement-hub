import { describe, expect, it } from 'vitest';
import type { Team } from '../../api/types';
import { diffGeneral, toForm } from './general';
import { cleanPriorityLabels, priorityLabel } from './priority';
import { selectableCurrencies } from './rates';
import { createTeamSchema, isPositiveDecimal, ratesSchema, roleMappingSchema } from './schemas';

const team = {
  id: '1', slug: 't', name: 'Lab', description: 'd', visibility: 'public', locale: 'en',
  priorityLabels: { '5': 'Urgent' }, subgroups: [], referenceRates: [], archived: false,
  createdAt: '', updatedAt: '', version: 3,
} as Team;

describe('priority labels', () => {
  it('falls back to the default label when blank', () => {
    const def = (k: string) => `default ${k}`;
    expect(priorityLabel({ '5': 'Urgent' }, '5', def)).toBe('Urgent');
    expect(priorityLabel({ '5': '  ' }, '5', def)).toBe('default 5');
    expect(priorityLabel(null, '3', def)).toBe('default 3');
  });
  it('drops blank labels from the request', () => {
    expect(cleanPriorityLabels({ '1': ' a ', '2': '', '5': '  ' })).toEqual({ '1': 'a' });
  });
});

describe('diffGeneral', () => {
  it('sends only changed fields', () => {
    expect(diffGeneral(team, toForm(team))).toEqual({});
    const f = toForm(team);
    f.name = ' New ';
    f.priority['2'] = 'Two';
    expect(diffGeneral(team, f)).toEqual({ name: 'New', priorityLabels: { '5': 'Urgent', '2': 'Two' } });
  });
});

describe('schemas', () => {
  it('validates slugs like the server', () => {
    const ok = { name: 'n', description: '', firstAdminUserId: 'u' };
    expect(createTeamSchema.safeParse({ ...ok, slug: 'my-team-2' }).success).toBe(true);
    for (const slug of ['', 'My', '-a', 'a-', 'a--b', 'a_b']) expect(createTeamSchema.safeParse({ ...ok, slug }).success).toBe(false);
  });
  it('accepts only positive decimal strings', () => {
    for (const v of ['1', '0.5', '.25', '12.340']) expect(isPositiveDecimal(v)).toBe(true);
    for (const v of ['', '0', '0.0', '-1', '1e3', 'abc', '1,5']) expect(isPositiveDecimal(v)).toBe(false);
  });
  it('rejects duplicate currencies in the rate list', () => {
    const r = ratesSchema.safeParse({ rates: [{ currency: 'USD', rateToBase: '30' }, { currency: 'USD', rateToBase: '31' }] });
    expect(r.success).toBe(false);
  });
  it('requires pattern and team for role mappings', () => {
    const base = { claim: 'groups', pattern: '/teams/*/members', team: '$1', role: 'member', enabled: true, description: '' };
    expect(roleMappingSchema.safeParse(base).success).toBe(true);
    expect(roleMappingSchema.safeParse({ ...base, pattern: ' ' }).success).toBe(false);
  });
  it('excludes the base currency from selectable rates', () => {
    expect(selectableCurrencies(['TWD', 'USD', 'EUR'], 'TWD')).toEqual(['USD', 'EUR']);
  });
});
