import './zodSetup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { AppCommitProvider } from '@team6083/ui';
import { App } from './App';
import { Provider } from './components/ui/provider';
import { RuntimeConfigProvider } from './config';
import i18n from './i18n';

// Runtime config is fetched before anything else (auth, API, router) initializes; a failure shows the config error page.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Provider>
        <RuntimeConfigProvider>
          <AppCommitProvider buildCommit={__APP_COMMIT__}>
            <App />
          </AppCommitProvider>
        </RuntimeConfigProvider>
      </Provider>
    </I18nextProvider>
  </StrictMode>,
);
