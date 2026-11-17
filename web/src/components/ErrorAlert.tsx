import { Alert, List } from '@chakra-ui/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, errorMessage } from '../api/errors';

/** Localized error box. For invalid_request the per-field server messages are listed too. */
export function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const fields =
    error instanceof ApiError && error.code === 'invalid_request'
      ? Object.entries((error.details.fields ?? {}) as Record<string, unknown>)
      : [];
  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{errorMessage(t, error)}</Alert.Description>
        {fields.length > 0 && (
          <List.Root textStyle="sm" mt="1" ps="4">
            {fields.map(([k, v]) => (
              <List.Item key={k}>
                {k}: {String(v)}
              </List.Item>
            ))}
          </List.Root>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}

/** Neutral or warning notice (not an error). */
export function Notice({ children, status = 'neutral' }: { children: ReactNode; status?: 'neutral' | 'warning' | 'info' }) {
  return (
    <Alert.Root status={status}>
      <Alert.Indicator />
      <Alert.Description>{children}</Alert.Description>
    </Alert.Root>
  );
}
