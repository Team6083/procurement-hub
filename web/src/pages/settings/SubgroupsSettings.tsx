import { Badge, Button, Card, Dialog, HStack, Input, Stack, Textarea } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { DataTable, EmptyState, type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LuBan, LuCircleCheck, LuFolderTree, LuPencil, LuPlus } from 'react-icons/lu';
import { z } from 'zod';
import { useTeamMutation } from '../../api/teams';
import type { Subgroup, Team } from '../../api/types';
import { ErrorAlert } from '../../components/ErrorAlert';
import { Forbidden } from '../../components/PageStates';
import { ReasonModal } from '../../components/ReasonModal';
import { SectionActions } from '../../components/SectionLayout';
import { AppDialog, DialogFooter } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/field';
import { requiredText, useFieldError } from '../../components/ui/form';
import { useTeamCtx } from '../../features/teams/TeamContext';

/** The server's limits on a subgroup's aliases (service.cleanAliases). */
const MAX_ALIASES = 50;
const MAX_ALIAS_LENGTH = 200;

/**
 * Aliases are separated by new lines or commas (ASCII or full-width); each is trimmed, and empty and repeated ones
 * are dropped. The server also drops case-insensitive duplicates and an alias equal to the subgroup's own name.
 */
const splitAliases = (v: string) => [...new Set(v.split(/[\n,，]/).map((a) => a.trim()).filter(Boolean))];

const nameSchema = z.object({
  name: requiredText(200),
  aliases: z.string().superRefine((v, ctx) => {
    const aliases = splitAliases(v);
    if (aliases.length > MAX_ALIASES) ctx.addIssue({ code: 'custom', message: 'teams:subgroups.aliasesTooMany' });
    else if (aliases.some((a) => [...a].length > MAX_ALIAS_LENGTH)) ctx.addIssue({ code: 'custom', message: 'teams:subgroups.aliasesTooLong' });
  }),
});

/** Add a subgroup (group === null) or edit its name and aliases. */
function NameForm({ team, group, onClose }: { team: Team; group: Subgroup | null; onClose: () => void }) {
  const { t } = useTranslation('teams');
  const save = useTeamMutation<{ name: string; aliases: string[] }>(team.id, (api, body, headers) =>
    group
      ? api.patch<Team>(`/teams/${team.id}/subgroups/${group.id}`, body, { headers })
      : api.post<Team>(`/teams/${team.id}/subgroups`, body, { headers }),
  );
  const form = useForm({ resolver: zodResolver(nameSchema), defaultValues: { name: group?.name ?? '', aliases: (group?.aliases ?? []).join('\n') } });
  const fieldError = useFieldError();
  const aliasError = form.formState.errors.aliases?.message;
  const submit = form.handleSubmit((v) => save.mutate({ name: v.name.trim(), aliases: splitAliases(v.aliases) }, { onSuccess: onClose }));
  return (
    <>
      <Dialog.Body>
        <form id="subgroup-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <FormField label={t('subgroups.name')} required errorText={fieldError(form.formState.errors.name)}>
              <Input maxLength={200} {...form.register('name')} />
            </FormField>
            <FormField
              label={t('subgroups.aliases')} helperText={t('subgroups.aliasesHint')}
              errorText={aliasError && t(aliasError, { max: MAX_ALIASES, maxLength: MAX_ALIAS_LENGTH })}
            >
              <Textarea autoresize rows={2} {...form.register('aliases')} />
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

/** The team's subgroups (team admins): add, edit (name and aliases), deactivate and activate. */
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
    { key: 'aliases', header: t('subgroups.aliases'), cell: (g) => (
      <HStack wrap="wrap" gap="1">{g.aliases.map((a) => <Badge key={a} variant="surface">{a}</Badge>)}</HStack>
    ) },
    { key: 'status', header: t('subgroups.status'), cell: (g) => (g.active ? <Badge colorPalette="green" variant="subtle">{t('subgroups.active')}</Badge> : <Badge variant="outline">{t('subgroups.inactive')}</Badge>) },
  ];
  const rowActions = (g: Subgroup): RowAction[] => (writable ? [
    { value: 'rename', icon: <LuPencil />, label: t('subgroups.edit'), onSelect: () => setEditing(g) },
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
      <AppDialog open={editing !== null} onClose={() => setEditing(null)} title={editing && editing !== 'new' ? t('subgroups.edit') : t('subgroups.add')} size="sm">
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
