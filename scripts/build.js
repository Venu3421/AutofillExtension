import { build } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');

async function buildAll() {
  console.log('🚀 Building Pilgrim QuickFill Chrome Extension...');

  // 1. Build Popup
  console.log('\n[1/3] Building Popup UI...');
  await build({
    configFile: false,
    root: rootDir,
    base: '',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: resolve(rootDir, 'src/popup/index.html'),
        output: {
          entryFileNames: 'popup/[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (assetInfo) => {
            if (assetInfo.name && assetInfo.name.endsWith('.css')) {
              return 'popup/popup.css';
            }
            return 'assets/[name][extname]';
          }
        }
      }
    }
  });

  // 2. Build Background Service Worker
  console.log('\n[2/3] Building Background Service Worker...');
  await build({
    configFile: false,
    root: rootDir,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: resolve(rootDir, 'src/background/service-worker.ts'),
        formats: ['es'],
        fileName: () => 'background/service-worker.js'
      }
    }
  });

  // 3. Build Content Script as standalone IIFE (Zero external module imports!)
  console.log('\n[3/3] Building Content Script (Standalone IIFE)...');
  await build({
    configFile: false,
    root: rootDir,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: false,
      lib: {
        entry: resolve(rootDir, 'src/content/index.ts'),
        name: 'PilgrimQuickFill',
        formats: ['iife'],
        fileName: () => 'content/index.js'
      }
    }
  });

  console.log('\n✨ Build completed successfully.');
}

buildAll().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
