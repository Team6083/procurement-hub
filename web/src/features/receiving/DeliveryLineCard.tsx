import { Alert, Badge, Button, Card, HStack, List, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuLink, LuUndo2 } from 'react-icons/lu';
import type { DeliveryLine } from '../../api/types';
import { RouteAnchor } from '../../components/RouteLinks';
import { paths } from '../../paths';
import { MatchStateBadge } from './StatusBadges';

interface Props {
  line: DeliveryLine;
  canWrite: boolean;
  onMatch: () => void;
  onNoMatch: () => void;
  onUndoNoMatch: () => void;
}

/** One line of a delivery: what came, where it went, and what can still be done with it. */
export function DeliveryLineCard({ line, canWrite, onMatch, onNoMatch, onUndoNoMatch }: Props) {
  const { t } = useTranslation('receiving');
  const pending = line.goodQuantity + line.problemQuantity - line.matchedGoodQuantity - line.matchedProblemQuantity;
  const open = line.matchState === 'unmatched' || line.matchState === 'partial';
  const title = `#${line.lineNo} ${line.name || line.sku}`;
  return (
    <Card.Root size="sm" as="article" aria-label={title}>
      <Card.Header>
        <HStack justify="space-between" align="flex-start" gap="2">
          <Stack gap="0" minW="0">
            <Text fontWeight="semibold">{title}</Text>
            {line.name && line.sku && <Text fontSize="xs" color="fg.muted">{line.sku}</Text>}
          </Stack>
          <MatchStateBadge state={line.matchState} />
        </HStack>
      </Card.Header>
      <Card.Body>
        <Stack gap="3">
          <HStack gap="2" wrap="wrap" fontSize="sm">
            <Text>{t('line.good', { count: line.goodQuantity })}</Text>
            {line.problemQuantity > 0 && (
              <Badge variant="subtle" colorPalette="red">{t('line.problem', { count: line.problemQuantity, type: t(`problemType.${line.problemType || 'damaged'}`) })}</Badge>
            )}
            {line.problemNote && <Text color="fg.muted">{line.problemNote}</Text>}
          </HStack>

          {line.matches.length > 0 && (
            <Stack gap="1">
              <Text fontSize="sm" fontWeight="medium">{t('line.matchedTo')}</Text>
              <List.Root fontSize="sm" ps="4" gap="1">
                {line.matches.map((m) => (
                  <List.Item key={m.id}>
                    <RouteAnchor to={paths.vendorOrder(m.vendorOrderId)}>{`VO-${m.vendorOrderNumber} #${m.lineNo} ${m.lineName}`}</RouteAnchor>
                    {': '}
                    {t('line.matchQty', { good: m.goodQuantity, problem: m.problemQuantity })}
                  </List.Item>
                ))}
              </List.Root>
            </Stack>
          )}

          {line.noMatch && <Text fontSize="sm" color="fg.muted">{t('line.noMatchReason', { reason: line.noMatch.reason })}</Text>}

          {open && pending > 0 && line.matches.length > 0 && (
            <Alert.Root status="warning" size="sm">
              <Alert.Indicator />
              <Alert.Description>{t('line.pendingRest', { count: pending })}</Alert.Description>
            </Alert.Root>
          )}

          {canWrite && (
            <HStack gap="2" wrap="wrap">
              {!line.noMatch && <Button size="sm" variant={open ? 'solid' : 'outline'} onClick={onMatch}><LuLink />{t('line.match')}</Button>}
              {open && <Button size="sm" variant="outline" onClick={onNoMatch}><LuBan />{t('noMatch.action')}</Button>}
              {line.noMatch && <Button size="sm" variant="outline" onClick={onUndoNoMatch}><LuUndo2 />{t('noMatch.undo')}</Button>}
            </HStack>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  );
}
