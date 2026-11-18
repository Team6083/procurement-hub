import { Badge, Box, Button, Flex, HStack, Icon, Link, Text } from '@chakra-ui/react';
import { type DataColumn, type DataTableSelection, type RowAction } from '@team6083/ui';
import { ClampedText } from '../../components/ClampedText';
import { DataTable } from '../../components/DataTable';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuArrowDown, LuArrowUp, LuStickyNote } from 'react-icons/lu';
import type { Item, Team } from '../../api/types';
import { Tooltip } from '../../components/ui/tooltip';
import { priorityLabel, type PriorityKey } from '../teams/priority';
import { format } from './decimal';
import { formatMoney } from '../money';
import { lineTotal } from './estimates';
import { safeHttpUrl } from './itemForm';
import { FulfillmentBadge, ItemStatusBadge, ItemStatusIcon } from './StatusBadges';

type SortKey = 'name' | 'requester' | 'subgroup' | 'priority' | 'quantity' | 'unitPrice' | 'lineTotal' | 'vendor' | 'status';
interface Sort { key: SortKey; desc: boolean }

interface Props {
  items: Item[];
  team: Team | undefined;
  nameOf: (userId: string) => string;
  /** False for viewers who cannot read the team's members: the requester column is left out. */
  showRequester?: boolean;
  /** A row's actions (edit, withdraw, resubmit, force reject...), folded into its ⋯ menu. */
  rowActions?: (item: Item) => RowAction[];
  selection?: DataTableSelection<Item>;
  empty?: ReactNode;
  /** While purchasing runs, the review status is an icon before the name and the status column keeps only the fulfillment. */
  reviewAsIcon?: boolean;
}

const total = (i: Item) => {
  const d = lineTotal(i);
  return Number(d.n) / 10 ** d.s;
};

