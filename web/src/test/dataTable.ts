import { act, fireEvent, screen, within } from '@testing-library/react';

/** The table row (or phone card) whose text contains `text`. */
export function rowWith(text: string): HTMLElement {
  const row = screen.getAllByRole('row').find((r) => r.textContent?.includes(text));
  if (!row) throw new Error(`no row with "${text}"`);
  return row;
}

/** Opens a DataTable row's ⋯ menu and returns its items' labels. */
export async function openRowMenu(row: HTMLElement): Promise<string[]> {
  const trigger = within(row).getByRole('button', { name: 'More actions' });
  await act(async () => { fireEvent.click(trigger); });
  const menu = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  return menu ? within(menu).queryAllByRole('menuitem').map((m) => m.textContent ?? '') : [];
}

/** Picks an item of the open row menu. */
export async function chooseMenuItem(name: string | RegExp): Promise<void> {
  // Ark's menu acts on the highlighted item; in jsdom the keyboard is what reliably moves the highlight.
  const item = screen.getByRole('menuitem', { name });
  const menu = item.closest('[role="menu"]') as HTMLElement;
  for (let i = 0; i < 20 && item.getAttribute('data-highlighted') === null; i++) {
    await act(async () => { fireEvent.keyDown(menu, { key: 'ArrowDown' }); });
  }
  await act(async () => { fireEvent.keyDown(menu, { key: 'Enter' }); });
}

/** Opens a FilterBar's 篩選 popover (if closed) and returns the named filter select. */
export async function filterSelect(name: string): Promise<HTMLSelectElement> {
  if (!screen.queryByRole('combobox', { name })) {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Filter/ })); });
  }
  return screen.getByRole('combobox', { name }) as HTMLSelectElement;
}

/** The SelectionBar, present once rows are picked. */
export const selectionBar = () => screen.queryByRole('region', { name: /selected$/ });

/** Closes the open row menu. */
export async function closeMenu(): Promise<void> {
  for (const menu of screen.queryAllByRole('menu')) await act(async () => { fireEvent.keyDown(menu, { key: 'Escape' }); });
}
