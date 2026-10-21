/**
 * Lo que el PDF de Trappvel escribe con Helvetica (WinAnsi): las flechas que no existen en esa
 * fuente se cambian por un guion largo antes de pintar.
 *
 * Re-verificación D (Vera, 2026-10-14): «Avianca Bogotá ⇄ San Andrés» salía «Bogotá Ä San Andrés».
 * Helvetica no tiene «⇄» (U+21C4) y `@react-pdf` escribe el byte bajo del carácter: 0xC4 es «Ä».
 * Lo mismo pasa con «→» (0x92, una comilla). Solo se tocan esos caracteres: un texto que ya se
 * imprimía bien sale exactamente igual (comillas, rayas, tildes, «·» y «€» son WinAnsi).
 */

/** Las flechas: en el documento separan dos lugares, como el guion largo de las rutas. */
const FLECHAS = /[←-⇿⟰-⟿⤀-⥿]/g

/** La misma clase sin `g`: `test` con `g` guarda la posición entre llamadas. */
const HAY_FLECHA = /[←-⇿⟰-⟿⤀-⥿]/

export function textoParaHelvetica(v: string): string {
  return v.replace(FLECHAS, '–')
}

/**
 * Lo mismo en todas las props del documento (textos dentro de objetos y listas). Lo que no es
 * texto, o no es un objeto plano (un Buffer, una fecha), pasa igual.
 */
export function propsParaHelvetica<T>(v: T): T {
  if (typeof v === 'string') return (HAY_FLECHA.test(v) ? textoParaHelvetica(v) : v) as unknown as T
  if (Array.isArray(v)) return v.map(x => propsParaHelvetica(x)) as unknown as T
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = propsParaHelvetica(x)
    return out as T
  }
  return v
}
