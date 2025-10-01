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
    // 'react-native-fs' modülünü çözmeye çalışmasını engelle
    // jsmediatags kütüphanesi bunu gerektiriyor ama sadece RN ortamında
    config.resolve.alias['react-native-fs'] = false;

    // Sunucu tarafında bu modülü yok say
    if (isServer) {
        if (Array.isArray(config.externals)) {
            config.externals.push('react-native-fs');
        } else {
            config.externals = ['react-native-fs', config.externals];
        }
    }
    
    return config;
  },
};

export default nextConfig;
