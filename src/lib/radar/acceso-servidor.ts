import 'server-only'
import { cache } from 'react'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { createServiceClient } from '@/lib/supabase/server'
import { MODULOS } from '@/lib/modulos/catalogo'
import { cuotasConEstado, type CobroRecibido, type CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import { estadoAccesoRadar, mensajeRadarCerrado, type AccesoRadar, type CuotaDelRadar } from './acceso'
import { contextoRadar } from './contexto'

/**
 * De dónde sale el estado de pago del Radar: el contrato que cubre este espacio, la fecha en que se
 * aceptaron sus términos y sus cuotas con lo que los pagos alcanzaron a cubrir. La decisión es
 * `acceso.ts` (puro).
 *
 * Todo se lee con el cliente de SERVICIO, acotado al espacio de la sesión: la tabla del contrato es
 * del cobrador (`metrik`), así que el cliente `authenticated` del cliente final no la ve (y no debe
 * verla). El reparto de los pagos es el MISMO que usa `/suscripcion` (`cuotasConEstado`): dos
 * reglas distintas dirían cosas distintas sobre la misma cuota.
 *
 * ## Si una lectura falla, el módulo NO se cierra
 *
 * Devuelve `no_disponible`, y `radarAbierto` lo trata como abierto. Es el mismo criterio de la mora
 * de Valida: sin prueba de impago no se corta el servicio. Lo contrario —cerrar por no poder leer—
 * convertiría cualquier hipo de la base en un cliente sin producto.
 */

export interface PagoDelRadar {
  /** Lo que falta de la cuota vencida. */
  saldo: number
  vence: string
  /** Enlace de pago vigente, si lo hay. Lo genera el paso 6 del cron. */
  enlace: string | null
}

export interface LecturaAccesoRadar {
  acceso: AccesoRadar
  /**
   * La cuota que hay que pagar: la vencida cuando el módulo está cerrado, y la PRIMERA impaga
   * mientras el trial corre (el banner de prueba necesita el enlace y el precio del cliente, no el
   * de lista: ver el bloque G de la spec). `null` cuando no hay nada que pagar.
   */
  pago: PagoDelRadar | null
}

interface FilaContrato {
  id: string
  workspace_id: string
  negocio_id: string
  estado: string
  servicio_slug: string
  servicio_version: number
  parametros: Record<string, unknown> | null
}

function entero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : null
}

