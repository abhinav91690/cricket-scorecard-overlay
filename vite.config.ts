import { defineConfig } from 'vite';

export default defineConfig({
    base: './', // Important for relative paths in overlays
    build: {
        outDir: 'dist',
    },
});
