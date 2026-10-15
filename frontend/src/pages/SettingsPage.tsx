import { Select, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { ErrorAlert } from '../components/ErrorAlert';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { me } = useMe();
  const { change, mutation } = useChangeLanguage();
  return (
    <Stack maw={480}>
      <Title order={2}>{t('pages.settings')}</Title>
      {me && (
        <Text c="dimmed">
          {me.displayName || me.username} {me.email && `(${me.email})`}
        </Text>
      )}
      <Select
        label={t('language.label')}
        description={t('settingsPage.languageHelp')}
        allowDeselect={false}
        disabled={mutation.isPending}
        value={i18n.resolvedLanguage ?? 'en'}
        data={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
        onChange={(v) => v && change(v as Language)}
      />
      {mutation.isSuccess && <Text size="sm" c="green">{t('actions.saved')}</Text>}
      <ErrorAlert error={mutation.error} />
    </Stack>
  );
}
