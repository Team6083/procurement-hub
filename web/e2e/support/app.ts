import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, storageStatePath, users, type UserKey } from './env';

/** Fills in the Keycloak login form the browser was redirected to. */
export async function signInOnKeycloak(page: Page, user: UserKey): Promise<void> {
  await expect(page).toHaveURL(/^http:\/\/keycloak:18180\/realms\/example\/protocol\/openid-connect\/auth/);
  await page.getByLabel('Username or email').fill(users[user].username);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

/** The signed-in shell is up: the header's user menu shows the user's name. */
export async function expectSignedIn(page: Page, user: UserKey): Promise<void> {
  await expect(page.getByRole('button', { name: 'User menu' })).toHaveText(users[user].name);
}

export interface Session {
  context: BrowserContext;
  page: Page;
}

/**
 * A new browser context for a user signed in by auth.setup.ts. Only the Keycloak SSO cookie is
 * stored (tokens live in memory), so this navigation itself goes through the silent sign-in
 * redirect of spec section 7.1.
 */
export async function openAs(browser: Browser, user: UserKey, path = '/'): Promise<Session> {
  const context = await browser.newContext({ storageState: storageStatePath(user) });
  const page = await context.newPage();
  await page.goto(path);
  await expectSignedIn(page, user);
  return { context, page };
}

/** Full reload: a new token through the SSO session (and with it a role-mapping sync). */
export async function reloadSignedIn(page: Page, user: UserKey): Promise<void> {
  await page.reload();
  await expectSignedIn(page, user);
}
