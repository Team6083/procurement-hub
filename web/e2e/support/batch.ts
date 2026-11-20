import { expect, type Locator, type Page } from '@playwright/test';

/** The batch page header (title heading plus status badge). */
export const batchHeader = (page: Page): Locator => page.getByRole('main').getByRole('heading', { level: 1 }).locator('..');

export async function expectBatchStatus(page: Page, status: string): Promise<void> {
  await expect(batchHeader(page)).toContainText(status);
}

export const itemRow = (scope: Page | Locator, name: string): Locator => scope.getByRole('row').filter({ hasText: name });

/** Opens "Add item" on a batch page and submits the dialog. */
export async function addItem(page: Page, item: { name: string; quantity: string; unitPrice: string; purpose: string }): Promise<void> {
  await page.getByRole('button', { name: 'Add item' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add item' });
  await dialog.getByLabel('Name').fill(item.name);
  await dialog.getByLabel('Quantity').fill(item.quantity);
  await dialog.getByLabel('Unit price').fill(item.unitPrice);
  await dialog.getByLabel('Purpose').fill(item.purpose);
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog).toBeHidden();
  await expect(itemRow(page, item.name)).toContainText('Pending');
}

/** A datetime-local value (browser local time) the given number of days from now. */
export function localInputInDays(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The Items tab's Status filter (a multi-select behind the Filter button): opens the popover and the list when closed. */
async function statusOptions(page: Page): Promise<Locator> {
  const trigger = page.getByRole('combobox', { name: 'Status', exact: true });
  if (!(await trigger.isVisible())) await page.getByRole('button', { name: /^Filter/ }).click();
  const list = page.getByRole('listbox', { name: 'Status', exact: true });
  if (!(await list.isVisible())) await trigger.click();
  await expect(list).toBeVisible();
  return list;
}

/** The labels of the chosen statuses. */
export async function checkedStatuses(page: Page): Promise<string[]> {
  const chosen = (await statusOptions(page)).getByRole('option', { selected: true });
  return (await chosen.allTextContents()).map((t) => t.trim());
}

/** Chooses exactly the given statuses (none = show all) and closes the list and the popover. */
export async function showStatuses(page: Page, labels: string[]): Promise<void> {
  const list = await statusOptions(page);
  for (const option of await list.getByRole('option').all()) {
    const label = ((await option.textContent()) ?? '').trim();
    if ((await option.getAttribute('aria-selected') === 'true') !== labels.includes(label)) await option.click();
  }
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}

/** Opens the ⋯ menu of the item's row. */
export async function openRowMenu(page: Page, name: string): Promise<void> {
  await itemRow(page, name).getByRole('button', { name: 'More actions' }).click();
}

/** The bar that appears once rows are picked. */
export const selectionBar = (page: Page): Locator => page.getByRole('region', { name: /selected$/ });
