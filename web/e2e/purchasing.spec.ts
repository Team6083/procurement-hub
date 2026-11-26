import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { Session } from './support/app';
import { apiAs, openWithToken } from './support/api';
import { API_URL, runId, users, type UserKey } from './support/env';
import { itemRow } from './support/batch';

// Spec section 21.5 (two teams' approved items from one vendor go into one USD vendor order, with a line of a third
// team, a coupon for one team, a customs fee paid in the base currency and the amount actually charged) and 21.9 (a
// plain member sees only their own team's lines of that order and no receipt record). The approved items, the teams and
// the reference rate are set up through the API; everything a purchaser does on the way is driven in the UI.
//
// There is no cost report yet (M7), so "the teams' cost totals" is the sum of each team's line totals on the order,
// read through the API; the order's net total must equal the amount charged plus the customs fee.
test.describe.configure({ mode: 'serial' });

const id = runId();
const names = {
  teamA: `Team A ${id}`, teamB: `Team B ${id}`, teamC: `Team C ${id}`,
  vendor: `Vendor ${id}`,
  gear: `Sprocket ${id}`, motor: `Winch ${id}`, freight: `Courier ${id}`,
};
const sessions = new Map<UserKey, Session & { token: string }>();
let request: APIRequestContext;
const team: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
const itemIds: Record<'gear' | 'motor', string> = { gear: '', motor: '' };
let vendorId = '';
let orderId = '';

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

/** Scaled integer (8 decimals) of a decimal string, so sums compare exactly. */
function scaled(v: string | null | undefined): bigint {
  if (v == null) throw new Error('amount is null');
  const neg = v.startsWith('-');
  const [i = '0', f = ''] = v.replace('-', '').split('.');
  const n = BigInt(i + f.padEnd(8, '0').slice(0, 8));
  return neg ? -n : n;
}

interface Line { id: string; teamId: string; name: string; quantity: number; totalBase: string | null; sharedBase: string | null }
interface Order { lines: Line[]; totals: { netBase: string | null; provisional: boolean }; invariantOk: boolean | null; costEntries: unknown[]; chargedAmountBase: string | null }

/**
 * A new rate schedules a background job (polled every few seconds) that recomputes the USD orders and so bumps their
 * version; an order edited at that moment would hit a version conflict. A probe order shows when the job has run.
 */
async function waitForRecompute(pat: { api: ReturnType<typeof apiAs> }, teamId: string): Promise<void> {
  const probeVendor = (await pat.api('POST', '/vendors', { name: `Probe ${id}`, aliases: [], defaultCurrency: 'USD' })).body.id as string;
  let o = await pat.api('POST', '/vendor-orders', { vendorId: probeVendor });
  o = await pat.api('POST', `/vendor-orders/${o.body.id as string}/lines`, { teamId, name: `Probe ${id}`, quantity: 1, unitPrice: '1' }, o.etag);
  const probe = o.body.id as string;
  const version = o.body.version as number;
  await expect(async () => {
    expect((await pat.api('GET', `/vendor-orders/${probe}`)).body.version).not.toBe(version);
  }).toPass({ timeout: 30_000 });
  await pat.api('POST', `/vendor-orders/${probe}/cancel`, { reason: 'probe' }, (await pat.api('GET', `/vendor-orders/${probe}`)).etag);
}

