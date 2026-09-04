import { defineConfig } from 'vitest/config';

// Without this, Vitest walks up and picks the site's jsdom config.
export default defineConfig({
    test: {
        environment: 'node',
        coverage: { include: ['src/**/*.ts'], exclude: ['src/**/*.test.ts', 'src/env.ts'] },
    },
});
