import { afterAll, afterEach, beforeAll } from 'vitest';
import { clearProviders } from '@/lib/ai/provider';

beforeAll(() => {
  // Clear any previous providers
  clearProviders();

  // Force garbage collection before tests run
  if (global.gc) {
    global.gc();
  }
});

afterEach(() => {
  clearProviders();
});

afterAll(() => {
  clearProviders();
});

