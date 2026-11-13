import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { resolveCommitStrict } from './scripts/commit.mjs';

export default defineConfig(({ command, mode }) => ({
  // Only for deployments under a sub-path, e.g. VITE_BASE_PATH=/procurement/ (spec section 6.2).
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  define: {
    // Fails production builds (vite build, NODE_ENV=production, CI) when no commit can be determined (spec §6.3).
    __APP_COMMIT__: JSON.stringify(resolveCommitStrict(process.env, undefined, command === 'build' && mode === 'production')),
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
