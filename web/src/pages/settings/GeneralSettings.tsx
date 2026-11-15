import { Button, HStack, Input, Separator, Stack, Text, Textarea } from '@chakra-ui/react';
import { SectionHeader } from '@team6083/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useMe } from '../../api/me';
import { useTeamMutation } from '../../api/teams';
import type { PatchTeamRequest, Team } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
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
      <fieldset disabled={team.archived} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Stack maxW="640px" gap="4">
          <FormField label={t('general.name')} errorText={msg(err.name?.message)}>
            <Input {...form.register('name')} />
          </FormField>
          <FormField label={t('general.description')}>
            <Textarea autoresize rows={2} {...form.register('description')} />
          </FormField>
          <Controller
            control={form.control}
            name="visibility"
            render={({ field }) => (
              <SelectField
                label={t('general.visibility')}
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                options={(['public', 'members'] as const).map((v) => ({ value: v, label: t(`team.visibility.${v}`) }))}
              />
            )}
          />
          <Controller
            control={form.control}
            name="locale"
            render={({ field }) => (
              <SelectField
                label={t('general.locale')}
                helperText={t('general.localeHelp')}
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                options={(['en', 'zh-TW'] as const).map((l) => ({ value: l, label: t(`common:language.${l}`) }))}
              />
            )}
          />
          <Separator />
          <Text fontWeight="semibold">{t('general.priorityLabels')}</Text>
          <Text fontSize="sm" color="fg.muted">{t('general.priorityHelp')}</Text>
          {PRIORITIES.map((k: PriorityKey) => (
            <FormField key={k} label={t('priority.level', { n: k })} errorText={msg(err.priority?.[k]?.message)}>
              <Input placeholder={t(`priority.default.${k}`)} {...form.register(`priority.${k}`)} />
            </FormField>
          ))}
          <ErrorAlert error={save.error} />
          {save.isSuccess && !form.formState.isDirty && <Text fontSize="sm" color="fg.success">{t('common:actions.saved')}</Text>}
          <HStack>
            <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>{t('common:actions.save')}</Button>
          </HStack>
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
    <Stack gap="2" maxW="640px">
      <Separator />
      <Text fontWeight="semibold">{t('general.archive.title')}</Text>
      <Text fontSize="sm" color="fg.muted">{t('general.archive.help')}</Text>
      <HStack>
        <Button colorPalette={team.archived ? 'brand' : 'red'} variant="subtle" loading={toggle.isPending} onClick={() => toggle.mutate(!team.archived)}>
          {team.archived ? t('general.archive.unarchive') : t('general.archive.archive')}
        </Button>
      </HStack>
      <ErrorAlert error={toggle.error} />
    </Stack>
  );
}

export function GeneralSettings() {
  const { t } = useTranslation('teams');
  const { full } = useTeamCtx();
  const { isSystemAdmin } = useMe();
  if (!full) return <Notice>{t('settings.forbidden')}</Notice>;
  return (
    <Stack gap="4">
      <SectionHeader title={t('settings.nav.general')} mb="0" />
      {/* Remount when the server version changes (after save or a conflict refetch). */}
      <GeneralForm_ key={full.version} team={full} />
      {isSystemAdmin && <ArchiveControl team={full} />}
    </Stack>
  );
}
