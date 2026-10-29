/**
 * Las dos fechas que deciden si un CDA opera Valida, además de la aceptación de sus términos. Puro:
 * todas las fechas son 'YYYY-MM-DD' de Bogotá y `hoy` entra por parámetro.
 *
 * ## 1. El plazo para aceptar los términos (decisión de Mauricio, 2026-09-23)
 *
 * `servicios_contratados.terminos_plazo_hasta` es el ÚLTIMO día en que el espacio opera sin la
 * aceptación. Con plazo 30-sep: el 30-sep opera (con aviso), el 1-oct se pausa. `null` = sin plazo:
 * se pausa desde que existe el contrato (el comportamiento del PR #845).
 *
 * ## 2. La mora (cláusula 11 de los términos, v1.4 desde el 2026-11-06)
 *
 * Se mide sobre la cuota impaga MÁS VIEJA (la primera que lo pagado, repartido de la más vieja a la
 * más nueva, no cubre: `proximoPago`). Con vencimiento D:
 *
 *   - hasta D (inclusive), nada: la tarjeta de pago informa a quien maneja la plata;
 *   - desde D+1, aviso para TODOS los usuarios con la fecha en que se restringe (11.2);
 *   - desde D+6 (`restringido`, 11.1): se niegan las CONSULTAS NUEVAS, individuales y masivas. Se
 *     siguen viendo y descargando los reportes ya generados, y los usuarios siguen entrando;
 *   - desde D+31 (`suspendido`, 11.3: «obligaciones vencidas superiores a treinta días»): Valida se
 *     pausa entera, como desde el PR #849.
 *
 * La restricción rige desde la vigencia de la v1.4 de ESE contrato (11.4: 30 días calendario después
 * de publicado el aviso de la 13.1 en la plataforma), que sale del dato registrado
 * (`vigenciaRestriccion`: el `vigente_desde` de su versión ≥ v1.4) y no de una constante. Sin una
 * versión ≥ v1.4 registrada, el contrato no tiene restricción: sin aviso no hay cambio. La regla alcanza
 * también a las cuotas vencidas antes: una cuota con D+6 anterior a la vigencia se restringe ESE día,
 * no antes. Antes de la vigencia solo existe la regla de los 30 días (v1.3).
 *
 * Cuota que vence el 10-nov: aviso del 11-nov al 15-nov, restringido del 16-nov al 10-dic, pausa
 * desde el 11-dic. Cuota que vence el 15-oct: aviso desde el 16-oct (con la fecha 6-nov), restringido
 * desde el 6-nov, pausa desde el 15-nov.
 *
 * El pago levanta todo en la petición siguiente: nada de esto se cachea más allá del request.
 *
 * ## 3. La transición de la v1.5 (cláusula 11.7, publicada por aviso el 1-nov-2026)
 *
 * Para un contrato con una v1.5 registrada (aceptada o por aviso), los períodos que EMPIEZAN antes de la
 * vigencia de la v1.5 ({{VIGENCIA_AVISO}}, el 1-dic-2026: `vigenciaTransicion`) y no están pagados se
 * pagan a más tardar el día anterior a esa vigencia (30-nov), y «para efectos de las cláusulas 11.1 a
 * 11.3, esa es su fecha de renovación». Así que la cuota impaga más vieja, si es de un período así, se
 * mide con D = 30-nov (o su vencimiento, si fuera posterior): nada hasta el 30-nov, aviso del 1 al 5-dic,
 * consultas restringidas desde el 6-dic y pausa desde el 31-dic. «No se aplican la restricción ni la
 * suspensión por mora de las cláusulas 11.1 y 11.3 de la versión 1.4»: por eso la v1.4 deja de restringir
 * desde el 6-nov a Caquetá, Puertotest y Maxitec (cuota del 23-oct, vencida el 27-oct).
 *
 * El período sale del concepto de la cuota («periodo del 23-oct al 22-nov», `leerPeriodoEnConcepto`);
 * sin él, del vencimiento (las cuotas de los CDA vencen dentro del período que pagan, así que un
 * vencimiento anterior a la vigencia es de un período que empezó antes). Los períodos que empiezan desde
 * la vigencia siguen, por ahora, la regla de la v1.4 sobre su vencimiento (D+6 / D+31), que es más
 * tarde que la de la 11.2/11.3 de la v1.5 (renovación + 6 / + 31): los estados Suspendido por pago y
 * Cancelado de la v1.5 no son de este cambio.
 */

