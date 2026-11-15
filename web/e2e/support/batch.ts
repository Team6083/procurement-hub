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
