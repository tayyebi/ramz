import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        options: resolve(__dirname, 'options.html'),
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'popup' || chunk.name === 'options') {
            return `${chunk.name}/index.js`;
          }
          return '[name]/index.js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (info) => {
          if (info.name?.endsWith('.css')) return 'popup/[name][extname]';
          return '[name]/[name][extname]';
        },
      },
    },
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});
