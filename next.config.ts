import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // This is to solve the 'Module not found: Can't resolve 'react-native-fs'' error
    // caused by jsmediatags library.
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        'react-native-fs': false,
      };
    }
     config.externals.push('react-native-fs');
    return config;
  },
};

export default nextConfig;
