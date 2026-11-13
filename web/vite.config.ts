import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolveCommitStrict } from './scripts/gen-runtime-files.mjs';

export default defineConfig(({ command, mode }) => ({
  plugins: [react()],
  define: {
    // Fails production builds (vite build, NODE_ENV=production, CI) when no commit can be determined (spec §6.3).
    __APP_COMMIT__: JSON.stringify(resolveCommitStrict(process.env, undefined, command === 'build' && mode === 'production')),
  },
  build: {
    // scripts/gen-runtime-files.mjs prepares dist/ (config.json, _headers) before this build runs.
    emptyOutDir: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
}));
