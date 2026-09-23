/**
 * Qué cuotas reciben su enlace de pago en línea SIN que nadie oprima el botón. Puro.
 *
 * Lo corre el cron diario (`/api/crons/procesar-planes-cobro`, paso 6) y genera el enlace con la
 * MISMA función del botón (`generarEnlacePagoCuota`), que vuelve a decidir con `decidirEnlaceCuota`.
 * Esto solo preselecciona para no llamar a la pasarela por cuotas que a todas luces no lo necesitan.
 *
 * ## Qué entra
 *
 *   · La cuota es de un plan cuyo negocio es un contrato de servicio (`servicios_contratados`) del
 *     MISMO espacio, en estado `activo` o `pausado`. Pausado sigue debiendo: justamente se pausa por
 *     mora. Borrador, cancelado y terminado no reciben cobros nuevos.
 *   · La pasarela en línea del plan resuelve a una que genera enlaces (`pasarelaDeEnlaces`). Un plan
 *     `manual` sin `cobros.pasarela_en_linea` en el espacio queda fuera.
 *   · Vence dentro de `DIAS_ANTICIPACION_ENLACE` días, o ya venció y sigue sin pagar.
 *   · Su cobro programado, si existe, no está pagado ni anulado y no tiene un enlace vigente
 *     (`enlaceVigente`, la misma regla del botón, con su margen de una hora).
 *
 * ## Por qué NO se mira `planes_cobro.activo`
 *
 * `activo` es el interruptor del EMISOR de cuentas de cobro (`emitirCuentasExplicitasPeriodo` solo
 * lee planes activos) y el trigger lo apaga solo cuando todas las cuotas quedaron cobradas. Para el
 * enlace manda el contrato: un plan inactivo con cuotas pagadas no produce candidatos (sus cobros
 * están pagados), y uno inactivo con cuotas pendientes es exactamente el caso del plan de pruebas de
 * `cda-pruebas`, que se dejó inactivo para que el emisor no le emita cuentas. Este paso no emite
 * cuentas de cobro ni escribe en `plan_cobro_cuotas`: solo el cobro programado y su enlace, igual
 * que el botón.
 */

import { enlaceVigente, pasarelaDeEnlaces } from './enlace-pago-cuota'

/** Con cuánta anticipación al vencimiento se genera el enlace. Igual a su vigencia: el ciclo del 20 al 27. */
export const DIAS_ANTICIPACION_ENLACE = 7

/** Estados del contrato que siguen recibiendo cobros. */
export const ESTADOS_CONTRATO_CON_COBRO = ['activo', 'pausado'] as const

export interface ContratoParaEnlace {
  workspaceId: string
  negocioId: string
  estado: string
}

export interface PlanParaEnlace {
  id: string
  workspaceId: string
  negocioId: string
  pasarela: string | null
}

export interface CuotaParaSeleccion {
  id: string
  planCobroId: string
  numero: number
  fechaVencimiento: string
}

export interface CobroParaSeleccion {
  planCobroId: string | null
  numeroCuota: number | null
  tipoCobro: string | null
  fecha: string | null
  anuladoAt: string | null
  enlacePagoUrl: string | null
  enlacePagoExpira: string | null
}

export interface CuotaCandidata {
  cuotaId: string
  workspaceId: string
  planCobroId: string
  negocioId: string
  numero: number
  fechaVencimiento: string
}

export type MotivoDescarte = 'pagada' | 'anulada' | 'enlace_vigente'

export interface Seleccion {
  candidatas: CuotaCandidata[]
  /** Cuotas en la ventana que no se tocan, con el motivo. Para el resumen del cron. */
  descartadas: { cuotaId: string; motivo: MotivoDescarte }[]
}

/** 'YYYY-MM-DD' + n días, en calendario (sin zona: la fecha ya es de Bogotá). */
export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(a, m - 1, d + dias))
  return t.toISOString().slice(0, 10)
}

/** Último vencimiento que entra hoy en la ventana. */
export function limiteVentana(hoy: string): string {
  return sumarDias(hoy, DIAS_ANTICIPACION_ENLACE)
}

/**
 * Los planes cuya pasarela genera enlaces y que cuelgan de un contrato de servicio vigente del mismo
 * espacio. `configPorWorkspace` es `workspaces.config_extra` de cada espacio cobrador.
 */
export function planesConEnlaceAutomatico(p: {
  contratos: readonly ContratoParaEnlace[]
  planes: readonly PlanParaEnlace[]
  configPorWorkspace: ReadonlyMap<string, unknown>
  generaEnlaces: (pasarela: string) => boolean
}): PlanParaEnlace[] {
  const vigentes = new Set(
    p.contratos
      .filter((c) => (ESTADOS_CONTRATO_CON_COBRO as readonly string[]).includes(c.estado))
      .map((c) => `${c.workspaceId}|${c.negocioId}`),
  )
  return p.planes.filter(
    (plan) =>
      vigentes.has(`${plan.workspaceId}|${plan.negocioId}`) &&
      pasarelaDeEnlaces({
        pasarelaPlan: plan.pasarela,
        configWorkspace: p.configPorWorkspace.get(plan.workspaceId) ?? null,
        generaEnlaces: p.generaEnlaces,
      }) !== null,
  )
}

/** Qué cuotas de esos planes necesitan enlace hoy. */
export function seleccionarCuotasParaEnlace(p: {
  planes: readonly PlanParaEnlace[]
  cuotas: readonly CuotaParaSeleccion[]
  cobros: readonly CobroParaSeleccion[]
  hoy: string
  ahoraMs: number
}): Seleccion {
  const limite = limiteVentana(p.hoy)
  const planes = new Map(p.planes.map((x) => [x.id, x]))
  const cobroDeCuota = new Map<string, CobroParaSeleccion>()
  for (const c of p.cobros) {
    if (c.tipoCobro !== 'programado' || !c.planCobroId || c.numeroCuota == null) continue
    cobroDeCuota.set(`${c.planCobroId}|${c.numeroCuota}`, c)
  }

  const candidatas: CuotaCandidata[] = []
  const descartadas: Seleccion['descartadas'] = []
  const ordenadas = [...p.cuotas].sort(
    (a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento) || a.numero - b.numero,
  )
  for (const cuota of ordenadas) {
    const plan = planes.get(cuota.planCobroId)
    if (!plan) continue
    if (cuota.fechaVencimiento > limite) continue
    const cobro = cobroDeCuota.get(`${cuota.planCobroId}|${cuota.numero}`)
    if (cobro?.anuladoAt) {
      descartadas.push({ cuotaId: cuota.id, motivo: 'anulada' })
      continue
    }
    if (cobro?.fecha) {
      descartadas.push({ cuotaId: cuota.id, motivo: 'pagada' })
      continue
    }
    if (cobro && enlaceVigente(cobro, p.ahoraMs)) {
      descartadas.push({ cuotaId: cuota.id, motivo: 'enlace_vigente' })
      continue
    }
    candidatas.push({
      cuotaId: cuota.id,
      workspaceId: plan.workspaceId,
      planCobroId: plan.id,
      negocioId: plan.negocioId,
      numero: cuota.numero,
      fechaVencimiento: cuota.fechaVencimiento,
    })
  }
  return { candidatas, descartadas }
}

/**
 * Lo que cuenta un generación que se rechazó por una razón esperada (la cuota ya quedó cubierta con
 * pagos anteriores, por ejemplo). No es una falla del cron: es la decisión de `decidirEnlaceCuota`.
 */
export function esRechazoEsperado(error: string): boolean {
  return /ya quedó cubierta|ya está pagada|está anulado|no tiene monto/i.test(error)
}
