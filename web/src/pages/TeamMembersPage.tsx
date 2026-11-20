import { Button, Card, Dialog, Stack, Text } from '@chakra-ui/react';
import { zodResolver } from '@hookform/resolvers/zod';
import { DataTable, EmptyState, type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { LuFolderTree, LuPlus, LuShieldCheck, LuUserMinus, LuUserX, LuUsers } from 'react-icons/lu';
import { z } from 'zod';
import { useMe } from '../api/me';
import { useAddMember, useMembers, usePatchMember, useRemoveMember } from '../api/members';
import type { Team, TeamMember } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { Forbidden, ListSkeleton } from '../components/PageStates';
import { ReasonModal } from '../components/ReasonModal';
import { SectionActions } from '../components/SectionLayout';
import { UserSearchSelect } from '../components/UserSearchSelect';
import { AppDialog, DialogFooter } from '../components/ui/dialog';
import { requiredText, useFieldError } from '../components/ui/form';
import { SelectField } from '../components/ui/select';
import { RoleCell } from '../features/teams/RoleBadges';
import { useTeamCtx } from '../features/teams/TeamContext';
import { canClearManualRole, canRemoveMember } from '../features/teams/roles';

const ROLES = ['member', 'admin'] as const;

const addSchema = z.object({ userId: requiredText(), role: z.enum(ROLES) });

function AddMemberForm({ team, existing, onClose }: { team: Team; existing: string[]; onClose: () => void }) {
  const { t } = useTranslation('teams');
  const add = useAddMember(team.id);
  const form = useForm({ resolver: zodResolver(addSchema), defaultValues: { userId: '', role: 'member' as const } });
  const fieldError = useFieldError();
  const submit = form.handleSubmit((v) => add.mutate(v, { onSuccess: onClose }));
  return (
    <>
      <Dialog.Body>
        <form id="add-member-form" onSubmit={submit} noValidate>
          <Stack gap="3">
            <Controller control={form.control} name="userId" render={({ field }) => (
              <UserSearchSelect
                inDialog required label={t('members.user')} value={field.value || null} onChange={(v) => field.onChange(v ?? '')}
                excludeIds={existing} error={fieldError(form.formState.errors.userId)}
              />
            )} />
            <Controller control={form.control} name="role" render={({ field }) => (
              <SelectField
                label={t('members.role')} name={field.name} value={field.value} onChange={(v) => v && field.onChange(v)} onBlur={field.onBlur}
                options={ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))}
              />
            )} />
            <ErrorAlert error={add.error} />
          </Stack>
        </form>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" type="submit" form="add-member-form" loading={add.isPending}>{t('members.addButton')}</Button>
      </DialogFooter>
    </>
  );
}

type Editing = { member: TeamMember; field: 'manualRole' | 'defaultSubgroupId' };

/** One select in a dialog: a member's manual role or default subgroup. */
function MemberFieldForm({ team, editing, onClose }: { team: Team; editing: Editing; onClose: () => void }) {
  const { t } = useTranslation('teams');
  const patch = usePatchMember(team.id);
  const { member, field } = editing;
  const [value, setValue] = useState<string>((field === 'manualRole' ? member.manualRole : member.defaultSubgroupId) || (field === 'manualRole' ? 'member' : ''));
  const options = field === 'manualRole'
    ? ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }))
    : team.subgroups.filter((g) => g.active || g.id === member.defaultSubgroupId).map((g) => ({ value: g.id, label: g.name }));
  const submit = () => patch.mutate(
    { member, patch: field === 'manualRole' ? { manualRole: value as (typeof ROLES)[number] } : { defaultSubgroupId: value } },
    { onSuccess: onClose },
  );
  return (
    <>
      <Dialog.Body>
        <Stack gap="3">
          <Text>{member.displayName || member.username}</Text>
          <SelectField
            label={t(field === 'manualRole' ? 'members.manualRole' : 'members.defaultSubgroup')} value={value} onChange={setValue}
            placeholder={field === 'defaultSubgroupId' ? t('members.noDefault') : undefined} options={options}
          />
          <ErrorAlert error={patch.error} />
        </Stack>
      </Dialog.Body>
      <DialogFooter>
        <Button size="sm" loading={patch.isPending} onClick={submit}>{t('common:actions.save')}</Button>
      </DialogFooter>
    </>
  );
}

