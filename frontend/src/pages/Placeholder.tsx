import { Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Title order={2}>{t(titleKey)}</Title>
      <Text fw={600}>{t('placeholder.title')}</Text>
      <Text c="dimmed">{t('placeholder.body')}</Text>
    </Stack>
  );
}
