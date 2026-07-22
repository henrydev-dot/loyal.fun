/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @solana/web3.js pulls node polyfills it doesn't need in the browser.
  webpack: (config) => {
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    // The Pyth receiver's @pythnetwork/solana-utils drags in jito-ts (block
    // engine client) which we never use; its subtree has broken ESM paths
    // and an ancient nested web3.js. Stub the whole package out.
    config.resolve.alias = { ...config.resolve.alias, "jito-ts": false };
    return config;
  },
};

export default nextConfig;
