import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Permit images from Supabase storage
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'yfjqscvvxetobiidnepa.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  outputFileTracingIncludes: {
    '/**/*': ['./src/lib/pdf/templates/**/*'],
  },
}

export default nextConfig
