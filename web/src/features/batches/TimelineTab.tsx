import { useTranslation } from 'react-i18next';
import { useBatchAudit } from '../../api/batches';
import type { AuditEvent } from '../../api/types';
import { AuditTimeline, auditActionKey, isSystemActor } from '../../components/AuditTimeline';

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
        actor: (a) => (isSystemActor(a) ? t('timeline.system') : nameOf(a)),
      }}
    />
  );
}
