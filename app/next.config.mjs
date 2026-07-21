/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @solana/web3.js pulls node polyfills it doesn't need in the browser.
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    return config;
  },
};

export default nextConfig;
