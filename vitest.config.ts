import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        minThreads: 1,
        maxThreads: 1,
      },
    },
    testTimeout: 60000,
    hookTimeout: 60000,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      'pdf-parse': path.resolve(__dirname, './tests/mocks/pdf-parse.ts'),
      'mammoth': path.resolve(__dirname, './tests/mocks/mammoth.ts'),
      'jszip': path.resolve(__dirname, './tests/mocks/jszip.ts'),
      'ws': path.resolve(__dirname, './tests/mocks/ws.ts'),
    },
  },
});
