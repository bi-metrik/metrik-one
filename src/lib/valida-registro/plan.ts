/**
 * El plan pagado de una cuenta de Valida que nació en el registro autogestionado. Puro.
 *
 * `18-recorrido-baja-friccion.md`, PR 5 a 7. Lo que decide este archivo:
 *
 *   1. **Cuánto cabe en un mes.** El plan de $150.000 (decisión F, precio único) trae un LÍMITE
 *      TÉCNICO de 3.000 consultas por mes (Mauricio, 2026-10-11). No es un paquete con excedente: al
 *      llegar al límite Valida responde `402 bolsa_agotada` hasta el ciclo siguiente.
 *      FIJO EN EL CÓDIGO (fila 23 de Vera, 2026-10-12): lo prometen las Condiciones (7.1) y los
 *      Términos de autoservicio, así que ni `parametros.limite_consultas_mes` del contrato ni una
 *      variable de entorno lo cambian. Cambiarlo es un PR con una versión nueva de esos textos.
 *
 *   2. **Qué ciclo abre un pago.** Cada cuota pagada abre en Valida UNA bolsa de `limite` consultas
 *      con la referencia `one-ciclo:<cobro>` (idempotente: el mismo pago dos veces abre una sola). La
 *      bolsa vence al terminar el período que paga la cuota MÁS `DIAS_GRACIA_CICLO`: quien paga el
 *      día 3 de su período no queda cortado el día 1 del siguiente mientras su enlace está en plazo.
 *
 *   3. **Que el pago no quede cortado el día 7.** La llave de la prueba vence con la prueba. Abrir el
 *      primer ciclo le quita el vencimiento a esa misma llave (no se cambia por otra: una llave nueva
 *      que se pierde entre Valida y Vault dejaría al cliente sin servicio después de pagar). Eso lo
 *      hace Valida en `POST /api/one/v1/autogestion/{cliente}/ciclos`.
 */

/** Las 3.000 consultas al mes del plan (Condiciones 7.1, Términos 4.5). Fijo: ver la cabecera. */
export const LIMITE_CONSULTAS_MES_POR_DEFECTO = 3000
/** El mismo tope del lado de Valida: un pedido mayor lo rechaza. */
export const TOPE_LIMITE_CONSULTAS_MES = 20_000

/** Precio de lista (decisión F, 2026-10-09): $150.000 al mes, valor total, sin IVA que sumar. */
export const PRECIO_MENSUAL_VALIDA = 150_000
/** Usuarios incluidos, como los CDA de hoy (`CUPOS_VALIDA` del registro). */
export const LICENCIAS_INCLUIDAS = 2

/**
 * ⚠️ DECISIÓN ABIERTA (Mauricio y Carmen, fila 21 de Vera): los días que una cuenta autogestionada
 * sigue consultando después de que vence una cuota sin pagar, antes de suspenderse. Hoy 5 (lo que
 * hacía el código); Emilio propone 10 en los Términos (3.6 y 11.1, con `{N}`). ES LA ÚNICA PERILLA:
 * la usan el vencimiento de la bolsa (`cicloDeCuota`) y el aviso de suspensión
 * (`suspension-servidor.ts`). Al decidir, se cambia aquí y el `{N}` de los Términos con el MISMO número.
 *
 * No es `DIAS_GRACIA` del cron `procesar-planes-cobro`: aquel es el de la mora de todos los productos
 * (los Términos del Radar dicen 5) y no corta el servicio de Valida.
 */
export const DIAS_GRACIA_CICLO = 5

/** El límite de consultas por mes de una cuenta autogestionada: siempre el de los textos. */
export function limiteConsultasMes(): number {
  return LIMITE_CONSULTAS_MES_POR_DEFECTO
}

/**
 * Los parámetros con que nace el contrato al activar el plan. `dias_trial: 0` a propósito: la
 * prueba ya pasó (10 consultas, 7 días). Con el cobro al cumplirse los 7 días, la cuota 1 vence el
 * día del primer cobro (`cobro-prueba-servidor.ts` enrola con ese día como ancla, fila 22 de Vera).
 */
export function parametrosDelPlan(): {
  precio_mensual: number
  licencias: number
  dias_trial: number
  limite_consultas_mes: number
} {
  return {
    precio_mensual: PRECIO_MENSUAL_VALIDA,
    licencias: LICENCIAS_INCLUIDAS,
    dias_trial: 0,
    limite_consultas_mes: limiteConsultasMes(),
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