/** The batch's items: name first, numbers right-aligned, detail columns dropped on narrow screens; sortable by any column. */
export function ItemsTable({ items, team, nameOf, showRequester = true, rowActions, selection, empty, reviewAsIcon = false }: Props) {
  const { t } = useTranslation('batches');
  const [sort, setSort] = useState<Sort | null>(null);
  const subgroupName = (id: string) => team?.subgroups.find((g) => g.id === id)?.name ?? '';
  const prio = (p: number) => priorityLabel(team?.priorityLabels, String(p) as PriorityKey, (k) => t(`teams:priority.default.${k}`));

  const rows = useMemo(() => {
    if (!sort) return items;
    const value = (i: Item): string | number => {
      switch (sort.key) {
        case 'name': return i.name;
        case 'requester': return nameOf(i.requesterId);
        case 'subgroup': return team?.subgroups.find((g) => g.id === i.subgroupId)?.name ?? '';
        case 'priority': return i.priority;
        case 'quantity': return i.quantity;
        case 'unitPrice': return Number(i.estimatedUnitPrice.amount);
        case 'lineTotal': return total(i);
        case 'vendor': return i.vendorName;
        case 'status': return t(`itemStatus.${i.status}`, { defaultValue: i.status });
      }
    };
    const sorted = [...items].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    });
    return sort.desc ? sorted.reverse() : sorted;
  }, [items, sort, nameOf, team, t]);

  // Like a spreadsheet: the first click sorts ascending, the second descending, the third restores the batch order.
  const header = (key: SortKey, label: string, numeric = false) => {
    const dir = sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined;
    const next = () => setSort(!dir ? { key, desc: false } : dir === 'ascending' ? { key, desc: true } : null);
    return (
      <Button variant="plain" size="sm" px="0" h="auto" minW="0" color="inherit" fontWeight="inherit" data-sort={dir} onClick={next}
        flexDirection={numeric ? 'row-reverse' : 'row'}>
        {label}
        {dir && <Icon boxSize="3" aria-hidden>{dir === 'ascending' ? <LuArrowUp /> : <LuArrowDown />}</Icon>}
      </Button>
    );
  };
  const col = (key: SortKey, label: string, rest: Omit<DataColumn<Item>, 'key' | 'header' | 'label'>): DataColumn<Item> => ({
    key, label, header: header(key, label, rest.numeric), ...rest,
  });

  const columns: DataColumn<Item>[] = [
    col('name', t('item.name'), {
      priority: 'primary',
      cell: (it) => {
        const url = safeHttpUrl(it.productUrl);
        return (
          <Box as="span" display="block" textAlign="start" overflowWrap="anywhere">
            <Flex as="span" align="flex-start" gap="1.5">
              {/* One line tall, whatever the font size, so the icon centres on the first line of the name. */}
              {reviewAsIcon && <Box as="span" display="inline-flex" alignItems="center" h="1lh" flexShrink={0}><ItemStatusIcon status={it.status} /></Box>}
              <ClampedText text={`#${it.seqNo} ${it.name}`} flex="0 1 auto" minW="0">
                <Text as="span" color="fg.muted" fontWeight="normal" fontVariantNumeric="tabular-nums" me="1.5">#{it.seqNo}</Text>
                {url ? <Link display="inline" href={url} target="_blank" rel="noopener noreferrer" color="fg" textUnderlineOffset="3px">{it.name}</Link> : it.name}
              </ClampedText>
              {/* The priority rides along with the name instead of taking a column of its own (B3: the table must fit). */}
              <Tooltip content={t('item.priorityOf', { label: prio(it.priority) })}>
                <Badge variant="outline" size="sm" flexShrink={0} tabIndex={0} aria-label={t('item.priorityOf', { label: prio(it.priority) })}>P{it.priority}</Badge>
              </Tooltip>
              {/* A marker that this item has notes; the notes show on hover or focus. */}
              {it.notes && (
                <Tooltip content={<Text whiteSpace="pre-wrap" overflowWrap="anywhere" maxW="xs">{it.notes}</Text>}>
                  <Icon as={LuStickyNote} boxSize="4" mt="0.5" color="fg.muted" flexShrink={0} tabIndex={0} role="img" aria-label={`${t('item.notes')}: ${it.notes}`} />
                </Tooltip>
              )}
            </Flex>
            {it.purpose && <ClampedText text={it.purpose} lines={2} display="block" textStyle="xs" fontWeight="normal" color="fg.muted" />}
            {it.status === 'returned' && it.review?.comment && (
              <Text textStyle="xs" fontWeight="normal" color="fg.warning">{t('item.returnedComment', { comment: it.review.comment })}</Text>
            )}
            {it.status === 'rejected' && it.review?.comment && (
              <Text textStyle="xs" fontWeight="normal" color="fg.error">{t('item.rejectedComment', { comment: it.review.comment })}</Text>
            )}
            {it.unpurchasable?.reason && (
              <Text textStyle="xs" fontWeight="normal" color="fg.muted">{t('item.unpurchasableReason', { reason: it.unpurchasable.reason })}</Text>
            )}
          </Box>
        );
      },
    }),
    ...(showRequester ? [col('requester', t('item.requester'), { cell: (it) => nameOf(it.requesterId) })] : []),
    col('subgroup', t('item.subgroup'), { priority: 'secondary', cell: (it) => subgroupName(it.subgroupId) || '—' }),
    col('vendor', t('item.vendor'), { priority: 'secondary', cell: (it) => it.vendorName || '—' }),
    col('quantity', t('item.quantity'), { numeric: true, cell: (it) => it.quantity }),
    // Unit price under the total: one money column instead of two.
    col('lineTotal', t('item.lineTotal'), {
      numeric: true,
      cell: (it) => (
        <Box as="span" display="block">
          <Text as="span" display="block">{formatMoney(format(lineTotal(it)), it.estimatedUnitPrice.currency)}</Text>
          <Text as="span" display="block" textStyle="xs" color="fg.muted">{t('item.each', { price: formatMoney(it.estimatedUnitPrice.amount, it.estimatedUnitPrice.currency) })}</Text>
        </Box>
      ),
    }),
    col('status', t('item.status'), { cell: (it) => (
      reviewAsIcon
        ? (it.fulfillment ? <FulfillmentBadge value={it.fulfillment} /> : '—')
        : (
          <HStack gap="1" wrap="nowrap">
            <ItemStatusBadge status={it.status} />
            {it.fulfillment && <FulfillmentBadge value={it.fulfillment} />}
          </HStack>
        )
    ) }),
  ];

  return (
    <DataTable
      aria-label={t('tabs.items')}
      rows={rows}
      columns={columns}
      getRowId={(i) => i.id}
      selection={selection}
      rowActions={rowActions}
      empty={empty}
    />
  );
}