import type { ProximoPago } from './pago-pendiente'
import { leerPeriodoEnConcepto } from '@/lib/cobros/periodo-en-concepto'
import { DIAS_GRACIA_CICLO } from '@/lib/valida-registro/plan'

/** Días de mora que la cláusula 11.3 tolera antes de suspender (más de 30: se pausa el día 31). */
export const DIAS_MORA_ANTES_DE_SUSPENDER = 30

/** Días de mora que la cláusula 11.1 (v1.4) tolera antes de restringir las consultas nuevas. */
export const DIAS_MORA_ANTES_DE_RESTRINGIR = 5

/**
 * La vigencia ESPERADA de la cláusula 11.1 (v1.4): el aviso se publicó en la plataforma el 2026-10-07 y
 * rige 30 días calendario después (cláusula 13.1). La puerta NO decide con esta constante: usa la
 * vigencia registrada de la v1.4 de cada contrato (`vigenciaRestriccion`). Queda como valor por
 * defecto de `estadoMora` (lo usa la licencia de ONE en /suscripcion, que no se pausa por mora) y como
 * testigo: una prueba exige que el SQL de alta de la v1.4 registre exactamente esta fecha.
 */
export const RESTRICCION_VIGENTE_DESDE = '2026-11-06'

/**
 * Desde qué día de mora (contado desde el vencimiento D) se restringen las consultas nuevas y desde
 * cuál se pausa Valida entera. Cada serie de Términos trae la suya.
 */
export interface ReglaMora {
  /** D + este número: consultas nuevas restringidas, reportes abiertos. */
  diaRestriccion: number
  /** D + este número: Valida pausada entera. */
  diaPausa: number
}

/** Plan CDA: restricción por más de 5 días (11.1, v1.4) y pausa por más de 30 (11.3). */
export const REGLA_MORA_CDA: ReglaMora = { diaRestriccion: DIAS_MORA_ANTES_DE_RESTRINGIR + 1, diaPausa: DIAS_MORA_ANTES_DE_SUSPENDER + 1 }

/** Días de suspensión sin pago tras los cuales termina la suscripción de autoservicio (Términos 11.2). */
export const DIAS_SUSPENSION_ANTES_DE_TERMINAR = 30

/**
 * Términos de autoservicio v2.0: la suspensión (11.1) llega a los `DIAS_GRACIA_CICLO` (10) días y deja
 * abiertos los reportes y la exportación de la bitácora (11.2); a los 30 días de suspensión la
 * suscripción termina (11.2) y el acceso cesa (12.6). O sea: consultas restringidas desde D+10 y Valida
 * pausada desde D+40, no desde D+31 como un CDA. No depende de un aviso (la regla viene en los
 * Términos aceptados al registrarse).
 */
export const REGLA_MORA_AUTOSERVICIO: ReglaMora = {
  diaRestriccion: DIAS_GRACIA_CICLO,
  diaPausa: DIAS_GRACIA_CICLO + DIAS_SUSPENSION_ANTES_DE_TERMINAR,
}

/** La serie de los Términos de Suscripción VALIDA · Plan CDA en `documentos_contractuales_versiones`. */
export const SLUG_TERMINOS_CDA = 'terminos-suscripcion-valida-cda'

/** La primera versión de esos términos con la restricción de la cláusula 11.1. */
const VERSION_CON_RESTRICCION: readonly [number, number] = [1, 4]

/** 'v1.4' → [1, 4]; lo que no es una versión, `null`. */
function numeroDeVersion(version: string): [number, number] | null {
  const m = /^v?(\d+)\.(\d+)$/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2])] : null
}

/**
 * Desde cuándo rige la restricción para un contrato: el `vigente_desde` más temprano de sus versiones
 * de los Términos del Plan CDA que ya la traen (v1.4 o posterior), la haya aceptado o no (rige por el
 * aviso). `null` = el contrato no tiene ninguna registrada: no hay restricción, solo la pausa de los 30.
 */
