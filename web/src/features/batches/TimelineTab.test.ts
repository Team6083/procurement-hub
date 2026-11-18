import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '../../api/types';
import { deletedItemLabel } from './TimelineTab';

const ev = (from: unknown) => ({ action: 'item.deleted', changes: [{ field: 'item', from }] }) as unknown as AuditEvent;

describe('deletedItemLabel', () => {
  it('shows seqNo and name', () => expect(deletedItemLabel(ev({ seqNo: 3, name: 'Cable' }))).toBe('#3 Cable'));
  it('tolerates missing fields', () => {
    expect(deletedItemLabel(ev({ name: 'Cable' }))).toBe('Cable');
    expect(deletedItemLabel(ev(null))).toBeNull();
    expect(deletedItemLabel({ action: 'item.deleted' } as AuditEvent)).toBeNull();
  });
});
