/**
 * «Aceptar» de la bandeja se puede repetir sin duplicar (caso Alejandra, N1 26 1, 2026-10-05).
 *
 * La bandeja reintenta un envío cuando no le llega respuesta (`bandeja-red.ts`). Para detectar
 * y leer da igual: no escriben. Para «Aceptar» no: si la petición SÍ llegó y lo que se perdió
 * fue la respuesta, repetirla crearía otra opción u otra habitación con el mismo pantallazo.
 *
 * Por eso cada «Aceptar» lleva una llave (`idAceptacion`, la misma en cada reintento y en cada
 * toque de la misma fila), el servidor la guarda en la lectura que escribe (`aceptacion`) y,
 * antes de escribir, busca si alguna línea de la cotización ya la tiene. Si la tiene, responde
 * con lo que ya quedó, sin escribir nada más.
 *
 * Si la persona deshace la habitación, la lectura se va con ella y la llave deja de aparecer:
 * aceptarla otra vez entra como nueva, que es lo que pidió.
 *
 * Puro: las líneas entran por parámetro.
 */
import { normalizarGrupo } from './itinerarios'
import { leerTarifaPax } from './tarifa-pasajero'

const FORMA = /^[A-Za-z0-9-]{8,80}$/

/** La llave que mandó el navegador, si tiene la forma de una. Otra cosa se ignora. */
export function idAceptacionValido(v: unknown): string | null {
  return typeof v === 'string' && FORMA.test(v) ? v : null
}

export type AceptacionPrevia =
  | { itemId: string; como: 'opcion'; sola: boolean }
  | { itemId: string; como: 'habitacion'; habitacionId: string }

/**
 * ¿Esta aceptación ya quedó escrita? La opción (su pantallazo 1) o la habitación que tiene la
 * llave. `sola`: la opción es la única de su bloque (entró como bloque nuevo).
 */
export function aceptacionPrevia(lineas: readonly Record<string, unknown>[], id: string | null): AceptacionPrevia | null {
  if (!id) return null
  const vivas = lineas.filter(l => l.es_ajuste !== true)
  for (const l of vivas) {
    const t = leerTarifaPax(l.tarifa_pax)
    if (t.casillas?.grupo_completo?.aceptacion === id) {
      const grupo = normalizarGrupo((l.grupo ?? null) as string | null)
      const hermanas = grupo ? vivas.filter(x => normalizarGrupo((x.grupo ?? null) as string | null) === grupo).length : 1
      return { itemId: String(l.id), como: 'opcion', sola: hermanas <= 1 }
    }
  }
  for (const l of vivas) {
    const h = leerTarifaPax(l.tarifa_pax).habitaciones?.find(x => x.lectura.aceptacion === id)
    if (h) return { itemId: String(l.id), como: 'habitacion', habitacionId: h.id }
  }
  return null
}
