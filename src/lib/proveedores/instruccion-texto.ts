/**
 * La fecha de la instrucción del motor (PURO). La instrucción trae escrita la fecha en que se
 * redactó («Fecha de hoy: 2026-10-19.»); el motor la usa para decidir qué temporada está vencida
 * (L48), así que se cambia por la de HOY al mandarla. Si la instrucción no la trae, se agrega al
 * final: el motor nunca corre sin saber qué día es.
 */
const FECHA_DE_HOY = /Fecha de hoy: \d{4}-\d{2}-\d{2}/g

export function conFechaDeHoy(instruccion: string, hoy: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoy)) throw new Error(`Fecha de hoy inválida: ${hoy}`)
  if (instruccion.search(FECHA_DE_HOY) >= 0) return instruccion.replace(FECHA_DE_HOY, `Fecha de hoy: ${hoy}`)
  return `${instruccion.trimEnd()}\n\nFecha de hoy: ${hoy}.\n`
}
