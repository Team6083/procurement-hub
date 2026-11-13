import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { vi } from 'vitest';
import { createApiClient } from '../api/client';
import { ApiContext } from '../api/context';
import { createVersionStore } from '../api/versionGuard';
import type { Batch, Item, Me, Team, TeamMember } from '../api/types';
import { TestProviders } from './render';

type Handler = (body: unknown, url: URL) => unknown;
/** Routes are "METHOD /path" (path after /api/v1, without query). */
export type Routes = Record<string, Handler | unknown>;

const STATUS = Symbol('status');

/** A route result that answers with an API error envelope. */
export function apiError(status: number, code: string) {
  return { [STATUS]: status, error: { code, message: code } };
}

/** A real API client over a fake fetch, so pages exercise the same request code as in production. */
export function fakeApi(routes: Routes, opts: { onMissingRole?: () => void } = {}) {
  const calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const key = `${method} ${path}`;
    if (!(key in routes)) {
      return new Response(JSON.stringify({ error: { code: 'not_found', message: key } }), { status: 404 });
    }
    const r = routes[key];
    const data = typeof r === 'function' ? (r as Handler)(body, url) : r;
    const status = (data as { [STATUS]?: number } | undefined)?.[STATUS] ?? 200;
    const version = (data as { version?: number } | undefined)?.version;
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...(version ? { ETag: `"${version}"` } : {}) },
    });
  });
  const client = createApiClient({
    baseUrl: 'https://api.example.org',
    getToken: () => 'token',
    renew: async () => undefined,
    onAuthFailure: () => undefined,
    appCommit: 'unknown',
    store: createVersionStore(),
    fetchImpl: fetchImpl as unknown as typeof fetch,
    onMissingRole: opts.onMissingRole,
  });
  return { client, calls };
}

export function renderWithApi(ui: ReactElement, routes: Routes, opts: { onMissingRole?: () => void } = {}) {
  const api = fakeApi(routes, opts);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={api.client}>
        <TestProviders>{children}</TestProviders>
      </ApiContext.Provider>
    </QueryClientProvider>
  );
  return { ...api, qc, ...render(ui, { wrapper }) };
}

const at = '2026-01-01T00:00:00Z';

export function team(over: Partial<Team> = {}): Team {
  return {
    id: 't1', slug: 'robotics', name: 'Robotics', description: '', visibility: 'members', locale: 'en',
    priorityLabels: null, subgroups: [{ id: 'g1', name: 'Mechanical', active: true }, { id: 'g2', name: 'Electrical', active: true }],
    referenceRates: [{ currency: 'USD', rateToBase: '32' } as Team['referenceRates'][number]],
    archived: false, createdAt: at, updatedAt: at, version: 3, ...over,
  };
}

export function me(over: Partial<Me> = {}): Me {
  return {
    id: 'u1', username: 'alice', email: 'alice@example.org', displayName: 'Alice', locale: null, notificationPrefs: null,
    createdAt: at, updatedAt: at, version: 1, isSystemAdmin: false,
    memberships: [{ teamId: 't1', slug: 'robotics', name: 'Robotics', role: 'admin', ssoRole: '', manualRole: 'admin', defaultSubgroupId: 'g1' }],
    ...over,
  };
}

export function member(id: string, name: string): TeamMember {
  return { userId: id, username: name.toLowerCase(), displayName: name, email: `${name.toLowerCase()}@example.org`, ssoRole: '', manualRole: 'member', effectiveRole: 'member', defaultSubgroupId: '', version: 1 };
}

export function batch(over: Partial<Batch> = {}): Batch {
  return {
    id: 'b1', teamId: 't1', number: 7, title: 'Spring order', description: 'Parts for the arm', status: 'reviewing', origin: 'created',
    createdBy: 'u1', deadline: '2026-03-01T16:30:00Z', assignments: { approvers: ['u1'], purchasers: [], receivers: [] },
    visibilityOverride: '', statusReason: '', statusChangedAt: at, createdAt: at, updatedAt: at, version: 2, ...over,
  };
}

export function item(seqNo: number, over: Partial<Item> = {}): Item {
  return {
    id: `i${seqNo}`, teamId: 't1', batchId: 'b1', seqNo, requesterId: 'u1', subgroupId: 'g1', name: `Item ${seqNo}`, vendor: 'Acme', sku: '',
    quantity: 1, estimatedUnitPrice: { amount: '10', currency: 'USD' }, priority: 3, purpose: '', notes: '', productUrl: '',
    status: 'pending', review: null, lookup: null, orderId: null, actualUnitPrice: null, actualCostBase: null, receivedQuantity: 0,
    closeReason: '', customFields: null, createdAt: at, updatedAt: at, version: 1, ...over,
  };
}
