import { useTranslation } from 'react-i18next';
import type { ConfigError } from '../config';
import { StatusPage } from './StatusPage';

export function ConfigErrorPage({ error }: { error: ConfigError }) {
  const { t } = useTranslation();
  return (
    <StatusPage
      title={t(`config.${error.kind}.title`)}
      body={t(`config.${error.kind}.body`)}
      note={t('config.details')}
      details={error.message}
    />
  );
}
