import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.ts'],
        coverage: {
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/mockData.ts', 'src/replayData.ts', 'src/types.ts', 'src/vite-env.d.ts', 'src/script.ts'],
        },
    },
});
