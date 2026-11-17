import { Button, Dialog, Input, Stack, Switch, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCreateRoleMapping, usePutRoleMapping } from '../../api/roleMappings';
import type { RoleMapping } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { SelectField } from '../../components/ui/select';
import { roleMappingSchema, type RoleMappingForm } from '../teams/schemas';

const EMPTY: RoleMappingForm = { claim: 'groups', pattern: '', team: '', role: 'member', enabled: true, description: '' };

function Inner({ rule, onClose }: { rule: RoleMapping | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const create = useCreateRoleMapping();
  const put = usePutRoleMapping();
  const form = useForm<RoleMappingForm>({
    resolver: zodResolver(roleMappingSchema),
    defaultValues: rule
      ? { claim: rule.claim, pattern: rule.pattern, team: rule.team, role: rule.role, enabled: rule.enabled, description: rule.description }
      : EMPTY,
  });
  const mutation = rule ? put : create;
  const done = { onSuccess: onClose };
  const submit = form.handleSubmit((v) => {
    if (rule) put.mutate({ rule, body: v }, done);
    else create.mutate(v, done);
  });
  const err = form.formState.errors;
  const msg = (m: string | undefined) => (m ? t(m) : undefined);
  return (
    <>
      <Dialog.Body>
        <form id="role-mapping-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <Controller
              control={form.control}
              name="claim"
              render={({ field }) => (
                <SelectField
                  label={t('form.claim')}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={(['groups', 'roles'] as const).map((c) => ({ value: c, label: t(`claim.${c}`) }))}
                />
              )}
            />
            <FormField label={t('form.pattern')} helperText={t('patternHelp')} errorText={msg(err.pattern?.message)}>
              <Input autoCapitalize="none" {...form.register('pattern')} />
            </FormField>
            <FormField label={t('form.team')} helperText={t('teamHelp')} errorText={msg(err.team?.message)}>
              <Input autoCapitalize="none" {...form.register('team')} />
            </FormField>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <SelectField
                  label={t('form.role')}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={(['member', 'admin'] as const).map((r) => ({ value: r, label: t(`teams:role.${r}`) }))}
                />
              )}
            />
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Switch.Root checked={field.value} onCheckedChange={(e) => field.onChange(e.checked)}>
                  <Switch.HiddenInput />
                  <Switch.Control />
                  <Switch.Label>{t('form.enabled')}</Switch.Label>
                </Switch.Root>
              )}
            />
            <FormField label={t('form.description')}>
              <Textarea {...form.register('description')} />
            </FormField>
            <ErrorAlert error={mutation.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="role-mapping-form" loading={mutation.isPending}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/** Create (rule === null) or edit a UI-managed rule. */
export function RoleMappingModal({ opened, rule, onClose }: { opened: boolean; rule: RoleMapping | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <AppDialog open={opened} onClose={onClose} title={rule ? t('edit') : t('create')}>
      <Inner key={rule?.id ?? 'new'} rule={rule} onClose={onClose} />
    </AppDialog>
  );
}
