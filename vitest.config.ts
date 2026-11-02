import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.{ts,tsx}'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
  },
  esbuild: { jsx: 'automatic' },
})
