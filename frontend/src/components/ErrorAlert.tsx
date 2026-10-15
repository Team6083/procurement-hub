import { Alert, List } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { ApiError, errorMessage } from '../api/errors';

/** Localized error box. For VALIDATION_ERROR the per-field server messages are listed too. */
export function ErrorAlert({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const fields =
    error instanceof ApiError && error.code === 'VALIDATION_ERROR'
      ? Object.entries((error.details.fields ?? {}) as Record<string, unknown>)
      : [];
  return (
    <Alert color="red" role="alert">
      {errorMessage(t, error)}
      {fields.length > 0 && (
        <List size="sm" mt="xs">
          {fields.map(([k, v]) => (
            <List.Item key={k}>
              {k}: {String(v)}
            </List.Item>
          ))}
        </List>
      )}
    </Alert>
  );
}
