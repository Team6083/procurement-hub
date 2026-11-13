import { Badge, Button, Flex, Heading, HStack, Spinner, Stack, Table, Text } from '@chakra-ui/react';
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

  if (isPending) return <Spinner />;
  if (!isSystemAdmin) return <Notice>{t('forbidden')}</Notice>;

  return (
    <Stack gap="4">
      <Flex justify="space-between" align="center" gap="3" wrap="wrap">
        <Heading as="h2" size="xl">{t('title')}</Heading>
        <Button onClick={() => setCreating(true)}>{t('create')}</Button>
      </Flex>
      <Text color="fg.muted" fontSize="sm">{t('intro')}</Text>
      {rules.isPending && <Spinner />}
      {rules.error && <ErrorAlert error={rules.error} />}
      {rules.data?.length === 0 && <Text color="fg.muted">{t('empty')}</Text>}
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
