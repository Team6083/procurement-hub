import { Badge, Box, Button, Checkbox, HStack, Link, Table, Text } from '@chakra-ui/react';
import {
  createSortedRowModel, createColumnHelper, rowSelectionFeature, rowSortingFeature, sortFn_basic, sortFn_text, tableFeatures, useTable,
  type RowSelectionState, type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Item, Team } from '../../api/types';
import { TableShell } from '../../components/ui/table';
import { Tooltip } from '../../components/ui/tooltip';
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
/** An item plus its requester's display name; the table caches cell values per data row, so the name must live in the data. */
type Row = Item & { requesterName: string };
const helper = createColumnHelper<typeof features, Row>();

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
              <Box>
                {url ? (
                  <Link href={url} target="_blank" rel="noopener noreferrer" color="brand.fg">{it.name}</Link>
                ) : (
                  <Text as="span">{it.name}</Text>
                )}
                {it.status === 'returned' && it.review?.comment && (
                  <Text textStyle="xs" color="fg.warning">{t('item.returnedComment', { comment: it.review.comment })}</Text>
                )}
                {it.status === 'rejected' && it.review?.comment && (
                  <Text textStyle="xs" color="fg.error">{t('item.rejectedComment', { comment: it.review.comment })}</Text>
                )}
              </Box>
            );
          },
        }),
        helper.accessor((r) => subgroupName(r.subgroupId), { id: 'subgroup', header: t('item.subgroup'), sortFn: 'text' }),
        helper.accessor('requesterName', { id: 'requester', header: t('item.requester'), sortFn: 'text' }),
        helper.accessor('priority', {
          id: 'priority', header: t('item.priority'), sortFn: 'basic',
          cell: (c) => (
            <Tooltip content={prio(c.getValue())}>
              <Badge variant="outline" tabIndex={0}>{c.getValue()}</Badge>
            </Tooltip>
          ),
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
    [t, team],
  );

  // Names usually arrive after the items (member list loads separately); new row objects make the table recompute.
  const data = useMemo<Row[]>(() => items.map((i) => ({ ...i, requesterName: nameOf(i.requesterId) })), [items, nameOf]);

  const table = useTable({
    features, columns, data,
    getRowId: (r) => r.id,
    enableRowSelection: selectable,
    // Like a spreadsheet: the first click sorts ascending for text and numbers alike.
    sortDescFirst: false,
    state: { sorting, rowSelection: selection },
    onSortingChange: setSorting,
    onRowSelectionChange: (u) => onSelectionChange(typeof u === 'function' ? u(selection) : u),
  });
  const all = table.getIsAllRowsSelected();
  const some = table.getIsSomeRowsSelected();

  return (
    <TableShell minW="900px" interactive>
      <Table.Header>
        <Table.Row>
          {selectable && (
            <Table.ColumnHeader w="8">
              <Checkbox.Root size="sm" checked={all ? true : some ? 'indeterminate' : false} onCheckedChange={(e) => table.toggleAllRowsSelected(!!e.checked)}>
                <Checkbox.HiddenInput aria-label={t('item.selectAll')} />
                <Checkbox.Control />
              </Checkbox.Root>
            </Table.ColumnHeader>
          )}
          {table.getHeaderGroups()[0]?.headers.map((h) => {
            const dir = h.column.getIsSorted();
            return (
              <Table.ColumnHeader key={h.id} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
                <Button variant="plain" px="0" h="auto" fontWeight="semibold" onClick={h.column.getToggleSortingHandler()}>
                  <HStack gap="1">
                    <table.FlexRender header={h} />
                    <span aria-hidden>{dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : ''}</span>
                  </HStack>
                </Button>
              </Table.ColumnHeader>
            );
          })}
          {actions && <Table.ColumnHeader />}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {table.getRowModel().rows.map((row) => (
          <Table.Row key={row.id} bg={row.getIsSelected() ? 'brand.subtle' : undefined} aria-selected={selectable ? row.getIsSelected() : undefined}>
            {selectable && (
              <Table.Cell>
                <Checkbox.Root size="sm" checked={row.getIsSelected()} onCheckedChange={(e) => row.toggleSelected(!!e.checked)}>
                  <Checkbox.HiddenInput aria-label={t('item.selectRow')} />
                  <Checkbox.Control />
                </Checkbox.Root>
              </Table.Cell>
            )}
            {row.getAllCells().map((cell) => (
              <Table.Cell key={cell.id}><table.FlexRender cell={cell} /></Table.Cell>
            ))}
            {actions && <Table.Cell><HStack gap="2">{actions(row.original)}</HStack></Table.Cell>}
          </Table.Row>
        ))}
      </Table.Body>
    </TableShell>
  );
}
