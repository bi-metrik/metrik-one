/**
 * ¿Se puede generar el enlace de pago en línea de una cuota, por cuánto y con qué texto? Puro.
 * No sabe de qué pasarela es: eso lo resuelve `pasarelaDeEnlaces` en el servidor.
 *
 * Mismo criterio que `sql/valida-cda/plantilla-enlace-de-pago-cuota.sql` (la carga manual):
 *   · El enlace vive en el COBRO PROGRAMADO de la cuota (`plan_cobro_id` + `numero_cuota`). Si no
 *     existe, se crea con el vencimiento de la cuota; si existe sin pagar, se le cambia el enlace.
 *   · Cuota ya pagada, o su cobro anulado → no hay enlace: uno nuevo cobraría dos veces.
 *
 * Y dos reglas que la plantilla no necesitaba porque el monto lo ponía una persona:
 *   · **El monto es el SALDO de la cuota**, con el reparto FIFO de `cuotasConEstado` (el mismo de la
 *     pestaña Pagos del cliente): lo pagado de más en una cuota anterior se descuenta de esta, que
 *     es la regla del excedente. Una cuota que ya quedó cubierta por pagos anteriores no lleva enlace.
 *   · **Un enlace vigente no se regenera**: el cliente pudo haberlo recibido ya. Solo se genera si
 *     no hay enlace o si el que hay venció.
 */

import { cuotasConEstado, fechaCorta, type CobroRecibido, type CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'

export interface CuotaParaEnlace {
  cuotaId: string
  numero: number
  monto: number
  fechaVencimiento: string
  concepto: string | null
  planCobroId: string
  totalCuotas: number | null
}

export interface CobroProgramadoDeCuota {
  id: string
  fecha: string | null
  anuladoAt: string | null
  monto: number
  enlacePagoUrl: string | null
  enlacePagoExpira: string | null
}

export type DecisionEnlace =
  | { accion: 'rechazar'; motivo: string }
  | { accion: 'vigente'; url: string; expira: string | null }
  | { accion: 'generar'; monto: number; descripcion: string }

/** Margen para no entregar un enlace que vence en minutos. */
const MARGEN_VIGENCIA_MS = 60 * 60 * 1000

/**
 * ¿El enlace guardado en el cobro todavía sirve? La MISMA regla para el botón y para el paso
 * automático del cron: si los dos la escribieran por separado, el cron generaría enlaces que el
 * botón consideraría vigentes, o al revés.
 *
 * Sin fecha de vencimiento no hay cómo saber si sirve: se trata como vigente, igual que la
 * pantalla del cliente, que lo pinta. Reemplazarlo lo decide quien lo cargó.
 */
export function enlaceVigente(
  cobro: Pick<CobroProgramadoDeCuota, 'enlacePagoUrl' | 'enlacePagoExpira'>,
  ahoraMs: number,
): boolean {
  if (!cobro.enlacePagoUrl) return false
  if (cobro.enlacePagoExpira === null) return true
  const expira = Date.parse(cobro.enlacePagoExpira)
  return !Number.isNaN(expira) && expira > ahoraMs + MARGEN_VIGENCIA_MS
}

export function decidirEnlaceCuota(p: {
  cuota: CuotaParaEnlace
  cobro: CobroProgramadoDeCuota | null
  /** Todas las cuotas de los planes del negocio, para el reparto FIFO. */
  cuotas: readonly CuotaDeServicio[]
  /** Todos los cobros del negocio (pagados, programados y anulados). */
  cobros: readonly CobroRecibido[]
  hoy: string
  ahoraMs: number
}): DecisionEnlace {
  const { cuota, cobro } = p
  if (cobro?.anuladoAt) return { accion: 'rechazar', motivo: `El cobro de la cuota ${cuota.numero} está anulado. Revísalo antes de generar un enlace.` }
  if (cobro?.fecha) return { accion: 'rechazar', motivo: `La cuota ${cuota.numero} ya está pagada (${fechaCorta(cobro.fecha)}).` }

  const ahoraISO = new Date(p.ahoraMs).toISOString()
  const estado = cuotasConEstado({ cuotas: p.cuotas, cobros: p.cobros, hoy: p.hoy, ahoraISO }).find(
    (c) => c.cuotaId === cuota.cuotaId,
  )
  if (!estado) return { accion: 'rechazar', motivo: `La cuota ${cuota.numero} no tiene monto para cobrar.` }
  if (estado.estado === 'pagada' || estado.saldo <= 0) {
    return { accion: 'rechazar', motivo: `La cuota ${cuota.numero} ya quedó cubierta con los pagos anteriores.` }
  }

  if (cobro?.enlacePagoUrl && enlaceVigente(cobro, p.ahoraMs)) {
    return { accion: 'vigente', url: cobro.enlacePagoUrl, expira: cobro.enlacePagoExpira }
  }

  return { accion: 'generar', monto: Math.round(estado.saldo), descripcion: descripcionCuota(cuota) }
}

const RE_PERIODO = /periodo del \d{2}\/\d{2}\/\d{4} al \d{2}\/\d{2}\/\d{4}/i

/**
 * El texto que ve el cliente en la pantalla de pago de la pasarela (máximo 100). El concepto de la cuota
 * ya trae el período («Licencia VALIDA · Starter — periodo del 23/09/2026 al 22/10/2026»); si no
 * cabe, se queda el período; sin concepto, el número y el vencimiento.
 */
export function descripcionCuota(c: Pick<CuotaParaEnlace, 'numero' | 'concepto' | 'fechaVencimiento' | 'totalCuotas'>): string {
  const concepto = (c.concepto ?? '').replace(/\s+/g, ' ').trim()
  if (concepto && concepto.length <= 100) return concepto
  const periodo = RE_PERIODO.exec(concepto)?.[0]
  if (periodo) return `Cuota ${c.numero} · ${periodo}`
  const de = c.totalCuotas ? ` de ${c.totalCuotas}` : ''
  return `Cuota ${c.numero}${de} · vence ${fechaCorta(c.fechaVencimiento)}`
}

/**
 * Con qué pasarela se genera el enlace de una cuota. Se resuelve por DATO, nunca por código, para que
 * cambiar de pasarela (Bold → ePayco) sea implementar el adaptador y cambiar un valor:
 *   1. `planes_cobro.pasarela` del plan de la cuota, si esa pasarela genera enlaces;
 *   2. si no (los planes viejos dicen 'manual'), `workspaces.config_extra.cobros.pasarela_en_linea`;
 *   3. si ninguna, no hay pasarela y el botón lo dice.
 */
export function pasarelaDeEnlaces(p: {
  pasarelaPlan: string | null
  configWorkspace: unknown
  generaEnlaces: (pasarela: string) => boolean
}): string | null {
  if (p.pasarelaPlan && p.generaEnlaces(p.pasarelaPlan)) return p.pasarelaPlan
  const cobros = (p.configWorkspace as { cobros?: { pasarela_en_linea?: unknown } } | null)?.cobros
  const deConfig = typeof cobros?.pasarela_en_linea === 'string' ? cobros.pasarela_en_linea.trim() : ''
  if (deConfig && p.generaEnlaces(deConfig)) return deConfig
  return null
}

export const MOTIVO_SIN_PASARELA =
  'Este espacio no tiene una pasarela de pago en línea configurada (ni en el plan de la cuota ni en la configuración de cobros).'
