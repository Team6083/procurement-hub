import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { App } from './App';
import { ConfigErrorPage } from './components/ConfigErrorPage';
import { ConfigError, loadConfig, setConfig } from './config';
import i18n from './i18n';

async function bootstrap() {
  const root = createRoot(document.getElementById('root')!);
  try {
    // Runtime config is fetched before anything else (auth, API, router) initializes.
    const config = await loadConfig();
    setConfig(config);
    root.render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <App config={config} />
        </I18nextProvider>
      </StrictMode>,
    );
  } catch (e) {
    const err = e instanceof ConfigError ? e : new ConfigError('invalid', String(e));
    root.render(
      <I18nextProvider i18n={i18n}>
        <MantineProvider defaultColorScheme="auto">
          <ConfigErrorPage error={err} />
        </MantineProvider>
      </I18nextProvider>,
    );
  }
}

void bootstrap();
