import { Toaster, UiProvider } from '@team6083/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** The team theme and color mode, with the package's own strings in the current UI language, and the toasts. */
export function Provider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <UiProvider locale={i18n.language}>
      {children}
      <Toaster />
    </UiProvider>
  );
}
