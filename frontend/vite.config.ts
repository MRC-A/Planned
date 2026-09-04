import path from 'node:path'
import { defineConfig } from 'vite'

// Pin the test timezone before anything reads a Date. Bug C4 only ever
// reproduced ahead of UTC and passed cleanly in UTC, so a suite running in
// UTC would assert nothing about the very bug it exists to prevent.
// task-dates.test.ts asserts the offset is actually negative, so this
// failing to apply is a loud test failure rather than a silent no-op.
process.env.TZ = process.env.TZ ?? 'Europe/Paris'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Proxies /api to the FastAPI backend during development, so the frontend
// can call fetch('/api/...') without hardcoding a host.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
    // The app is single-timezone in practice but its date bugs were not:
    // C4 only reproduced ahead of UTC, and passed cleanly in UTC. Pin a
    // UTC+2 zone so the suite exercises the case that actually broke.
    // Overridable per-run with TZ=... to spot-check another offset.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
