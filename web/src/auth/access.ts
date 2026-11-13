import { useSyncExternalStore } from 'react';

type Listener = () => void;

/** Set once the API answers 403 missing_role: the user may sign in but may not use the service. */
export function createAccessStore() {
  let denied = false;
  const listeners = new Set<Listener>();
  return {
    isDenied: () => denied,
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    deny() {
      if (denied) return;
      denied = true;
      listeners.forEach((l) => l());
    },
  };
}

export type AccessStore = ReturnType<typeof createAccessStore>;

export function useAccessDenied(store: AccessStore): boolean {
  return useSyncExternalStore(store.subscribe, store.isDenied);
}
