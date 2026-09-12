import { NextResponse } from 'next/server'
import { IMAGEN_OG_GENERICA } from '@/lib/marca/og'
import { medirImagen } from '@/lib/og/medidas-tarjeta'
import { tarjetaInquilino } from '@/lib/og/tarjeta-inquilino'
import { brandingInquilino, slugPlausible } from '@/lib/tenant/branding-inquilino'

/**
 * Dibuja la tarjeta Open Graph de un inquilino: `/api/og/<slug>`.
 *
 * Quien la pide es el rastreador de WhatsApp o LinkedIn cuando alguien pega el
 * enlace de un subdominio. Llega SIN sesion, asi que la ruta es publica (el
 * middleware la deja pasar de forma explicita) y no expone nada que el propio
 * `/login` del subdominio no muestre ya: el logo del cliente y su subdominio.
 *
 * Vive en el dominio base y no en el subdominio para que el contenido dependa
 * SOLO del slug de la ruta y el CDN pueda guardar una sola copia por inquilino.
 *
 * Cuando no hay tarjeta propia que dibujar (workspace inexistente, sin logo, o
 * un logo que no se puede leer) NO se inventa una: se manda a la generica. Un
 * enlace sin vista previa es peor que una vista previa generica.
 */

/** Tope defensivo: un logo de mas de esto no es un logo. */
const LOGO_BYTES_MAXIMO = 8 * 1024 * 1024
const LOGO_TIMEOUT_MS = 5_000

/**
 * La caida a la generica se cachea CORTO a proposito: el caso tipico es un
 * workspace al que todavia no le han subido el logo, y cuando se lo suban la
 * tarjeta tiene que aparecer sin esperar un dia.
 */
const CACHE_GENERICA = 'public, max-age=300, s-maxage=300'

function aLaGenerica(req: Request) {
  const res = NextResponse.redirect(new URL(IMAGEN_OG_GENERICA, req.url), 302)
  res.headers.set('Cache-Control', CACHE_GENERICA)
  return res
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  if (!slugPlausible(slug)) return aLaGenerica(req)

  const branding = await brandingInquilino(slug)
  if (!branding?.logoUrl) return aLaGenerica(req)

  let bytes: Uint8Array
  try {
    const respuesta = await fetch(branding.logoUrl, {
      signal: AbortSignal.timeout(LOGO_TIMEOUT_MS),
    })
    if (!respuesta.ok) return aLaGenerica(req)
    const buffer = await respuesta.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > LOGO_BYTES_MAXIMO) {
      return aLaGenerica(req)
    }
    bytes = new Uint8Array(buffer)
  } catch {
    // Red caida, timeout o URL invalida: el enlace igual tiene que verse.
    return aLaGenerica(req)
  }

  // El mime y las medidas salen de los BYTES, no de la cabecera de la respuesta:
  // el alto de la placa es fijo y el ancho se calcula con la proporcion real.
  const medida = medirImagen(bytes)
  if (!medida) return aLaGenerica(req)

  const dataUri = `data:${medida.mime};base64,${Buffer.from(bytes).toString('base64')}`

  try {
    return tarjetaInquilino({ slug, logo: { dataUri, medida } })
  } catch {
    return aLaGenerica(req)
  }
}
