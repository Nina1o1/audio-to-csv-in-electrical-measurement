import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'

// Plain config avoids coupling Vite 8 plugin types to Vitest's bundled Vite 6.
export default {
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // The dependency-free Vue host needs client SFC transforms; other tests retain Node/SSR.
    projects: [
      { extends: true, test: { name: 'contracts', environment: 'node', include: ['tests/**/*.test.ts'], exclude: ['tests/integration/manual-app.test.ts'] } },
      { extends: true, test: { name: 'app', environment: './tests/helpers/vue-renderer-environment.ts', include: ['tests/integration/manual-app.test.ts'] } },
    ],
    clearMocks: true,
    restoreMocks: true,
  },
}
