import { expect, test, type Page } from '@playwright/test';
import { openAs, reloadSignedIn, type Session } from './support/app';
import { addItem, expectBatchStatus, itemRow, localInputInDays, openRowMenu, selectionBar, statusFilter } from './support/batch';
import { runId, users, type UserKey } from './support/env';
import { addToGroup, ensureTeamGroup, removeFromGroup } from './support/keycloak';

// One story through spec section 21 items 1, 3 and 4 (without CSV and email) and 7: a team with
// SSO-mapped members, a proposed batch that is opened, collected, reviewed and ordered, and the
// visibility rules for a non-member. The steps depend on each other, so they run in order.
test.describe.configure({ mode: 'serial' });

const id = runId();
const slug = `e2e-${id}`;
const teamName = `E2E team ${id}`;
const batchTitle = `Robot parts ${id}`;
const items = {
  kit: { name: `Resistor kit ${id}`, quantity: '2', unitPrice: '12.50', purpose: 'Prototype boards' },
  servo: { name: `Servo ${id}`, quantity: '4', unitPrice: '30', purpose: 'Arm joints' },
  cable: { name: `USB cable ${id}`, quantity: '10', unitPrice: '3.20', purpose: 'Spares' },
};

const sessions = new Map<UserKey, Session>();
let membersGroup = '';
let batchPath = '';

/** The user's page, signed in once per run and re-navigated (a fresh load) on every call. */
async function as(browser: import('@playwright/test').Browser, user: UserKey, path?: string): Promise<Page> {
  let s = sessions.get(user);
  if (!s) {
    s = await openAs(browser, user, path ?? '/');
    sessions.set(user, s);
  } else if (path) {
    await s.page.goto(path);
    await expect(s.page.getByRole('button', { name: users[user].name })).toBeVisible();
  }
  return s.page;
}

