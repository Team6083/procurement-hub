import { Button, Dialog, Input, Stack, Switch, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useCreateBatch } from '../../api/batches';
import type { MyMembership } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { requiredText, useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { paths } from '../../paths';

interface InnerProps {
  team: MyMembership;
  teams: MyMembership[];
  onTeamChange: (teamId: string) => void;
  onClose: () => void;
}

const createSchema = z.object({ title: requiredText(200), description: z.string(), propose: z.boolean() });

function Inner({ team, teams, onTeamChange, onClose }: InnerProps) {
  const { t } = useTranslation('batches');
  const navigate = useNavigate();
  const admin = team.role === 'admin';
  const create = useCreateBatch(team.teamId);
  const form = useForm({ resolver: zodResolver(createSchema), defaultValues: { title: '', description: '', propose: !admin } });
  const propose = useWatch({ control: form.control, name: 'propose' });
  const fieldError = useFieldError();
  const submit = form.handleSubmit((v) =>
    create.mutate(
      { title: v.title.trim(), description: v.description, propose: admin ? v.propose : true },
      { onSuccess: (b) => { onClose(); void navigate(paths.batch(b.id)); } },
    ),
  );
  return (
    <>
      <Dialog.Body>
        <form id="create-batch-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <SelectField
              label={t('filters.team')} value={team.teamId} onChange={(v) => v && onTeamChange(v)}
              options={teams.map((m) => ({ value: m.teamId, label: m.name }))}
            />
            <FormField label={t('create.title')} required errorText={fieldError(form.formState.errors.title)}>
              <Input maxLength={200} {...form.register('title')} />
            </FormField>
            <FormField label={t('create.description')}>
              <Textarea autoresize rows={2} {...form.register('description')} />
            </FormField>
            {admin ? (
              <Controller control={form.control} name="propose" render={({ field }) => (
                <Stack gap="1">
                  <Switch.Root checked={field.value} onCheckedChange={(e) => field.onChange(e.checked)}>
                    <Switch.HiddenInput onBlur={field.onBlur} />
                    <Switch.Control />
                    <Switch.Label>{t('create.proposeInstead')}</Switch.Label>
                  </Switch.Root>
                  <Text color="fg.muted">{t('create.proposeHelp')}</Text>
                </Stack>
              )} />
            ) : (
              <Notice status="info">{t('create.memberNote')}</Notice>
            )}
            <ErrorAlert error={create.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="create-batch-form" loading={create.isPending}>
          {admin && !propose ? t('create.submitDraft') : t('create.submitPropose')}
        </Button>
      </DialogFooter>
    </>
  );
}

/** New batch (team admin: draft or proposal) / propose batch (member: proposal). */
export function CreateBatchModal({ open, onClose, teams, defaultTeamId }: { open: boolean; onClose: () => void; teams: MyMembership[]; defaultTeamId?: string }) {
  const { t } = useTranslation('batches');
  const [picked, setTeamId] = useState<string | null>(null);
  const teamId = picked ?? defaultTeamId ?? teams[0]?.teamId ?? null;
  const team = teams.find((m) => m.teamId === teamId);
  return (
    <AppDialog open={open} onClose={onClose} title={t('create.dialogTitle')}>
      {team && <Inner key={team.teamId} team={team} teams={teams} onTeamChange={setTeamId} onClose={onClose} />}
    </AppDialog>
  );
}
