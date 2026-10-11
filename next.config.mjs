/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  poweredByHeader: false,
  compress: true,
  productionBrowserSourceMaps: false,
  webpack: (config, { dev }) => {
    config.performance = false;
    if (dev) {
      config.watchOptions = { aggregateTimeout: 300, poll: 1000 };
    }
    return config;
  },
};

export default nextConfig;
