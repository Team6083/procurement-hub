import { Button, Dialog, Input, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useApi } from '../../api/context';
import type { Team } from '../../api/types';
import { useGuardedMutation } from '../../api/useGuardedMutation';
import { ErrorAlert } from '../../components/ErrorAlert';
import { UserSearchSelect } from '../../components/UserSearchSelect';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { useFieldError } from '../../components/ui/form';
import { paths } from '../../paths';
import { createTeamSchema, type CreateTeamForm } from './schemas';

function Inner({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('teams');
  const api = useApi();
  const navigate = useNavigate();
  const form = useForm<CreateTeamForm>({
    resolver: zodResolver(createTeamSchema),
    defaultValues: { slug: '', name: '', description: '', firstAdminUserId: '' },
  });
  const create = useGuardedMutation<CreateTeamForm, Team>({ mutationFn: (body) => api.post<Team>('/teams', body) });
  const fieldError = useFieldError();
  const err = form.formState.errors;
  const submit = form.handleSubmit((v) => create.mutate(v, { onSuccess: (team) => { onClose(); void navigate(paths.team(team.slug)); } }));
  return (
    <>
      <Dialog.Body>
        <form id="create-team-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('createTeam.slug')} required helperText={t('createTeam.slugHelp')} errorText={fieldError(err.slug)}>
              <Input autoCapitalize="none" {...form.register('slug')} />
            </FormField>
            <FormField label={t('createTeam.name')} required errorText={fieldError(err.name)}>
              <Input {...form.register('name')} />
            </FormField>
            <FormField label={t('createTeam.description')}>
              <Textarea autoresize rows={2} {...form.register('description')} />
            </FormField>
            <Controller
              control={form.control}
              name="firstAdminUserId"
              render={({ field }) => (
                <UserSearchSelect
                  inDialog required label={t('createTeam.firstAdmin')} value={field.value || null}
                  onChange={(v) => field.onChange(v ?? '')} error={fieldError(err.firstAdminUserId)}
                />
              )}
            />
            <ErrorAlert error={create.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="create-team-form" loading={create.isPending}>{t('createTeam.submit')}</Button>
      </DialogFooter>
    </>
  );
}

/** System-admin "Create team" dialog (POST /teams). */
export function CreateTeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('teams');
  return (
    <AppDialog open={open} onClose={onClose} title={t('createTeam.title')}>
      <Inner onClose={onClose} />
    </AppDialog>
  );
}
