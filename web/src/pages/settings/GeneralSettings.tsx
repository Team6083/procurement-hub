import { Button, HStack, Input, Separator, Stack, Text, Textarea } from '@chakra-ui/react';
import { SectionHeader } from '@team6083/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n/detect';
import { useMe } from '../../api/me';
import { useTeamMutation } from '../../api/teams';
import type { PatchTeamRequest, Team } from '../../api/types';
import { ErrorAlert, Notice } from '../../components/ErrorAlert';
import { ReasonModal } from '../../components/ReasonModal';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { useTeamCtx } from '../../features/teams/TeamContext';
import { diffGeneral, toForm } from '../../features/teams/general';
import { PRIORITIES, type PriorityKey } from '../../features/teams/priority';
import { generalSchema, type GeneralForm } from '../../features/teams/schemas';

function GeneralSettingsForm({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const form = useForm<GeneralForm>({ resolver: zodResolver(generalSchema), defaultValues: toForm(team) });
  const save = useTeamMutation<PatchTeamRequest>(team.id, (api, body, headers) => api.patch<Team>(`/teams/${team.id}`, body, { headers }),
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
        <Stack maxW="640px" gap="3">
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
                options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`common:language.${l}`) }))}
              />
            )}
          />
          <Separator />
          <Text fontWeight="semibold">{t('general.priorityLabels')}</Text>
          <Text color="fg.muted">{t('general.priorityHelp')}</Text>
          {PRIORITIES.map((k: PriorityKey) => (
            <FormField key={k} label={t('priority.level', { n: k })} errorText={msg(err.priority?.[k]?.message)}>
              <Input placeholder={t(`priority.default.${k}`)} {...form.register(`priority.${k}`)} />
            </FormField>
          ))}
          <ErrorAlert error={save.error} />
          {save.isSuccess && !form.formState.isDirty && <Text textStyle="sm" color="fg.success">{t('common:actions.saved')}</Text>}
          <HStack>
            <Button size="sm" type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>{t('common:actions.save')}</Button>
          </HStack>
        </Stack>
      </fieldset>
    </form>
  );
}

function ArchiveControl({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const [confirming, setConfirming] = useState(false);
  const toggle = useTeamMutation<boolean>(team.id, (api, archived, headers) => api.patch<Team>(`/teams/${team.id}`, { archived }, { headers }),
  );
  return (
    <Stack gap="2" maxW="640px">
      <Separator />
      <Text fontWeight="semibold">{t('general.archive.title')}</Text>
      <Text color="fg.muted">{t('general.archive.help')}</Text>
      <HStack>
        <Button size="sm" colorPalette={team.archived ? undefined : 'red'} variant="subtle" loading={toggle.isPending && !confirming} onClick={() => (team.archived ? toggle.mutate(false) : setConfirming(true))}>
          {team.archived ? t('general.archive.unarchive') : t('general.archive.archive')}
        </Button>
      </HStack>
      <ErrorAlert error={confirming ? null : toggle.error} />
      <ReasonModal
        opened={confirming} danger title={t('general.archive.confirmTitle')} body={t('general.archive.confirmBody')}
        confirmLabel={t('general.archive.archive')} loading={toggle.isPending} error={toggle.error} onClose={() => setConfirming(false)}
        onConfirm={() => toggle.mutate(true, { onSuccess: () => setConfirming(false) })}
      />
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
      <GeneralSettingsForm key={full.version} team={full} />
      {isSystemAdmin && <ArchiveControl team={full} />}
    </Stack>
  );
}
