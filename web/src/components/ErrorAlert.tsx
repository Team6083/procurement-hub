import { Alert, Button, List } from '@chakra-ui/react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@team6083/ui';
import { errorMessage } from '../api/errors';
import { isVersionConflict } from '../api/versioned';

interface Props {
  error: unknown;
  /**
   * For a form that keeps the user's edits through a version conflict: the alert says so and offers this action
   * to throw the edits away and show the latest version instead.
   */
  onDiscard?: () => void;
}

/** Localized error box. For invalid_request the per-field server messages are listed too. */
export function ErrorAlert({ error, onDiscard }: Props) {
  const { t } = useTranslation();
  if (!error) return null;
  const fields =
    error instanceof ApiError && error.code === 'invalid_request'
      ? Object.entries((error.details.fields ?? {}) as Record<string, unknown>)
      : [];
  const keptEdits = !!onDiscard && isVersionConflict(error);
  return (
    <Alert.Root status="error" role="alert">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{keptEdits ? t('errors:conflictKeptEdits') : errorMessage(t, error)}</Alert.Description>
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
      {keptEdits && (
        <Button size="xs" variant="outline" alignSelf="center" onClick={onDiscard}>{t('actions.discardChanges')}</Button>
      )}
    </Alert.Root>
  );
}
