import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolveCommitStrict } from './scripts/commit.mjs';

const TEST_COMMIT = '0123456789abcdef0123456789abcdef01234567';

export default defineConfig(({ command, mode }) => ({
  // Only for deployments under a sub-path, e.g. VITE_BASE_PATH=/procurement/ (spec section 6.2).
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  define: {
    // The dev server has no build to identify, so the footer shows "dev" (an "unknown" commit); tests get a fixed SHA
    // so they do not depend on a git checkout. Production builds (vite build, NODE_ENV=production, CI) fail when no
    // commit can be determined (spec §6.3).
    __APP_COMMIT__: JSON.stringify(
      process.env.VITEST
        ? TEST_COMMIT
        : command === 'build'
          ? resolveCommitStrict(process.env, undefined, command === 'build' && mode === 'production') : 'unknown',
    ),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    chunkSizeWarningLimit: 1300,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
  },
}));
