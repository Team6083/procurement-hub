import { Badge, Button, Card, Flex, SimpleGrid, Skeleton, Stack, Text } from '@chakra-ui/react';
import { EmptyState, SectionHeader } from '@team6083/ui';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPackageCheck } from 'react-icons/lu';
import { useItemExceptions } from '../../api/receiving';
import type { Batch, Item, ItemException } from '../../api/types';
import { ItemStatusBadge } from '../batches/StatusBadges';
import type { Caller } from '../batches/rules';
import { ExceptionModal } from './ExceptionModal';
import { ReceiveModal } from './ReceiveModal';
import { ResolveModal, type Resolving } from './ResolveModal';
import { canReceive, canResolve, closedItems, openExceptionItems, remainingQuantity, toReceive } from './rules';

interface Props {
  batch: Batch;
  caller: Caller;
  items: Item[];
  nameOf: (id: string) => string;
}

/** Big touch targets on a phone: buttons span the card and stack, and sit side by side from md up. */
function Actions({ children }: { children: ReactNode }) {
  return <Flex gap="2" direction={{ base: 'column', md: 'row' }} wrap="wrap" mt="1">{children}</Flex>;
}

function ItemCard({ item, children, actions }: { item: Item; children?: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation('receiving');
  return (
    <Card.Root size="sm" data-testid={`receiving-item-${item.id}`}>
      <Card.Body gap="2">
        <Flex justify="space-between" align="flex-start" gap="2">
          <Text fontWeight="semibold" overflowWrap="anywhere">#{item.seqNo} {item.name}</Text>
          <ItemStatusBadge status={item.status} />
        </Flex>
        <Text color="fg.muted" textStyle="sm">
          {item.vendor && `${item.vendor} · `}{t('card.received', { received: item.receivedQuantity, quantity: item.quantity })}
        </Text>
        {children}
        {actions && <Actions>{actions}</Actions>}
      </Card.Body>
    </Card.Root>
  );
}

/** The open exception's details; the purchaser's resolve button needs its id and version. */
function ExceptionCard({ item, mayResolve, nameOf, onResolve }: { item: Item; mayResolve: boolean; nameOf: (id: string) => string; onResolve: (r: Resolving) => void }) {
  const { t } = useTranslation('receiving');
  const list = useItemExceptions(item.id);
  const open: ItemException | undefined = list.data?.find((e) => e.resolution === null);
  return (
    <ItemCard
      item={item}
      actions={mayResolve && open && <Button size="lg" onClick={() => onResolve({ item, exception: open })}>{t('exception.resolve')}</Button>}
    >
      {list.isPending && <Skeleton h="10" rounded="l2" />}
      {open && (
        <Stack gap="0.5">
          <Badge variant="subtle" colorPalette="red" alignSelf="flex-start">{t(`exceptionType.${open.type}`)}</Badge>
          <Text overflowWrap="anywhere" whiteSpace="pre-wrap">{open.description}</Text>
          <Text color="fg.muted" textStyle="xs">{t('exception.reportedBy', { who: nameOf(open.reportedBy), when: new Date(open.reportedAt).toLocaleString() })}</Text>
        </Stack>
      )}
    </ItemCard>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <Stack gap="3">
      <SectionHeader title={title} count={count} mb="0" />
      <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="3">{children}</SimpleGrid>
    </Stack>
  );
}

export function ReceivingTab({ batch, caller, items, nameOf }: Props) {
  const { t } = useTranslation('receiving');
  const [receiving, setReceiving] = useState<Item | null>(null);
  const [reporting, setReporting] = useState<Item | null>(null);
  const [resolving, setResolving] = useState<Resolving | null>(null);
  const mayReceive = canReceive(batch, caller);
  const mayResolve = canResolve(batch, caller);
  const pending = toReceive(items);
  const exceptions = openExceptionItems(items);
  const done = closedItems(items);

  if (pending.length + exceptions.length + done.length === 0) {
    return <EmptyState icon={<LuPackageCheck />} title={t('empty')} description={t('emptyHelp')} />;
  }

  return (
    <Stack gap="6">
      {exceptions.length > 0 && (
        <Group title={t('groups.exceptions')} count={exceptions.length}>
          {exceptions.map((i) => <ExceptionCard key={i.id} item={i} mayResolve={mayResolve} nameOf={nameOf} onResolve={setResolving} />)}
        </Group>
      )}
      <Stack gap="3">
        <SectionHeader title={t('groups.toReceive')} count={pending.length} mb="0" />
        {pending.length === 0 ? (
          <EmptyState icon={<LuPackageCheck />} title={t('allReceived')} />
        ) : (
          <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="3">
            {pending.map((i) => (
              <ItemCard
                key={i.id}
                item={i}
                actions={mayReceive && (
                  <>
                    <Button size="lg" onClick={() => setReceiving(i)}>{t('receive.button', { count: remainingQuantity(i) })}</Button>
                    <Button size="lg" variant="outline" onClick={() => setReporting(i)}>{t('exception.button')}</Button>
                  </>
                )}
              />
            ))}
          </SimpleGrid>
        )}
      </Stack>
      {done.length > 0 && (
        <Group title={t('groups.done')} count={done.length}>
          {done.map((i) => (
            <ItemCard key={i.id} item={i}>
              {i.closeReason && <Text color="fg.muted" textStyle="sm" overflowWrap="anywhere">{i.closeReason}</Text>}
            </ItemCard>
          ))}
        </Group>
      )}
      <ReceiveModal item={receiving} batchId={batch.id} nameOf={nameOf} onClose={() => setReceiving(null)} />
      <ExceptionModal item={reporting} batchId={batch.id} onClose={() => setReporting(null)} />
      <ResolveModal target={resolving} batchId={batch.id} onClose={() => setResolving(null)} />
    </Stack>
  );
}