test('setup: three teams, approved items of one vendor in two batches, a reference rate', async ({ browser }) => {
  const sys = await as(browser, 'sysadmin');
  const tara = await as(browser, 'tara');
  const pat = await as(browser, 'pat');
  const alice = await as(browser, 'alice');
  const taraId = (await tara.api('GET', '/me')).body.id as string;
  const aliceId = (await alice.api('GET', '/me')).body.id as string;

  // Any USD rate will do: the tests compare amounts with each other, not with a fixed rate.
  const rates = (await sys.api('GET', '/reference-rates')).body.items as { currency: string }[];
  const newRate = !rates.some((r) => r.currency === 'USD');
  if (newRate) await sys.api('PUT', '/reference-rates/USD', { rateToBase: '30' });

  vendorId = (await pat.api('POST', '/vendors', { name: names.vendor, aliases: [], defaultCurrency: 'USD' })).body.id as string;

  for (const key of ['a', 'b', 'c'] as const) {
    const name = names[`team${key.toUpperCase() as 'A' | 'B' | 'C'}`];
    const created = await sys.api('POST', '/teams', { slug: `e2e-p${key}-${id}`, name, description: '', firstAdminUserId: taraId });
    team[key] = created.body.id as string;
    // Teams are public by default; a member of a public team could read its batches and so see its order lines (spec 8.2).
    await sys.api('PATCH', `/teams/${team[key]}`, { visibility: 'members' }, created.etag);
  }
  if (newRate) await waitForRecompute(pat, team.a);
  await tara.api('POST', `/teams/${team.a}/members`, { userId: aliceId, role: 'member' });

  async function approvedItem(teamId: string, title: string, name: string, quantity: number): Promise<string> {
    let b = await tara.api('POST', `/teams/${teamId}/batches`, { title });
    const bp = `/batches/${b.body.id as string}`;
    b = await tara.api('PATCH', bp, { deadline: new Date(Date.now() + 2 * 86_400_000).toISOString() }, b.etag);
    b = await tara.api('PUT', `${bp}/assignments`, { approvers: [taraId], purchasers: [] }, b.etag);
    await tara.api('POST', `${bp}/transitions`, { action: 'open' }, b.etag);
    const item = await tara.api('POST', `${bp}/items`, { name, vendorId, quantity, priority: 3, purpose: 'e2e', estimatedUnitPrice: { amount: '10', currency: 'USD' } });
    b = await tara.api('GET', bp);
    await tara.api('POST', `${bp}/transitions`, { action: 'close' }, b.etag);
    b = await tara.api('POST', `${bp}/reviews`, { decisions: [{ itemId: item.body.id, decision: 'approve' }] });
    await tara.api('POST', `${bp}/transitions`, { action: 'confirm_review' }, b.etag);
    return item.body.id as string;
  }
  itemIds.gear = await approvedItem(team.a, `Batch A ${id}`, names.gear, 5);
  itemIds.motor = await approvedItem(team.b, `Batch B ${id}`, names.motor, 3);
});

test('a purchaser puts both teams\' items into one USD order, adds a third team\'s line and prices it (21.5)', async ({ browser }) => {
  const { page } = await as(browser, 'pat');
  await page.goto('/purchasing');
  const queue = page.getByRole('table', { name: 'Purchasing' });
  for (const name of [names.gear, names.motor]) {
    // The native input is visually hidden under Chakra's checkbox control, so the click goes to the input itself.
    const box = itemRow(queue, name).getByRole('checkbox', { name: 'Select row' });
    await box.dispatchEvent('click');
    await expect(box).toBeChecked();
  }
  await page.getByRole('region', { name: /selected$/ }).getByRole('button', { name: 'Add to order' }).click();
  const send = page.getByRole('dialog', { name: 'Add to a vendor order' });
  await expect(send.getByText('2 items selected.')).toBeVisible();
  await expect(send.getByLabel('Currency')).toBeVisible();
  await send.getByRole('button', { name: 'Create order' }).click();

  const dialog = page.getByRole('dialog', { name: 'Vendor order' });
  const lines = dialog.getByRole('table', { name: 'Lines' });
  await expect(itemRow(lines, names.gear)).toBeVisible();
  await expect(itemRow(lines, names.motor)).toBeVisible();
  await expect(dialog.getByText('USD', { exact: true }).first()).toBeVisible();

  // A line of the third team, linked to no item.
  await dialog.getByRole('button', { name: 'Add line' }).click();
  const add = page.getByRole('dialog', { name: 'Add line' });
  await add.getByLabel('Cost team').selectOption({ label: names.teamC });
  await add.getByLabel('Name').fill(names.freight);
  await add.getByLabel('Quantity').fill('1');
  await add.getByRole('button', { name: 'Save' }).click();
  await expect(add).toBeHidden();
  await expect(itemRow(lines, names.freight)).toBeVisible();

  // Order 3 of the 5 requested gears.
  await itemRow(lines, names.gear).getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit line' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit line' });
  await edit.getByLabel('Quantity').fill('3');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(itemRow(lines, names.gear)).toContainText('Team A');

  // Marking as placed needs a price on every line; the price saves when the field loses focus.
  const place = dialog.getByRole('button', { name: 'Mark as placed' });
  for (const [name, price] of [[names.gear, '10'], [names.motor, '20'], [names.freight, '10']] as const) {
    const row = itemRow(lines, name);
    // The price is text until clicked, then an input.
    await row.locator('[data-scope="editable"][data-part="preview"]').click();
    const input = row.getByLabel(/^Unit price of line/);
    const saved = page.waitForResponse((r) => r.url().includes('/vendor-order-lines/') && r.request().method() === 'PUT');
    await input.fill(price);
    await input.blur();
    expect((await saved).ok()).toBe(true);
  }
  // Without the charged amount the amounts come from the reference rate and are marked provisional.
  await expect(dialog.getByRole('button', { name: 'Provisional', exact: true }).first()).toBeVisible();
  await place.click();
  await expect(dialog.getByText('Placed', { exact: true }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Provisional', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as placed' })).toHaveCount(0);

  // The order was created with no vendor order number.
  const pat = await as(browser, 'pat');
  const list = (await pat.api('GET', `/vendor-orders?vendorId=${vendorId}`)).body.items as { id: string; status: string; externalOrderNo: string; lineCount: number; currency: string }[];
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ status: 'placed', externalOrderNo: '', lineCount: 3, currency: 'USD' });
  orderId = list[0]!.id;
});

