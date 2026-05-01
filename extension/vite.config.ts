import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync } from 'fs';

const copyExtensionFiles = () => ({
  name: 'copy-extension-files',
  closeBundle() {
    const root = resolve(__dirname);
    const dist = resolve(__dirname, 'dist');
    try {
      copyFileSync(resolve(root, 'manifest.json'), resolve(dist, 'manifest.json'));
      mkdirSync(resolve(dist, 'icons'), { recursive: true });
      for (const size of [16, 48, 128]) {
        copyFileSync(
          resolve(root, `icons/icon${size}.png`),
          resolve(dist, `icons/icon${size}.png`)
        );
      }
    } catch (err) {
      throw new Error(
        `[copy-extension-files] Failed to copy extension assets: ${(err as Error).message}`
      );
    }
  },
});

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
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