export function vigenciaRestriccion(
  documentos: readonly { slug: string; version: string; vigenteDesde: string }[],
): string | null {
  const fechas = documentos
    .filter((d) => {
      if (d.slug !== SLUG_TERMINOS_CDA) return false
      const n = numeroDeVersion(d.version)
      if (!n) return false
      return n[0] > VERSION_CON_RESTRICCION[0] || (n[0] === VERSION_CON_RESTRICCION[0] && n[1] >= VERSION_CON_RESTRICCION[1])
    })
    .map((d) => d.vigenteDesde.slice(0, 10))
    .filter((f) => FECHA.test(f))
    .sort()
  return fechas[0] ?? null
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/** La primera versión de los Términos del Plan CDA con la transición de la cláusula 11.7. */
const VERSION_CON_TRANSICION: readonly [number, number] = [1, 5]

/** ¿Es una versión de los Términos del Plan CDA igual o posterior a `minima`? */
export function esVersionCdaDesde(d: { slug: string; version: string }, minima: readonly [number, number]): boolean {
  if (d.slug !== SLUG_TERMINOS_CDA) return false
  const n = numeroDeVersion(d.version)
  if (!n) return false
  return n[0] > minima[0] || (n[0] === minima[0] && n[1] >= minima[1])
}

/**
 * La vigencia de la transición de la cláusula 11.7 (v1.5) para un contrato: el `vigente_desde` más
 * temprano de sus versiones v1.5 o posteriores de los Términos del Plan CDA, la haya aceptado o no (rige
 * por el aviso). `null` = no tiene ninguna registrada (y publicada): la mora sigue la v1.4.
 */
export function vigenciaTransicion(
  documentos: readonly { slug: string; version: string; vigenteDesde: string }[],
): string | null {
  const fechas = documentos
    .filter((d) => esVersionCdaDesde(d, VERSION_CON_TRANSICION))
    .map((d) => d.vigenteDesde.slice(0, 10))
    .filter((f) => FECHA.test(f))
    .sort()
  return fechas[0] ?? null
}

/**
 * La fecha que hace de vencimiento (D) de la cuota impaga más vieja: la suya, o, si es de un período
 * que empezó antes de la vigencia de la transición, el día anterior a esa vigencia (cláusula 11.7: «esa
 * es su fecha de renovación»), si es posterior. Ver el encabezado, sección 3.
 */
export function vencimientoConTransicion(
  pago: { concepto: string | null; fechaVencimiento: string },
  transicion: string | null,
): string {
  if (!transicion || !FECHA.test(transicion)) return pago.fechaVencimiento
  const periodo = leerPeriodoEnConcepto(pago.concepto, pago.fechaVencimiento)
  const inicio = periodo?.desde && FECHA.test(periodo.desde) ? periodo.desde : pago.fechaVencimiento
  if (!(inicio < transicion)) return pago.fechaVencimiento
  const alDia = sumarDias(transicion, -1)
  return pago.fechaVencimiento > alDia ? pago.fechaVencimiento : alDia
}

/** 'YYYY-MM-DD' + n días, en calendario (sin horas ni zonas de por medio). */
export function sumarDias(iso: string, dias: number): string {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias))
  return d.toISOString().slice(0, 10)
}

/** ¿Hoy todavía está dentro del plazo para aceptar? `null` = sin plazo = no. Una fecha ilegible, no. */
export function enPlazoParaAceptar(plazoHasta: string | null | undefined, hoy: string): boolean {
  if (!plazoHasta || !FECHA.test(plazoHasta)) return false
  return hoy <= plazoHasta
}

export type EstadoMora =
  /** Sin cuota vencida (o sin cuotas): nada que decirle a todos. */
  | { estado: 'al_dia' }
  /**
   * Cuota vencida, todavía sin restricción: aviso con la fecha de la restricción (`restringeDesde`) y la
   * de la pausa. `restringeDesde` es `null` solo cuando la pausa llega antes de que rija la restricción
   * (cuotas vencidas a comienzos de octubre de 2026).
   */
  | { estado: 'en_mora'; vencio: string; restringeDesde: string | null; corteDesde: string }
  /** Más de 5 días: se niegan las consultas nuevas; el histórico sigue abierto. */
  | { estado: 'restringido'; vencio: string; restringeDesde: string; corteDesde: string }
  /** Más de 30 días: Valida se pausa hasta que el pago se registre. */
  | { estado: 'suspendido'; vencio: string; corteDesde: string }

/**
 * `vigenteDesde`: desde cuándo rige la restricción de los 5 días para este contrato (`vigenciaRestriccion`).
 * `null` = no rige: solo la pausa de los 30 días (v1.3).
 *
 * `transicion`: la vigencia de la v1.5 del contrato (`vigenciaTransicion`), o `null` sin v1.5. Con ella,
 * la cuota de un período que empezó antes se mide desde el día anterior a esa vigencia (cláusula 11.7).
 */
