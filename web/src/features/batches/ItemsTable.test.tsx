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

function Harness({ onChange, selectable = true }: { onChange?: (s: string[]) => void; selectable?: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  return (
    <ItemsTable
      items={items}
      team={team()}
      nameOf={() => 'Alice'}
      selection={selectable ? { selected: sel, onChange: (s) => { setSel(s); onChange?.(s); } } : undefined}
    />
  );
}

const names = () => screen.getAllByRole('row').slice(1).map((r) => ['Bolt', 'Arduino', 'Cable'].find((n) => r.textContent?.includes(n)));
const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });
const sortButton = (name: string) => within(header(name)).getByRole('button');

describe('ItemsTable', () => {
  it('sorts by a column, toggling ascending, descending and back to the batch order', () => {
    renderUI(<Harness />);
    expect(names()).toEqual(['Bolt', 'Arduino', 'Cable']);
    fireEvent.click(sortButton('Name'));
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    expect(names()).toEqual(['Arduino', 'Bolt', 'Cable']);
    fireEvent.click(sortButton('Name'));
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
    expect(names()).toEqual(['Cable', 'Bolt', 'Arduino']);
    fireEvent.click(sortButton('Name'));
    expect(names()).toEqual(['Bolt', 'Arduino', 'Cable']);
  });

  it('sorts numeric columns by value, not text', () => {
    renderUI(<Harness />);
    fireEvent.click(sortButton('^Total'));
    // 4×5 = 20, 1×25.5 = 25.5, 10×1.25 = 12.5; first click is ascending like text columns
    expect(names()).toEqual(['Cable', 'Bolt', 'Arduino']);
  });

  it('selects rows and all rows, and marks selected rows', async () => {
    const onChange = vi.fn();
    renderUI(<Harness onChange={onChange} />);
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox', { name: 'Select row' })[1]!); });
    expect(onChange).toHaveBeenLastCalledWith(['i2']);
    expect(screen.getAllByRole('row')[2]!.hasAttribute('data-selected')).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' })); });
    expect([...onChange.mock.lastCall![0]].sort()).toEqual(['i1', 'i2', 'i3']);
    await act(async () => { fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' })); });
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('shows requester names, updating when names load after the first render', () => {
    const rows = [item(1, { requesterId: 'u1' }), item(2, { requesterId: 'u2' })];
    const view = renderUI(<ItemsTable items={rows} team={team()} nameOf={() => '…'} />);
    expect(screen.getAllByRole('img', { name: '…' })).toHaveLength(2);
    const nameOf = (id: string) => (id === 'u1' ? 'Alice' : 'Former member');
    view.rerender(<ItemsTable items={rows} team={team()} nameOf={nameOf} />);
    expect(screen.getByRole('img', { name: 'Alice' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Former member' })).toBeTruthy();
  });

  it('leaves the requester out for viewers who cannot see names', () => {
    renderUI(<ItemsTable items={items} team={team()} nameOf={() => 'Alice'} showRequester={false} />);
    expect(screen.queryByRole('columnheader', { name: /Requester/ })).toBeNull();
    expect(screen.queryByRole('img', { name: 'Alice' })).toBeNull();
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

  it('saves an edited quantity inline and ignores an invalid one', () => {
    const onQuantityChange = vi.fn();
    renderUI(<ItemsTable items={items} team={team()} nameOf={() => 'Alice'} canEditQuantity={(i) => i.name === 'Bolt'} onQuantityChange={onQuantityChange} />);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);
    expect(onQuantityChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(onQuantityChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bolt' }), 7, expect.any(Function));
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onQuantityChange).toHaveBeenCalledTimes(1);
  });
});
