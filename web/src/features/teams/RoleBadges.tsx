import { Badge, Group, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { RoleOrNone } from '../../api/types';
import { showSsoLock, type RoleSources } from './roles';

export function RoleBadge({ role }: { role: RoleOrNone | null | undefined }) {
  const { t } = useTranslation('teams');
  return (
    <Badge color={role === 'admin' ? 'grape' : role === 'member' ? 'blue' : 'gray'} variant="light">
      {t(`role.${role || 'none'}`)}
    </Badge>
  );
}

/** "Managed by SSO" lock badge, shown whenever an SSO role source exists. */
export function SsoBadge({ sources }: { sources: RoleSources }) {
  const { t } = useTranslation('teams');
  if (!showSsoLock(sources)) return null;
  return (
    <Tooltip label={t('ssoBadgeHint')}>
      <Badge color="gray" variant="outline" leftSection={<span aria-hidden>🔒</span>}>
        {t('ssoBadge')}
      </Badge>
    </Tooltip>
  );
}

export function RoleCell({ sources, effective }: { sources: RoleSources; effective: RoleOrNone }) {
  return (
    <Group gap="xs">
      <RoleBadge role={effective} />
      <SsoBadge sources={sources} />
    </Group>
  );
}
