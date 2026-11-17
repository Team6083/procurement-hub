import { Button, HStack, Skeleton, Stack, Text, Timeline } from '@chakra-ui/react';
import { EmptyState } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { LuHistory } from 'react-icons/lu';
import { useMe } from '../../api/me';
import { useBaseCurrency } from '../../api/meta';
import { useOrderAudit } from '../../api/vendorOrders';
import { ErrorAlert } from '../../components/ErrorAlert';
import { shortDate } from '../dates';
import { formatMoney } from '../money';

/** The order's timeline: its own, its lines', ledger and problem events (filtered by the server per caller). */
export function OrderTimeline({ orderId }: { orderId: string }) {
  const { t, i18n } = useTranslation('purchasing');
  const { me } = useMe();
  const baseCurrency = useBaseCurrency();
  const audit = useOrderAudit(orderId);
  if (audit.isPending) return <Skeleton h="24" rounded="l3" />;
  if (audit.error) return <ErrorAlert error={audit.error} />;
  const events = audit.data.pages.flatMap((p) => p.items);
  if (events.length === 0) return <EmptyState icon={<LuHistory />} title={t('timeline.empty')} />;
  const who = (actor: string) => (actor.startsWith('system:') ? t('timeline.system') : actor === me?.id ? t('timeline.you') : t('timeline.someone'));
  const value = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v === 'boolean') return v ? '✓' : '✗';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (field === 'chargedAmountBase') return formatMoney(s, baseCurrency);
    if (field === 'status') {
      for (const ns of ['orderStatus', 'lineStatus']) if (i18n.exists(`${ns}.${s}`, { ns: 'purchasing' })) return t(`${ns}.${s}`);
    }
    return s;
  };
  return (
    <Stack gap="4">
      <Timeline.Root size="sm">
        {events.map((ev) => {
          const detail = (ev.changes ?? []).map((c) => `${t(`timeline.fields.${c.field}`, { defaultValue: c.field })}: ${value(c.field, c.from)} → ${value(c.field, c.to)}`).join('; ');
          return (
            <Timeline.Item key={ev.id}>
              <Timeline.Connector>
                <Timeline.Separator />
                <Timeline.Indicator />
              </Timeline.Connector>
              <Timeline.Content>
                <Timeline.Title>{t(`timeline.actions.${ev.action.replace(/\./g, '_')}`, { defaultValue: ev.action })}</Timeline.Title>
                {detail && <Text textStyle="sm" color="fg.muted" wordBreak="break-word">{detail}</Text>}
                {ev.comment && <Text textStyle="sm" color="fg.muted" whiteSpace="pre-wrap">“{ev.comment}”</Text>}
                <Timeline.Description>{who(ev.actor)} · {shortDate(ev.at)}</Timeline.Description>
              </Timeline.Content>
            </Timeline.Item>
          );
        })}
      </Timeline.Root>
      {audit.hasNextPage && (
        <HStack>
          <Button size="sm" variant="outline" loading={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}>{t('list.loadMore')}</Button>
        </HStack>
      )}
    </Stack>
  );
}
