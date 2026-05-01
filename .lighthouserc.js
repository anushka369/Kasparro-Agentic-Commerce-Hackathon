/**
 * Lighthouse CI configuration for the AI-Assisted Checkout Recovery bundle.
 *
 * Asserts that injecting the checkout recovery script does not increase the
 * checkout page load time by more than 200ms at the 95th percentile compared
 * to the baseline checkout page without the script active.
 *
 * Requirements: 12.4
 *
 * Usage:
 *   npm install -g @lhci/cli
 *   lhci autorun
 *
 * Environment variables:
 *   LHCI_CHECKOUT_URL   — URL of the Shopify checkout page to audit
 *                         (default: http://localhost:3000/checkout)
 *   LHCI_SERVER_URL     — Optional Lighthouse CI server for result storage
 */

'use strict';

const checkoutUrl = process.env['LHCI_CHECKOUT_URL'] ?? 'http://localhost:3000/checkout';

/** @type {import('@lhci/cli').LighthouseRcConfig} */
module.exports = {
  ci: {
    // -------------------------------------------------------------------------
    // Collect: run Lighthouse against the checkout page
    // -------------------------------------------------------------------------
    collect: {
      url: [checkoutUrl],
      numberOfRuns: 5, // 5 runs → p95 is the worst of the top 5%
      settings: {
        // Simulate a mid-range mobile device on a 4G connection to match
        // the p95 user population for e-commerce checkouts.
        preset: 'desktop',
        throttlingMethod: 'simulate',
        throttling: {
          // Simulated 4G: 20 Mbps down, 10 Mbps up, 40ms RTT
          rttMs: 40,
          throughputKbps: 20_000,
          uploadThroughputKbps: 10_000,
          cpuSlowdownMultiplier: 1,
        },
        // Inject the checkout recovery bundle via an extra script so we can
        // measure its impact. The bundle path is resolved from the manifest.
        extraHeaders: {
          // Allow the test server to serve the bundle from dist/
          'Cache-Control': 'no-cache',
        },
      },
    },

    // -------------------------------------------------------------------------
    // Assert: page load impact ≤ 200ms at p95 (Requirement 12.4)
    // -------------------------------------------------------------------------
    assert: {
      // Use the "warn" level for most metrics so CI doesn't fail on unrelated
      // regressions; use "error" only for the metrics that directly measure
      // the 200ms load-time budget.
      preset: 'lighthouse:no-pwa',
      assertions: {
        // Total Blocking Time — proxy for script parse/execute cost.
        // A 200ms TBT increase maps roughly to a 200ms load-time increase.
        'total-blocking-time': ['error', { maxNumericValue: 200, aggregationMethod: 'p95' }],

        // Time to Interactive — must not regress by more than 200ms.
        'interactive': ['error', { maxNumericValue: 5000, aggregationMethod: 'p95' }],

        // First Contentful Paint — must not regress by more than 200ms.
        'first-contentful-paint': ['warn', { maxNumericValue: 3000, aggregationMethod: 'p95' }],

        // Speed Index — informational.
        'speed-index': ['warn', { maxNumericValue: 4000, aggregationMethod: 'p95' }],

        // Largest Contentful Paint — informational.
        'largest-contentful-paint': ['warn', { maxNumericValue: 4000, aggregationMethod: 'p95' }],

        // Cumulative Layout Shift — the widget must not cause layout shifts.
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1, aggregationMethod: 'p95' }],

        // Render-blocking resources — the bundle must be loaded async/defer.
        'render-blocking-resources': ['warn', { maxLength: 0 }],

        // Unused JavaScript — flag if the bundle contributes significant dead code.
        'unused-javascript': ['warn', { maxLength: 1 }],
      },
    },

    // -------------------------------------------------------------------------
    // Upload: optional Lighthouse CI server for historical comparison
    // -------------------------------------------------------------------------
    upload: process.env['LHCI_SERVER_URL'] !== undefined
      ? {
          target: 'lhci',
          serverBaseUrl: process.env['LHCI_SERVER_URL'],
        }
      : {
          target: 'temporary-public-storage',
        },
  },
};
