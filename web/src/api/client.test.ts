import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { ApiError, VersionMismatchError } from './errors';
import { checkCommit, createVersionStore } from './versionGuard';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function setup(responses: Response[], commit = 'abc') {
  const store = createVersionStore();
  const fetchImpl = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => {
    const r = responses.shift();
    if (!r) throw new Error('no more responses');
    return r;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  const onAuthFailure = vi.fn();
  const renew = vi.fn(async () => 'new-token' as string | undefined);
  const onMissingRole = vi.fn();
  const client = createApiClient({
    baseUrl: 'https://api.example.org',
    getToken: () => 'old-token',
    renew,
    onAuthFailure,
    onMissingRole,
    appCommit: commit,
    store,
    fetchImpl,
  });
  return { client, store, fetchImpl: fetchImpl as unknown as ReturnType<typeof vi.fn>, renew, onAuthFailure, onMissingRole };
}

describe('checkCommit', () => {
  it('flags only a real mismatch', () => {
    const store = createVersionStore();
    expect(checkCommit(null, 'abc', store)).toBe(false);
    expect(checkCommit('abc', 'abc', store)).toBe(false);
    expect(checkCommit('unknown', 'abc', store)).toBe(false);
    expect(checkCommit('abc', 'unknown', store)).toBe(false);
    expect(store.isMismatch()).toBe(false);
    expect(checkCommit('def', 'abc', store)).toBe(true);
    expect(store.isMismatch()).toBe(true);
  });
});

describe('api client', () => {
  it('adds bearer token and prefixes /api/v1', async () => {
    const { client, fetchImpl } = setup([json(200, { ok: 1 })]);
    await client.get('/x', { query: { a: 1 } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.example.org/api/v1/x?a=1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer old-token');
  });

  it('omits token for auth:false', async () => {
    const { client, fetchImpl } = setup([json(200, {})]);
    await client.get('/meta', { auth: false });
    expect((fetchImpl.mock.calls[0]![1].headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('parses the error envelope', async () => {
    const { client } = setup([json(409, { error: { code: 'version_conflict', message: 'm', details: { a: 1 } } })]);
    const err = await client.get('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'version_conflict', message: 'm', details: { a: 1 } });
  });

  it('renews once on 401 and retries', async () => {
    const { client, renew, fetchImpl, onAuthFailure } = setup([json(401, { error: { code: 'unauthenticated', message: 'x' } }), json(200, { ok: true })]);
    await expect(client.get('/x')).resolves.toEqual({ ok: true });
    expect(renew).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[1]![1].headers as Record<string, string>).Authorization).toBe('Bearer new-token');
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('signs in again when retry still 401', async () => {
    const e = { error: { code: 'unauthenticated', message: 'x' } };
    const { client, fetchImpl, onAuthFailure } = setup([json(401, e), json(401, e)]);
    await expect(client.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('signs in again when renewal fails', async () => {
    const { client, renew, onAuthFailure, fetchImpl } = setup([json(401, { error: { code: 'unauthenticated', message: 'x' } })]);
    renew.mockResolvedValueOnce(undefined);
    await expect(client.get('/x')).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
  });

  it('flags mismatch from any response and then blocks non-GET only', async () => {
    const { client, store, fetchImpl } = setup([json(200, {}, { 'X-App-Commit': 'other' }), json(200, { r: 1 })]);
    await client.get('/meta', { auth: false });
    expect(store.isMismatch()).toBe(true);
    await expect(client.post('/x', {})).rejects.toBeInstanceOf(VersionMismatchError);
    await expect(client.delete('/x')).rejects.toBeInstanceOf(VersionMismatchError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // blocked before hitting the network
    await expect(client.get('/x')).resolves.toEqual({ r: 1 });
  });

  it('allows mutations when commits match', async () => {
    const { client } = setup([json(200, { ok: 1 }, { 'X-App-Commit': 'abc' })]);
    await expect(client.post('/x', {})).resolves.toEqual({ ok: 1 });
  });

  it('passes If-Match through and handles 204', async () => {
    const { client, fetchImpl } = setup([new Response(null, { status: 204 })]);
    const r = await client.delete('/x', { headers: { 'If-Match': '"2"' } });
    expect(r).toBeUndefined();
    expect((fetchImpl.mock.calls[0]![1].headers as Record<string, string>)['If-Match']).toBe('"2"');
  });

  it('reports 403 missing_role (and only that 403) as denied access', async () => {
    const { client, onMissingRole } = setup([
      json(403, { error: { code: 'forbidden', message: 'no' } }),
      json(403, { error: { code: 'missing_role', message: 'no' } }),
    ]);
    const first = await client.get('/teams/1').catch((e) => e);
    expect(first).toBeInstanceOf(ApiError);
    expect(onMissingRole).not.toHaveBeenCalled();
    const second = await client.get('/me').catch((e) => e);
    expect((second as ApiError).code).toBe('missing_role');
    expect(onMissingRole).toHaveBeenCalledTimes(1);
  });
});
