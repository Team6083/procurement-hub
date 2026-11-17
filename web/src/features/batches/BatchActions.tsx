import { Box, Button, Checkbox, Dialog, HStack, Stack, Text } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTransition } from '../../api/batches';
import type { Batch, BatchAction } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { Tooltip } from '../../components/ui/tooltip';
import { UndoDialog } from '../../components/UndoDialog';
import { availableActions, type Caller } from './rules';
import { DeadlineModal } from './DeadlineModal';

const NEEDS_REASON: BatchAction[] = ['cancel', 'reject_proposal'];
const UNDO: BatchAction[] = ['uncancel', 'restore_proposal', 'unconfirm_review'];
/** Which action is the batch header's one solid button, in order of preference. */
const PRIMARY: BatchAction[] = ['confirm_review', 'open', 'close', 'reopen'];
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
  // One solid button per header: the step that moves the batch on; the rest are outline (danger ones stay red).
  const solid = PRIMARY.find((p) => actions.some((a) => a.action === p));
  // Why an action cannot run yet, in text a phone can read too (a tooltip needs hover).
  const reasons = [...new Set(actions.flatMap((a) => (a.disabled ? [a.disabled] : [])))];

  return (
    <>
      <Stack gap="1" align="flex-end">
      <HStack gap="2" wrap="wrap">
        {actions.map(({ action, disabled }) => (
          <Tooltip key={action} content={disabled ? t(`actions.disabled.${disabled}`) : ''} disabled={!disabled}>
            <Box as="span" display="inline-block" tabIndex={disabled ? 0 : undefined}>
              <Button
                size="sm"
                variant={DANGER.includes(action) ? 'subtle' : action === solid ? 'solid' : 'outline'}
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
      {reasons.map((r) => <Text key={r} textStyle="sm" color="fg.muted">{t(`actions.disabled.${r}`)}</Text>)}
      </Stack>
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
        <AppDialog open onClose={close} title={t('actions.confirm_review')} size="sm">
          <Dialog.Body>
            <Stack gap="3">
              <Text>{t('actions.confirm.confirm_review')}</Text>
              <Checkbox.Root checked={outside} onCheckedChange={(e) => setOutside(e.checked === true)}>
                <Checkbox.HiddenInput />
                <Checkbox.Control />
                <Checkbox.Label>{t('actions.purchaseOutside')}</Checkbox.Label>
              </Checkbox.Root>
              <ErrorAlert error={transition.error} />
            </Stack>
          </Dialog.Body>
          <DialogFooter>
            <Button size="sm" loading={transition.isPending} onClick={() => run({ purchaseOutside: outside })}>{t('actions.confirm_review')}</Button>
          </DialogFooter>
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
