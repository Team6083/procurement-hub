import { Button, HStack, Input, Stack, Switch, Text, Textarea } from '@chakra-ui/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useCreateBatch } from '../../api/batches';
import type { MyMembership } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { paths } from '../../paths';

function Inner({ team, onClose }: { team: MyMembership; onClose: () => void }) {
  const { t } = useTranslation('batches');
  const navigate = useNavigate();
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
          { onSuccess: (b) => { onClose(); void navigate(paths.batch(b.id)); } },
        );
      }}
    >
      <Stack gap="4">
        <FormField label={t('create.title')} required>
          <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} />
        </FormField>
        <FormField label={t('create.description')}>
          <Textarea value={description} onChange={(e) => setDescription(e.currentTarget.value)} autoresize rows={2} />
        </FormField>
        {admin ? (
          <Stack gap="1">
            <Switch.Root checked={propose} onCheckedChange={(e) => setPropose(e.checked)}>
              <Switch.HiddenInput />
              <Switch.Control />
              <Switch.Label>{t('create.proposeInstead')}</Switch.Label>
            </Switch.Root>
            <Text fontSize="sm" color="fg.muted">{t('create.proposeHelp')}</Text>
          </Stack>
        ) : (
          <Notice status="info">{t('create.memberNote')}</Notice>
        )}
        <ErrorAlert error={create.error} />
        <HStack justify="flex-end">
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
            {admin && !propose ? t('create.submitDraft') : t('create.submitPropose')}
          </Button>
        </HStack>
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
    <AppDialog open={opened} onClose={onClose} title={t('create.dialogTitle')}>
      <Stack gap="4">
        <SelectField
          label={t('filters.team')}
          value={teamId}
          onChange={(v) => v && setTeamId(v)}
          options={teams.map((m) => ({ value: m.teamId, label: m.name }))}
        />
        {team && <Inner key={team.teamId} team={team} onClose={onClose} />}
      </Stack>
    </AppDialog>
  );
}
