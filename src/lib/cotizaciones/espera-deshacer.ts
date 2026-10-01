/**
 * «Quitar habitación» de la tarjeta se hace al vencer el «Deshacer» (6 s): la fila se va en el
 * acto, pero el total no cambia hasta que la quita se escribe. Mientras corre esa ventana, la
 * tarjeta lo dice con un aviso (ajuste de Mauricio al criterio 7 del brief del 2026-10-01).
 *
 * Aquí vive la cuenta, pura: qué habitaciones esperan, hasta cuándo, y cuántos segundos le
 * quedan a la última. La tarjeta (`tarjeta-opcion.tsx`) solo la pinta.
 */

/** Habitación que espera → hora (ms) en que vence su «Deshacer». */
export type EsperasDeshacer = ReadonlyMap<string, number>

export const SIN_ESPERAS: EsperasDeshacer = new Map()

export function agregarEspera(esperas: EsperasDeshacer, id: string, venceEn: number): EsperasDeshacer {
  const n = new Map(esperas)
  n.set(id, venceEn)
  return n
}

/** Al vencer (ya escrita) o al tocar «Deshacer». */
export function quitarEspera(esperas: EsperasDeshacer, id: string): EsperasDeshacer {
  if (!esperas.has(id)) return esperas
  const n = new Map(esperas)
  n.delete(id)
  return n
}

/**
 * Segundos que faltan para que el total cambie (los de la última en vencer), redondeados hacia
 * arriba y nunca menos de 1 mientras haya una esperando: la quita se escribe al llegar a cero y el
 * aviso se va cuando termina, no antes. `null` = nada espera y no hay aviso.
 */
export function segundosParaElTotal(esperas: EsperasDeshacer, ahora: number): number | null {
  if (esperas.size === 0) return null
  const ultima = Math.max(...esperas.values())
  return Math.max(1, Math.ceil((ultima - ahora) / 1000))
}

export function textoAvisoDeshacer(segundos: number): string {
  return `El total se actualiza cuando pase el Deshacer (${segundos} s).`
}
