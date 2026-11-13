import type { RowSelectionState } from '@tanstack/react-table';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { item, team } from '../../test/fakeApi';
import { renderUI } from '../../test/render';
import { ItemsTable } from './ItemsTable';

beforeAll(() => void i18n.changeLanguage('en'));
afterEach(cleanup);

const items = [
  item(1, { name: 'Bolt', priority: 2, estimatedUnitPrice: { amount: '5', currency: 'USD' }, quantity: 4 }),
  item(2, { name: 'Arduino', priority: 5, estimatedUnitPrice: { amount: '25.5', currency: 'USD' }, productUrl: 'https://shop.example.org/a' }),
  item(3, { name: 'Cable', priority: 3, estimatedUnitPrice: { amount: '1.25', currency: 'USD' }, quantity: 10, productUrl: 'javascript:alert(1)' }),
];

function Harness({ onChange, selectable }: { onChange?: (s: RowSelectionState) => void; selectable?: boolean }) {
  const [sel, setSel] = useState<RowSelectionState>({});
  return (
    <ItemsTable
      items={items}
      team={team()}
      nameOf={() => 'Alice'}
      selectable={selectable}
      selection={sel}
      onSelectionChange={(s) => { setSel(s); onChange?.(s); }}
    />
  );
}

const names = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[2]!.textContent);
const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });

describe('ItemsTable', () => {
  it('sorts by a column, toggling ascending and descending', () => {
    renderUI(<Harness />);
    expect(names()).toEqual(['Bolt', 'Arduino', 'Cable']);
    fireEvent.click(within(header('Name')).getByRole('button'));
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Arduino', 'Bolt', 'Cable']);
    fireEvent.click(within(header('Name')).getByRole('button'));
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Cable', 'Bolt', 'Arduino']);
  });

  it('sorts numeric columns by value, not text', () => {
    renderUI(<Harness />);
    fireEvent.click(within(header('^Total')).getByRole('button'));
    // 4×5 = 20, 1×25.5 = 25.5, 10×1.25 = 12.5; first click is ascending like text columns
    expect(header('^Total').getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Cable', 'Bolt', 'Arduino']);
  });

  it('selects rows and all rows, and marks selected rows', async () => {
    const onChange = vi.fn();
    renderUI(<Harness onChange={onChange} />);
    const rowBoxes = screen.getAllByRole('checkbox', { name: 'Select row' });
    await act(async () => {
      fireEvent.click(rowBoxes[1]!);
    });
    expect(onChange).toHaveBeenLastCalledWith({ i2: true });
    expect(screen.getAllByRole('row')[2]!.getAttribute('aria-selected')).toBe('true');
    expect((screen.getAllByRole('checkbox', { name: 'Select row' })[1] as HTMLInputElement).checked).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    });
    expect(onChange).toHaveBeenLastCalledWith({ i1: true, i2: true, i3: true });
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('has no checkboxes when not selectable', () => {
    renderUI(<Harness selectable={false} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('links only http(s) product URLs, opening them safely in a new tab', () => {
    renderUI(<Harness />);
    const link = screen.getByRole('link', { name: 'Arduino' });
    expect(link.getAttribute('href')).toBe('https://shop.example.org/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.queryByRole('link', { name: 'Cable' })).toBeNull();
  });
});
