import { expect, test } from '@playwright/test';
import { openAs } from './support/app';
import { API_NEXT_URL, API_URL, runId } from './support/env';

// Spec section 21.8: a tab of the old frontend stays open while a backend with another commit
// is deployed. serve-next (e2e/docker-compose.yml) is that backend: same database and
// configuration, built with a different commit. Rerouting the tab's API calls to it is the
// deployment from the tab's point of view.
test('a backend with another commit shows the update banner and blocks writes', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'sysadmin', '/batches');
  await expect(page.getByTestId('update-banner')).toHaveCount(0);

  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith(`${API_URL}/api/`) && r.method() !== 'GET' && r.method() !== 'OPTIONS') writes.push(`${r.method()} ${r.url()}`);
  });
  await page.route(`${API_URL}/api/**`, (route) => route.continue({ url: route.request().url().replace(API_URL, API_NEXT_URL) }));

  // Any read answered by the new backend raises the banner; reads keep working.
  const read = page.waitForResponse((r) => r.url().includes('/api/v1/batches?') && r.headers()['x-app-commit']?.endsWith('-next') === true);
  await page.getByLabel('Search').fill(`nothing-${runId()}`);
  expect((await read).ok()).toBe(true);
  const banner = page.getByTestId('update-banner');
  await expect(banner).toContainText('The system has been updated. Please reload the page.');
  await expect(page.getByText('No batches found.')).toBeVisible();

  // Writes are refused in the client and never reach the API.
  await page.getByRole('link', { name: 'My tasks' }).click();
  await page.getByRole('button', { name: 'Create team' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create team' });
  await dialog.getByLabel('Slug').fill(`e2e-${runId()}`);
  await dialog.getByLabel('Name').fill('Never created');
  await dialog.getByRole('combobox', { name: 'First team admin' }).fill('Tara');
  await dialog.getByRole('option', { name: 'Tara Teamadmin (tara@example.org)' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('The system has been updated. Please reload the page.');
  expect(writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Reloading loads the app again; with the matching backend the banner is gone.
  await page.unroute(`${API_URL}/api/**`);
  await banner.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('heading', { name: 'My tasks' })).toBeVisible();
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
  await context.close();
});
