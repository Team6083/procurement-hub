import { Button, Group, Modal, Select, Stack, Switch, Textarea, TextInput } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCreateBatch } from '../../api/batches';
import type { MyMembership } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useRouter } from '@tanstack/react-router';

function Inner({ team, onClose }: { team: MyMembership; onClose: () => void }) {
  const { t } = useTranslation('batches');
  const router = useRouter();
  const admin = team.role === 'admin';
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [propose, setPropose] = useState(!admin);
  const create = useCreateBatch(team.teamId);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(
          { title: title.trim(), description, propose: admin ? propose : true },
          { onSuccess: (b) => { onClose(); router.history.push(`/batches/${b.id}`); } },
        );
      }}
    >
      <Stack>
        <TextInput label={t('create.title')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} required data-autofocus />
        <Textarea label={t('create.description')} value={description} onChange={(e) => setDescription(e.currentTarget.value)} autosize minRows={2} />
        {admin ? (
          <Switch label={t('create.proposeInstead')} description={t('create.proposeHelp')} checked={propose} onChange={(e) => setPropose(e.currentTarget.checked)} />
        ) : (
          <TextInput readOnly variant="filled" value={t('create.memberNote')} aria-label={t('create.memberNote')} />
        )}
        <ErrorAlert error={create.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
            {admin && !propose ? t('create.submitDraft') : t('create.submitPropose')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** New batch (team admin: draft or proposal) / propose batch (member: proposal). */
export function CreateBatchModal({ opened, onClose, teams, defaultTeamId }: { opened: boolean; onClose: () => void; teams: MyMembership[]; defaultTeamId?: string }) {
  const { t } = useTranslation('batches');
  const [picked, setTeamId] = useState<string | null>(null);
  const teamId = picked ?? defaultTeamId ?? teams[0]?.teamId ?? null;
  const team = teams.find((m) => m.teamId === teamId);
  return (
    <Modal opened={opened} onClose={onClose} title={t('create.dialogTitle')}>
      <Stack>
        <Select
          label={t('filters.team')}
          allowDeselect={false}
          value={teamId}
          onChange={setTeamId}
          data={teams.map((m) => ({ value: m.teamId, label: m.name }))}
        />
        {team && <Inner key={team.teamId} team={team} onClose={onClose} />}
      </Stack>
    </Modal>
  );
}
