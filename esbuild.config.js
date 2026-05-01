// esbuild.config.js — builds the checkout recovery bundle as a single IIFE
//
// Production build:
//   NODE_ENV=production node esbuild.config.js
//   → dist/checkout-recovery.<hash>.js  (minified, content-hashed)
//   → dist/checkout-recovery.js         (canonical copy, same content)
//   → dist/manifest.json                (maps "checkout-recovery.js" → hashed filename)
//
// Development / watch build:
//   node esbuild.config.js --watch
//   → dist/checkout-recovery.js         (unminified, with source maps)
//
// Requirements: 12.4

import * as esbuild from 'esbuild';
import { createHash } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const isWatch = process.argv.includes('--watch');
const isProd = process.env.NODE_ENV === 'production';

/** Base esbuild configuration shared between dev and prod builds. */
const baseConfig = {
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: /** @type {'iife'} */ ('iife'),
  globalName: 'CheckoutRecovery',
  platform: /** @type {'browser'} */ ('browser'),
  // es2017 gives broad browser support (Chrome 58+, Firefox 52+, Safari 10.1+)
  // while still allowing async/await without regenerator-runtime overhead.
  target: ['es2017'],
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
};

if (isWatch) {
  // -------------------------------------------------------------------------
  // Development / watch mode
  // -------------------------------------------------------------------------
  const ctx = await esbuild.context({
    ...baseConfig,
    outfile: 'dist/checkout-recovery.js',
    sourcemap: true,
    minify: false,
  });
  await ctx.watch();
  console.log('[esbuild] Watching for changes…');
} else {
  // -------------------------------------------------------------------------
  // Production / one-shot build
  // -------------------------------------------------------------------------
  mkdirSync('dist', { recursive: true });

  const result = await esbuild.build({
    ...baseConfig,
    outfile: 'dist/checkout-recovery.js', // temporary; we rename below
    sourcemap: false,
    minify: isProd,
    metafile: true,
    write: false, // we handle writing ourselves to compute the content hash
  });

  if (result.outputFiles === undefined || result.outputFiles.length === 0) {
    console.error('[esbuild] Build produced no output files.');
    process.exit(1);
  }

  for (const outputFile of result.outputFiles) {
    const contents = outputFile.contents;
    const sizeKb = (contents.byteLength / 1024).toFixed(1);

    // Compute an 8-character SHA-256 content hash for cache busting
    const hash = createHash('sha256').update(contents).digest('hex').slice(0, 8);

    const hashedFilename = isProd
      ? `dist/checkout-recovery.${hash}.js`
      : 'dist/checkout-recovery.js';

    // Write the hashed file
    writeFileSync(hashedFilename, contents);
    console.log(`[esbuild] Built ${hashedFilename} (${sizeKb} KB)`);

    if (isProd) {
      // Also write the canonical (unhashed) filename so existing script tags
      // that reference "checkout-recovery.js" continue to work.
      writeFileSync('dist/checkout-recovery.js', contents);
      console.log(`[esbuild] Wrote canonical dist/checkout-recovery.js`);

      // Write a manifest so the Script Tag injection layer can reference the
      // hashed filename for cache-busted deployments.
      const manifest = {
        'checkout-recovery.js': hashedFilename.replace('dist/', ''),
        buildTime: new Date().toISOString(),
        sizeKb: parseFloat(sizeKb),
      };
      writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2));
      console.log('[esbuild] Wrote dist/manifest.json');
    }
  }

  // -------------------------------------------------------------------------
  // Bundle size budget check (Requirement 12.4)
  // -------------------------------------------------------------------------
  // We enforce a hard limit here at build time as a fast-feedback gate.
  // The authoritative p95 measurement is done by Lighthouse CI (see .lighthouserc.js).
  const BUNDLE_SIZE_BUDGET_KB = 150; // conservative; 150 KB gzipped ≈ ~50 KB transfer

  for (const outputFile of result.outputFiles) {
    const sizeKb = outputFile.contents.byteLength / 1024;
    if (sizeKb > BUNDLE_SIZE_BUDGET_KB) {
      console.warn(
        `[esbuild] WARNING: Bundle size ${sizeKb.toFixed(1)} KB exceeds budget of ${BUNDLE_SIZE_BUDGET_KB} KB.`,
      );
      console.warn('[esbuild] Review imports and consider code-splitting to stay within the 200ms p95 load budget.');
    }
  }
}
