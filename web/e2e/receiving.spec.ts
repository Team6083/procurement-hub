import { expect, test, type APIRequestContext, type Browser } from '@playwright/test';
import type { Session } from './support/app';
import { apiAs, openWithToken } from './support/api';
import { runId, type UserKey } from './support/env';

// The receiving happy path of spec section 10.4: a box is registered, matched on its page with a damaged unit
// (which opens a problem), and a purchaser settles the problem from the receiving workbench. The placed vendor
// order it needs is set up through the API; the purchasing pages have their own tests.
test.describe.configure({ mode: 'serial' });

const id = runId();
const itemName = `Gearbox ${id}`;
const sessions = new Map<UserKey, Session & { token: string }>();
let request: APIRequestContext;
let deliveryPath = '';

async function as(browser: Browser, user: UserKey) {
  let s = sessions.get(user);
  if (!s) {
    s = await openWithToken(browser, user);
    sessions.set(user, s);
  }
  return { ...s, api: apiAs(request, s.token) };
}

test.beforeAll(async ({ playwright }) => {
  request = await playwright.request.newContext();
});

test.afterAll(async () => {
  for (const s of sessions.values()) await s.context.close();
  await request.dispose();
});

test('setup: a placed vendor order line for 3 units', async ({ browser }) => {
  const sys = await as(browser, 'sysadmin');
  const tara = await as(browser, 'tara');
  const pat = await as(browser, 'pat');
  const base = (await sys.api('GET', '/meta')).body.baseCurrency as string;
  const taraId = (await tara.api('GET', '/me')).body.id as string;

  const team = await sys.api('POST', '/teams', { slug: `e2e-r-${id}`, name: `Receiving team ${id}`, description: '', firstAdminUserId: taraId });
  let b = await tara.api('POST', `/teams/${team.body.id as string}/batches`, { title: `Receiving batch ${id}` });
  const bp = `/batches/${b.body.id as string}`;
  b = await tara.api('PATCH', bp, { deadline: new Date(Date.now() + 2 * 86_400_000).toISOString() }, b.etag);
  b = await tara.api('PUT', `${bp}/assignments`, { approvers: [taraId], purchasers: [] }, b.etag);
  await tara.api('POST', `${bp}/transitions`, { action: 'open' }, b.etag);
  const item = await tara.api('POST', `${bp}/items`, { name: itemName, quantity: 3, priority: 3, purpose: 'e2e', estimatedUnitPrice: { amount: '10', currency: base } });
  b = await tara.api('GET', bp);
  await tara.api('POST', `${bp}/transitions`, { action: 'close' }, b.etag);
  b = await tara.api('POST', `${bp}/reviews`, { decisions: [{ itemId: item.body.id, decision: 'approve' }] });
  await tara.api('POST', `${bp}/transitions`, { action: 'confirm_review' }, b.etag);

  const vendor = await pat.api('POST', '/vendors', { name: `Vendor ${id}`, aliases: [], defaultCurrency: base });
  let o = await pat.api('POST', '/vendor-orders', { vendorId: vendor.body.id, itemIds: [item.body.id] });
  const line = (o.body.lines as Record<string, unknown>[])[0]!;
  o = await pat.api('PUT', `/vendor-order-lines/${line.id as string}`, { teamId: line.teamId, name: line.name, quantity: line.quantity, unitPrice: '10' }, o.etag);
  await pat.api('POST', `/vendor-orders/${o.body.id as string}/place`, undefined, o.etag);
});

test('a receiver registers a box with a damaged unit and sees the open order line as a candidate', async ({ browser }) => {
  const { page } = await as(browser, 'rita');
  await page.goto('/deliveries/new');
  await page.getByLabel('Source').fill(`Vendor ${id}`);
  const line = page.getByRole('region', { name: 'Line 1' });
  await line.getByLabel('Name', { exact: true }).fill(itemName);
  await line.getByLabel('Good quantity').fill('2');
  await line.getByLabel('With a problem').fill('1');
  await line.getByLabel('Problem', { exact: true }).selectOption({ label: 'damaged' });
  await expect(line.getByText('lacks 3')).toBeVisible();
  await page.getByRole('button', { name: 'Save box' }).click();

  await expect(page).toHaveURL(/\/deliveries\/[^/]+$/);
  deliveryPath = new URL(page.url()).pathname;
  await expect(page.getByRole('article', { name: `#1 ${itemName}` })).toContainText('Unmatched');
});

test('the receiver matches the line on the suggested split, which opens a problem', async ({ browser }) => {
  const { page } = await as(browser, 'rita');
  await page.goto(deliveryPath);
  const card = page.getByRole('article', { name: `#1 ${itemName}` });
  await card.getByRole('button', { name: 'Match', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^Good units for VO-\d+ line #1$/)).toHaveValue('2');
  await expect(dialog.getByLabel(/^Problem units for VO-\d+ line #1$/)).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Save matches' }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText('Matched');
  await expect(card).toContainText('2 good, 1 with a problem');

  // Receivers work the matching list only; problems are the purchasers'.
  await page.goto('/receiving');
  await expect(page.getByRole('heading', { name: 'Waiting for a match' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Problems' })).toHaveCount(0);
});

test('a purchaser settles the problem as returned with a refund', async ({ browser }) => {
  const { page } = await as(browser, 'pat');
  await page.goto('/receiving');
  const open = page.getByRole('table', { name: 'Problems: Open' });
  const row = open.getByRole('row').filter({ hasText: itemName });
  await expect(row).toContainText('damaged');
  await row.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Settle problem' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settle problem' });
  await dialog.getByLabel('How to settle').selectOption({ label: 'Return, no replacement' });
  await dialog.getByLabel('Refund (base currency)').fill('5');
  await dialog.getByRole('button', { name: 'Settle problem' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);

  await page.getByRole('tab', { name: 'Resolved' }).click();
  await expect(page.getByRole('table', { name: 'Problems: Resolved' }).getByRole('row').filter({ hasText: itemName })).toContainText('Return, no replacement');
});
