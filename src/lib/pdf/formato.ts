/**
 * Formatos compartidos por los PDF del expediente (moneda y fecha).
 *
 * Vivían copiados dentro de `relacion-facturas-pdf.tsx`. Al escribir la
 * declaración juramentada nueva —que imprime los MISMOS dos valores de la misma
 * factura, el valor sin IVA y el IVA— duplicarlos habría dejado dos criterios
 * sobre la misma cifra: dos documentos del mismo expediente que la DIAN lee
 * juntos no pueden formatear distinto el mismo peso.
 */

export const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/**
 * Pesos colombianos sin decimales: `$ 86.380.952`.
 *
 * El valor llega como texto desde la extracción; si no es numérico se devuelve
 * TAL CUAL (nunca "NaN"), porque en un documento que va a la DIAN es preferible
 * que el operador vea el dato crudo y lo corrija a que vea un error de programa.
 */
export function fmtCurrency(v: string | null | undefined, marcador = '—'): string {
  if (!v) return marcador
  const n = Number(v)
  if (isNaN(n)) return v
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n)
}

/**
 * Fecha legible en español: `2026-03-15` → `15 de marzo de 2026`.
 *
 * Se parsea con expresión regular, NO con `new Date(...)`: `new Date('2026-03-15')`
 * es medianoche UTC y en Bogotá (UTC-5) retrocede un día al leerlo en local. Una
 * fecha de adquisición corrida un día contradice la factura adjunta.
 *
 * Si el valor no viene en ISO se devuelve tal cual: la extracción es la que manda
 * y un texto crudo es corregible; "Invalid Date" no.
 */
export function fechaLarga(v: string | null | undefined, marcador = '—'): string {
  const raw = v?.trim()
  if (!raw) return marcador
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return raw
  const mes = MESES[Number(m[2]) - 1]
  if (!mes) return raw
  return `${Number(m[3])} de ${mes} de ${Number(m[1])}`
}
