/**
 * El eslabón que faltaba entre un contrato de servicio y su cobro: qué contrato se enrola, con qué
 * ancla de trial y con qué calendario de cuotas. **Puro.**
 *
 * Spec: `proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md`, bloque C. Autorizado por
 * Mauricio el 2026-09-28. Lo escribe la base con `enrolar_cobro_por_ciclo`
 * (`20260929010000_enrolamiento_cobro_por_ciclo.sql`) y lo corre el paso 6a del cron diario.
 *
 * ## Las tres decisiones que este archivo hace cumplir
 *
 *   1. **El ancla del trial es la ACEPTACIÓN de los términos**, no la creación del espacio ni la
 *      fecha que alguien digite. `fin_trial = fecha de la aceptación (en Bogotá) + dias_trial`.
 *   2. **El trial no se extiende solo.** El ancla es la aceptación MÁS VIEJA del contrato: aceptar
 *      una versión nueva de los términos no corre la fecha. Y una vez enrolado, el acta es
 *      inmutable: recalcular con otro `dias_trial` no cambia nada.
 *   3. **Nadie se cobra dos veces el mismo ciclo.** Un contrato con acta no se vuelve a enrolar, y
 *      un negocio que ya tiene plan de cobro (los que hoy se cargan a mano) no recibe otro.
 *
 * ## Por qué el calendario se calcula aquí y no en SQL
 *
 * Porque es lo único que tiene casos raros —el 31 de un mes que no tiene 31, el período que va en
 * el concepto de cada cuota— y en TypeScript eso se prueba. La base no confía: `enrolar_cobro_por_ciclo`
 * rechaza el calendario que no arranque el día en que termina el trial, con números no consecutivos,
 * con un monto en cero o con vencimientos que no crezcan.
 *
 * ## El alcance es una lista corta, y es a propósito
 *
 * `MODULOS_CON_ENROLAMIENTO_AUTOMATICO` tiene dos llaves: `radar_secop` (2026-09-28) y
 * `valida_consulta` (decisión de Mauricio del 2026-10-09, fila A de
 * `proyectos/metrik/valida/docs/crecimiento-mrr/10-decisiones-mauricio.md`: el cobro de Valida se
 * renueva solo cada mes, sin permanencia). Las licencias de Clarity y Sustenta siguen con sus planes
 * cargados a mano: enrolarlas emitiría cobros que nadie autorizó. Sumar un módulo a esa lista es una
 * línea de código **y una decisión de Mauricio**, no un efecto secundario de este eslabón.
 *
 * Los cuatro CDA de Valida que ya tienen plan cargado a mano no se enrolan (`plan_existente`): su
 * paso a la renovación continua es un script aparte que enciende `auto_renovar` en SU plan, y la
 * renovación (`renovar-ciclo.ts`) la hace el paso 6b del cron.
 */

/** Los módulos cuyo cobro por ciclo lo enrola el cron. Ver la cabecera antes de agregar uno. */
export const MODULOS_CON_ENROLAMIENTO_AUTOMATICO = ['radar_secop', 'valida_consulta'] as const

/**
 * La pasarela del enlace de un módulo cuando el espacio cobrador no declara una
 * (`config_extra.cobros.pasarela_en_linea`). Valida cobra por enlace de Bold mientras no exista el
 * cobro recurrente a tarjeta (ePayco, decisión 7): `metrik` no tiene pasarela en su configuración y
 * ponérsela encendería el enlace automático a TODO plan `manual` del espacio, no solo a Valida.
 */
export const PASARELA_DE_ENLACE_POR_MODULO: Readonly<Record<string, string>> = { valida_consulta: 'bold' }

/** Meses que se enrolan de una vez. Renovar más allá del año es un acto explícito. */
export const CUOTAS_POR_ENROLAMIENTO = 12

export const FRECUENCIA_ENROLAMIENTO = 'mensual'

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' + n días, en calendario. */
export function sumarDias(iso: string, dias: number): string {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias)).toISOString().slice(0, 10)
}

