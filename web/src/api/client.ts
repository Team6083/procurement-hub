import { readApiError } from '@team6083/ui';

export interface ApiClientOptions {
  /** Base URL of the API origin, e.g. https://api.example.org (no /api/v1 suffix). */
  baseUrl: string;
  /** Returns the current access token, or undefined when unauthenticated. */
  getToken: () => Promise<string | undefined> | string | undefined;
  /** Attempts one token renewal; returns the new access token or undefined on failure. */
  renew: () => Promise<string | undefined>;
  /** Called when authentication cannot be recovered (starts signinRedirect). */
  onAuthFailure: () => void | Promise<void>;
  /** Called when the API answers 403 missing_role: the user lacks ALLOWED_ROLES (spec section 7.1). */
  onMissingRole?: () => void;
  /** The fetch to use; the app passes useCommitCheckedFetch(), which flags a newer server build and refuses writes then. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Set false for unauthenticated endpoints such as GET /meta. */
  auth?: boolean;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  function buildUrl(path: string, query: RequestOptions['query']): string {
    const url = new URL(`/api/v1${path}`, opts.baseUrl);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async function send(method: string, path: string, o: RequestOptions, token: string | undefined) {
    const headers: Record<string, string> = { Accept: 'application/json', ...o.headers };
    if (o.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await doFetch(buildUrl(path, o.query), {
      method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
    });
    return res;
  }

  async function request<T>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const useAuth = o.auth !== false;
    let res = await send(method, path, o, useAuth ? await opts.getToken() : undefined);
    if (res.status === 401 && useAuth) {
      const renewed = await opts.renew().catch(() => undefined);
      if (renewed) res = await send(method, path, o, renewed);
      if (!renewed || res.status === 401) {
        await opts.onAuthFailure();
        throw await readApiError(res);
      }
    }
    if (!res.ok) {
      const err = await readApiError(res);
      if (err.status === 403 && err.code === 'missing_role') opts.onMissingRole?.();
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    request,
    get: <T>(path: string, o?: RequestOptions) => request<T>('GET', path, o),
    post: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('POST', path, { ...o, body }),
    put: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PUT', path, { ...o, body }),
    patch: <T>(path: string, body?: unknown, o?: RequestOptions) => request<T>('PATCH', path, { ...o, body }),
    delete: <T>(path: string, o?: RequestOptions) => request<T>('DELETE', path, o),
  };
}


