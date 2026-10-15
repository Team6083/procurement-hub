import { Alert, Badge, Button, Group, Loader, Modal, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { useDeleteRoleMapping, useRoleMappings } from '../api/roleMappings';
import type { RoleMapping } from '../api/types';
import { ErrorAlert } from '../components/ErrorAlert';
import { RoleMappingModal } from '../features/admin/RoleMappingModal';

export function RoleMappingsPage() {
  const { t } = useTranslation('admin');
  const { isSystemAdmin, isPending } = useMe();
  const rules = useRoleMappings(isSystemAdmin);
  const del = useDeleteRoleMapping();
  const [editing, setEditing] = useState<RoleMapping | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<RoleMapping | null>(null);

  if (isPending) return <Loader />;
  if (!isSystemAdmin) return <Alert color="gray">{t('forbidden')}</Alert>;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t('title')}</Title>
        <Button onClick={() => setCreating(true)}>{t('create')}</Button>
      </Group>
      <Text c="dimmed" size="sm">{t('intro')}</Text>
      {rules.isPending && <Loader />}
      {rules.error && <ErrorAlert error={rules.error} />}
      {rules.data?.length === 0 && <Text c="dimmed">{t('empty')}</Text>}
      {rules.data && rules.data.length > 0 && (
        <Table.ScrollContainer minWidth={760}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('form.claim')}</Table.Th>
                <Table.Th>{t('form.pattern')}</Table.Th>
                <Table.Th>{t('form.team')}</Table.Th>
                <Table.Th>{t('form.role')}</Table.Th>
                <Table.Th>{t('form.enabled')}</Table.Th>
                <Table.Th>{t('form.description')}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rules.data.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{t(`claim.${r.claim}`)}</Table.Td>
                  <Table.Td><Text ff="monospace" size="sm">{r.pattern}</Text></Table.Td>
                  <Table.Td><Text ff="monospace" size="sm">{r.team}</Text></Table.Td>
                  <Table.Td>{t(`teams:role.${r.role}`)}</Table.Td>
                  <Table.Td>{r.enabled ? t('on') : t('off')}</Table.Td>
                  <Table.Td>{r.description}</Table.Td>
                  <Table.Td>
                    {r.managed ? (
                      <Badge color="gray" variant="outline">{t('managed')}</Badge>
                    ) : (
                      <Group gap="xs" wrap="nowrap">
                        <Button size="xs" variant="default" onClick={() => setEditing(r)}>{t('common:actions.edit')}</Button>
                        <Button size="xs" color="red" variant="light" onClick={() => { del.reset(); setToDelete(r); }}>{t('common:actions.delete')}</Button>
                      </Group>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      <RoleMappingModal opened={creating || !!editing} rule={editing} onClose={() => { setCreating(false); setEditing(null); }} />
      <Modal opened={!!toDelete} onClose={() => setToDelete(null)} title={t('deleteTitle')}>
        <Stack>
          <Text>{t('deleteConfirm', { pattern: toDelete?.pattern })}</Text>
          <ErrorAlert error={del.error} />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setToDelete(null)}>{t('common:actions.cancel')}</Button>
            <Button color="red" loading={del.isPending} onClick={() => toDelete && del.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })}>
              {t('common:actions.delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
