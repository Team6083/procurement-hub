import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolveCommit } from './scripts/gen-runtime-files.mjs';

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(resolveCommit(process.env)),
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
});
