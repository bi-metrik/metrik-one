/**
 * El TOPE del presupuesto que dijo el cliente (decisión de Mauricio del 2026-11-06 sobre M-H2-2: la
 * Recomendada de un bloqueo es «la de mejor experiencia dentro del presupuesto», regla de Trappvel del
 * 2026-09-14).
 *
 * El dato vive en la solicitud (`negocio_bloques.data->presupuesto`), un select de Trappvel con rangos
 * para TODO el viaje, no por persona: `menos_3m`, `3m_5m`, `5m_8m`, `8m_12m`, `12m_20m`, `mas_20m`,
 * `sin_definir` (sus etiquetas: «Entre $8 y $12 millones», «Más de $20 millones»…). También se lee la
 * etiqueta o un texto escrito a mano («9 a 10 millones», «12.000.000»).
 *
 * «Dentro del presupuesto» = el total al cliente NO pasa del techo del rango. Lo de abajo del rango
 * también cabe en el bolsillo: el piso no excluye a nadie.
 *
 * Devuelve:
 *  · el techo en pesos;
 *  · `Infinity` si el rango no tiene techo («Más de $20 millones»): todo cabe;
 *  · `null` si no hay presupuesto, es «sin definir» o no se entiende (quien llama usa la regla de antes).
 */
export function topeDelPresupuesto(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? enPesos(valor) : null
  if (typeof valor !== 'string') return null
  const t = valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  if (t === '') return null
  if (/sin[ _]definir|no tiene|no sabe|sin presupuesto/.test(t)) return null
  if (/^mas_|\bmas de\b/.test(t)) return Infinity
  const numeros = (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map(leerNumero).filter((n): n is number => n !== null && n > 0)
  if (numeros.length === 0) return null
  return enPesos(Math.max(...numeros))
}

/** «12.000.000» y «12,000,000» son miles; «8,5» y «8.5» son decimales. */
function leerNumero(s: string): number | null {
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ''))
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Un número chico son millones («8m», «$12 millones»); uno grande ya son pesos. */
function enPesos(n: number): number {
  return n < 1000 ? Math.round(n * 1_000_000) : n
}
