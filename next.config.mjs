/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build a self-contained server bundle for slim Docker images.
  // See https://nextjs.org/docs/app/api-reference/next-config-js/output
  output: 'standalone',
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
    // Arms the in-process reminder scheduler on boot (src/instrumentation.ts).
    instrumentationHook: true,
  },
};

export default nextConfig;
