import { Badge, Button, Card, Dialog, Input, Stack } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { EmptyState, type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCircleCheck, LuFolderTree, LuPencil, LuPlus } from 'react-icons/lu';
import { z } from 'zod';
import { useTeamMutation } from '../../api/teams';
import type { Subgroup, Team } from '../../api/types';
import { DataTable } from '../../components/DataTable';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Forbidden } from '../../components/PageStates';
import { ReasonModal } from '../../components/ReasonModal';
import { SectionActions } from '../../components/SectionLayout';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { requiredText, useFieldError } from '../../components/ui/form';
import { useTeamCtx } from '../../features/teams/TeamContext';

const nameSchema = z.object({ name: requiredText(200) });

/** Add a subgroup (group === null) or rename one. */
function NameForm({ team, group, onClose }: { team: Team; group: Subgroup | null; onClose: () => void }) {
  const { t } = useTranslation('teams');
  const save = useTeamMutation<string>(team.id, (api, name, headers) =>
    group
      ? api.patch<Team>(`/teams/${team.id}/subgroups/${group.id}`, { name }, { headers })
      : api.post<Team>(`/teams/${team.id}/subgroups`, { name }, { headers }),
  );
  const form = useForm({ resolver: zodResolver(nameSchema), defaultValues: { name: group?.name ?? '' } });
  const fieldError = useFieldError();
  const submit = form.handleSubmit((v) => (v.name.trim() === group?.name ? onClose() : save.mutate(v.name.trim(), { onSuccess: onClose })));
  return (
    <>
      <Dialog.Body>
        <form id="subgroup-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('subgroups.name')} required errorText={fieldError(form.formState.errors.name)}>
              <Input maxLength={200} {...form.register('name')} />
            </FormField>
            <ErrorAlert error={save.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="subgroup-form" loading={save.isPending}>{group ? t('common:actions.save') : t('subgroups.add')}</Button>
      </DialogFooter>
    </>
  );
}

/** The team's subgroups (team admins): add, rename, deactivate and activate. */
export function SubgroupsSettings() {
  const { t } = useTranslation('teams');
  const { full, canAdmin } = useTeamCtx();
  const [editing, setEditing] = useState<Subgroup | 'new' | null>(null);
  const [deactivating, setDeactivating] = useState<Subgroup | null>(null);
  const setActive = useTeamMutation<{ group: Subgroup; active: boolean }>(full?.id ?? '', (api, { group, active }, headers) =>
    api.patch<Team>(`/teams/${full?.id}/subgroups/${group.id}`, { active }, { headers }),
  );
  if (!full || !canAdmin) return <Forbidden />;
  const writable = !full.archived;

  const columns: DataColumn<Subgroup>[] = [
    { key: 'name', header: t('subgroups.name'), priority: 'primary', cell: (g) => g.name },
    { key: 'status', header: t('subgroups.status'), cell: (g) => (g.active ? <Badge colorPalette="green" variant="subtle">{t('subgroups.active')}</Badge> : <Badge variant="outline">{t('subgroups.inactive')}</Badge>) },
  ];
  const rowActions = (g: Subgroup): RowAction[] => (writable ? [
    { value: 'rename', icon: <LuPencil />, label: t('subgroups.rename'), onSelect: () => setEditing(g) },
    g.active
      ? { value: 'deactivate', icon: <LuBan />, label: t('subgroups.deactivate'), danger: true, onSelect: () => { setActive.reset(); setDeactivating(g); } }
      : { value: 'activate', icon: <LuCircleCheck />, label: t('subgroups.activate'), onSelect: () => setActive.mutate({ group: g, active: true }) },
  ] : []);

  return (
    <Stack gap="4">
      {writable && <SectionActions><Button size="sm" onClick={() => setEditing('new')}><LuPlus />{t('subgroups.add')}</Button></SectionActions>}
      {!deactivating && <ErrorAlert error={setActive.error} />}
      <DataTable
        aria-label={t('tabs.subgroups')} rows={full.subgroups} columns={columns} getRowId={(g) => g.id} rowActions={rowActions}
        empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuFolderTree />} title={t('subgroups.empty')} /></Card.Body></Card.Root>}
      />
      <AppDialog open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? t('subgroups.rename') : t('subgroups.add')} size="sm">
        {editing && <NameForm team={full} group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      </AppDialog>
      <ReasonModal
        open={!!deactivating} danger title={t('subgroups.deactivateTitle', { name: deactivating?.name })} body={t('subgroups.deactivateBody')}
        confirmLabel={t('subgroups.deactivate')} loading={setActive.isPending} error={setActive.error} onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && setActive.mutate({ group: deactivating, active: false }, { onSuccess: () => setDeactivating(null) })}
      />
    </Stack>
  );
}
