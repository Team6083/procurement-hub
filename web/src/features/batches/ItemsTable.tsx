import { Badge, Checkbox, Group, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import {
  createSortedRowModel, createColumnHelper, rowSelectionFeature, rowSortingFeature, sortFn_basic, sortFn_text, tableFeatures, useTable,
  type RowSelectionState, type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Item, Team } from '../../api/types';
import { priorityLabel, type PriorityKey } from '../teams/priority';
import { format, parseDecSafe } from './decimal';
import { lineTotal } from './estimates';
import { safeHttpUrl } from './itemForm';
import { ItemStatusBadge } from './StatusBadges';

const features = tableFeatures({
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, text: sortFn_text },
});
const helper = createColumnHelper<typeof features, Item>();

interface Props {
  items: Item[];
  team: Team | undefined;
  nameOf: (userId: string) => string;
  /** Row actions (edit/withdraw/resubmit/force-reject) rendered in the last column. */
  actions?: (item: Item) => ReactNode;
  selectable?: boolean;
  selection: RowSelectionState;
  onSelectionChange: (s: RowSelectionState) => void;
}

/** Spreadsheet-like items table: sortable columns, multi-select, inline line totals. */
export function ItemsTable({ items, team, nameOf, actions, selectable = true, selection, onSelectionChange }: Props) {
  const { t } = useTranslation('batches');
  const [sorting, setSorting] = useState<SortingState>([]);
  const subgroupName = (id: string) => team?.subgroups.find((g) => g.id === id)?.name ?? '';
  const prio = (p: number) => priorityLabel(team?.priorityLabels, String(p) as PriorityKey, (k) => t(`teams:priority.default.${k}`));

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('seqNo', { id: 'seqNo', header: '#', sortFn: 'basic', cell: (c) => `#${c.getValue()}` }),
        helper.accessor('name', {
          id: 'name', header: t('item.name'), sortFn: 'text',
          cell: (c) => {
            const it = c.row.original;
            const url = safeHttpUrl(it.productUrl);
            return (
              <div>
                {url ? <a href={url} target="_blank" rel="noopener noreferrer">{it.name}</a> : <Text span>{it.name}</Text>}
                {it.status === 'returned' && it.review?.comment && (
                  <Text size="xs" c="orange">{t('item.returnedComment', { comment: it.review.comment })}</Text>
                )}
                {it.status === 'rejected' && it.review?.comment && (
                  <Text size="xs" c="red">{t('item.rejectedComment', { comment: it.review.comment })}</Text>
                )}
              </div>
            );
          },
        }),
        helper.accessor((r) => subgroupName(r.subgroupId), { id: 'subgroup', header: t('item.subgroup'), sortFn: 'text' }),
        helper.accessor((r) => nameOf(r.requesterId), { id: 'requester', header: t('item.requester'), sortFn: 'text' }),
        helper.accessor('priority', {
          id: 'priority', header: t('item.priority'), sortFn: 'basic',
          cell: (c) => <Tooltip label={prio(c.getValue())}><Badge variant="outline">{c.getValue()}</Badge></Tooltip>,
        }),
        helper.accessor('quantity', { id: 'quantity', header: t('item.quantity'), sortFn: 'basic' }),
        helper.accessor((r) => Number(r.estimatedUnitPrice.amount), {
          id: 'unitPrice', header: t('item.unitPrice'), sortFn: 'basic',
          cell: (c) => `${format(parseDecSafe(c.row.original.estimatedUnitPrice.amount))} ${c.row.original.estimatedUnitPrice.currency}`,
        }),
        helper.accessor((r) => Number(lineTotal(r).n) / 10 ** lineTotal(r).s, {
          id: 'lineTotal', header: t('item.lineTotal'), sortFn: 'basic',
          cell: (c) => `${format(lineTotal(c.row.original))} ${c.row.original.estimatedUnitPrice.currency}`,
        }),
        helper.accessor('vendor', { id: 'vendor', header: t('item.vendor'), sortFn: 'text' }),
        helper.accessor('status', { id: 'status', header: t('item.status'), sortFn: 'text', cell: (c) => <ItemStatusBadge status={c.getValue()} /> }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, team, nameOf],
  );

  const table = useTable({
    features, columns, data: items,
    getRowId: (r) => r.id,
    enableRowSelection: selectable,
    state: { sorting, rowSelection: selection },
    onSortingChange: setSorting,
    onRowSelectionChange: (u) => onSelectionChange(typeof u === 'function' ? u(selection) : u),
  });

  return (
    <Table.ScrollContainer minWidth={900}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {selectable && (
              <Table.Th w={32}>
                <Checkbox aria-label={t('item.selectAll')} checked={table.getIsAllRowsSelected()} indeterminate={table.getIsSomeRowsSelected()} onChange={table.getToggleAllRowsSelectedHandler()} />
              </Table.Th>
            )}
            {table.getHeaderGroups()[0]?.headers.map((h) => {
              const dir = h.column.getIsSorted();
              return (
                <Table.Th key={h.id} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
                  <UnstyledButton onClick={h.column.getToggleSortingHandler()} fw={600} fz="sm">
                    <Group gap={4} wrap="nowrap">
                      <table.FlexRender header={h} />
                      <span aria-hidden>{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span>
                    </Group>
                  </UnstyledButton>
                </Table.Th>
              );
            })}
            {actions && <Table.Th />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {table.getRowModel().rows.map((row) => (
            <Table.Tr key={row.id} bg={row.getIsSelected() ? 'var(--mantine-primary-color-light)' : undefined}>
              {selectable && (
                <Table.Td>
                  <Checkbox aria-label={t('item.selectRow')} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
                </Table.Td>
              )}
              {row.getAllCells().map((cell) => (
                <Table.Td key={cell.id}><table.FlexRender cell={cell} /></Table.Td>
              ))}
              {actions && <Table.Td><Group gap="xs" wrap="nowrap">{actions(row.original)}</Group></Table.Td>}
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
