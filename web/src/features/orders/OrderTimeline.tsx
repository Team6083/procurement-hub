import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCheck, LuFilePlus, LuPackageCheck, LuPencil, LuPlus, LuReceipt, LuRotateCcw, LuSend, LuTriangleAlert, LuUndo2, LuX } from 'react-icons/lu';
import { useMe } from '../../api/me';
import { useBaseCurrency } from '../../api/meta';
import { useOrderAudit } from '../../api/vendorOrders';
import type { AuditEvent } from '../../api/types';
import { AuditTimeline, auditActionKey, isSystemActor } from '../../components/AuditTimeline';
import { formatMoney } from '../money';

const actionIcons: Record<string, ReactNode> = {
  'vendor_order.created': <LuFilePlus />, 'vendor_order.updated': <LuPencil />, 'vendor_order.placed': <LuSend />, 'vendor_order.unplaced': <LuUndo2 />,
  'vendor_order.cancelled': <LuBan />, 'vendor_order.uncancelled': <LuRotateCcw />,
  'vendor_order.line_added': <LuPlus />, 'vendor_order.line_updated': <LuPencil />, 'vendor_order.line_removed': <LuX />,
  'vendor_order.line_closed': <LuCheck />, 'vendor_order.line_reopened': <LuRotateCcw />, 'vendor_order.line_status_derived': <LuPencil />,
  'vendor_order.ledger_added': <LuReceipt />, 'vendor_order.ledger_voided': <LuX />,
  'vendor_order.problem_reported': <LuTriangleAlert />, 'vendor_order.problem_resolved': <LuCheck />, 'vendor_order.problem_resolved_undone': <LuUndo2 />,
  'vendor_order.delivery_matched': <LuPackageCheck />, 'vendor_order.delivery_match_voided': <LuUndo2 />,
};

/** The order's timeline: its own, its lines', ledger and problem events (filtered by the server per caller). */
export function OrderTimeline({ orderId }: { orderId: string }) {
  const { t, i18n } = useTranslation('purchasing');
  const { me } = useMe();
  const baseCurrency = useBaseCurrency();
  const audit = useOrderAudit(orderId);
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
  const detail = (ev: AuditEvent) =>
    (ev.changes ?? []).map((c) => `${t(`timeline.fields.${c.field}`, { defaultValue: c.field })}: ${value(c.field, c.from)} → ${value(c.field, c.to)}`).join('; ');
  return (
    <AuditTimeline
      audit={audit} emptyTitle={t('timeline.empty')}
      format={{
        title: (ev) => t(auditActionKey(ev.action), { defaultValue: ev.action }),
        detail,
        icon: (ev) => actionIcons[ev.action],
        // Purchasers and receivers are not team members, so their names are not known here: a neutral "Someone".
        actor: (a) => (isSystemActor(a) ? t('timeline.system') : a === me?.id ? t('timeline.you') : t('timeline.someone')),
      }}
    />
  );
}
