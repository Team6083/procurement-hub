import { expect, test } from '@playwright/test';
import { openAs } from './support/app';
import { addItem, expectBatchStatus, itemRow } from './support/batch';
import { runId } from './support/env';

// Phone viewport (Pixel 7): navigation through the menu, full-screen dialogs, and no
// horizontal page scrolling on the busiest page.
test('a team admin creates a draft batch and adds an item on a phone', async ({ browser }) => {
  const id = runId();
  const slug = `e2e-m-${id}`;
  const teamName = `Mobile team ${id}`;

  const admin = await openAs(browser, 'sysadmin');
  await admin.page.getByRole('button', { name: 'Create team' }).click();
  const create = admin.page.getByRole('dialog', { name: 'Create team' });
  await create.getByLabel('Slug').fill(slug);
  await create.getByLabel('Name').fill(teamName);
  await create.getByRole('combobox', { name: 'First team admin' }).fill('Tara');
  await create.getByRole('option', { name: 'Tara Teamadmin (tara@example.org)' }).click();
  await create.getByRole('button', { name: 'Create' }).click();
  await expect(admin.page.getByRole('heading', { name: teamName })).toBeVisible();
  await admin.context.close();

  const { context, page } = await openAs(browser, 'tara');
  // Teams are listed on the home page; the menu drawer holds the app's pages.
  await page.getByRole('link', { name: teamName }).click();
  await expect(page).toHaveURL(`/teams/${slug}`);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Batches' }).click();
  await page.getByRole('button', { name: 'New batch' }).click();
  const dialog = page.getByRole('dialog', { name: 'New batch' });
  await dialog.getByLabel('Team').selectOption({ label: teamName });
  await dialog.getByLabel('Title').fill(`Phone batch ${id}`);
  await dialog.getByRole('button', { name: 'Create draft' }).click();
  await expectBatchStatus(page, 'Draft');

  // A draft takes no items until it is opened; proposing would. Open it with assignments set.
  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit batch' });
  for (const group of ['Approvers', 'Purchasers', 'Receivers']) {
    await edit.getByRole('group', { name: group }).getByText('Tara Teamadmin').click();
  }
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await page.getByRole('button', { name: 'Open for items' }).click();
  const open = page.getByRole('dialog', { name: 'Open for items' });
  await open.getByLabel('Deadline').fill('2099-01-01T12:00');
  await open.getByRole('button', { name: 'Open for items' }).click();
  await expectBatchStatus(page, 'Collecting');

  await addItem(page, { name: `Phone item ${id}`, quantity: '1', unitPrice: '9.99', purpose: 'Field test' });
  await expect(itemRow(page, `Phone item ${id}`)).toContainText('Tara Teamadmin');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});
