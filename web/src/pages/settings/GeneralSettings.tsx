import { Alert, Button, Card, Fieldset, HStack, Input, SimpleGrid, Stack, Text, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { SectionHeader, toaster } from '@team6083/ui';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../../i18n/detect';
import { useTeamMutation } from '../../api/teams';
import type { PatchTeamRequest, Team } from '../../api/types';
import { useAccess } from '../../auth/useAccess';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Forbidden } from '../../components/PageStates';
import { ReasonModal } from '../../components/ReasonModal';
import { FormField } from '../../components/ui/field';
import { useFieldError } from '../../components/ui/form';
import { SelectField } from '../../components/ui/select';
import { useTeamCtx } from '../../features/teams/TeamContext';
import { diffGeneral, toForm } from '../../features/teams/general';
import { PRIORITIES } from '../../features/teams/priority';
import { generalSchema } from '../../features/teams/schemas';

/**
 * Name, description, visibility, locale and priority labels. The form follows the team: after a version conflict
 * refetches it, untouched fields show the latest values and the user's edits stay (no remount).
 */
function GeneralSettingsForm({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const form = useForm({ resolver: zodResolver(generalSchema), values: toForm(team), resetOptions: { keepDirtyValues: true } });
  const save = useTeamMutation<PatchTeamRequest>(team.id, (api, body, headers) => api.patch<Team>(`/teams/${team.id}`, body, { headers }));
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const submit = form.handleSubmit((v) => {
    const body = diffGeneral(team, v);
    if (Object.keys(body).length === 0) return;
    save.mutate(body, {
      onSuccess: (saved) => {
        form.reset(toForm(saved));
        toaster.success({ title: t('common:actions.saved') });
      },
    });
  });
  const discard = () => {
    save.reset();
    form.reset(toForm(team));
  };
  return (
    <Card.Root size="sm">
      <Card.Body>
        <form onSubmit={submit} noValidate>
          <Fieldset.Root disabled={team.archived}>
            <Stack gap="3">
              <FormField label={t('general.name')} required errorText={fieldError(err.name)}>
                <Input {...form.register('name')} />
              </FormField>
              <FormField label={t('general.description')}>
                <Textarea autoresize rows={2} {...form.register('description')} />
              </FormField>
              <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
                <Controller control={form.control} name="visibility" render={({ field }) => (
                  <SelectField
                    label={t('general.visibility')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                    options={(['public', 'members'] as const).map((v) => ({ value: v, label: t(`team.visibility.${v}`) }))}
                  />
                )} />
                <Controller control={form.control} name="locale" render={({ field }) => (
                  <SelectField
                    label={t('general.locale')} helperText={t('general.localeHelp')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                    options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`common:language.${l}`) }))}
                  />
                )} />
              </SimpleGrid>
              <Stack gap="1" pt="2">
                <Text fontWeight="semibold">{t('general.priorityLabels')}</Text>
                <Text color="fg.muted">{t('general.priorityHelp')}</Text>
              </Stack>
              <SimpleGrid columns={{ base: 1, sm: 2 }} gap="3">
                {PRIORITIES.map((k) => (
                  <FormField key={k} label={t('priority.level', { n: k })} errorText={fieldError(err.priority?.[k])}>
                    <Input placeholder={t(`priority.default.${k}`)} {...form.register(`priority.${k}`)} />
                  </FormField>
                ))}
              </SimpleGrid>
              <ErrorAlert error={save.error} onDiscard={discard} />
              <HStack justify="flex-end">
                <Button size="sm" type="submit" loading={save.isPending}>{t('common:actions.save')}</Button>
              </HStack>
            </Stack>
          </Fieldset.Root>
        </form>
      </Card.Body>
    </Card.Root>
  );
}

/** Archiving (system admins only); archived teams are read-only. */
function ArchiveControl({ team }: { team: Team }) {
  const { t } = useTranslation('teams');
  const [confirming, setConfirming] = useState(false);
  const toggle = useTeamMutation<boolean>(team.id, (api, archived, headers) => api.patch<Team>(`/teams/${team.id}`, { archived }, { headers }));
  return (
    <Stack gap="2">
      <SectionHeader mb="0" title={t('general.archive.title')} />
      <Card.Root size="sm">
        <Card.Body gap="3">
          <Text color="fg.muted">{t('general.archive.help')}</Text>
          <ErrorAlert error={confirming ? null : toggle.error} />
          <HStack>
            <Button
              size="sm" variant="outline" colorPalette={team.archived ? undefined : 'red'} loading={toggle.isPending && !confirming}
              onClick={() => { toggle.reset(); if (team.archived) toggle.mutate(false); else setConfirming(true); }}
            >
              {team.archived ? t('general.archive.unarchive') : t('general.archive.archive')}
            </Button>
          </HStack>
        </Card.Body>
      </Card.Root>
      <ReasonModal
        open={confirming} danger title={t('general.archive.confirmTitle')} body={t('general.archive.confirmBody')}
        confirmLabel={t('general.archive.archive')} loading={toggle.isPending} error={toggle.error} onClose={() => setConfirming(false)}
        onConfirm={() => toggle.mutate(true, { onSuccess: () => setConfirming(false) })}
      />
    </Stack>
  );
}

/** /teams/:slug/settings: the team's general settings (team admins). */
export function GeneralSettings() {
  const { t } = useTranslation('teams');
  const { full, canAdmin } = useTeamCtx();
  const { isSystemAdmin } = useAccess();
  if (!full || !canAdmin) return <Forbidden />;
  return (
    <Stack gap="6">
      {full.archived && (
        <Alert.Root status="warning">
          <Alert.Indicator />
          <Alert.Description>{t('settings.archivedNotice')}</Alert.Description>
        </Alert.Root>
      )}
      <GeneralSettingsForm team={full} />
      {isSystemAdmin && <ArchiveControl team={full} />}
    </Stack>
  );
}
