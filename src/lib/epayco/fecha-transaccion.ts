/**
 * La fecha de un cobro de ePayco es la del PAGO, no la del registro en ONE.
 *
 * Por que existe este modulo:
 *   `registrarPagoEpayco` guardaba `cobros.fecha = todayBogotaISO()`, el dia en
 *   que alguien concilia. Como `v_venta_mes_comercial.fecha_venta` es el
 *   `min(cobros.fecha)` del negocio, una tanda de conciliacion hecha el 3 de
 *   agosto fecho como ventas de agosto plata que habia entrado en julio
 *   (medido en SOENA: V0046, V0122 y V0123). Decision de Mauricio 2026-08-18:
 *   **la venta la define la fecha del pago**.
 *
 *   ePayco si entrega ese dato (`EpaycoTransaction.transactionDate`); llegaba y
 *   se descartaba al guardar. Este modulo lo convierte al dia civil de Bogota.
 *
 * ⚠️ SUPUESTO DECLARADO, pendiente de confirmar con ePayco:
 *   una marca de tiempo SIN zona (`2026-08-03 15:36:12`) se interpreta como hora
 *   de **Bogota**, porque es lo que muestra su panel y ePayco es colombiana. El
 *   supuesto solo cambia el resultado para transacciones entre las 00:00 y las
 *   05:00, que en UTC caen el dia anterior. Si se confirma que el campo viaja en
 *   UTC, se cambia `ZONA_DEL_CRUDO` y los casos afectados son solo esos.
 *
 * Regla de diseno: **nunca inventar la fecha**. Si el crudo no se puede leer,
 * devuelve null y quien llama decide, dejando rastro. Caer de vuelta en "hoy" en
 * silencio seria reponer el mismo defecto sin que nadie lo vea.
 */

/** Zona en que se interpreta una marca de tiempo sin zona explicita. */
const ZONA_DEL_CRUDO = 'America/Bogota'

const OFFSET_BOGOTA_HORAS = 5 // UTC-5, sin horario de verano.

/** `2026-08-03 15:36:12`, `2026-08-03T15:36:12` (sin zona). */
const SIN_ZONA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/
/** `03/08/2026 15:36:12` (dia primero, formato de panel en es-CO). */
const DIA_PRIMERO = /^(\d{2})\/(\d{2})\/(\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/
/** Solo fecha: `2026-08-03`. Ya es un dia civil, no hay nada que convertir. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
/** Con zona explicita: ISO con `Z` u offset `+hh:mm` / `-hhmm`. */
const CON_ZONA = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/

/**
 * Un patron que "calza" no garantiza una fecha real: `2026-13-45 99:99:99` tiene
 * la forma correcta, y `Date.UTC` la desbordaria en silencio hasta un dia
 * valido. Se valida el rango antes de construir nada.
 */
function partesValidas(y: number, mo: number, d: number, h: number, mi: number, se: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  if (h > 23 || mi > 59 || se > 59) return false
  // Rebote: si el dia no existe en ese mes (30 de febrero), la fecha construida
  // cae en otro mes y aqui se ve.
  const prueba = new Date(Date.UTC(y, mo - 1, d))
  return prueba.getUTCFullYear() === y && prueba.getUTCMonth() === mo - 1 && prueba.getUTCDate() === d
}

function diaCivilBogota(instante: Date): string {
  // Intl proyecta el instante al calendario de Bogota sin depender de la zona
  // del proceso, que en Vercel es UTC.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_DEL_CRUDO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(instante)
}

/**
 * Convierte el `transactionDate` de ePayco al dia civil de Bogota (`YYYY-MM-DD`).
 *
 * @returns el dia, o `null` si el crudo no tiene una forma reconocible. Nunca
 *          devuelve la fecha de hoy: eso es decision de quien llama, y debe
 *          quedar registrada.
 */
export function fechaTransaccionBogota(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null

  // 1. Ya es un dia civil.
  const soloFecha = SOLO_FECHA.exec(s)
  if (soloFecha) {
    const [, y, mo, d] = soloFecha
    return partesValidas(+y, +mo, +d, 0, 0, 0) ? s : null
  }

  // 2. Trae zona explicita: se respeta y se proyecta a Bogota.
  if (CON_ZONA.test(s)) {
    const d = new Date(s.replace(' ', 'T'))
    return Number.isNaN(d.getTime()) ? null : diaCivilBogota(d)
  }

  // 3. Sin zona: se interpreta en ZONA_DEL_CRUDO. Se construye el instante UTC
  //    equivalente sumando el offset, en vez de dejar que el motor aplique la
  //    zona del proceso (que en produccion es UTC y correria el dia).
  const sinZona = SIN_ZONA.exec(s)
  if (sinZona) {
    const [, y, mo, d, h, mi, se] = sinZona
    if (!partesValidas(+y, +mo, +d, +h, +mi, se ? +se : 0)) return null
    const utc = Date.UTC(+y, +mo - 1, +d, +h + OFFSET_BOGOTA_HORAS, +mi, se ? +se : 0)
    return diaCivilBogota(new Date(utc))
  }

  // 4. Dia primero, con o sin hora.
  const diaPrimero = DIA_PRIMERO.exec(s)
  if (diaPrimero) {
    const [, d, mo, y, h, mi, se] = diaPrimero
    if (!partesValidas(+y, +mo, +d, h ? +h : 0, mi ? +mi : 0, se ? +se : 0)) return null
    const utc = Date.UTC(+y, +mo - 1, +d, (h ? +h : 0) + OFFSET_BOGOTA_HORAS, mi ? +mi : 0, se ? +se : 0)
    return diaCivilBogota(new Date(utc))
  }

  return null
}
