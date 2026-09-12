import type { Metadata } from 'next'
import { headers } from 'next/headers'
import {
  DESCRIPCION_SITIO,
  TARJETA_OG,
  TITULO_SITIO,
  rutaTarjetaInquilino,
} from '@/lib/marca/og'
import { brandingInquilino } from '@/lib/tenant/branding-inquilino'
import { extractSlug } from '@/lib/tenant/extract-slug'
import LoginClient from './login-client'

type Busqueda = Promise<Record<string, string | string[] | undefined>>

// El slug lo pasa el middleware (edge, host correcto) por rewrite (?__ws=slug),
// porque en la funcion serverless que renderiza /login el host NO es el
// subdominio del cliente. Fallbacks: header x-tenant-slug y, en dev local, host.
async function slugDelInquilino(searchParams: Busqueda): Promise<string | null> {
  const h = await headers()
  const sp = await searchParams
  const wsParam = typeof sp?.__ws === 'string' ? sp.__ws : ''
  return (
    wsParam ||
    h.get('x-tenant-slug') ||
    extractSlug(h.get('x-forwarded-host') || h.get('host') || '')
  )
}

// Al pegar el enlace de un subdominio en WhatsApp o LinkedIn, el rastreador
// aterriza AQUI: todo subdominio sin sesion redirige a /login. Por eso la
// tarjeta por inquilino se declara en esta pagina y no en el layout raiz, que
// sirve por igual al dominio base y a los 17 subdominios.
//
// Sin logo que mostrar NO se arma tarjeta propia: devolver `{}` hace que se
// herede la generica del layout raiz. Aplica a un workspace que no existe, al
// slug que no se pudo resolver y a los dos inquilinos que todavia no han
// subido logo. Media tarjeta (placa vacia) seria peor que la generica.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Busqueda
}): Promise<Metadata> {
  const slug = await slugDelInquilino(searchParams)
  if (!slug) return {}

  const branding = await brandingInquilino(slug)
  if (!branding?.logoUrl) return {}

  const imagen = rutaTarjetaInquilino(slug)

  // `openGraph` NO se fusiona campo a campo con el del padre: si esta pagina lo
  // declara, lo reemplaza entero. Por eso se repiten titulo y descripcion, que
  // salen de la misma fuente que usa el layout raiz.
  return {
    openGraph: {
      type: 'website',
      locale: 'es_CO',
      siteName: TITULO_SITIO,
      title: TITULO_SITIO,
      description: DESCRIPCION_SITIO,
      images: [
        {
          url: imagen,
          width: TARJETA_OG.ancho,
          height: TARJETA_OG.alto,
          type: 'image/png',
          // El alt NO nombra al cliente: la tarjeta ya se explica sola con su
          // logo y su subdominio, y el nombre viajaria en cada reenvio.
          alt: 'MéTRIK one: tus números claros para tomar mejores decisiones',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: TITULO_SITIO,
      description: DESCRIPCION_SITIO,
      images: [imagen],
    },
  }
}

// El login del subdominio muestra el logo del cliente. Se resuelve server-side
// desde el slug del tenant (sin sesion): slug -> workspace -> name + logo_url.
// Solo esos dos campos cruzan al browser; el service role nunca sale del servidor.
// `brandingInquilino` va envuelto en `cache()`, asi que esta lectura y la de
// `generateMetadata` son UNA sola consulta por peticion.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Busqueda
}) {
  const slug = await slugDelInquilino(searchParams)
  const tenantBranding = slug ? await brandingInquilino(slug) : null

  return <LoginClient tenantBranding={tenantBranding} />
}
