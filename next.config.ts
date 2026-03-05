import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Server-only env vars: inlined at build-time so they survive Vercel bundling.
  // Values come from Vercel Project Environment Variables.
  env: {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  },
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
}

export default nextConfig
