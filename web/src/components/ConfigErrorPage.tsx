import { Center, Code, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import type { ConfigError } from '../config';

export function ConfigErrorPage({ error }: { error: ConfigError }) {
  const { t } = useTranslation();
  return (
    <Center mih="100vh" p="md">
      <Stack maw={560}>
        <Title order={2}>{t(`config.${error.kind}.title`)}</Title>
        <Text>{t(`config.${error.kind}.body`)}</Text>
        <Text size="sm" c="dimmed">
          {t('config.details')}
        </Text>
        <Code block>{error.message}</Code>
      </Stack>
    </Center>
  );
}
