import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Skew Protection: sella cada peticion con el id del deployment que la
  // origino, para que una pestaña vieja siga recibiendo SUS assets aunque ya
  // haya entrado un deploy nuevo. Sin esto, un push a `main` retira los chunks
  // que la pestaña abierta todavia esta pidiendo → "Application error: a
  // client-side exception has occurred" (incidente Jessica, 2026-08-18).
  // Es el MISMO valor que sirve `src/lib/version/build.ts` al vigilante.
  // OJO: el flag solo no basta — Skew Protection tambien se activa en el panel
  // de Vercel (Settings → Advanced).
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
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
