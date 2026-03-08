import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only measure the business logic layers. Agent (LangGraph) and CLI
      // (Commander.js) require live API keys or process spawning; MQTT
      // subscriber requires a live broker — all excluded from enforcement.
      include: ['src/db/**', 'src/services/**', 'src/utils/**', 'src/mqtt/**'],
      exclude: ['**/*.test.ts', 'src/mqtt/subscriber.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
