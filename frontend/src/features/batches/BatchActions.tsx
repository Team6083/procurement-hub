import { Button, Group, Tooltip } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransition } from '../../api/batches';
import type { Batch, BatchAction } from '../../api/types';
import { ReasonModal } from '../../components/ReasonModal';
import { availableActions, type Caller } from './rules';
import { DeadlineModal } from './DeadlineModal';

const NEEDS_REASON: BatchAction[] = ['cancel', 'reject_proposal'];
const NEEDS_DEADLINE: BatchAction[] = ['open', 'reopen'];
const DANGER: BatchAction[] = ['cancel', 'reject_proposal', 'withdraw_proposal'];

/** Role-aware lifecycle buttons with reason / deadline dialogs where the backend requires them. */
export function BatchActions({ batch, caller, pendingItems }: { batch: Batch; caller: Caller; pendingItems: number | undefined }) {
  const { t } = useTranslation('batches');
  const [active, setActive] = useState<BatchAction | null>(null);
  const transition = useTransition(batch.id);
  const actions = availableActions(batch, caller, pendingItems);
  if (actions.length === 0) return null;
  const close = () => { setActive(null); transition.reset(); };
  const run = (body: { reason?: string; deadline?: string }) =>
    active && transition.mutate({ action: active, ...body }, { onSuccess: () => setActive(null) });

  return (
    <>
      <Group gap="xs">
        {actions.map(({ action, disabled }) => (
          <Tooltip key={action} label={disabled ? t(`actions.disabled.${disabled}`) : ''} disabled={!disabled}>
            <span>
              <Button size="xs" variant={DANGER.includes(action) ? 'light' : 'filled'} color={DANGER.includes(action) ? 'red' : undefined} disabled={!!disabled} onClick={() => { transition.reset(); setActive(action); }}>
                {t(`actions.${action}`)}
              </Button>
            </span>
          </Tooltip>
        ))}
      </Group>
      {active && NEEDS_DEADLINE.includes(active) && (
        <DeadlineModal
          opened
          title={t(`actions.${active}`)}
          required={active === 'reopen' || !batch.deadline}
          initial={batch.deadline}
          loading={transition.isPending}
          error={transition.error}
          onClose={close}
          onConfirm={(deadline) => run({ deadline })}
        />
      )}
      {active && !NEEDS_DEADLINE.includes(active) && (
        <ReasonModal
          opened
          title={t(`actions.${active}`)}
          body={t(`actions.confirm.${active}`)}
          confirmLabel={t(`actions.${active}`)}
          danger={DANGER.includes(active)}
          reasonLabel={NEEDS_REASON.includes(active) ? t('actions.reason') : undefined}
          loading={transition.isPending}
          error={transition.error}
          onClose={close}
          onConfirm={(reason) => run(reason ? { reason } : {})}
        />
      )}
    </>
  );
}
