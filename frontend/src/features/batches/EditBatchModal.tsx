import { Button, Group, Modal, MultiSelect, Select, Stack, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatchBatch, useSetAssignments } from '../../api/batches';
import type { Batch, PatchBatchRequest, TeamMember } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { toLocalInput } from './DeadlineModal';

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
  const [r, setR] = useState(batch.assignments.receivers);
  const data = members.map((m) => ({ value: m.userId, label: m.displayName || m.username }));

  const save = async () => {
    // Sequential: each call returns the new version, which the next call reads from the cache.
    const body: PatchBatchRequest = {};
    if (title.trim() !== batch.title) body.title = title.trim();
    if (description !== batch.description) body.description = description;
    const newDeadline = deadline ? new Date(deadline).toISOString() : null;
    const oldDeadline = batch.deadline ? new Date(batch.deadline).toISOString() : null;
    if (newDeadline !== oldDeadline) body.deadline = newDeadline;
    const newOverride = override === 'inherit' ? '' : override;
    if (newOverride !== batch.visibilityOverride) body.visibilityOverride = newOverride === '' ? null : (newOverride as 'public' | 'members');
    try {
      if (Object.keys(body).length > 0) await patch.mutateAsync(body);
      const as = batch.assignments;
      if (!sameIds(a, as.approvers) || !sameIds(p, as.purchasers) || !sameIds(r, as.receivers)) {
        await assign.mutateAsync({ approvers: a, purchasers: p, receivers: r });
      }
      onClose();
    } catch {
      /* errors are shown below; conflicts are refetched by the mutation hooks */
    }
  };

  return (
    <Stack>
      <TextInput label={t('create.title')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} />
      <Textarea label={t('create.description')} value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
      <TextInput type="datetime-local" label={t('header.deadline')} value={deadline} onChange={(e) => setDeadline(e.currentTarget.value)} />
      <Select
        label={t('header.visibility')}
        allowDeselect={false}
        value={override}
        onChange={(v) => v && setOverride(v)}
        data={[{ value: 'inherit', label: t('visibility.inherit') }, { value: 'public', label: t('visibility.public') }, { value: 'members', label: t('visibility.members') }]}
      />
      <MultiSelect label={t('assignments.approvers')} data={data} value={a} onChange={setA} searchable />
      <MultiSelect label={t('assignments.purchasers')} data={data} value={p} onChange={setP} searchable />
      <MultiSelect label={t('assignments.receivers')} data={data} value={r} onChange={setR} searchable />
      <ErrorAlert error={patch.error ?? assign.error} />
      <Group justify="flex-end">
        <Button variant="default" onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button loading={patch.isPending || assign.isPending} disabled={!title.trim()} onClick={() => void save()}>{t('common:actions.save')}</Button>
      </Group>
    </Stack>
  );
}

/** Edit details and assignments; the assignee pickers only offer team members. */
export function EditBatchModal({ opened, batch, members, onClose }: { opened: boolean; batch: Batch; members: TeamMember[]; onClose: () => void }) {
  const { t } = useTranslation('batches');
  return (
    <Modal opened={opened} onClose={onClose} title={t('edit.title')}>
      {opened && <Inner batch={batch} members={members} onClose={onClose} />}
    </Modal>
  );
}
