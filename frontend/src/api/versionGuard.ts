import { useSyncExternalStore } from 'react';

type Listener = () => void;

/** Global flag: true once the backend reports a different commit than this build. */
export function createVersionStore() {
  let mismatch = false;
  const listeners = new Set<Listener>();
  return {
    isMismatch: () => mismatch,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setMismatch() {
      if (mismatch) return;
      mismatch = true;
      listeners.forEach((l) => l());
    },
    reset() {
      mismatch = false;
      listeners.forEach((l) => l());
    },
  };
}

export const versionStore = createVersionStore();

export function useVersionMismatch(): boolean {
  return useSyncExternalStore(versionStore.subscribe, versionStore.isMismatch);
}

/**
 * Compares the X-App-Commit response header with this build's commit and flags a mismatch.
 * A missing header or an "unknown" commit on either side cannot be compared and is ignored.
 */
export function checkCommit(
  headerValue: string | null,
  appCommit: string,
  store: Pick<ReturnType<typeof createVersionStore>, 'setMismatch'> = versionStore,
): boolean {
  const server = headerValue?.trim();
  if (!server || server === 'unknown' || appCommit === 'unknown') return false;
  if (server !== appCommit) {
    store.setMismatch();
    return true;
  }
  return false;
}