/** Reloads until the role-mapping sync shows the expected team role (it runs on a newer token iat). */
async function expectTeamRoleAfterSync(page: Page, user: UserKey, role: 'Member' | null): Promise<void> {
  await expect(async () => {
    await reloadSignedIn(page, user);
    const tab = page.getByRole('tab', { name: 'Members' });
    if (role) await expect(tab).toBeVisible({ timeout: 2_000 });
    else await expect(tab).toHaveCount(0, { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test.afterAll(async () => {
  for (const s of sessions.values()) await s.context.close();
});

test('system admin creates a team and assigns its first admin (21.1)', async ({ browser }) => {
  const page = await as(browser, 'sysadmin', '/');
  await page.getByRole('button', { name: 'Create team' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create team' });
  await dialog.getByLabel('Slug').fill(slug);
  await dialog.getByLabel('Name').fill(teamName);
  await dialog.getByRole('combobox', { name: 'First team admin' }).fill('Tara');
  await page.getByRole('option', { name: 'Tara Teamadmin (tara@example.org)' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(`/teams/${slug}`);
  await expect(page.getByRole('heading', { name: teamName })).toBeVisible();

  const tara = await as(browser, 'tara', `/teams/${slug}/settings/members`);
  await expect(itemRow(tara, users.tara.name)).toContainText('Admin');
});

test('group-based role mapping makes users members on their next token (21.1)', async ({ browser }) => {
  membersGroup = await ensureTeamGroup(slug, 'members');
  for (const u of ['alice', 'bob', 'carol'] as const) {
    await addToGroup(users[u].username, membersGroup);
    const page = await as(browser, u, `/teams/${slug}`);
    await expectTeamRoleAfterSync(page, u, 'Member');
  }

  const alice = await as(browser, 'alice', `/teams/${slug}/members`);
  const row = itemRow(alice, users.alice.name);
  await expect(row).toContainText('Member');
  await expect(row).toContainText('Managed by SSO');
});

test('a member proposes a batch with two items', async ({ browser }) => {
  const page = await as(browser, 'alice', '/batches');
  await page.getByRole('button', { name: 'Propose batch' }).click();
  const dialog = page.getByRole('dialog', { name: 'New batch' });
  await dialog.getByLabel('Team').selectOption({ label: teamName });
  await dialog.getByLabel('Title').fill(batchTitle);
  await dialog.getByRole('button', { name: 'Propose' }).click();

  await expect(page.getByRole('heading', { name: `#1 ${batchTitle}` })).toBeVisible();
  await expectBatchStatus(page, 'Proposed');
  batchPath = new URL(page.url()).pathname;

  await addItem(page, items.kit);
  await addItem(page, items.servo);
});

test('the team admin sets assignments and opens the batch for collection', async ({ browser }) => {
  const page = await as(browser, 'tara', batchPath);
  await expectBatchStatus(page, 'Proposed');
  // Opening needs every assignment first.
  await expect(page.getByRole('button', { name: 'Open for items' })).toBeDisabled();

  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit batch' });
  await dialog.getByRole('group', { name: 'Approvers' }).getByText(users.carol.name).click();
  await dialog.getByRole('group', { name: 'Purchasers' }).getByText(users.tara.name).click();
  await dialog.getByRole('group', { name: 'Receivers' }).getByText(users.tara.name).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(users.carol.name)).toBeVisible();

  await page.getByRole('button', { name: 'Open for items' }).click();
  const open = page.getByRole('dialog', { name: 'Open for items' });
  await open.getByLabel('Deadline').fill(localInputInDays(7));
  await open.getByRole('button', { name: 'Open for items' }).click();
  await expect(open).toBeHidden();
  await expectBatchStatus(page, 'Collecting');
});

test('another member adds an item while collecting', async ({ browser }) => {
  const page = await as(browser, 'bob', batchPath);
  await expectBatchStatus(page, 'Collecting');
  await addItem(page, items.cable);
  await expect(page.getByRole('row')).toHaveCount(4); // header + 3 items
});

test('a non-member reads a public batch but cannot change it (21.7)', async ({ browser }) => {
  const page = await as(browser, 'oscar', batchPath);
  await expectBatchStatus(page, 'Collecting');
  await expect(itemRow(page, items.cable.name)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Review' })).toHaveCount(0);
});

test('the team admin closes collection and the batch moves to review', async ({ browser }) => {
  const page = await as(browser, 'tara', batchPath);
  await page.getByRole('button', { name: 'Close collection' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close collection' });
  await dialog.getByRole('button', { name: 'Close collection' }).click();
  await expect(dialog).toBeHidden();
  await expectBatchStatus(page, 'Reviewing');
});

/** Selects one pending item in the Items table and decides it; `pendingAfter` null = review ends. */
async function decide(page: Page, itemName: string, decision: 'approve' | 'return' | 'reject', pendingAfter: number | null, comment = '') {
  // The native input is visually hidden under Chakra's checkbox control (which takes pointer
  // clicks), so the click goes to the input itself.
  const box = itemRow(page, itemName).getByRole('checkbox', { name: 'Select row' });
  await box.dispatchEvent('click');
  await expect(box).toBeChecked();
  if (decision === 'approve') {
    await selectionBar(page).getByRole('button', { name: 'Approve selected (1)' }).click();
  } else {
    const label = decision === 'return' ? 'Return' : 'Reject';
    await selectionBar(page).getByRole('button', { name: label, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: label });
    await dialog.getByLabel('Comment').fill(comment);
    await dialog.getByRole('button', { name: label }).click();
    await expect(dialog).toBeHidden();
  }
  if (pendingAfter === null) return;
  // Settled: the selection was cleared and the reloaded list (on the pending filter) shrank.
  await expect(selectionBar(page)).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Pending' })).toHaveCount(pendingAfter);
}

test('the reviewer approves, returns and rejects; the batch stays in review (21.4)', async ({ browser }) => {
  const page = await as(browser, 'carol', batchPath);
  // A reviewer's Items table opens on the pending filter.
  await expect(page.getByRole('button', { name: /^Filter\s*1$/ })).toBeVisible();
  await expect(await statusFilter(page)).toHaveValue('pending');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('row').filter({ hasText: 'Pending' })).toHaveCount(3);

  await decide(page, items.kit.name, 'approve', 2);
  await decide(page, items.servo.name, 'return', 1, 'Which model? Add the SKU.');
  await decide(page, items.cable.name, 'reject', 0, 'We have plenty of these.');

  await (await statusFilter(page)).selectOption({ label: 'Returned' });
  await page.keyboard.press('Escape');
  await expect(itemRow(page, items.servo.name)).toContainText('Returned');
  await expectBatchStatus(page, 'Reviewing');
});

test('the requester edits and resubmits the returned item; its approval moves the batch to ordering (21.4)', async ({ browser }) => {
  const page = await as(browser, 'alice', batchPath);
  const row = itemRow(page, items.servo.name);
  await expect(row).toContainText('Returned: Which model? Add the SKU.');
  // No buttons in rows: Resubmit waits in the row's menu, disabled until the item is edited.
  await openRowMenu(page, items.servo.name);
  await expect(page.getByRole('menuitem', { name: /^Resubmit/ })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit item' });
  await dialog.getByLabel('SKU').fill('MG996R');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await openRowMenu(page, items.servo.name);
  await page.getByRole('menuitem', { name: 'Resubmit', exact: true }).click();
  await expect(row).toContainText('Pending');
  await expectBatchStatus(page, 'Reviewing');

  const carol = await as(browser, 'carol', batchPath);
  await decide(carol, items.servo.name, 'approve', null);
  await expectBatchStatus(carol, 'Ordering');
  await (await statusFilter(carol)).selectOption({ label: 'All' });
  await carol.keyboard.press('Escape');
  await expect(itemRow(carol, items.kit.name)).toContainText('Approved');
  await expect(itemRow(carol, items.servo.name)).toContainText('Approved');
  await expect(itemRow(carol, items.cable.name)).toContainText('Rejected');
});

test('a members-only batch is not found for a non-member (21.7)', async ({ browser }) => {
  const tara = await as(browser, 'tara', batchPath);
  await tara.getByRole('button', { name: 'Edit' }).click();
  const dialog = tara.getByRole('dialog', { name: 'Edit batch' });
  await dialog.getByLabel('Visibility').selectOption({ label: 'Members only' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  const response = (await as(browser, 'oscar')).waitForResponse((r) => r.url().endsWith(`/api/v1${batchPath}`));
  const oscar = await as(browser, 'oscar', batchPath);
  expect((await response).status()).toBe(404);
  await expect(oscar.getByText('The requested item was not found.')).toBeVisible();
  await expect(oscar.getByRole('heading', { name: batchTitle })).toHaveCount(0);
});

test('removing the SSO group ends that membership but keeps a manual one (21.1)', async ({ browser }) => {
  const tara = await as(browser, 'tara', `/teams/${slug}/settings/members`);
  const bobRow = itemRow(tara, users.bob.name);
  await bobRow.getByLabel('Manual role').selectOption({ label: 'Member' });
  await expect(bobRow.getByRole('button', { name: 'Clear manual role' })).toBeVisible();

  await removeFromGroup(users.alice.username, membersGroup);
  await removeFromGroup(users.bob.username, membersGroup);

  const alice = await as(browser, 'alice', `/teams/${slug}`);
  await expectTeamRoleAfterSync(alice, 'alice', null);

  const bob = await as(browser, 'bob', `/teams/${slug}`);
  await expect(async () => {
    await reloadSignedIn(bob, 'bob');
    await bob.getByRole('tab', { name: 'Members' }).click();
    const row = itemRow(bob, users.bob.name);
    await expect(row).toContainText('Member', { timeout: 2_000 });
    await expect(row).not.toContainText('Managed by SSO', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
});
