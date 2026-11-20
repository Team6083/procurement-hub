import { Badge, Button, Card, Stack, Text } from '@chakra-ui/react';
import { DataTable, EmptyState, type DataColumn, type RowAction } from '@team6083/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LuPencil, LuPlus, LuShieldCheck, LuTrash2 } from 'react-icons/lu';
import { useDeleteRoleMapping, useRoleMappings } from '../api/roleMappings';
import type { RoleMapping } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { ListSkeleton } from '../components/PageStates';
import { ReasonModal } from '../components/ReasonModal';
import { SectionActions } from '../components/SectionLayout';
import { RoleMappingModal } from '../features/admin/RoleMappingModal';

/** UI-managed role-mapping rules (system admins only; the admin section guards the route). */
export function RoleMappingsPage() {
  const { t } = useTranslation('admin');
  const rules = useRoleMappings(true);
  const del = useDeleteRoleMapping();
  const [editing, setEditing] = useState<RoleMapping | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<RoleMapping | null>(null);

  const mono = (s: string) => <Text as="span" fontFamily="mono" textStyle="sm">{s}</Text>;
  const columns: DataColumn<RoleMapping>[] = [
    { key: 'pattern', header: t('form.pattern'), label: t('form.pattern'), priority: 'primary', cell: (r) => mono(r.pattern) },
    { key: 'claim', header: t('form.claim'), cell: (r) => t(`claim.${r.claim}`) },
    { key: 'team', header: t('form.team'), cell: (r) => mono(r.team) },
    { key: 'role', header: t('form.role'), cell: (r) => <Badge variant="subtle">{t(`teams:role.${r.role}`)}</Badge> },
    {
      key: 'state', header: t('form.enabled'),
      cell: (r) => (
        <Stack direction="row" gap="1" wrap="wrap" justify="inherit">
          {r.enabled ? <Badge colorPalette="green" variant="subtle">{t('on')}</Badge> : <Badge variant="outline">{t('off')}</Badge>}
          {r.managed && <Badge variant="outline">{t('managed')}</Badge>}
        </Stack>
      ),
    },
    { key: 'description', header: t('form.description'), priority: 'secondary', cell: (r) => r.description || '—' },
  ];
  // Rules from the rules file are read-only.
  const rowActions = (r: RoleMapping): RowAction[] => (r.managed ? [] : [
    { value: 'edit', icon: <LuPencil />, label: t('common:actions.edit'), onSelect: () => setEditing(r) },
    { value: 'delete', icon: <LuTrash2 />, label: t('common:actions.delete'), danger: true, onSelect: () => { del.reset(); setToDelete(r); } },
  ]);

  return (
    <Stack gap="4">
      <SectionActions>
        <Button size="sm" onClick={() => setEditing('new')}><LuPlus />{t('create')}</Button>
      </SectionActions>
      {rules.isPending && <ListSkeleton />}
      {rules.error && <ErrorAlert error={rules.error} />}
      {rules.data && (
        <DataTable
          aria-label={t('title')} rows={rules.data} columns={columns} getRowId={(r) => r.id} rowActions={rowActions}
          empty={<Card.Root size="sm"><Card.Body><EmptyState icon={<LuShieldCheck />} title={t('empty')} /></Card.Body></Card.Root>}
        />
      )}
      <RoleMappingModal open={editing !== null} rule={editing && editing !== 'new' ? editing : null} onClose={() => setEditing(null)} />
      <ReasonModal
        open={!!toDelete} danger title={t('deleteTitle')} body={t('deleteConfirm', { pattern: toDelete?.pattern })}
        confirmLabel={t('common:actions.delete')} loading={del.isPending} error={del.error} onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete, { onSuccess: () => setToDelete(null) })}
      />
    </Stack>
  );
}
