/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PDF libraries used by /api/plans/*. Loaded from node_modules at runtime instead of being
  // bundled, which is how they are designed to run on a server.
  experimental: { serverComponentsExternalPackages: ['pdf-lib', 'unpdf'] },
};

// The old standalone customer portal (/portal and /portal/dashboard) was retired
// in favour of /customerportal. Old bookmarks and emails land there instead of a 404.
nextConfig.redirects = async () => [
  { source: '/portal', destination: '/customerportal', permanent: true },
  { source: '/portal/:path*', destination: '/customerportal', permanent: true },
];

module.exports = nextConfig;
