import { Box, Button, Flex, HStack, Menu, Portal, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useSession } from '../auth/AuthGate';
import { useMe } from '../api/me';
import { paths } from '../paths';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';
import { RouteAnchor } from './RouteLinks';
import { SelectField } from './ui/select';

export function Header() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useSession();
  const { memberships, isSystemAdmin } = useMe();
  const { change } = useChangeLanguage();
  const navigate = useNavigate();
  const name = (user.profile.name as string | undefined) ?? user.profile.email ?? t('user.unknown');
  const links = [
    { to: '/', label: t('nav.home') },
    { to: '/batches', label: t('nav.batches') },
    { to: '/reports', label: t('nav.reports') },
    ...(isSystemAdmin ? [{ to: '/admin/role-mappings', label: t('nav.admin') }] : []),
    { to: '/settings', label: t('nav.settings') },
  ];

  return (
    <Flex as="header" justify="space-between" align="center" px="4" h="14" gap="3" bg="header.bg" borderBottomWidth="1px">
      <HStack gap="6" minW="0">
        {/* Narrow screens: every destination in one menu. */}
        <Box hideFrom="md">
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="ghost" size="sm" aria-label={t('nav.menu')}>
                <span aria-hidden>☰</span>
              </Button>
            </Menu.Trigger>
            <Portal>
              <Menu.Positioner>
                <Menu.Content>
                  {links.map((l) => (
                    <Menu.Item key={l.to} value={l.to} asChild>
                      <Link to={l.to}>{l.label}</Link>
                    </Menu.Item>
                  ))}
                  {memberships.length > 0 && <Menu.Separator />}
                  {memberships.map((m) => (
                    <Menu.Item key={m.teamId} value={`team-${m.teamId}`} asChild>
                      <Link to={paths.team(m.slug)}>{m.name}</Link>
                    </Menu.Item>
                  ))}
                </Menu.Content>
              </Menu.Positioner>
            </Portal>
          </Menu.Root>
        </Box>
        <Text fontWeight="bold" truncate>{t('app.name')}</Text>
        <HStack as="nav" gap="4" hideBelow="md">
          <RouteAnchor to="/">{t('nav.home')}</RouteAnchor>
          {memberships.length > 0 && (
            <Menu.Root onSelect={(d) => void navigate(paths.team(d.value))}>
              <Menu.Trigger asChild>
                <Button variant="plain" size="sm" px="0" color="brand.fg" fontWeight="normal" fontSize="md">{t('nav.teams')}</Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    {memberships.map((m) => (
                      <Menu.Item key={m.teamId} value={m.slug}>{m.name}</Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
          )}
          {links.slice(1).map((l) => (
            <RouteAnchor key={l.to} to={l.to}>{l.label}</RouteAnchor>
          ))}
        </HStack>
      </HStack>
      <HStack gap="2" flexShrink={0}>
        <SelectField
          aria-label={t('language.label')}
          w="130px"
          value={i18n.resolvedLanguage ?? 'en'}
          options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
          onChange={(v) => v && change(v as Language)}
        />
        <Menu.Root positioning={{ placement: 'bottom-end' }} onSelect={(d) => d.value === 'logout' && void logout()}>
          <Menu.Trigger asChild>
            <Button variant="ghost" size="sm" aria-label={t('user.menu')} maxW={{ base: '100px', md: '180px' }}>
              <Text truncate>{name}</Text>
            </Button>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content>
                <Menu.Item value="logout">{t('user.logout')}</Menu.Item>
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </HStack>
    </Flex>
  );
}
