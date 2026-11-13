import { Heading, Stack, Text } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';

export function Placeholder({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Stack>
      <Heading as="h2" size="xl">{t(titleKey)}</Heading>
      <Text fontWeight="semibold">{t('placeholder.title')}</Text>
      <Text color="fg.muted">{t('placeholder.body')}</Text>
    </Stack>
  );
}
