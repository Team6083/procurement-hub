import { Card, Stack, Text } from '@chakra-ui/react';
import { PageHeader } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { useMe } from '../api/me';
import { ErrorAlert } from '../components/ErrorAlert';
import { SelectField } from '../components/ui/select';
import { SUPPORTED_LANGUAGES, type Language } from '../i18n';
import { useChangeLanguage } from '../i18n/useLanguage';

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const { me } = useMe();
  const { change, mutation } = useChangeLanguage();
  return (
    <>
      <PageHeader
        title={t('pages.settings')}
        description={me && `${me.displayName || me.username}${me.email ? ` (${me.email})` : ''}`}
      />
      <Card.Root size="sm">
        <Card.Body>
          <Stack maxW="480px" gap="4">
      <SelectField
        label={t('language.label')}
        helperText={t('settingsPage.languageHelp')}
        disabled={mutation.isPending}
        value={i18n.resolvedLanguage ?? 'en'}
        options={SUPPORTED_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }))}
        onChange={(v) => v && change(v as Language)}
      />
      {mutation.isSuccess && <Text textStyle="sm" color="fg.success">{t('actions.saved')}</Text>}
      <ErrorAlert error={mutation.error} />
          </Stack>
        </Card.Body>
      </Card.Root>
    </>
  );
}
