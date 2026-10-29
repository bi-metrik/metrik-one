import type { NextConfig } from 'next'
import { RUTA_REGISTRO_VALIDA, politicaRegistroValida } from './src/lib/valida-registro/csp'

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
  // La página donde se escribe la tarjeta (Valida, alta autogestionada) lleva su propia CSP: ningún
  // script de terceros salvo jQuery y ePayco.js. Ver `src/lib/valida-registro/csp.ts`.
  async headers() {
    return [
      {
        source: RUTA_REGISTRO_VALIDA,
        headers: [
          {
            key: 'Content-Security-Policy',
            value: politicaRegistroValida(
              process.env.NEXT_PUBLIC_SUPABASE_URL,
              process.env.NODE_ENV === 'development',
            ),
          },
        ],
      },
    ]
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
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
    },
  },
  outputFileTracingIncludes: {
    '/**/*': ['./src/lib/pdf/templates/**/*'],
    // Motor Chromium (ensayo del PR 0 de la propuesta de Trappvel). El binario comprimido de
    // @sparticuz/chromium (~67 MB) se lee por ruta en tiempo de ejecucion y el trazado no lo
    // ve solo; va acotado a esta ruta, nunca a '/**/*'. Las fuentes y el fixture, igual.
    '/api/interno/ensayo-chromium': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './src/lib/pdf/chromium/fuentes/**/*',
      './src/lib/pdf/chromium/ensayo/**/*',
    ],
    // Motor `html` de la propuesta de viaje (PR 2): la acción del PDF corre en la función de la
    // página del editor de la cotización, que es a la que el navegador le manda la server action.
    // Solo esa ruta carga el binario y las fuentes. La llave se compara con «contains» contra la
    // ruta normalizada (`/app/negocios/[id]/cotizacion/[cotId]`).
    // La instrucción del motor de extracción (un .md por versión) se lee por ruta en la acción
    // «Extraer con el motor» de la ficha del proveedor.
    '/proveedores/*': ['./src/lib/proveedores/instruccion/**/*'],
    '/negocios/*/cotizacion/*': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './src/lib/pdf/chromium/fuentes/**/*',
    ],
    // Plantillas editables de documentos (DJ, Relación de facturas; 2026-10-29). Con una versión
    // activa, `generarFormulario` imprime con Chromium: la server action corre en la función de
    // la página del negocio. `/negocios/*` (con «contains») cubre `/negocios/[id]`. La vista
    // previa en PDF corre en su propia ruta.
    '/negocios/*': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './src/lib/pdf/chromium/fuentes/**/*',
    ],
    '/api/plantillas-documento/*': [
      './node_modules/@sparticuz/chromium/bin/**/*',
      './src/lib/pdf/chromium/fuentes/**/*',
    ],
  },
  // Se cargan con require de Node, no por el bundler: @sparticuz/chromium ubica su binario
  // relativo a su propio paquete y puppeteer-core trae dependencias opcionales nativas.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
}

export default nextConfig
