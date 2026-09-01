import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxies /api to the FastAPI backend during development, so the frontend
// can call fetch('/api/...') without hardcoding a host.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
