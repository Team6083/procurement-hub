import type { TFunction } from 'i18next';

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Thrown for mutating requests while the client is out of date (commit mismatch). */
export class VersionMismatchError extends Error {
  constructor() {
    super('The system has been updated. Please reload the page.');
    this.name = 'VersionMismatchError';
  }
}

/** Parses the `{error:{code,message,details}}` envelope; falls back to a generic ApiError. */
export async function parseApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    const e = body.error;
    if (e && typeof e.code === 'string') {
      return new ApiError(
        res.status,
        e.code,
        typeof e.message === 'string' ? e.message : res.statusText,
        e.details && typeof e.details === 'object' ? e.details : {},
      );
    }
  } catch {
    /* not JSON */
  }
  return new ApiError(res.status, 'unknown', res.statusText || `HTTP ${res.status}`);
}

/** Localized text for an error: by API code, else the English server message, else generic. */
export function errorMessage(t: TFunction, err: unknown): string {
  if (err instanceof VersionMismatchError) return t('errors:versionMismatch');
  if (err instanceof ApiError) {
    return t(`errors:codes.${err.code}`, { defaultValue: err.message || t('errors:generic') });
  }
  if (err instanceof TypeError) return t('errors:network');
  return t('errors:generic');
}
