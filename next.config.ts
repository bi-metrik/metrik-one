import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Skew Protection: sella cada peticion con el id del deployment que la
  // origino, para que una pestaña vieja siga recibiendo SUS assets aunque ya
  // haya entrado un deploy nuevo. Sin esto, un push a `main` retira los chunks
  // que la pestaña abierta todavia esta pidiendo → "Application error: a
  // client-side exception has occurred" (incidente Jessica, 2026-08-18).
  //
  // Vercel ya lo hace solo: la proteccion viene activada por defecto en
  // proyectos creados despues de nov-2024 y Next >= 14.1.4 no necesita
  // configuracion (verificado el 2026-08-20: soena.metrikone.co sirve sus
  // assets con `?dpl=`). Esta linea se queda porque hace explicito lo que
  // importa aqui — que el id con el que Vercel pinea los assets y el que
  // `src/lib/version/build.ts` le da al vigilante sean el MISMO valor, y no
  // dos cosas que puedan desincronizarse.
  //
  // Lo que si se configura en el panel (Settings → Advanced → Skew Protection)
  // es **Maximum Age**: por defecto un dia, y pasado ese plazo la pestaña
  // vieja recibe 404 en sus assets. Es el borde exacto con el que se estrello
  // la pestaña de un dia de Jessica.
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
