import { Button, Group, Modal, Select, Stack, Switch, Text, Textarea, TextInput } from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCreateRoleMapping, usePatchRoleMapping } from '../../api/roleMappings';
import type { RoleMapping } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { roleMappingSchema, type RoleMappingForm } from '../teams/schemas';

const EMPTY: RoleMappingForm = { claim: 'groups', pattern: '', team: '', role: 'member', enabled: true, description: '' };

function Inner({ rule, onClose }: { rule: RoleMapping | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  const create = useCreateRoleMapping();
  const patch = usePatchRoleMapping();
  const form = useForm<RoleMappingForm>({
    resolver: zodResolver(roleMappingSchema),
    defaultValues: rule
      ? { claim: rule.claim as 'groups' | 'roles', pattern: rule.pattern, team: rule.team, role: rule.role, enabled: rule.enabled, description: rule.description }
      : EMPTY,
  });
  const mutation = rule ? patch : create;
  const done = { onSuccess: onClose };
  const submit = form.handleSubmit((v) => {
    if (rule) patch.mutate({ id: rule.id, patch: v }, done);
    else create.mutate(v, done);
  });
  const err = form.formState.errors;
  const msg = (m: string | undefined) => (m ? t(m) : undefined);
  return (
    <form onSubmit={submit} noValidate>
      <Stack>
        <Controller
          control={form.control}
          name="claim"
          render={({ field }) => (
            <Select
              label={t('form.claim')}
              allowDeselect={false}
              data={(['groups', 'roles'] as const).map((c) => ({ value: c, label: t(`claim.${c}`) }))}
              {...field}
            />
          )}
        />
        <TextInput label={t('form.pattern')} error={msg(err.pattern?.message)} {...form.register('pattern')} />
        <Text size="xs" c="dimmed">{t('patternHelp')}</Text>
        <TextInput label={t('form.team')} description={t('teamHelp')} error={msg(err.team?.message)} {...form.register('team')} />
        <Controller
          control={form.control}
          name="role"
          render={({ field }) => (
            <Select
              label={t('form.role')}
              allowDeselect={false}
              data={(['member', 'admin'] as const).map((r) => ({ value: r, label: t(`teams:role.${r}`) }))}
              {...field}
            />
          )}
        />
        <Controller
          control={form.control}
          name="enabled"
          render={({ field }) => <Switch label={t('form.enabled')} checked={field.value} onChange={(e) => field.onChange(e.currentTarget.checked)} />}
        />
        <Textarea label={t('form.description')} {...form.register('description')} />
        <ErrorAlert error={mutation.error} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button type="submit" loading={mutation.isPending}>{t('common:actions.save')}</Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Create (rule === null) or edit a UI-managed rule. */
export function RoleMappingModal({ opened, rule, onClose }: { opened: boolean; rule: RoleMapping | null; onClose: () => void }) {
  const { t } = useTranslation('admin');
  return (
    <Modal opened={opened} onClose={onClose} title={rule ? t('edit') : t('create')}>
      {opened && <Inner key={rule?.id ?? 'new'} rule={rule} onClose={onClose} />}
    </Modal>
  );
}
