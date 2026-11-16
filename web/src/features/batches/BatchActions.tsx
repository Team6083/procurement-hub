import { Box, Button, Checkbox, HStack, Stack, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransition } from '../../api/batches';
import type { Batch, BatchAction } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { AppDialog } from '../../components/ui/dialog';
import { Tooltip } from '../../components/ui/tooltip';
import { UndoDialog } from '../../components/UndoDialog';
import { availableActions, type Caller } from './rules';
import { DeadlineModal } from './DeadlineModal';

const NEEDS_REASON: BatchAction[] = ['cancel', 'reject_proposal'];
const UNDO: BatchAction[] = ['uncancel', 'restore_proposal', 'unconfirm_review'];
const DANGER: BatchAction[] = ['cancel', 'reject_proposal', 'withdraw_proposal'];

/** Role-aware lifecycle buttons with reason / deadline dialogs where the backend requires them. */
export function BatchActions({ batch, caller, pendingItems, undecidedItems }: {
  batch: Batch;
  caller: Caller;
  pendingItems: number | undefined;
  undecidedItems?: number;
}) {
  const { t } = useTranslation('batches');
  const [active, setActive] = useState<BatchAction | null>(null);
  const [outside, setOutside] = useState(false);
  const transition = useTransition(batch.id);
  const actions = availableActions(batch, caller, pendingItems, undecidedItems);
  if (actions.length === 0) return null;
  const close = () => { setActive(null); setOutside(false); transition.reset(); };
  const run = (body: { reason?: string; deadline?: string; purchaseOutside?: boolean }) =>
    active && transition.mutate({ action: active, ...body }, { onSuccess: close });
  // Undoing a cancellation of a collecting batch needs a new deadline when the old one has passed.
  const uncancelNeedsDeadline = active === 'uncancel' && batch.statusBeforeCancel === 'collecting' && (!batch.deadline || new Date(batch.deadline) <= new Date());
  const needsDeadline = active === 'open' || active === 'reopen' || uncancelNeedsDeadline;
  const primary = (a: BatchAction) => a === 'confirm_review';

  return (
    <>
      <HStack gap="2" wrap="wrap">
        {actions.map(({ action, disabled }) => (
          <Tooltip key={action} content={disabled ? t(`actions.disabled.${disabled}`) : ''} disabled={!disabled}>
            <Box as="span" display="inline-block" tabIndex={disabled ? 0 : undefined}>
              <Button
                size="xs"
                variant={DANGER.includes(action) ? 'subtle' : UNDO.includes(action) ? 'outline' : 'solid'}
                colorPalette={DANGER.includes(action) ? 'red' : undefined}
                disabled={!!disabled}
                onClick={() => { transition.reset(); setActive(action); }}
              >
                {t(`actions.${action}`)}
              </Button>
            </Box>
          </Tooltip>
        ))}
      </HStack>
      {active && needsDeadline && (
        <DeadlineModal
          opened
          title={t(`actions.${active}`)}
          required={active !== 'open' || !batch.deadline}
          initial={batch.deadline}
          reasonLabel={active === 'uncancel' ? t('common:undo.reason') : undefined}
          loading={transition.isPending}
          error={transition.error}
          onClose={close}
          onConfirm={(deadline, reason) => run({ deadline, ...(reason ? { reason } : {}) })}
        />
      )}
      {active === 'confirm_review' && (
        <AppDialog open onClose={close} title={t('actions.confirm_review')}>
          <Stack gap="4">
            <Text fontSize="sm">{t('actions.confirm.confirm_review')}</Text>
            <Checkbox.Root checked={outside} onCheckedChange={(e) => setOutside(e.checked === true)}>
              <Checkbox.HiddenInput />
              <Checkbox.Control />
              <Checkbox.Label>{t('actions.purchaseOutside')}</Checkbox.Label>
            </Checkbox.Root>
            <ErrorAlert error={transition.error} />
            <HStack justify="flex-end">
              <Button variant="outline" onClick={close}>{t('common:actions.cancel')}</Button>
              <Button loading={transition.isPending} onClick={() => run({ purchaseOutside: outside })}>{t('actions.confirm_review')}</Button>
            </HStack>
          </Stack>
        </AppDialog>
      )}
      {active && UNDO.includes(active) && !needsDeadline && (
        <UndoDialog
          opened
          title={t(`actions.${active}`)}
          body={t(`actions.confirm.${active}`)}
          confirmLabel={t(`actions.${active}`)}
          loading={transition.isPending}
          error={transition.error}
          onClose={close}
          onConfirm={(reason) => run({ reason })}
        />
      )}
      {active && !needsDeadline && !UNDO.includes(active) && !primary(active) && (
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
