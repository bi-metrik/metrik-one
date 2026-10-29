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

/**
 * Fecha corta `DD/MM/AAAA`: `2026-03-15` → `15/03/2026`. Es el formato que pide la
 * ficha de la Relación de facturas (plantilla SOE-033) para la fecha de expedición
 * de la factura y la del certificado UPME.
 *
 * Mismo criterio que `fechaLarga`: se parsea con expresión regular para no correrse un
 * día por zona horaria, y lo que no viene en ISO se devuelve tal cual.
 */
export function fechaCorta(v: string | null | undefined, marcador = '—'): string {
  const raw = v?.trim()
  if (!raw) return marcador
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return raw
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Valor redondeado al múltiplo de mil más cercano (art. 577 del Estatuto Tributario:
 * los valores de las declaraciones se aproximan al múltiplo de mil más cercano).
 * Devuelve el número, o null si el texto no es numérico.
 */
export function redondearAlMil(v: string | null | undefined): number | null {
  if (!v) return null
  const n = Number(v)
  if (isNaN(n)) return null
  return Math.round(n / 1000) * 1000
}

/**
 * «IVA solicitado, aproximado al mil»: `1234499` → `$ 1.234.000`, `1234500` →
 * `$ 1.235.000`. Es la cifra que la declaración juramentada (CUARTO) y la Relación
 * de facturas (ficha y totales) piden desde la plantilla del 2026-10-28 (SOE-033);
 * el «IVA pagado» de la factura sigue saliendo exacto.
 *
 * Sin valor → el marcador. Un texto no numérico se devuelve TAL CUAL, igual que
 * `fmtCurrency`: el operador ve el dato crudo y lo corrige.
 */
export function fmtAlMil(v: string | null | undefined, marcador = '—'): string {
  if (!v) return marcador
  const n = redondearAlMil(v)
  if (n == null) return v
  return fmtCurrency(String(n), marcador)
}

/**
 * Tarifa de IVA pagada, derivada de la factura: `valor_iva / valor_unitario_sin_iva`
 * redondeada a un entero porcentual (`5 %`, `19 %`). La extracción no trae la tarifa
 * como dato propio, y la plantilla de la Relación (SOE-033) la pide.
 *
 * Si alguno de los dos valores falta, no es numérico o la base es cero, devuelve el
 * marcador: una tarifa inventada en un documento que va a la DIAN es peor que una
 * casilla que el operador ve vacía.
 */
export function tarifaIva(
  valorIva: string | null | undefined,
  baseSinIva: string | null | undefined,
  marcador = '—',
): string {
  if (!valorIva || !baseSinIva) return marcador
  const iva = Number(valorIva)
  const base = Number(baseSinIva)
  if (!isFinite(iva) || !isFinite(base) || base <= 0 || iva < 0) return marcador
  return `${Math.round((iva / base) * 100)} %`
}

/**
 * Día, mes y año de la generación del documento EN BOGOTÁ.
 *
 * `fechaGeneracion` llega como `new Date().toISOString()`, o sea en UTC: leído con
 * `getUTCDate()` un documento generado después de las 7 p. m. salía fechado al día
 * siguiente. Colombia no tiene horario de verano, así que basta con restar 5 horas.
 *
 * Una fecha sola (`2026-09-07`) se toma tal cual: no lleva hora, y restarle 5 horas
 * la haría retroceder un día.
 */
export function fechaDeGeneracion(iso: string): { dia: number; mes: string; anio: number } {
  const raw = iso.trim()
  const d = new Date(raw)
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const bogota = soloFecha ? d : new Date(d.getTime() - 5 * 60 * 60 * 1000)
  return {
    dia: bogota.getUTCDate(),
    mes: MESES[bogota.getUTCMonth()] ?? '',
    anio: bogota.getUTCFullYear(),
  }
}