async function addCost(page: Page, entry: { type: string; paid: string; currency?: string; amount: string; teams?: string[]; note?: string }) {
  await page.getByRole('button', { name: 'Add cost or adjustment' }).click();
  const form = page.getByRole('dialog', { name: 'Add cost or adjustment' });
  await form.getByLabel(/^Type/).selectOption({ label: entry.type });
  await form.getByLabel(/^Paid/).selectOption({ label: entry.paid });
  if (entry.currency) await form.getByLabel('Currency', { exact: true }).selectOption({ label: entry.currency });
  await form.getByLabel(/^Amount \(/).fill(entry.amount);
  if (entry.teams) {
    await form.getByLabel('Split to', { exact: true }).selectOption({ label: 'Teams' });
    for (const t of entry.teams) await form.locator('label').filter({ hasText: t }).click();
  }
  if (entry.note) await form.getByLabel('Note').fill(entry.note);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toBeHidden();
}

test('shipping, a coupon of one team, customs in TWD and the charged amount settle the order (21.5)', async ({ browser }) => {
  const { page, api } = await as(browser, 'pat');
  await page.goto(`/vendor-orders/${orderId}`);
  const costs = page.getByRole('table', { name: 'Costs and adjustments' });

  await addCost(page, { type: 'Shipping', paid: 'With the goods', amount: '10' });
  await expect(costs.getByRole('row').filter({ hasText: 'Shipping' })).toContainText('All lines');
  await addCost(page, { type: 'Discount', paid: 'With the goods', amount: '-5', teams: [names.teamA], note: `Coupon of ${names.teamA}` });
  await expect(costs.getByRole('row').filter({ hasText: 'Discount' })).toContainText(`Teams: ${names.teamA}`);
  await addCost(page, { type: 'Fee', paid: 'Separately', currency: 'TWD', amount: '300', note: 'Customs' });
  await expect(costs.getByRole('row').filter({ hasText: 'Customs' })).toContainText('Separately');

  // Still estimated: the charged amount is unknown.
  await expect(page.getByRole('button', { name: 'Provisional', exact: true }).first()).toBeVisible();

  await page.getByLabel('Amount charged (TWD)').fill('3300');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Provisional', exact: true })).toHaveCount(0);
  await expect(page.getByText('Check passed: net total equals the sum of the line totals')).toBeVisible();

  // The teams' totals add up to the actual charge plus the customs fee paid in TWD.
  const order = (await api('GET', `/vendor-orders/${orderId}`)).body as unknown as Order;
  expect(order.chargedAmountBase).toBe('3300');
  expect(order.totals.provisional).toBe(false);
  expect(order.invariantOk).toBe(true);
  const perTeam = new Map<string, bigint>();
  for (const l of order.lines) perTeam.set(l.teamId, (perTeam.get(l.teamId) ?? 0n) + scaled(l.totalBase));
  expect([...perTeam.keys()].sort()).toEqual([team.a, team.b, team.c].sort());
  expect([...perTeam.values()].reduce((a, b) => a + b, 0n)).toBe(scaled('3300') + scaled('300'));
  expect(scaled(order.totals.netBase)).toBe(scaled('3600'));
  // The coupon belongs to team A only: it is the one team whose checkout share is negative.
  const shared = (teamId: string) => scaled(order.lines.find((l) => l.teamId === teamId)!.sharedBase);
  expect(shared(team.a) < 0n).toBe(true);
  expect(shared(team.b) > 0n).toBe(true);
  expect(shared(team.c) > 0n).toBe(true);
});

test('the under-ordered item stays in the purchasing overview until its remainder is marked not to purchase (21.5)', async ({ browser }) => {
  const { page, api } = await as(browser, 'pat');
  await page.goto('/purchasing');
  const queue = page.getByRole('table', { name: 'Purchasing' });
  const gear = itemRow(queue, names.gear);
  await expect(gear).toContainText('0 draft, 3 placed');
  // Fully ordered: gone from the overview.
  await expect(itemRow(queue, names.motor)).toHaveCount(0);
  const groups = (await api('GET', `/purchasing/queue?vendorId=${vendorId}`)).body.items as { items: { id: string; toPurchaseQuantity: number; quantity: number }[] }[];
  const items = groups.flatMap((g) => g.items);
  expect(items.find((i) => i.id === itemIds.gear)).toMatchObject({ toPurchaseQuantity: 2, quantity: 5 });

  await gear.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Do not buy the remaining quantity' }).click();
  const dialog = page.getByRole('dialog', { name: 'Do not buy the remaining quantity' });
  await dialog.getByLabel('Reason').fill('The vendor is out of stock');
  await dialog.getByRole('button', { name: 'Do not buy the remaining quantity' }).click();
  await expect(dialog).toBeHidden();
  await expect(itemRow(queue, names.gear)).toHaveCount(0);
});

test('a plain member sees only their own team\'s lines of the order and no receipt records (21.9)', async ({ browser }) => {
  const rita = await as(browser, 'rita');
  const { page, token } = await as(browser, 'alice');
  const pat = await as(browser, 'pat');
  const order = (await pat.api('GET', `/vendor-orders/${orderId}`)).body as unknown as Order;
  const gearLine = order.lines.find((l) => l.teamId === team.a)!;
  const box = await rita.api('POST', '/deliveries', { source: names.vendor, lines: [{ name: names.gear, goodQuantity: 1, matches: [{ vendorOrderLineId: gearLine.id, goodQuantity: 1, problemQuantity: 0 }] }] });
  const deliveryId = box.body.id as string;

  await page.goto(`/vendor-orders/${orderId}`);
  const lines = page.getByRole('table', { name: 'Lines' });
  await expect(page.getByText('You see only the lines of your teams and batches.')).toBeVisible();
  await expect(itemRow(lines, names.gear)).toBeVisible();
  await expect(page.getByText(names.motor)).toHaveCount(0);
  await expect(page.getByText(names.freight)).toHaveCount(0);
  await expect(page.getByText('Other teams: 2 lines')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Costs and adjustments' })).toHaveCount(0);

  const mine = (await apiAs(request, token)('GET', `/vendor-orders/${orderId}`)).body as unknown as Order & { restricted: boolean; otherTeams: { lines: number } };
  expect(mine.restricted).toBe(true);
  expect(mine.lines.map((l) => l.name)).toEqual([names.gear]);
  expect(mine.costEntries).toEqual([]);
  expect(mine.otherTeams.lines).toBe(2);
  expect(mine.invariantOk).toBeNull();

  for (const path of [`/deliveries/${deliveryId}`, '/deliveries']) {
    const res = await request.fetch(`${API_URL}/api/v1${path}`, { headers: { Authorization: token } });
    expect(res.status(), `GET ${path} as ${users.alice.name}`).toBe(404);
  }
});
