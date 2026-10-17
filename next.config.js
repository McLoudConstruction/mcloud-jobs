/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PDF libraries used by /api/plans/*. Loaded from node_modules at runtime instead of being
  // bundled, which is how they are designed to run on a server.
  experimental: { serverComponentsExternalPackages: ['pdf-lib', 'unpdf'] },
};

module.exports = nextConfig;
