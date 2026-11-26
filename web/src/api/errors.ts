import { ApiError } from '@team6083/ui';
import i18next, { type TFunction } from 'i18next';

/** Localized text for an error: by API code, else the English server message, else generic. */
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof ApiError) {
    // Refused by the client while the server runs a newer build.
    if (err.code === 'app_outdated') return t('errors:versionMismatch');
    // 412 is a stale If-Match too, whatever code the body carries.
    if (err.status === 412) return t('errors:codes.version_conflict');
    // Details such as `remaining` and `lineNo` (line_quantity_exceeded) fill the message's placeholders.
    const vars = Object.fromEntries(Object.entries(err.details).filter(([, v]) => typeof v === 'string' || typeof v === 'number'));
    // With a string `details.value` (the clashing value of subgroup_name_conflict), a code that has a `_value`
    // text uses it to name the value; other codes keep their plain text.
    const key = `errors:codes.${err.code}`;
    const withValue = typeof err.details.value === 'string' && i18next.exists(`${key}_value`);
    return t(withValue ? `${key}_value` : key, { ...vars, defaultValue: err.message || t('errors:generic') });
  }
  if (err instanceof TypeError) return t('errors:network');
  return t('errors:generic');
}
