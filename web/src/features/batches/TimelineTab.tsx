import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCheck, LuCircleCheck, LuEye, LuFilePlus, LuPencil, LuPlay, LuRotateCcw, LuSend, LuShoppingCart, LuTrash2, LuUsers, LuUndo2, LuX } from 'react-icons/lu';
import { useBatchAudit } from '../../api/batches';
import type { AuditEvent } from '../../api/types';
import { AuditTimeline, auditActionKey, isSystemActor } from '../../components/AuditTimeline';

const actionIcons: Record<string, ReactNode> = {
  'batch.created': <LuFilePlus />, 'batch.proposed': <LuSend />, 'batch.updated': <LuPencil />, 'batch.assignments_changed': <LuUsers />,
  'batch.open': <LuPlay />, 'batch.start_review': <LuEye />, 'batch.close': <LuCircleCheck />, 'batch.reopen': <LuRotateCcw />,
  'batch.cancel': <LuBan />, 'batch.reject_proposal': <LuX />, 'batch.withdraw_proposal': <LuUndo2 />, 'batch.auto_transition': <LuPlay />,
  'item.created': <LuFilePlus />, 'item.updated': <LuPencil />, 'item.withdrawn': <LuUndo2 />, 'item.deleted': <LuTrash2 />, 'item.resubmitted': <LuSend />,
  'item.approved': <LuCheck />, 'item.returned': <LuRotateCcw />, 'item.rejected': <LuX />, 'item.force_rejected': <LuBan />,
  'item.unpurchasable': <LuShoppingCart />,
};

/** A batch's timeline, its items' events included; people by name. */
export function TimelineTab({ batchId, nameOf }: { batchId: string; nameOf: (id: string) => string }) {
  const { t } = useTranslation('batches');
  const audit = useBatchAudit(batchId);
  const statusChange = (ev: AuditEvent) => {
    const c = ev.changes?.find((x) => x.field === 'status');
    if (!c || typeof c.to !== 'string' || !c.to) return null;
    const label = (s: unknown) => (typeof s === 'string' && s ? t(`${ev.objectType === 'item' ? 'itemStatus' : 'status'}.${s}`, { defaultValue: s }) : '');
    return c.from ? `${label(c.from)} → ${label(c.to)}` : label(c.to);
  };
  return (
    <AuditTimeline
      audit={audit} emptyTitle={t('timeline.empty')}
      format={{
        title: (ev) => t(auditActionKey(ev.action), { defaultValue: t('timeline.generic', { action: ev.action }) }),
        detail: statusChange,
        icon: (ev) => actionIcons[ev.action],
        actor: (a) => (isSystemActor(a) ? t('timeline.system') : nameOf(a)),
      }}
    />
  );
}
