import type { NextConfig } from 'next';

// TRD §4: single TS monorepo; workspace packages are TS sources, transpile them.
const nextConfig: NextConfig = {
  transpilePackages: [
    '@atlas/contracts',
    '@atlas/github',
    '@atlas/graph',
    '@atlas/ai',
    '@atlas/store',
    '@atlas/learning',
    '@atlas/pipeline',
  ],
  typedRoutes: false,
  // Workspace packages are TS sources whose relative imports use `.js`
  // suffixes (ESM style). Teach webpack to resolve those to `.ts`/`.tsx`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
