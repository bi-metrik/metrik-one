/**
 * Textos y rutas de la vista previa al compartir un enlace (Open Graph).
 *
 * Viven aqui porque los comparten el layout raiz (tarjeta generica) y el
 * `/login` del subdominio (tarjeta por inquilino): escritos dos veces, el dia
 * que alguien corrija el titular quedaria corregido en una sola tarjeta.
 */

export const TITULO_SITIO = 'MéTRIK one'
export const DESCRIPCION_SITIO = 'Tus números claros para tomar mejores decisiones'

/** Tarjeta generica. La heredan el dominio base y todo inquilino sin logo. */
export const IMAGEN_OG_GENERICA = '/og/metrik-one-og.png'

export const TARJETA_OG = { ancho: 1200, alto: 630 } as const

/**
 * Ruta de la tarjeta de un inquilino. Sale del dominio BASE, no del subdominio:
 * el contenido depende solo del slug, asi que una sola entrada de cache sirve a
 * todos los que compartan ese enlace. `metadataBase` la vuelve absoluta.
 */
export function rutaTarjetaInquilino(slug: string): string {
  return `/api/og/${encodeURIComponent(slug)}`
}
