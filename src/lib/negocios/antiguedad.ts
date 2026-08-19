/**
 * Antigüedad en días de un registro, para seguimiento de cartera.
 *
 * El reloj entra como PARÁMETRO, no se lee adentro. Dos razones:
 *
 *  1. Testeable sin congelar el reloj global ni tolerar rangos.
 *  2. Quien llama puede tomar UNA marca de tiempo para todo un lote. Si cada fila
 *     llamara a `Date.now()` por su cuenta, dos negocios creados en el mismo instante
 *     podrían salir con antigüedades distintas cuando el recorrido cruza la medianoche.
 *
 * Se cuentan días CUMPLIDOS (24 h completas), que es como los lee una persona: un caso
 * creado ayer a las 11 p.m. lleva "0 días" hasta que pasen 24 horas, no "1 día" porque
 * cambió la fecha del calendario.
 */

const MS_POR_DIA = 24 * 60 * 60 * 1000

/**
 * Días cumplidos entre `desdeIso` y `ahora`. `null` si no hay fecha o no se puede leer:
 * un dato ausente se muestra como ausente, nunca como cero. Un cero dice "recién
 * creado" y sería una afirmación falsa sobre algo que no sabemos.
 *
 * Una fecha futura da 0, no un negativo: puede pasar por desfase de reloj entre el
 * servidor y la base, y "-1 días" en una pantalla de cartera no significa nada.
 */
export function diasDesde(desdeIso: string | null | undefined, ahora: number): number | null {
  if (!desdeIso) return null
  const inicio = new Date(desdeIso).getTime()
  if (!Number.isFinite(inicio) || !Number.isFinite(ahora)) return null
  return Math.max(0, Math.floor((ahora - inicio) / MS_POR_DIA))
}

/**
 * El número en palabras del equipo. `null` → cadena vacía, para que quien pinta no
 * tenga que decidir qué hacer con un dato que no existe.
 */
export function etiquetaAntiguedad(dias: number | null | undefined): string {
  if (dias == null) return ''
  if (dias === 0) return 'hoy'
  return dias === 1 ? '1 día' : `${dias} días`
}

/** Lo mínimo que hay que saber de una fila de cartera para ordenarla. */
export interface FilaOrdenable {
  dias_desde_creacion: number | null
  /** `> 0` falta plata, `< 0` sobra. Solo se usa para desempatar. */
  saldo: number
}

/**
 * Comparador de la lista de Saldos: primero lo más VIEJO, y el monto solo desempata.
 *
 * Ordenar por monto no ordenaba nada. Medido en SOENA el 2026-08-18: de los 119
 * faltantes abiertos, **70 valen exactamente $637.500** (el precio estándar con 25% de
 * descuento) y otros 16 valen $850.000. Son 86 de 119 en dos grupos idénticos, y dentro
 * de cada grupo el orden quedaba al azar — el caso de 174 días salía mezclado con uno de
 * 12 porque debían la misma cifra. La antigüedad sí discrimina: va de 3 a 260 días.
 *
 * El desempate es por **valor absoluto** del saldo, para que sirva a los dos signos. El
 * orden anterior (`b.saldo - a.saldo`) dejaba los SOBRANTES del más chico al más grande,
 * y esa es justo la pestaña que abre por defecto.
 *
 * Sin fecha de creación (`null`) se va al final: una antigüedad desconocida no es una
 * antigüedad grande, y ponerla arriba manda a perseguir lo que no se sabe si urge.
 *
 * Puro: no toca DB, red ni reloj.
 */
export function compararPorAntiguedad(a: FilaOrdenable, b: FilaOrdenable): number {
  const diasA = a.dias_desde_creacion ?? -1
  const diasB = b.dias_desde_creacion ?? -1
  return diasB - diasA || Math.abs(b.saldo) - Math.abs(a.saldo)
}
