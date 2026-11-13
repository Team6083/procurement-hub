import { expect, test } from '@playwright/test';
import { expectSignedIn, openAs, signInOnKeycloak } from './support/app';

const KEYCLOAK_AUTH = /^http:\/\/keycloak:18180\/realms\/example\/protocol\/openid-connect\/auth\?/;

test.describe('sign-in (spec section 7.1)', () => {
  test('signs in through Keycloak, returns to the route, and survives a reload via the SSO session', async ({ page }) => {
    // A deep link: the route travels through the OIDC state and is restored after /auth/callback.
    await page.goto('/batches?status=collecting');
    await signInOnKeycloak(page, 'alice');
    await expectSignedIn(page, 'alice');
    await expect(page).toHaveURL('/batches?status=collecting');
    await expect(page.getByRole('heading', { name: 'Batches' })).toBeVisible();

    // Tokens are in memory only: nothing token-like in web storage.
    const stored = await page.evaluate(() =>
      [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith('oidc.user')),
    );
    expect(stored).toEqual([]);

    // So a reload must go back to Keycloak, which answers from its SSO session without a form.
    const bounce = page.waitForRequest(KEYCLOAK_AUTH);
    await page.reload();
    await bounce;
    await expectSignedIn(page, 'alice');
    await expect(page).toHaveURL('/batches?status=collecting');
    await expect(page.getByRole('heading', { name: 'Batches' })).toBeVisible();

    // Sign-out ends the SSO session (signoutRedirect with post_logout_redirect_uri = app root):
    // back at the app, the next sign-in shows the Keycloak form again.
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(page).toHaveURL(KEYCLOAK_AUTH);
    await expect(page.getByLabel('Username or email')).toBeVisible();
    await page.goto('/');
    await expect(page.getByLabel('Username or email')).toBeVisible();
  });

  test('renews the access token in the background with the rotated refresh token', async ({ page }) => {
    // Keycloak issues 5-minute access tokens; oidc-client-ts renews a minute before expiry.
    // The browser clock is fast-forwarded to get there; Keycloak runs on real time.
    const refreshes: { status: number; sent: string }[] = [];
    page.on('response', async (r) => {
      const body = r.request().postData() ?? '';
      if (r.url().endsWith('/protocol/openid-connect/token') && body.includes('grant_type=refresh_token')) {
        refreshes.push({ status: r.status(), sent: new URLSearchParams(body).get('refresh_token') ?? '' });
      }
    });
    await page.clock.install();
    await page.goto('/');
    await signInOnKeycloak(page, 'carol');
    await expectSignedIn(page, 'carol');
    let redirects = 0;
    page.on('request', (r) => {
      if (KEYCLOAK_AUTH.test(r.url())) redirects++;
    });

    await page.clock.fastForward('04:30');
    await expect.poll(() => refreshes.length).toBe(1);
    await page.clock.fastForward('04:30');
    await expect.poll(() => refreshes.length).toBeGreaterThanOrEqual(2);
    // Every renewal succeeded, each with the refresh token the previous one returned (rotation:
    // Keycloak rejects a reused one).
    expect(refreshes.map((r) => r.status)).toEqual(refreshes.map(() => 200));
    expect(new Set(refreshes.map((r) => r.sent)).size).toBe(refreshes.length);

    // Still signed in, without a new redirect, and the API accepts the renewed token.
    const me = page.waitForResponse((r) => r.url().includes('/api/v1/batches'));
    await page.getByRole('link', { name: 'Batches' }).click();
    expect((await me).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Batches' })).toBeVisible();
    expect(redirects).toBe(0);
  });

  test('a user without the ALLOWED_ROLES role only sees the no-access page', async ({ page, browser }) => {
    const me = page.waitForResponse((r) => r.url().endsWith('/api/v1/me') && r.request().method() === 'GET');
    await page.goto('/batches');
    await signInOnKeycloak(page, 'nora');
    const res = await me;
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: 'missing_role' } });

    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    await expect(page.getByText("You don't have access to this service. Please contact an admin.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // Nothing else of the app: no header, no navigation, no page content.
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Batches' })).toHaveCount(0);

    // No user record was created: a system admin cannot find her in the user search.
    const admin = await openAs(browser, 'sysadmin');
    await admin.page.getByRole('button', { name: 'Create team' }).click();
    const search = admin.page.getByRole('combobox', { name: 'First team admin' });
    await search.fill('Nora');
    await expect(admin.page.getByText('No users found. Users appear here after their first login.')).toBeVisible();
    await search.fill('Norole');
    await expect(admin.page.getByText('No users found. Users appear here after their first login.')).toBeVisible();
    await admin.context.close();

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Username or email')).toBeVisible();
  });
});
