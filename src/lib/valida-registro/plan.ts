/**
 * El plan pagado de una cuenta de Valida que nació en el registro autogestionado. Puro.
 *
 * `18-recorrido-baja-friccion.md`, PR 5 a 7. Lo que decide este archivo:
 *
 *   1. **Cuánto cabe en un mes.** El plan de $150.000 (decisión F, precio único) trae un LÍMITE
 *      TÉCNICO de consultas por mes: 3.000 por defecto (Mauricio, 2026-10-11). No es un paquete con
 *      excedente: al llegar al límite Valida responde `402 bolsa_agotada` hasta el ciclo siguiente.
 *      Es configurable sin PR, en este orden:
 *        a. `servicios_contratados.parametros.limite_consultas_mes` del contrato (lo pactado con ESE
 *           cliente: subirle el límite a uno es editar su contrato, con su fila en la bitácora);
 *        b. `VALIDA_PLAN_LIMITE_MES` en el entorno (el valor para todos los contratos que no lo traen);
 *        c. 3.000.
 *      Un valor fuera de [1, 20.000] se ignora y cae al siguiente: Valida topa el pedido en 20.000.
 *
 *   2. **Qué ciclo abre un pago.** Cada cuota pagada abre en Valida UNA bolsa de `limite` consultas
 *      con la referencia `one-ciclo:<cobro>` (idempotente: el mismo pago dos veces abre una sola). La
 *      bolsa vence al terminar el período que paga la cuota MÁS los 5 días de gracia de la mora
 *      (`DIAS_GRACIA` del cron, los mismos de los Términos): quien paga el día 3 de su período no
 *      queda cortado el día 1 del siguiente mientras su enlace todavía está en plazo.
 *
 *   3. **Que el pago no quede cortado el día 7.** La llave de la prueba vence con la prueba. Abrir el
 *      primer ciclo le quita el vencimiento a esa misma llave (no se cambia por otra: una llave nueva
 *      que se pierde entre Valida y Vault dejaría al cliente sin servicio después de pagar). Eso lo
 *      hace Valida en `POST /api/one/v1/autogestion/{cliente}/ciclos`.
 */

export const LIMITE_CONSULTAS_MES_POR_DEFECTO = 3000
/** El mismo tope del lado de Valida: un pedido mayor lo rechaza. */
export const TOPE_LIMITE_CONSULTAS_MES = 20_000

/** Precio de lista (decisión F, 2026-10-09): $150.000 al mes, valor total, sin IVA que sumar. */
export const PRECIO_MENSUAL_VALIDA = 150_000
/** Usuarios incluidos, como los CDA de hoy (`CUPOS_VALIDA` del registro). */
export const LICENCIAS_INCLUIDAS = 2

/** Los días de gracia de la mora: `DIAS_GRACIA` del cron `procesar-planes-cobro` y de los Términos. */
export const DIAS_GRACIA_CICLO = 5

function enteroEnRango(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** El límite de consultas por mes de un contrato (ver la cabecera, punto 1). */
export function limiteConsultasMes(
  parametros: Record<string, unknown> | null | undefined,
  env: Record<string, string | undefined> = process.env,
): number {
  return (
    enteroEnRango(parametros?.limite_consultas_mes, 1, TOPE_LIMITE_CONSULTAS_MES) ??
    enteroEnRango(env.VALIDA_PLAN_LIMITE_MES, 1, TOPE_LIMITE_CONSULTAS_MES) ??
    LIMITE_CONSULTAS_MES_POR_DEFECTO
  )
}

/**
 * Los parámetros con que nace el contrato al activar el plan. `dias_trial: 0` a propósito: la
 * prueba ya pasó (10 consultas, 7 días); el enrolamiento por ciclo (`enrolar-ciclo.ts`) lee el del
 * contrato antes que el de la ficha, y con 0 la cuota 1 vence el día en que se aceptan los Términos.
 */
export function parametrosDelPlan(env: Record<string, string | undefined> = process.env): {
  precio_mensual: number
  licencias: number
  dias_trial: number
  limite_consultas_mes: number
} {
  return {
    precio_mensual: PRECIO_MENSUAL_VALIDA,
    licencias: LICENCIAS_INCLUIDAS,
    dias_trial: 0,
    limite_consultas_mes: limiteConsultasMes(null, env),
  }
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

function sumarMesesISO(iso: string, meses: number): string {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const destino = new Date(Date.UTC(y, mes - 1 + meses, 1))
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth(), Math.min(dia, ultimo))).toISOString().slice(0, 10)
}

