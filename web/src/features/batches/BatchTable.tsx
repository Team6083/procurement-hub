import { DataTable } from '@team6083/ui';
import { Text } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Batch } from '../../api/types';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { shortDate } from '../dates';
import { BatchStatusBadge } from './StatusBadges';

/** The list of batches shared by the Batches page and a team's overview; `teamName` adds the team column. */
export function BatchTable({ batches, teamName, empty }: { batches: Batch[]; teamName?: (teamId: string) => string; empty?: ReactNode }) {
  const { t } = useTranslation('batches');
  return (
    <DataTable
      aria-label={t('list.title')}
      rows={batches}
      empty={empty}
      getRowId={(b) => b.id}
      columns={[
        {
          key: 'title', header: t('list.batchTitle'), priority: 'primary',
          cell: (b) => (
            <>
              <Text as="span" color="fg.muted" fontWeight="normal" fontVariantNumeric="tabular-nums" me="1.5">#{b.number}</Text>
              <RouteAnchor to={paths.batch(b.id)}>{b.title}</RouteAnchor>
            </>
          ),
        },
        ...(teamName ? [{ key: 'team', header: t('filters.team'), cell: (b: Batch) => teamName(b.teamId) }] : []),
        { key: 'status', header: t('filters.status'), cell: (b) => <BatchStatusBadge status={b.status} /> },
        { key: 'deadline', header: t('header.deadline'), cell: (b) => <Text as="span" fontVariantNumeric="tabular-nums">{shortDate(b.deadline)}</Text> },
      ]}
    />
  );
}
