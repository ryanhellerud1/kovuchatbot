import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Handle pdf-parse test file issue
    config.module.rules.push({
      test: /node_modules\/pdf-parse\/.*\.js$/,
      use: {
        loader: 'string-replace-loader',
        options: {
          search: /require\(['"]\.\/test\/data\/.*?['"]\)/g,
          replace: 'null',
          flags: 'g',
        },
      },
    });

    // Handle Node.js modules for server-side rendering
    if (isServer) {
      config.externals = config.externals || [];
      // Don't externalize these anymore since we're fixing the test file issue
    }

    return config;
  },
};

export default nextConfig;
