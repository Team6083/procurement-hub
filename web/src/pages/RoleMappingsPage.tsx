import { Badge, Button, Card, HStack, Skeleton, Stack, Table, Text } from '@chakra-ui/react';
import { EmptyState, PageHeader } from '@team6083/ui';
import { LuPlus, LuShieldCheck } from 'react-icons/lu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useDeleteRoleMapping, useRoleMappings } from '../api/roleMappings';
import type { RoleMapping } from '../api/types';
import { ErrorAlert, Notice } from '../components/ErrorAlert';
import { ReasonModal } from '../components/ReasonModal';
import { TableShell } from '../components/ui/table';
import { RoleMappingModal } from '../features/admin/RoleMappingModal';

export function RoleMappingsPage() {
  const { t } = useTranslation('admin');
  const { isSystemAdmin, isPending } = useMe();
  const rules = useRoleMappings(isSystemAdmin);
  const del = useDeleteRoleMapping();
  const [editing, setEditing] = useState<RoleMapping | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<RoleMapping | null>(null);

  if (isPending) return <Skeleton h="24" rounded="l3" />;
  if (!isSystemAdmin) return <Notice>{t('forbidden')}</Notice>;

  return (
    <Stack gap="4">
      <PageHeader
        mb="0"
        title={t('title')}
        description={t('intro')}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <LuPlus />
            {t('create')}
          </Button>
        }
      />
      {rules.isPending && <Skeleton h="24" rounded="l3" />}
      {rules.error && <ErrorAlert error={rules.error} />}
      {rules.data?.length === 0 && (
        <Card.Root size="sm">
          <Card.Body>
            <EmptyState icon={<LuShieldCheck />} title={t('empty')} />
          </Card.Body>
        </Card.Root>
      )}
      {rules.data && rules.data.length > 0 && (
        <TableShell minW="760px">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>{t('form.claim')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('form.pattern')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('form.team')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('form.role')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('form.enabled')}</Table.ColumnHeader>
              <Table.ColumnHeader>{t('form.description')}</Table.ColumnHeader>
              <Table.ColumnHeader />
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rules.data.map((r) => (
              <Table.Row key={r.id}>
                <Table.Cell>{t(`claim.${r.claim}`)}</Table.Cell>
                <Table.Cell><Text fontFamily="mono" fontSize="sm">{r.pattern}</Text></Table.Cell>
                <Table.Cell><Text fontFamily="mono" fontSize="sm">{r.team}</Text></Table.Cell>
                <Table.Cell>{t(`teams:role.${r.role}`)}</Table.Cell>
                <Table.Cell>{r.enabled ? t('on') : t('off')}</Table.Cell>
                <Table.Cell>{r.description}</Table.Cell>
                <Table.Cell>
                  {r.managed ? (
                    <Badge colorPalette="gray" variant="outline">{t('managed')}</Badge>
                  ) : (
                    <HStack gap="2">
                      <Button size="xs" variant="outline" onClick={() => setEditing(r)}>{t('common:actions.edit')}</Button>
                      <Button size="xs" colorPalette="red" variant="subtle" onClick={() => { del.reset(); setToDelete(r); }}>{t('common:actions.delete')}</Button>
                    </HStack>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </TableShell>
      )}
      <RoleMappingModal opened={creating || !!editing} rule={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <ReasonModal
        opened={!!toDelete}
        title={t('deleteTitle')}
        body={t('deleteConfirm', { pattern: toDelete?.pattern })}
        confirmLabel={t('common:actions.delete')}
        danger
        loading={del.isPending}
        error={del.error}
        onClose={() => setToDelete(null)}
        onConfirm={() => toDelete && del.mutate(toDelete, { onSuccess: () => setToDelete(null) })}
      />
    </Stack>
  );
}