/**
 * 'YYYY-MM-DD' + n meses, con el día TOPADO al último del mes destino: el 31-ene + 1 mes es el
 * 28-feb, no el 3-mar. Sin esto, un contrato que arranca el 31 saltaría de mes y el cliente vería
 * dos cuotas en marzo.
 */
export function sumarMeses(iso: string, meses: number): string {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const destino = new Date(Date.UTC(y, mes - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth(), Math.min(dia, ultimo)))
    .toISOString()
    .slice(0, 10)
}

/** '2026-10-04' → '4-oct'. Es la forma que lee `leerPeriodoEnConcepto`. */
export function diaMes(iso: string): string {
  const m = FECHA.exec(iso)
  if (!m) return iso
  return `${Number(m[3])}-${MESES[Number(m[2]) - 1]}`
}

/**
 * La fecha en que termina el trial: el día de Bogotá en que se aceptaron los términos, más
 * `diasTrial` días. `anclaAt` es un instante UTC (`respondido_at` de la base).
 *
 * Con la aceptación del 2026-09-29 a las 02:00 UTC (21:00 del 28-sep en Bogotá) y 5 días, el trial
 * termina el 3-oct, no el 4: el día que cuenta es el que vio el cliente.
 */
export function finDelTrial(anclaAt: string, diasTrial: number): string {
  const t = Date.parse(anclaAt)
  if (Number.isNaN(t)) throw new Error(`ancla inválida: ${anclaAt}`)
  // Bogotá es UTC-5 todo el año (sin horario de verano desde 1993).
  const enBogota = new Date(t - 5 * 3_600_000).toISOString().slice(0, 10)
  return sumarDias(enBogota, Math.trunc(diasTrial))
}

export interface CuotaAEnrolar {
  numero: number
  monto: number
  fecha_vencimiento: string
  concepto_detalle: string
}

export interface PlanAEnrolar {
  monto: number
  frecuencia: string
  fecha_inicio: string
  fecha_fin: string
  total_cuotas: number
  pasarela: string
  concepto_detalle_template: string
  notas: string
}

/**
 * El calendario: `total` cuotas mensuales del mismo monto, la primera el día en que termina el
 * trial. El concepto de cada cuota trae el período que paga, en la forma sin año de la redacción
 * fiscal (`periodo del 4-oct al 3-nov`), que es la que `leerPeriodoEnConcepto` entiende y la que
 * viaja a la pantalla de pago de la pasarela.
 */
export function cuotasDelCiclo(p: {
  finTrial: string
  monto: number
  total: number
  nombreServicio: string
}): CuotaAEnrolar[] {
  const cuotas: CuotaAEnrolar[] = []
  for (let n = 1; n <= p.total; n++) {
    const vence = sumarMeses(p.finTrial, n - 1)
    const hasta = sumarDias(sumarMeses(p.finTrial, n), -1)
    cuotas.push({
      numero: n,
      monto: p.monto,
      fecha_vencimiento: vence,
      concepto_detalle:
        `Suscripción ${p.nombreServicio} — servicio de computación en la nube (SaaS) · ` +
        `periodo del ${diaMes(vence)} al ${diaMes(hasta)}`,
    })
  }
  return cuotas
}

/** Lo que el servidor sabe de un contrato candidato a enrolarse. */
export interface ContratoCandidato {
  id: string
  workspaceId: string
  negocioId: string
  estado: string
  servicioSlug: string
  /** Nombre del tipo de servicio en el catálogo, para el concepto de las cuotas. */
  nombreServicio: string
  /** Módulo del catálogo: decide si este eslabón lo toca (ver la cabecera). */
  modulo: string
  disparadorCobro: string
  /** `servicios_contratados.parametros`, lo pactado con este cliente. */
  parametros: Record<string, unknown> | null
  /** `dias_trial.por_defecto` de la ficha del catálogo. `null` si la ficha no lo declara. */
  diasTrialFicha: number | null
  /** `respondido_at` de la aceptación MÁS VIEJA del contrato. `null` = todavía no aceptó. */
  anclaAt: string | null
  /** Ya tiene acta de enrolamiento. */
  yaEnrolado: boolean
  /** Su negocio ya tiene un plan de cobro (cargado a mano o por una corrida anterior). */
  tienePlan: boolean
  /** La pasarela en línea con que se le va a generar el enlace. `null` = no hay. */
  pasarela: string | null
}

