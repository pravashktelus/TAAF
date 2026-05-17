import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@steps': path.resolve(__dirname, 'src/steps'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@config': path.resolve(__dirname, 'src/config'),
      '@pages': path.resolve(__dirname, 'src/pages'),
    },
  },
});
