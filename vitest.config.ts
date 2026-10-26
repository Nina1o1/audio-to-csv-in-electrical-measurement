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
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
}