/**
 * The team's members (one table for everyone): members read it and set their own default subgroup; team admins also
 * add members, set or clear manual roles and remove manual memberships (spec: /teams/:slug/settings/members).
 */
export function TeamMembersPage() {
  const { t } = useTranslation('teams');
  const { teamId, full, isMember, canAdmin } = useTeamCtx();
  const { me } = useMe();
  const members = useMembers(teamId, isMember);
  const patch = usePatchMember(teamId);
  const remove = useRemoveMember(teamId);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [toRemove, setToRemove] = useState<TeamMember | null>(null);
  if (!full || !isMember) return <Forbidden />;
  const writable = !full.archived;
  const subgroupName = (id: string) => full.subgroups.find((g) => g.id === id)?.name;

  const columns: DataColumn<TeamMember>[] = [
    {
      key: 'user', header: t('members.user'), priority: 'primary',
      cell: (m) => (
        <Stack gap="0">
          <Text fontWeight="medium">{m.displayName || m.username}</Text>
          <Text textStyle="xs" color="fg.muted">{m.email}</Text>
        </Stack>
      ),
    },
    { key: 'role', header: t('members.effective'), cell: (m) => <RoleCell sources={m} effective={m.effectiveRole} /> },
    ...(canAdmin ? [{ key: 'manual', header: t('members.manualRole'), priority: 'secondary' as const, cell: (m: TeamMember) => (m.manualRole ? t(`role.${m.manualRole}`) : t('members.noManual')) }] : []),
    { key: 'subgroup', header: t('members.defaultSubgroup'), cell: (m) => (m.defaultSubgroupId && subgroupName(m.defaultSubgroupId)) || t('members.noDefault') },
  ];
  const rowActions = (m: TeamMember): RowAction[] => {
    if (!writable) return [];
    const out: RowAction[] = [];
    if (canAdmin) out.push({ value: 'role', icon: <LuShieldCheck />, label: t('members.setManual'), onSelect: () => setEditing({ member: m, field: 'manualRole' }) });
    if (canAdmin || m.userId === me?.id) out.push({ value: 'subgroup', icon: <LuFolderTree />, label: t('members.setDefault'), onSelect: () => setEditing({ member: m, field: 'defaultSubgroupId' }) });
    if (canAdmin && canClearManualRole(m)) out.push({ value: 'clear', icon: <LuUserX />, label: t('members.clearManual'), onSelect: () => patch.mutate({ member: m, patch: { manualRole: null } }) });
    if (canAdmin && canRemoveMember(m)) out.push({ value: 'remove', icon: <LuUserMinus />, label: t('members.remove'), danger: true, onSelect: () => { remove.reset(); setToRemove(m); } });
    return out;
  };

  return (
    <Stack gap="4">
      {canAdmin && writable && (
        <SectionActions><Button size="sm" onClick={() => setAdding(true)}><LuPlus />{t('members.add')}</Button></SectionActions>
      )}
      <ErrorAlert error={patch.error} />
      {members.isPending && <ListSkeleton />}
      {members.error && <ErrorAlert error={members.error} />}
      {members.data && (
        <DataTable
          aria-label={t('tabs.members')} rows={members.data} columns={columns} getRowId={(m) => m.userId} rowActions={rowActions}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuUsers />} title={t('members.empty')} /></Card.Body></Card.Root>}
        />
      )}
      <AppDialog open={adding} onClose={() => setAdding(false)} title={t('members.add')}>
        <AddMemberForm team={full} existing={(members.data ?? []).map((m) => m.userId)} onClose={() => setAdding(false)} />
      </AppDialog>
      <AppDialog open={!!editing} onClose={() => setEditing(null)} title={editing ? t(editing.field === 'manualRole' ? 'members.setManual' : 'members.setDefault') : ''} size="sm">
        {editing && <MemberFieldForm team={full} editing={editing} onClose={() => setEditing(null)} />}
      </AppDialog>
      <ReasonModal
        open={!!toRemove} danger title={t('members.removeTitle')} confirmLabel={t('members.remove')}
        body={<>{t('members.removeConfirm', { name: toRemove?.displayName || toRemove?.username })}<Text as="span" display="block" mt="2" color="fg.muted">{t('members.removeNote')}</Text></>}
        loading={remove.isPending} error={remove.error} onClose={() => setToRemove(null)}
        onConfirm={() => toRemove && remove.mutate(toRemove, { onSuccess: () => setToRemove(null) })}
      />
    </Stack>
  );
}
