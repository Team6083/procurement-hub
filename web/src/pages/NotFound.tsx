import { StatusPage } from '@team6083/ui';
import { useTranslation } from 'react-i18next';
import { RouteButton } from '../components/RouteLinks';

/** Any path no route matches. */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <StatusPage
      title={t('pages.notFound')}
      description={t('notFound.body')}
      actions={<RouteButton to="/">{t('notFound.home')}</RouteButton>}
    />
  );
}
