import { Alert, Button, Group } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { useVersionMismatch } from '../api/versionGuard';

export function UpdateBanner() {
  const { t } = useTranslation();
  const mismatch = useVersionMismatch();
  if (!mismatch) return null;
  return (
    <Alert color="yellow" radius={0} role="alert" data-testid="update-banner">
      <Group justify="center" gap="md">
        <span>{t('banner.updated')}</span>
        <Button size="xs" onClick={() => window.location.reload()}>
          {t('banner.reload')}
        </Button>
      </Group>
    </Alert>
  );
}
