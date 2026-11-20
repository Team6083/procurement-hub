import { Button, Dialog, Input, NativeSelect, Stack, Switch, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCreateRoleMapping, usePutRoleMapping } from '../../api/roleMappings';
import type { RoleMapping } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { useFieldError } from '../../components/ui/form';
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
  const fieldError = useFieldError();
  return (
    <>
      <Dialog.Body>
        <form id="role-mapping-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <Controller
              control={form.control}
              name="claim"
              render={({ field }) => (
                <FormField label={t('form.claim')}>
                  <NativeSelect.Root size="md">
                    <NativeSelect.Field
                      name={field.name}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.currentTarget.value)}
                      onBlur={field.onBlur}
                    >
                      {!field.value && <option value="" />}
                      {(['groups', 'roles'] as const).map((c) => (
                        <option key={c} value={c}>{t(`claim.${c}`)}</option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
              )}
            />
            <FormField label={t('form.pattern')} required helperText={t('patternHelp')} errorText={fieldError(err.pattern)}>
              <Input autoCapitalize="none" {...form.register('pattern')} />
            </FormField>
            <FormField label={t('form.team')} required helperText={t('teamHelp')} errorText={fieldError(err.team)}>
              <Input autoCapitalize="none" {...form.register('team')} />
            </FormField>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormField label={t('form.role')}>
                  <NativeSelect.Root size="md">
                    <NativeSelect.Field
                      name={field.name}
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.currentTarget.value)}
                      onBlur={field.onBlur}
                    >
                      {!field.value && <option value="" />}
                      {(['member', 'admin'] as const).map((r) => (
                        <option key={r} value={r}>{t(`teams:role.${r}`)}</option>
                      ))}
                    </NativeSelect.Field>
                    <NativeSelect.Indicator />
                  </NativeSelect.Root>
                </FormField>
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
              <Textarea autoresize rows={2} {...form.register('description')} />
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
export function RoleMappingModal({ open, rule, onClose }: { open: boolean; rule: RoleMapping | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <AppDialog open={open} onClose={onClose} title={rule ? t('edit') : t('create')}>
      <Inner key={rule?.id ?? 'new'} rule={rule} onClose={onClose} />
    </AppDialog>
  );
}
