import { Button, Dialog, Input, Stack, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchBatch, useSetAssignments } from '../../api/batches';
import { useRoleHolders } from '../../api/members';
import type { Batch, PatchBatchRequest, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Checklist } from '../../components/ui/checklist';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { deadlineChange, fromLocalInput, toLocalInput } from './datetime';

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

function Inner({ batch, members, onClose }: { batch: Batch; members: TeamMember[]; onClose: () => void }) {
  const { t } = useTranslation('batches');
  const patch = usePatchBatch(batch.id);
  const assign = useSetAssignments(batch.id);
  const [title, setTitle] = useState(batch.title);
  const [description, setDescription] = useState(batch.description);
  const [deadline, setDeadline] = useState(toLocalInput(batch.deadline));
  const [override, setOverride] = useState<string>(batch.visibilityOverride || 'inherit');
  const [a, setA] = useState(batch.assignments.approvers);
  const [p, setP] = useState(batch.assignments.purchasers);
  const purchasers = useRoleHolders('purchaser');
  const options = members.map((m) => ({ value: m.userId, label: m.displayName || m.username }));
  const purchaserOptions = (purchasers.data ?? []).map((u) => ({ value: u.id, label: u.displayName || u.username }));
  const newDeadline = fromLocalInput(deadline);

  const save = async () => {
    if (newDeadline === undefined) return;
    // Sequential: each call returns the new version, which the next call reads from the cache.
    const body: PatchBatchRequest = {};
    if (title.trim() !== batch.title) body.title = title.trim();
    if (description !== batch.description) body.description = description;
    const changed = deadlineChange(batch.deadline, deadline);
    if (changed !== undefined) body.deadline = changed;
    const newOverride = override === 'inherit' ? '' : override;
    if (newOverride !== batch.visibilityOverride) body.visibilityOverride = newOverride === '' ? null : (newOverride as 'public' | 'members');
    try {
      if (Object.keys(body).length > 0) await patch.mutateAsync(body);
      const as = batch.assignments;
      if (!sameIds(a, as.approvers) || !sameIds(p, as.purchasers)) {
        await assign.mutateAsync({ approvers: a, purchasers: p });
      }
      onClose();
    } catch {
      /* errors are shown below; conflicts are refetched by the mutation hooks */
    }
  };

  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <FormField label={t('create.title')}>
            <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} />
          </FormField>
          <FormField label={t('create.description')}>
            <Textarea value={description} onChange={(e) => setDescription(e.currentTarget.value)} autoresize rows={2} />
          </FormField>
          <FormField label={t('header.deadline')}>
            <Input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.currentTarget.value)} />
          </FormField>
          <SelectField
            label={t('header.visibility')}
            value={override}
            onChange={(v) => v && setOverride(v)}
            options={[{ value: 'inherit', label: t('visibility.inherit') }, { value: 'public', label: t('visibility.public') }, { value: 'members', label: t('visibility.members') }]}
          />
          <Checklist label={t('assignments.approvers')} options={options} value={a} onChange={setA} />
          <Checklist label={t('assignments.purchasers')} options={purchaserOptions} value={p} onChange={setP} emptyText={t('assignments.none')} />
          <Text color="fg.muted">{t('assignments.purchasersHelp')}</Text>
          <ErrorAlert error={patch.error ?? assign.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" loading={patch.isPending || assign.isPending} disabled={!title.trim() || newDeadline === undefined} onClick={() => void save()}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Edit details and assignments; the assignee pickers only offer team members. */
export function EditBatchModal({ opened, batch, members, onClose }: { opened: boolean; batch: Batch; members: TeamMember[]; onClose: () => void }) {
  const { t } = useTranslation('batches');
  return (
    <AppDialog open={opened} onClose={onClose} title={t('edit.title')}>
      <Inner batch={batch} members={members} onClose={onClose} />
    </AppDialog>
  );
}
