import { Button, HStack, Input, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context';
import { meKey } from '../../api/me';
import { teamsKey } from '../../api/teams';
import type { Team } from '../../api/types';
import { useGuardedMutation } from '../../api/useGuardedMutation';
import { ErrorAlert } from '../../components/ErrorAlert';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { AppDialog } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { paths } from '../../paths';
import { createTeamSchema, type CreateTeamForm } from './schemas';

/** System-admin "Create team" dialog (POST /teams). */
export function CreateTeamModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation('teams');
  const api = useApi();
  const navigate = useNavigate();
  const form = useForm<CreateTeamForm>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { slug: '', name: '', description: '', firstAdminUserId: '' },
  });
  const create = useGuardedMutation<CreateTeamForm, Team>({
    mutationFn: (body) => api.post<Team>('/teams', body),
    invalidate: [teamsKey, meKey],
    onSuccess: (team) => {
      form.reset();
      onClose();
      void navigate(paths.team(team.slug));
    },
  });
  const err = form.formState.errors;
  const msg = (m: string | undefined) => (m ? t(m) : undefined);
  return (
    <AppDialog open={opened} onClose={onClose} title={t('createTeam.title')}>
      <form onSubmit={form.handleSubmit((v) => create.mutate(v))} noValidate>
        <Stack gap="4">
          <FormField label={t('createTeam.slug')} helperText={t('createTeam.slugHelp')} errorText={msg(err.slug?.message)}>
            <Input autoCapitalize="none" {...form.register('slug')} />
          </FormField>
          <FormField label={t('createTeam.name')} errorText={msg(err.name?.message)}>
            <Input {...form.register('name')} />
          </FormField>
          <FormField label={t('createTeam.description')}>
            <Textarea {...form.register('description')} />
          </FormField>
          <Controller
            control={form.control}
            name="firstAdminUserId"
            render={({ field }) => (
              <UserSearchSelect
                inDialog
                label={t('createTeam.firstAdmin')}
                value={field.value || null}
                onChange={(v) => field.onChange(v ?? '')}
                error={msg(err.firstAdminUserId?.message)}
              />
            )}
          />
          <ErrorAlert error={create.error} />
          <HStack justify="flex-end">
            <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
            <Button type="submit" loading={create.isPending}>{t('createTeam.submit')}</Button>
          </HStack>
        </Stack>
      </form>
    </AppDialog>
  );
}
