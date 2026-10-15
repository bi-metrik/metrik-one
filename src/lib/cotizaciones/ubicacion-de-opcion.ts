/**
 * Dónde quedó una opción aceptada desde la bandeja, como se ve en Componentes: «Hotel en
 * Providencia · Opción 2», «… como habitación 3». Puro: lo usan la aceptación de a una
 * (`terminarAceptacion`) y el lote, que la calcula una vez al final (H3 de la verificación D).
 */

import { normalizarGrupo } from './itinerarios'
import { etiquetaDeRanura } from './ranuras-pantallazo'

/** «Hotel en Providencia» y «2». */
export function ubicacionDeOpcion(lineas: readonly Record<string, unknown>[], itemId: string): { bloque: string; opcion: number | null } {
  const linea = lineas.find(l => l.id === itemId)
  const grupo = normalizarGrupo((linea?.grupo ?? null) as string | null)
  if (!linea || !grupo) return { bloque: 'Componentes', opcion: null }
  const hermanas = lineas.filter(l => l.es_ajuste !== true && normalizarGrupo((l.grupo ?? null) as string | null) === grupo)
  return { bloque: etiquetaDeRanura(grupo), opcion: hermanas.findIndex(l => l.id === itemId) + 1 }
}

/** El texto de la fila: el bloque, la opción y, si entró como habitación, cuál. */
export function dondeQuedoLaOpcion(
  lineas: readonly Record<string, unknown>[] | null,
  itemId: string,
  entrada: { como: string; habitacionNumero?: number | null },
): { donde: string; bloque: string; opcion: number | null } {
  const { bloque, opcion } = lineas ? ubicacionDeOpcion(lineas, itemId) : { bloque: 'Componentes', opcion: null }
  const lugar = opcion ? `${bloque} · Opción ${opcion}` : bloque
  const habitacion = entrada.como === 'habitacion'
    ? ` como habitación${entrada.habitacionNumero ? ` ${entrada.habitacionNumero}` : ''}`
    : ''
  return { donde: `${lugar}${habitacion}`, bloque, opcion }
}