export function estadoMora(
  pago: ProximoPago,
  hoy: string,
  vigenteDesde: string | null = RESTRICCION_VIGENTE_DESDE,
  regla: ReglaMora = REGLA_MORA_CDA,
  transicion: string | null = null,
): EstadoMora {
  if (pago.estado !== 'pendiente') return { estado: 'al_dia' }
  const vencio = vencimientoConTransicion(pago, transicion)
  if (!FECHA.test(vencio) || !(vencio < hoy)) return { estado: 'al_dia' }
  const corteDesde = sumarDias(vencio, regla.diaPausa)
  if (corteDesde <= hoy) return { estado: 'suspendido', vencio, corteDesde }
  // La regla de los 5 días no existe antes de su vigencia, y desde ella alcanza a lo ya vencido.
  const porDias = sumarDias(vencio, regla.diaRestriccion)
  const desde = vigenteDesde === null ? null : porDias < vigenteDesde ? vigenteDesde : porDias
  const restringeDesde = desde !== null && desde < corteDesde ? desde : null
  if (restringeDesde && restringeDesde <= hoy) return { estado: 'restringido', vencio, restringeDesde, corteDesde }
  return { estado: 'en_mora', vencio, restringeDesde, corteDesde }
}

/** ¿El estado deja hacer consultas nuevas? Solo al día o en mora sin restricción. */
export function moraPermiteConsultar(m: EstadoMora): boolean {
  return m.estado === 'al_dia' || m.estado === 'en_mora'
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** '2026-09-30' → '30-sep'. Lo que no es una fecha sale tal cual. */
export function fechaDiaMes(iso: string): string {
  const m = FECHA.exec(iso)
  if (!m) return iso
  const mes = MESES[Number(m[2]) - 1]
  return mes ? `${Number(m[3])}-${mes}` : iso
}

/**
 * El texto del aviso del plazo, para todos los usuarios del espacio. `plazoHasta` es el último día en
 * que Valida opera sin la aceptación (inclusive): al terminar ese día se suspende.
 */
export function textoAvisoPlazo(plazoHasta: string): string {
  return (
    `El servicio de Valida se suspenderá al terminar el ${fechaDiaMes(plazoHasta)} ` +
    `si la persona designada por tu empresa no ha aceptado los Términos.`
  )
}

/** El texto del aviso de mora, para todos los usuarios del espacio (cláusula 11.2). Sin montos. */
export function textoAvisoMora(m: Extract<EstadoMora, { estado: 'en_mora' }>): string {
  const vencido = `Hay un pago de la suscripción vencido desde el ${fechaDiaMes(m.vencio)}.`
  if (!m.restringeDesde) {
    return `${vencido} Si no se registra, Valida se pausa desde el ${fechaDiaMes(m.corteDesde)} (cláusula 11 de los términos).`
  }
  return (
    `${vencido} Si no se registra, desde el ${fechaDiaMes(m.restringeDesde)} no se podrán hacer consultas nuevas; ` +
    `los reportes ya generados seguirán disponibles (cláusula 11 de los términos).`
  )
}

/** Lo que responde una consulta nueva (individual o masiva) con las consultas restringidas por mora. */
export function mensajeConsultasRestringidas(m: Extract<EstadoMora, { estado: 'restringido' }>): string {
  return (
    `Las consultas nuevas están restringidas desde el ${fechaDiaMes(m.restringeDesde)} por un pago de la ` +
    `suscripción vencido desde el ${fechaDiaMes(m.vencio)}. Los reportes ya generados siguen disponibles. ` +
    `Las consultas se habilitan de nuevo cuando se registre el pago.`
  )
}

/** El aviso de la restricción en `/valida`: el mensaje, más la fecha de la pausa si sigue sin pago. */
export function textoAvisoRestriccion(m: Extract<EstadoMora, { estado: 'restringido' }>): string {
  return `${mensajeConsultasRestringidas(m)} Si no se registra, Valida se pausa desde el ${fechaDiaMes(m.corteDesde)}.`
}

/** Lo que responde cualquier acción de Valida con el servicio pausado por mora. */
export function mensajeSuspendidoPorMora(m: Extract<EstadoMora, { estado: 'suspendido' }>): string {
  return (
    `Valida está pausada desde el ${fechaDiaMes(m.corteDesde)} por un pago de la suscripción vencido desde el ` +
    `${fechaDiaMes(m.vencio)}. Se reactiva cuando se registre el pago.`
  )
}