async function resolver(): Promise<LecturaAccesoRadar> {
  const ctx = await contextoRadar()
  if (ctx.tipo !== 'ok') return { acceso: { estado: 'no_disponible' }, pago: null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const fallo = (donde: string, mensaje: string): LecturaAccesoRadar => {
    console.error(`[radar] no se pudo leer ${donde}:`, mensaje)
    return { acceso: { estado: 'no_disponible' }, pago: null }
  }

  // 1. Los tipos de servicio del módulo Radar.
  const servicios = await svc.from('catalogo_servicios').select('slug').eq('modulo', MODULOS.radar_secop.clave)
  if (servicios.error) return fallo('el catálogo del Radar', servicios.error.message)
  const slugs = ((servicios.data ?? []) as { slug: string }[]).map((s) => s.slug)
  // Sin ficha publicada no hay contrato posible: el módulo está encendido por cortesía o para uso
  // interno, y no se cobra.
  if (slugs.length === 0) return { acceso: { estado: 'sin_contrato' }, pago: null }

  // 2. El contrato que cubre este espacio: como pagador, o como beneficiario.
  const beneficiarios = await svc
    .from('servicio_contratado_beneficiarios')
    .select('servicio_contratado_id')
    .eq('workspace_id', ctx.workspaceId)
  if (beneficiarios.error) return fallo('los beneficiarios del contrato', beneficiarios.error.message)
  const idsBeneficiario = ((beneficiarios.data ?? []) as { servicio_contratado_id: string }[]).map(
    (b) => b.servicio_contratado_id,
  )

  const campos = 'id, workspace_id, negocio_id, estado, servicio_slug, servicio_version, parametros'
  const ESTADOS = ['activo', 'pausado']
  const [comoPagador, comoBeneficiario] = await Promise.all([
    svc.from('servicios_contratados').select(campos).in('servicio_slug', slugs).in('estado', ESTADOS)
      .eq('workspace_pagador_id', ctx.workspaceId),
    idsBeneficiario.length > 0
      ? svc.from('servicios_contratados').select(campos).in('servicio_slug', slugs).in('estado', ESTADOS)
          .in('id', idsBeneficiario)
      : Promise.resolve({ data: [], error: null }),
  ])
  for (const r of [comoPagador, comoBeneficiario]) {
    if (r.error) return fallo('el contrato del Radar', r.error.message)
  }
  const contratos = [...((comoPagador.data ?? []) as FilaContrato[]), ...((comoBeneficiario.data ?? []) as FilaContrato[])]
  // El más reciente primero (activo antes que pausado), igual que la puerta de Valida.
  const contrato = contratos.sort(
    (a, b) => Number(b.estado === 'activo') - Number(a.estado === 'activo') || b.id.localeCompare(a.id),
  )[0]
  if (!contrato) return { acceso: { estado: 'sin_contrato' }, pago: null }

  // 3. Los días de trial: lo pactado, y si el contrato no lo dice, el `por_defecto` de SU versión.
  let diasTrial = entero(contrato.parametros?.dias_trial)
  if (diasTrial === null) {
    const ficha = await svc
      .from('catalogo_servicios_versiones')
      .select('definicion')
      .eq('slug', contrato.servicio_slug)
      .eq('version', contrato.servicio_version)
      .maybeSingle()
    if (ficha.error) return fallo('la ficha del servicio', ficha.error.message)
    const def = (ficha.data as { definicion?: { parametros?: Record<string, { por_defecto?: unknown }> } } | null)
      ?.definicion
    diasTrial = entero(def?.parametros?.dias_trial?.por_defecto)
  }

  // 4. El ANCLA: la aceptación más vieja del contrato. Un MAX correría el trial cada vez que se
  // acepta una versión nueva de los términos.
  const aceptaciones = await svc
    .from('aceptaciones_terminos')
    .select('respondido_at')
    .eq('negocio_id', contrato.negocio_id)
    .eq('estado', 'aceptado')
  if (aceptaciones.error) return fallo('las aceptaciones de términos', aceptaciones.error.message)
  const instantes = ((aceptaciones.data ?? []) as { respondido_at: string | null }[])
    .map((a) => a.respondido_at)
    .filter((x): x is string => typeof x === 'string')
    .sort()
  const fechaAceptacion = instantes.length > 0 ? todayBogotaISO(new Date(instantes[0])) : null

  // 5. Las cuotas del contrato y los pagos del negocio.
  const planes = await svc
    .from('planes_cobro')
    .select('id')
    .eq('workspace_id', contrato.workspace_id)
    .eq('negocio_id', contrato.negocio_id)
  if (planes.error) return fallo('el plan de cobro del contrato', planes.error.message)
  const planIds = ((planes.data ?? []) as { id: string }[]).map((p) => p.id)

  let cuotas: CuotaDelRadar[] = []
  let pago: PagoDelRadar | null = null
  const hoy = todayBogotaISO()

  if (planIds.length > 0) {
    const [filasCuota, filasCobro] = await Promise.all([
      svc
        .from('plan_cobro_cuotas')
        .select('id, numero, tipo, monto, fecha_vencimiento, concepto_detalle, plan_cobro_id')
        .in('plan_cobro_id', planIds),
      svc
        .from('cobros')
        .select('monto, fecha, anulado_at, retencion_iva, plan_cobro_id, numero_cuota, enlace_pago_url, enlace_pago_expira')
        .eq('workspace_id', contrato.workspace_id)
        .eq('negocio_id', contrato.negocio_id),
    ])
    for (const r of [filasCuota, filasCobro]) {
      if (r.error) return fallo('las cuotas del contrato', r.error.message)
    }

    interface FilaCobro {
      monto: number | string | null
      fecha: string | null
      anulado_at: string | null
      retencion_iva?: number | string | null
      plan_cobro_id: string | null
      numero_cuota: number | null
      enlace_pago_url: string | null
      enlace_pago_expira: string | null
    }
    const cobrosFilas = (filasCobro.data ?? []) as FilaCobro[]
    const enlacePorCuota = new Map<string, { url: string | null; expira: string | null }>()
    for (const c of cobrosFilas) {
      if (!c.plan_cobro_id || c.numero_cuota == null || c.anulado_at) continue
      enlacePorCuota.set(`${c.plan_cobro_id}|${c.numero_cuota}`, {
        url: c.enlace_pago_url,
        expira: c.enlace_pago_expira,
      })
    }

    const paraReparto: CuotaDeServicio[] = (
      (filasCuota.data ?? []) as {
        id: string
        numero: number
        tipo: string
        monto: number | string
        fecha_vencimiento: string
        concepto_detalle: string | null
        plan_cobro_id: string
      }[]
    ).map((q) => {
      const enlace = enlacePorCuota.get(`${q.plan_cobro_id}|${q.numero}`)
      return {
        cuotaId: q.id,
        numero: q.numero,
        tipo: q.tipo,
        monto: Number(q.monto),
        fechaVencimiento: q.fecha_vencimiento,
        concepto: q.concepto_detalle,
        enlacePagoUrl: enlace?.url ?? null,
        enlacePagoExpira: enlace?.expira ?? null,
      }
    })

    const cobros: CobroRecibido[] = cobrosFilas.map((c) => ({
      monto: Number(c.monto ?? 0),
      estado: c.anulado_at ? 'anulado' : c.fecha ? 'pagado' : 'programado',
      retencionIva: c.retencion_iva == null ? undefined : Number(c.retencion_iva),
    }))

    const conEstado = cuotasConEstado({ cuotas: paraReparto, cobros, hoy, ahoraISO: new Date().toISOString() })
    cuotas = conEstado.map((c) => ({
      numero: c.numero,
      fechaVencimiento: c.fechaVencimiento,
      pagada: c.estado === 'pagada',
      saldo: c.saldo,
      enlace: c.enlacePago,
    }))
  }

  const acceso = estadoAccesoRadar({
    contrato: { estado: contrato.estado, diasTrial },
    fechaAceptacion,
    cuotas,
    hoy,
  })
  // Qué cuota se ofrece pagar. Cerrado: la que venció. En trial: la primera impaga, que es la que
  // el cliente puede adelantar desde el banner con SU precio (el saldo de su cuota, no la tarifa de
  // lista: si el banner dijera otro número que el enlace, sería una reclamación esperando).
  const cuotaAPagar =
    acceso.estado === 'cerrado'
      ? acceso.cuota
      : acceso.estado === 'en_trial'
        ? cuotas.filter((c) => !c.pagada).sort((a, b) => a.fechaVencimiento.localeCompare(b.fechaVencimiento))[0] ?? null
        : null
  if (cuotaAPagar) {
    pago = { saldo: cuotaAPagar.saldo, vence: cuotaAPagar.fechaVencimiento, enlace: cuotaAPagar.enlace }
  }

  return { acceso, pago }
}

/** Una sola lectura por request aunque la pidan la página y varias acciones. */
export const accesoRadar = cache(resolver)

/** Lo que preguntan las acciones del Radar: ¿el pago deja operar? */
export async function radarPermiteOperar(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { acceso } = await accesoRadar()
  if (acceso.estado !== 'cerrado') return { ok: true }
  return { ok: false, error: mensajeRadarCerrado(acceso) }
}
