/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    // Para que el browser pueda llamar al orchestrator evitando CORS pre-flights.
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.ORCHESTRATOR_INTERNAL_URL || 'http://orchestrator:4000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
