import { ApiError } from '@team6083/ui';
import type { TFunction } from 'i18next';

/** Localized text for an error: by API code, else the English server message, else generic. */
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    // Refused by the client while the server runs a newer build.
    if (err.code === 'app_outdated') return t('errors:versionMismatch');
    // 412 is a stale If-Match too, whatever code the body carries.
    if (err.status === 412) return t('errors:codes.version_conflict');
    // Details such as `remaining` and `lineNo` (line_quantity_exceeded) fill the message's placeholders.
    const vars = Object.fromEntries(Object.entries(err.details).filter(([, v]) => typeof v === 'string' || typeof v === 'number'));
    return t(`errors:codes.${err.code}`, { ...vars, defaultValue: err.message || t('errors:generic') });
  }
  if (err instanceof TypeError) return t('errors:network');
  return t('errors:generic');
}
