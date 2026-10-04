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
  // importa aqui — que el id con el que Vercel pinea los assets, el que
  // `fetchPropio` manda en `x-deployment-id` (Next lo inlina como
  // NEXT_DEPLOYMENT_ID) y el que `src/lib/version/build.ts` reporta sean el
  // MISMO valor, y no cosas que puedan desincronizarse.
  //
  // Lo que si se configura en el panel (Settings → Advanced → Skew Protection)
  // es **Maximum Age**: pasado ese plazo la pestaña vieja recibe 404 en sus
  // assets. El default de Vercel es un dia, el borde exacto con el que se
  // estrello la pestaña de un dia de Jessica; en ONE esta en **7 dias**
  // (`skewProtectionMaxAge` = 604800 s, medido el 2026-10-02 con
  // `vercel api /v9/projects/prj_FPwJQ64AizUaE2IROm18G5sdBBNB`).
  //
  // Esos 7 dias son los que hacen seguro NO recargar la pestaña en cada deploy
  // (2026-10-03, `src/lib/version/`): una pestaña vive a lo sumo 8 horas (el
  // techo del vigilante), muy por debajo del plazo. Si alguien baja Maximum Age
  // por debajo de 8 horas, las pestañas viejas vuelven a quedarse sin assets.
  //
  // Skew Protection NO sella los `fetch('/api/...')` propios del cliente: esos
  // van por `fetchPropio` (`src/lib/version/fetch-propio.ts`). Y no cubre la base
  // de datos, que es una sola: para eso esta la epoca (`src/lib/version/epoca.ts`).
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
