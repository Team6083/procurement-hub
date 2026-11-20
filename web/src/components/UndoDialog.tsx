import { useTranslation } from 'react-i18next';
import { ReasonModal } from './ReasonModal';

interface Props {
  open: boolean;
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
