import { Alert, Button, Divider, Group, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../api/me';
import { useTeamMutation } from '../../api/teams';
import type { PatchTeamRequest, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { useTeamCtx } from '../../features/teams/TeamContext';
import { diffGeneral, toForm } from '../../features/teams/general';
import { PRIORITIES, type PriorityKey } from '../../features/teams/priority';
import { generalSchema, type GeneralForm } from '../../features/teams/schemas';

function GeneralForm_({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const form = useForm<GeneralForm>({ resolver: zodResolver(generalSchema), defaultValues: toForm(team) });
  const save = useTeamMutation<PatchTeamRequest>(team.id, (api, headers, body) =>
    api.full.patch<Team>(`/teams/${team.id}`, body, { headers }),
  );
  const err = form.formState.errors;
  const msg = (m: string | undefined) => (m ? t(m) : undefined);
  const submit = form.handleSubmit((v) => {
    const body = diffGeneral(team, v);
    if (Object.keys(body).length > 0) save.mutate(body);
  });
  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={team.archived} style={{ border: 0, padding: 0, margin: 0 }}>
        <Stack maw={640}>
          <TextInput label={t('general.name')} error={msg(err.name?.message)} {...form.register('name')} />
          <Textarea label={t('general.description')} autosize minRows={2} {...form.register('description')} />
          <Controller
            control={form.control}
            name="visibility"
            render={({ field }) => (
              <Select
                label={t('general.visibility')}
                allowDeselect={false}
                data={(['public', 'members'] as const).map((v) => ({ value: v, label: t(`team.visibility.${v}`) }))}
                {...field}
              />
            )}
          />
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <Select
                label={t('general.locale')}
                description={t('general.localeHelp')}
                allowDeselect={false}
                data={(['en', 'zh-TW'] as const).map((l) => ({ value: l, label: t(`common:language.${l}`) }))}
                {...field}
              />
            )}
          />
          <Divider />
          <Text fw={600}>{t('general.priorityLabels')}</Text>
          <Text size="sm" c="dimmed">{t('general.priorityHelp')}</Text>
          {PRIORITIES.map((k: PriorityKey) => (
            <TextInput
              key={k}
              label={t('priority.level', { n: k })}
              placeholder={t(`priority.default.${k}`)}
              error={msg(err.priority?.[k]?.message)}
              {...form.register(`priority.${k}`)}
            />
          ))}
          <ErrorAlert error={save.error} />
          {save.isSuccess && !form.formState.isDirty && <Text size="sm" c="green">{t('common:actions.saved')}</Text>}
          <Group>
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>{t('common:actions.save')}</Button>
          </Group>
        </Stack>
      </fieldset>
    </form>
  );
}

function ArchiveControl({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const toggle = useTeamMutation<boolean>(team.id, (api, headers, archived) =>
    api.full.patch<Team>(`/teams/${team.id}`, { archived }, { headers }),
  );
  return (
    <Stack gap="xs" maw={640}>
      <Divider />
      <Text fw={600}>{t('general.archive.title')}</Text>
      <Text size="sm" c="dimmed">{t('general.archive.help')}</Text>
      <Group>
        <Button color={team.archived ? 'blue' : 'red'} variant="light" loading={toggle.isPending} onClick={() => toggle.mutate(!team.archived)}>
          {team.archived ? t('general.archive.unarchive') : t('general.archive.archive')}
        </Button>
      </Group>
      <ErrorAlert error={toggle.error} />
    </Stack>
  );
}

export function GeneralSettings() {
  const { t } = useTranslation('teams');
  const { full } = useTeamCtx();
  const { isSystemAdmin } = useMe();
  if (!full) return <Alert color="gray">{t('settings.forbidden')}</Alert>;
  return (
    <Stack>
      <Title order={3}>{t('settings.nav.general')}</Title>
      {/* Remount when the server version changes (after save or a conflict refetch). */}
      <GeneralForm_ key={full.version} team={full} />
      {isSystemAdmin && <ArchiveControl team={full} />}
    </Stack>
  );
}
