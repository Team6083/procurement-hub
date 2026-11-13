import { Alert, Button, HStack } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { useVersionMismatch } from '../api/versionGuard';

export function UpdateBanner() {
  const { t } = useTranslation();
  const mismatch = useVersionMismatch();
  if (!mismatch) return null;
  return (
    <Alert.Root status="warning" borderRadius="0" role="alert" data-testid="update-banner" justifyContent="center">
      <HStack gap="3" wrap="wrap" justify="center">
        <Alert.Description>{t('banner.updated')}</Alert.Description>
        <Button size="xs" onClick={() => window.location.reload()}>
          {t('banner.reload')}
        </Button>
      </HStack>
    </Alert.Root>
  );
}
