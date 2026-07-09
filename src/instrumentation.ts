/**
 * Next.js instrumentation hook — runs once per server boot. The import is
 * gated on NEXT_RUNTIME inside the if-block (Next's documented pattern) so
 * the edge-runtime compile pass tree-shakes the Node-only scheduler code.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { armScheduler } = await import('./instrumentation-node');
    armScheduler();
  }
}