function sumarDiasISO(iso: string, dias: number): string {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias)).toISOString().slice(0, 10)
}

/** Medianoche de Bogotá (UTC-5, sin horario de verano) del día dado, en ISO UTC. */
function medianocheBogota(iso: string): string {
  return `${iso}T05:00:00.000Z`
}

export interface CicloPagado {
  /** Primer día del período que paga la cuota (su vencimiento: las cuotas del ciclo vencen al empezar). */
  desde: string
  /** Último día del período. */
  hasta: string
  /** Cuándo vence la bolsa en Valida: al terminar `hasta` + la gracia, medianoche de Bogotá. */
  venceEn: string
}

/**
 * El ciclo que abre el pago de una cuota del plan mensual. Las cuotas que crea el enrolamiento vencen
 * el PRIMER día de su período (`cuotasDelCiclo`), así que el período es [vencimiento, +1 mes).
 *
 * Si el pago llega tan tarde que ese ciclo ya terminó (más de un mes y la gracia), la bolsa no puede
 * nacer vencida —Valida la rechazaría y la persona habría pagado para nada—: dura un día desde hoy,
 * y el cobro de la cuota siguiente (ya vencida) es el que la extiende.
 */
export function cicloDeCuota(fechaVencimiento: string, ahora: Date = new Date()): CicloPagado {
  const desde = fechaVencimiento
  const siguiente = sumarMesesISO(desde, 1)
  const hasta = sumarDiasISO(siguiente, -1)
  const venceCalculado = medianocheBogota(sumarDiasISO(siguiente, DIAS_GRACIA_CICLO))
  const minimo = new Date(ahora.getTime() + 24 * 3_600_000).toISOString()
  return { desde, hasta, venceEn: Date.parse(venceCalculado) > Date.parse(minimo) ? venceCalculado : minimo }
}

/** La referencia del ciclo en Valida: el patrón `one-ciclo:` que exige su ruta (`RE_REFERENCIA_ONE`). */
export function referenciaCiclo(cobroId: string): string {
  return `one-ciclo:${cobroId}`
}

/** ¿El espacio nació en el registro autogestionado de Valida? Lo marca `crearEspacioValida`. */
export function esEspacioAutogestion(configExtra: Record<string, unknown> | null | undefined): boolean {
  return (configExtra ?? {}).origen_registro === 'valida_autogestion'
}

/**
 * Lo que queda en `workspaces.config_extra.valida_plan` cuando Valida abre un ciclo. Solo datos del
 * plan: la llave sigue en Vault. Reemplaza a `valida_prueba`, que se borra: la llave ya no vence, así
 * que un 401 vuelve a ser un 401 (`motivoCorteDeError`).
 */
export interface PlanAbierto {
  cliente_id: string
  limite_mes: number
  cobro_id: string
  cuota_numero: number
  desde: string
  hasta: string
  vence_en: string
  abierto_at: string
}

export function planDeConfig(configExtra: Record<string, unknown> | null | undefined): PlanAbierto | null {
  const p = (configExtra ?? {}).valida_plan as Record<string, unknown> | null | undefined
  if (!p || typeof p !== 'object') return null
  if (typeof p.cliente_id !== 'string' || typeof p.cobro_id !== 'string' || typeof p.cuota_numero !== 'number') return null
  return p as unknown as PlanAbierto
}

/**
 * ¿Este pago abre un ciclo? Solo la cuota más nueva pagada: una cuota vieja que se paga tarde (con la
 * siguiente ya pagada) no reabre un ciclo anterior ni le quita días al vigente.
 */
export function abreCiclo(p: { cuotaNumero: number; planActual: PlanAbierto | null }): boolean {
  if (!p.planActual) return true
  return p.cuotaNumero > p.planActual.cuota_numero
}

/** `config_extra` después de abrir el ciclo: sin `valida_prueba`, con `valida_plan`. */
export function configConPlan(configExtra: Record<string, unknown> | null | undefined, plan: PlanAbierto): Record<string, unknown> {
  const { valida_prueba: _prueba, ...resto } = configExtra ?? {}
  void _prueba
  return { ...resto, valida_cliente_id: plan.cliente_id, valida_plan: plan }
}
