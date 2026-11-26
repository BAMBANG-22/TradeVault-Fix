import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function resolveBuildGitSha(): string {
  const envSha = (process.env.VITE_BUILD_GIT_SHA || process.env.GITHUB_SHA || '').trim();
  if (envSha) return envSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function readInstalledPkgVersion(pkgName: string): string {
  try {
    const pkgPath = path.resolve(__dirname, 'node_modules', pkgName, 'package.json');
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(parsed?.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

export default defineConfig(() => {
  const buildGitSha = resolveBuildGitSha();
  const buildTimestamp = (process.env.VITE_BUILD_TIMESTAMP || new Date().toISOString()).trim();
  const buildRunNumber = (process.env.VITE_BUILD_RUN_NUMBER || process.env.GITHUB_RUN_NUMBER || 'local').trim();
  const tesseractVersion = readInstalledPkgVersion('tesseract.js');
  const tesseractCoreVersion = readInstalledPkgVersion('tesseract.js-core');

  return {
    define: {
      __BUILD_GIT_SHA__: JSON.stringify(buildGitSha),
      __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
      __BUILD_RUN_NUMBER__: JSON.stringify(buildRunNumber),
      __TESSERACT_VERSION__: JSON.stringify(tesseractVersion),
      __TESSERACT_CORE_VERSION__: JSON.stringify(tesseractCoreVersion),
    },
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        selfDestroying: true,
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'ocr/worker.min.js',
          'ocr/tesseract-core-lstm.wasm.js',
          'ocr/tesseract-core-simd-lstm.wasm.js',
          'ocr/tesseract-core-relaxedsimd-lstm.wasm.js',
          'ocr/eng.traineddata',
        ],
        manifest: {
          id: '/',
          name: 'VLO Journal - XAUUSD Trading Analytics',
          short_name: 'VLO Journal',
          description: 'Trading journal dan analytics dashboard profesional khusus trader XAUUSD dengan manajemen risiko, kurva ekuitas, dan kalkulator lot.',
          theme_color: '#050607',
          background_color: '#050607',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,wasm,gz}'],
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /\/ocr\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'vlo-offline-ocr-assets',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'lucide-react',
      ],
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      ws: process.env.DISABLE_HMR === 'true' ? (false as const) : undefined,
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

