import { Skeleton, Stack } from '@chakra-ui/react';
import { StatusPage } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LuSearchX, LuShieldX } from 'react-icons/lu';
import { ApiError } from '@team6083/ui';
import { useAccess, type Access } from '../auth/useAccess';
import { ErrorAlert } from './ErrorAlert';
import { RouteButton } from './RouteLinks';

const HomeLink = () => {
  const { t } = useTranslation();
  return <RouteButton to="/" variant="outline">{t('notFound.home')}</RouteButton>;
};

/** A page or record that does not exist, or that the user may not know exists (the API answers 404 for both). */
export function NotFound() {
  const { t } = useTranslation();
  return <StatusPage icon={<LuSearchX />} title={t('pages.notFound')} description={t('notFound.body')} actions={<HomeLink />} />;
}

/** A page the user's roles do not open. */
export function Forbidden({ description }: { description?: string }) {
  const { t } = useTranslation();
  return <StatusPage icon={<LuShieldX />} title={t('forbidden.title')} description={description ?? t('forbidden.body')} actions={<HomeLink />} />;
}

/** Shows the page only when `allow` passes; meanwhile a skeleton, otherwise Forbidden. Queries inside never run for the wrong role. */
export function RoleGuard({ allow, description, children }: { allow: (a: Access) => boolean; description?: string; children: ReactNode }) {
  const access = useAccess();
  if (access.isPending) return <PageSkeleton />;
  if (!allow(access)) return <Forbidden description={description} />;
  return <>{children}</>;
}

export const isNotFound = (err: unknown) => err instanceof ApiError && err.status === 404;

/** A detail page's failed load: NotFound for a 404, otherwise the error. */
export function LoadError({ error }: { error: unknown }) {
  return isNotFound(error) ? <NotFound /> : <ErrorAlert error={error} />;
}

/** First load of a page: a header line and a content block. */
export function PageSkeleton() {
  return (
    <Stack gap="4">
      <Skeleton h="8" w="64" maxW="full" />
      <Skeleton h="40" rounded="l3" />
    </Stack>
  );
}

/** First load of a list: rows in the shape of a table. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack gap="2" borderWidth="1px" rounded="l3" p="3">
      <Skeleton h="5" w="40%" />
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} h="8" />)}
    </Stack>
  );
}
