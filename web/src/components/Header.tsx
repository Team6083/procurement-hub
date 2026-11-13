import { Anchor, Group, Menu, Select, Text, UnstyledButton } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '../auth/AuthGate';
import { useMe } from '../api/me';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';

export function Header() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useSession();
  const { memberships, isSystemAdmin } = useMe();
  const { change } = useChangeLanguage();
  const navigate = useNavigate();
  const name = (user.profile.name as string | undefined) ?? user.profile.email ?? t('user.unknown');

  return (
    <Group component="header" justify="space-between" px="md" h={56} wrap="nowrap">
      <Group gap="lg" wrap="nowrap">
        <Text fw={700}>{t('app.name')}</Text>
        <Group component="nav" gap="md" visibleFrom="sm">
          <Anchor component={Link} to="/">{t('nav.home')}</Anchor>
          {memberships.length > 0 && (
            <Menu>
              <Menu.Target>
                <UnstyledButton>
                  <Text c="blue">{t('nav.teams')}</Text>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                {memberships.map((m) => (
                  <Menu.Item key={m.teamId} onClick={() => void navigate({ to: '/teams/$slug', params: { slug: m.slug } })}>
                    {m.name}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
          )}
          <Anchor component={Link} to="/batches">{t('nav.batches')}</Anchor>
          <Anchor component={Link} to="/reports">{t('nav.reports')}</Anchor>
          {isSystemAdmin && <Anchor component={Link} to="/admin/role-mappings">{t('nav.admin')}</Anchor>}
          <Anchor component={Link} to="/settings">{t('nav.settings')}</Anchor>
        </Group>
      </Group>
      <Group gap="sm" wrap="nowrap">
        <Select
          aria-label={t('language.label')}
          w={130}
          allowDeselect={false}
          value={i18n.resolvedLanguage ?? 'en'}
          data={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
          onChange={(v) => v && change(v as Language)}
        />
        <Menu position="bottom-end">
          <Menu.Target>
            <UnstyledButton aria-label={t('user.menu')}>
              <Text size="sm" maw={160} truncate>{name}</Text>
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => void logout()}>{t('user.logout')}</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}
