import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Provider } from '../components/ui/provider';
import i18n from '../i18n';

/** The app's UI providers (i18n + Chakra), for component tests. */
export function TestProviders({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <Provider>{children}</Provider>
    </I18nextProvider>
  );
}

export function renderUI(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return render(ui, { wrapper: TestProviders, ...options });
}

/** Like renderUI, plus a fresh TanStack Query client. */
export function renderWithQuery(ui: ReactElement, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(ui, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <TestProviders>{children}</TestProviders>
        </QueryClientProvider>
      ),
    }),
  };
}