export type MotivoNoEnrolar =
  | 'modulo_no_automatico'
  | 'no_es_por_ciclo'
  | 'estado'
  | 'ya_enrolado'
  | 'plan_existente'
  | 'sin_aceptacion'
  | 'sin_precio'
  | 'sin_dias_trial'
  | 'sin_pasarela'

export type Plan =
  | { tipo: 'enrolar'; anclaAt: string; diasTrial: number; finTrial: string; plan: PlanAEnrolar; cuotas: CuotaAEnrolar[] }
  | { tipo: 'no'; motivo: MotivoNoEnrolar }

function entero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : null
}

/**
 * ¿Este contrato se enrola hoy, y con qué? Un motivo por cada «no»: el cron los cuenta, y un
 * contrato que no se enrola tiene que poder explicarse sin abrir la base.
 *
 * Nada de esto usa la fecha de hoy: el calendario sale del ANCLA. Un contrato que aceptó hace tres
 * semanas y nunca se enroló (porque faltaba la pasarela, digamos) nace con su cuota 1 vencida, que
 * es la verdad, y no con un trial nuevo desde hoy.
 */
export function planearEnrolamiento(c: ContratoCandidato): Plan {
  if (!(MODULOS_CON_ENROLAMIENTO_AUTOMATICO as readonly string[]).includes(c.modulo)) {
    return { tipo: 'no', motivo: 'modulo_no_automatico' }
  }
  if (c.disparadorCobro !== 'ciclo') return { tipo: 'no', motivo: 'no_es_por_ciclo' }
  if (c.estado !== 'activo') return { tipo: 'no', motivo: 'estado' }
  if (c.yaEnrolado) return { tipo: 'no', motivo: 'ya_enrolado' }
  if (c.tienePlan) return { tipo: 'no', motivo: 'plan_existente' }
  if (!c.anclaAt) return { tipo: 'no', motivo: 'sin_aceptacion' }

  const monto = entero(c.parametros?.precio_mensual)
  // Un precio ausente no se completa con el de la ficha: el precio pactado es del contrato, y el de
  // lista cobraría a Fabri $20.000 en vez de los $15.000 de su descuento de fundador.
  if (monto === null || monto <= 0) return { tipo: 'no', motivo: 'sin_precio' }

  // Los días de trial SÍ pueden venir de la ficha: `por_defecto` es exactamente eso. Si no están en
  // ninguna de las dos, no se inventan (un 0 silencioso cobraría el día de la aceptación).
  const diasTrial = entero(c.parametros?.dias_trial) ?? c.diasTrialFicha
  if (diasTrial === null || diasTrial < 0) return { tipo: 'no', motivo: 'sin_dias_trial' }

  // Sin pasarela en línea el enlace no se puede generar, y un plan sin enlace deja al cliente con
  // una cuota vencida y nada que oprimir. Se espera a que la pasarela exista.
  if (!c.pasarela) return { tipo: 'no', motivo: 'sin_pasarela' }

  const finTrial = finDelTrial(c.anclaAt, diasTrial)
  const total = CUOTAS_POR_ENROLAMIENTO
  const cuotas = cuotasDelCiclo({ finTrial, monto, total, nombreServicio: c.nombreServicio })
  return {
    tipo: 'enrolar',
    anclaAt: c.anclaAt,
    diasTrial,
    finTrial,
    plan: {
      monto,
      frecuencia: FRECUENCIA_ENROLAMIENTO,
      fecha_inicio: finTrial,
      fecha_fin: cuotas[cuotas.length - 1].fecha_vencimiento,
      total_cuotas: total,
      pasarela: c.pasarela,
      concepto_detalle_template: `Suscripción ${c.nombreServicio}`,
      notas:
        `Enrolado automáticamente el trial de ${diasTrial} día(s) anclado a la aceptación de los ` +
        `términos (${c.anclaAt}). Contrato ${c.id}.`,
    },
    cuotas,
  }
}
