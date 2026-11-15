import './zodSetup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { ConfigErrorPage } from '@team6083/ui';
import { App } from './App';
import { Provider } from './components/ui/provider';
import { loadConfig } from './config';
import i18n from './i18n';

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);
  try {
    // Runtime config is fetched before anything else (auth, API, router) initializes.
    const config = await loadConfig();
    root.render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <App config={config} />
        </I18nextProvider>
      </StrictMode>,
    );
  } catch (e) {
    root.render(
      <I18nextProvider i18n={i18n}>
        <Provider>
          <ConfigErrorPage minH="100vh" error={e} />
        </Provider>
      </I18nextProvider>,
    );
  }
}

void bootstrap();
