import { Badge, HStack } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { LuLock } from 'react-icons/lu';
import type { RoleOrNone } from '../../api/types';
import { Tooltip } from '@team6083/ui';
import { showSsoLock, type RoleSources } from './roles';

export function RoleBadge({ role }: { role: RoleOrNone | null | undefined }) {
  const { t } = useTranslation('teams');
  return (
    <Badge colorPalette={role === 'admin' ? 'teal' : role === 'member' ? 'blue' : 'gray'} variant="subtle">
      {t(`role.${role || 'none'}`)}
    </Badge>
  );
}

/** "Managed by SSO" lock badge, shown whenever an SSO role source exists. */
function SsoBadge({ sources }: { sources: RoleSources }) {
  const { t } = useTranslation('teams');
  if (!showSsoLock(sources)) return null;
  return (
    <Tooltip content={t('ssoBadgeHint')}>
      <Badge colorPalette="gray" variant="outline" tabIndex={0}>
        <LuLock aria-hidden />
        {t('ssoBadge')}
      </Badge>
    </Tooltip>
  );
}

export function RoleCell({ sources, effective }: { sources: RoleSources; effective: RoleOrNone }) {
  return (
    <HStack gap="2" wrap="wrap">
      <RoleBadge role={effective} />
      <SsoBadge sources={sources} />
    </HStack>
  );
}
