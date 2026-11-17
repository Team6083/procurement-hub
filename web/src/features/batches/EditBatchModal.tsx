import { Button, Dialog, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { usePatchBatch, useSetAssignments } from '../../api/batches';
import { useRoleHolders } from '../../api/members';
import type { Batch, PatchBatchRequest, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Checklist } from '../../components/ui/checklist';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { requiredText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { deadlineChange, fromLocalInput, toLocalInput } from './datetime';

const editSchema = z.object({
  title: requiredText(200),
  description: z.string(),
  deadline: z.string().refine((v) => fromLocalInput(v) !== undefined, 'common:validation.invalid'),
  visibility: z.enum(['inherit', 'public', 'members']),
  approvers: z.array(z.string()),
  purchasers: z.array(z.string()),
});
type EditForm = z.infer<typeof editSchema>;

const toForm = (b: Batch): EditForm => ({
  title: b.title, description: b.description, deadline: toLocalInput(b.deadline), visibility: b.visibilityOverride || 'inherit',
  approvers: b.assignments.approvers, purchasers: b.assignments.purchasers,
});

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** Only what differs from the batch as it is now (fields the user did not touch follow the latest version). */
function patchBody(b: Batch, v: EditForm): PatchBatchRequest {
  const body: PatchBatchRequest = {};
  if (v.title.trim() !== b.title) body.title = v.title.trim();
  if (v.description !== b.description) body.description = v.description;
  const deadline = deadlineChange(b.deadline, v.deadline);
  if (deadline !== undefined) body.deadline = deadline;
  const override = v.visibility === 'inherit' ? null : v.visibility;
  if ((override ?? '') !== (b.visibilityOverride ?? '')) body.visibilityOverride = override;
  return body;
}

function Inner({ batch, members, onClose }: { batch: Batch; members: TeamMember[]; onClose: () => void }) {
  const { t } = useTranslation('batches');
  const patch = usePatchBatch(batch.id);
  const assign = useSetAssignments(batch.id);
  const purchasers = useRoleHolders('purchaser');
  // `values` follows the batch: after a version conflict refetches it, fields the user did not touch take the latest
  // values and the edited ones are kept, so saving again never reverts someone else's change.
  const form = useForm({ resolver: zodResolver(editSchema), values: toForm(batch), resetOptions: { keepDirtyValues: true } });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const options = members.map((m) => ({ value: m.userId, label: m.displayName || m.username }));
  const purchaserOptions = (purchasers.data ?? []).map((u) => ({ value: u.id, label: u.displayName || u.username }));
  const error = patch.error ?? assign.error;

  const submit = form.handleSubmit(async (v) => {
    patch.reset();
    assign.reset();
    try {
      // One after another: each write returns the next batch version, which the next one sends.
      const body = patchBody(batch, v);
      if (Object.keys(body).length > 0) await patch.mutateAsync(body);
      const as = batch.assignments;
      if (!sameIds(v.approvers, as.approvers) || !sameIds(v.purchasers, as.purchasers)) {
        await assign.mutateAsync({ approvers: v.approvers, purchasers: v.purchasers });
      }
      onClose();
    } catch {
      /* shown in the alert below */
    }
  });
  const discard = () => {
    patch.reset();
    assign.reset();
    form.reset(toForm(batch));
  };

  return (
    <>
      <Dialog.Body>
        <form id="edit-batch-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('create.title')} required errorText={fieldError(err.title)}>
              <Input maxLength={200} {...form.register('title')} />
            </FormField>
            <FormField label={t('create.description')}>
              <Textarea autoresize rows={2} {...form.register('description')} />
            </FormField>
            <FormField label={t('header.deadline')} errorText={fieldError(err.deadline)}>
              <Input type="datetime-local" {...form.register('deadline')} />
            </FormField>
            <Controller control={form.control} name="visibility" render={({ field }) => (
              <SelectField
                label={t('header.visibility')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                options={[{ value: 'inherit', label: t('visibility.inherit') }, { value: 'public', label: t('visibility.public') }, { value: 'members', label: t('visibility.members') }]}
              />
            )} />
            <Controller control={form.control} name="approvers" render={({ field }) => (
              <Checklist label={t('assignments.approvers')} options={options} value={field.value} onChange={field.onChange} />
            )} />
            <Controller control={form.control} name="purchasers" render={({ field }) => (
              <Checklist label={t('assignments.purchasers')} options={purchaserOptions} value={field.value} onChange={field.onChange} emptyText={t('assignments.none')} />
            )} />
            <Text color="fg.muted">{t('assignments.purchasersHelp')}</Text>
            <ErrorAlert error={error} onDiscard={discard} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="edit-batch-form" loading={patch.isPending || assign.isPending}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Edit details and assignments; the assignee pickers only offer team members. */
export function EditBatchModal({ open, batch, members, onClose }: { open: boolean; batch: Batch; members: TeamMember[]; onClose: () => void }) {
  const { t } = useTranslation('batches');
  return (
    <AppDialog open={open} onClose={onClose} title={t('edit.title')}>
      <Inner batch={batch} members={members} onClose={onClose} />
    </AppDialog>
  );
}
