import { List, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/errors';
import { paths } from '../paths';
import { RouteAnchor } from './RouteLinks';
import { ReasonModal } from './ReasonModal';

interface Blocker {
  type: string;
  id: string;
  label: string;
}

/** The objects that stop an undo (409 blocked_by_dependency, details.blockers), each linked when it has a page. */
export function BlockerList({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!(error instanceof ApiError) || error.code !== 'blocked_by_dependency') return null;
  const blockers = (Array.isArray(error.details.blockers) ? error.details.blockers : []) as Blocker[];
  if (blockers.length === 0) return null;
  const href = (b: Blocker) => (b.type === 'batch' ? paths.batch(b.id) : b.type === 'vendor_order' ? paths.vendorOrder(b.id) : undefined);
  const kind: Record<string, string> = {
    vendor_order_line: t('undo.blockedLine'), item: t('undo.blockedItem'), batch: t('undo.blockedBatch'), vendor_order: t('undo.blockedVendorOrder'),
  };
  return (
    <div>
      <Text fontSize="sm" fontWeight="medium">{t('undo.blockedTitle')}</Text>
      <List.Root fontSize="sm" ps="4">
        {blockers.map((b) => (
          <List.Item key={`${b.type}:${b.id}`}>
            {kind[b.type] ?? b.type}:{' '}
            {href(b) ? <RouteAnchor to={href(b)!}>{b.label}</RouteAnchor> : b.label}
          </List.Item>
        ))}
      </List.Root>
    </div>
  );
}

interface Props {
  opened: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  loading?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/** Dialog for undo actions: a required reason, and the blocker list when the backend refuses with 409 blocked_by_dependency. */
export function UndoDialog({ error, ...rest }: Props) {
  const { t } = useTranslation();
  return <ReasonModal {...rest} reasonLabel={t('undo.reason')} error={error} />;
}
