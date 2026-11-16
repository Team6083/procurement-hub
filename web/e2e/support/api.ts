import { expect, type APIRequestContext, type Browser } from '@playwright/test';
import { expectSignedIn, type Session } from './app';
import { API_URL, storageStatePath, type UserKey } from './env';

/**
 * Opens the app as a user and keeps the bearer token the SPA sends, so a test can set up server state through the
 * API (the SPA holds tokens in memory only, spec section 7.1).
 */
export async function openWithToken(browser: Browser, user: UserKey): Promise<Session & { token: string }> {
  const context = await browser.newContext({ storageState: storageStatePath(user) });
  const page = await context.newPage();
  const request = page.waitForRequest((r) => r.url().startsWith(API_URL) && !!r.headers().authorization);
  await page.goto('/');
  const token = (await request).headers().authorization ?? '';
  await expectSignedIn(page, user);
  return { context, page, token };
}

export interface ApiReply {
  body: Record<string, unknown>;
  etag: string;
}

/** A small client for the API as one user: JSON in and out, optional If-Match, and the status checked. */
export function apiAs(request: APIRequestContext, token: string) {
  return async (method: string, path: string, data?: unknown, ifMatch?: string): Promise<ApiReply> => {
    const res = await request.fetch(`${API_URL}/api/v1${path}`, {
      method, data, headers: { Authorization: token, ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
    });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return { body: (await res.json()) as Record<string, unknown>, etag: res.headers().etag ?? '' };
  };
}
