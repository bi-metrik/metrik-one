import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import type { CobroRecibido, CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import {
  decidirEnlaceCuota,
  MOTIVO_SIN_PASARELA,
  pasarelaDeEnlaces,
  type CobroProgramadoDeCuota,
} from './enlace-pago-cuota'
import { referenciaEnlaceCobro } from './referencia-enlace'

/** Cuánto vive un enlace desde que se genera. El ciclo manual de los CDA: se manda el 20, vence el 27. */
export const DIAS_VIGENCIA_ENLACE = 7

/**
 * Genera (o devuelve el vigente) el enlace de pago en línea de UNA cuota y lo deja en el cobro
 * programado de esa cuota (`enlace_pago_url`, `enlace_pago_expira`). La decisión es de
 * `decidirEnlaceCuota` (puro) y la pasarela la elige `pasarelaDeEnlaces` por dato; el enlace lo crea
 * el adaptador (`PasarelaAdapter.crearEnlacePago`). Aquí no se sabe qué pasarela es.
 *
 * Todo con el cliente de servicio, así que el filtro por espacio va en CADA consulta: la cuota, su
 * plan y el contrato tienen que ser del espacio de la sesión, y el negocio tiene que ser un contrato
 * de `servicios_contratados` cobrado por ese espacio (el mismo alcance que la carga de facturas).
 *
 * Orden de las escrituras: primero el cobro programado (si no existía), porque la referencia del
 * enlace lleva su id; después el enlace en la pasarela; al final el enlace en el cobro. Si la pasarela falla, el
 * cobro programado queda creado y sin enlace: es la misma fila que crearía la plantilla SQL.
 */

export type ResultadoEnlaceCuota =
  | {
      ok: true
      estado: 'generado' | 'vigente'
      url: string
      expira: string | null
      monto: number | null
      negocioId: string
      numero: number
      pasarela: string | null
    }
  | { ok: false; error: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function generarEnlacePagoCuota(
  p: { workspaceId: string; cuotaId: string; ahoraMs?: number },
  deps: { db: SupabaseClient; adapterPara?: (pasarela: string) => PasarelaAdapter | null },
): Promise<ResultadoEnlaceCuota> {
  const db = deps.db as Db
  const ahoraMs = p.ahoraMs ?? Date.now()

  const cuota = await db
    .from('plan_cobro_cuotas')
    .select('id, numero, monto, fecha_vencimiento, concepto_detalle, plan_cobro_id')
    .eq('id', p.cuotaId)
    .eq('workspace_id', p.workspaceId)
    .maybeSingle()
  if (cuota.error) return { ok: false, error: `No se pudo leer la cuota: ${cuota.error.message}` }
  if (!cuota.data) return { ok: false, error: 'Cuota no encontrada.' }

  const plan = await db
    .from('planes_cobro')
    .select('id, negocio_id, total_cuotas, pasarela')
    .eq('id', cuota.data.plan_cobro_id)
    .eq('workspace_id', p.workspaceId)
    .maybeSingle()
  if (plan.error || !plan.data) return { ok: false, error: 'Cuota no encontrada.' }
  const negocioId = plan.data.negocio_id as string

  const contrato = await db
    .from('servicios_contratados')
    .select('id')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', p.workspaceId)
    .limit(1)
  if (contrato.error) return { ok: false, error: `No se pudo leer el contrato: ${contrato.error.message}` }
  if ((contrato.data ?? []).length === 0) {
    return { ok: false, error: 'Esta cuota no es de un contrato de servicio: el cliente no tiene dónde ver el enlace.' }
  }

  // Las cuotas de TODOS los planes del negocio y todos sus cobros: el reparto FIFO los necesita.
  const planes = await db.from('planes_cobro').select('id').eq('negocio_id', negocioId).eq('workspace_id', p.workspaceId)
  if (planes.error) return { ok: false, error: `No se pudieron leer los planes: ${planes.error.message}` }
  const idsPlan = ((planes.data ?? []) as { id: string }[]).map((x) => x.id)

  const cuotas = await db
    .from('plan_cobro_cuotas')
    .select('id, numero, tipo, monto, fecha_vencimiento, concepto_detalle')
    .in('plan_cobro_id', idsPlan)
    .eq('workspace_id', p.workspaceId)
  if (cuotas.error) return { ok: false, error: `No se pudieron leer las cuotas: ${cuotas.error.message}` }

  const cobros = await db
    .from('cobros')
    .select('id, monto, fecha, anulado_at, tipo_cobro, plan_cobro_id, numero_cuota, enlace_pago_url, enlace_pago_expira')
    .eq('negocio_id', negocioId)
    .eq('workspace_id', p.workspaceId)
  if (cobros.error) return { ok: false, error: `No se pudieron leer los cobros: ${cobros.error.message}` }

  type FilaCobro = {
    id: string
    monto: number | string | null
    fecha: string | null
    anulado_at: string | null
    tipo_cobro: string | null
    plan_cobro_id: string | null
    numero_cuota: number | null
    enlace_pago_url: string | null
    enlace_pago_expira: string | null
  }
  const filasCobro = (cobros.data ?? []) as FilaCobro[]
  const delaCuota = filasCobro.find(
    (c) => c.plan_cobro_id === plan.data.id && c.numero_cuota === cuota.data.numero && c.tipo_cobro === 'programado',
  )
  const cobro: CobroProgramadoDeCuota | null = delaCuota
    ? {
        id: delaCuota.id,
        fecha: delaCuota.fecha,
        anuladoAt: delaCuota.anulado_at,
        monto: Number(delaCuota.monto ?? 0),
        enlacePagoUrl: delaCuota.enlace_pago_url,
        enlacePagoExpira: delaCuota.enlace_pago_expira,
      }
    : null

  const cuotasFifo: CuotaDeServicio[] = (
    (cuotas.data ?? []) as { id: string; numero: number; tipo: string; monto: number | string; fecha_vencimiento: string; concepto_detalle: string | null }[]
  ).map((c) => ({
    cuotaId: c.id,
    numero: c.numero,
    tipo: c.tipo,
    monto: Number(c.monto),
    fechaVencimiento: c.fecha_vencimiento,
    concepto: c.concepto_detalle,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
  }))
  // Mismo criterio de `mis_cobros_de_servicio`: anulado > sin fecha (programado) > pagado.
  const cobrosFifo: CobroRecibido[] = filasCobro.map((c) => ({
    monto: Number(c.monto ?? 0),
    estado: c.anulado_at ? 'anulado' : c.fecha === null ? 'programado' : 'pagado',
  }))

  const decision = decidirEnlaceCuota({
    cuota: {
      cuotaId: cuota.data.id,
      numero: cuota.data.numero,
      monto: Number(cuota.data.monto),
      fechaVencimiento: cuota.data.fecha_vencimiento,
      concepto: cuota.data.concepto_detalle,
      planCobroId: plan.data.id,
      totalCuotas: plan.data.total_cuotas ?? null,
    },
    cobro,
    cuotas: cuotasFifo,
    cobros: cobrosFifo,
    hoy: todayBogotaISO(new Date(ahoraMs)),
    ahoraMs,
  })
  if (decision.accion === 'rechazar') return { ok: false, error: decision.motivo }
  if (decision.accion === 'vigente') {
    return { ok: true, estado: 'vigente', url: decision.url, expira: decision.expira, monto: null, negocioId, numero: cuota.data.numero, pasarela: null }
  }

  // La pasarela, por dato: el plan de la cuota o la configuración de cobros del espacio.
  const resolver = deps.adapterPara ?? adapterPara
  const ws = await db.from('workspaces').select('config_extra').eq('id', p.workspaceId).maybeSingle()
  if (ws.error) return { ok: false, error: `No se pudo leer la configuración del espacio: ${ws.error.message}` }
  const pasarela = pasarelaDeEnlaces({
    pasarelaPlan: plan.data.pasarela ?? null,
    configWorkspace: ws.data?.config_extra ?? null,
    generaEnlaces: (x) => Boolean(resolver(x)?.crearEnlacePago),
  })
  const adapter = pasarela ? resolver(pasarela) : null
  if (!pasarela || !adapter?.crearEnlacePago) return { ok: false, error: MOTIVO_SIN_PASARELA }
  // Sin llaves no se escribe nada: ni siquiera el cobro programado.
  const faltante = adapter.faltaConfiguracion?.() ?? null
  if (faltante) return { ok: false, error: faltante }

  // 1. El cobro programado de la cuota, si todavía no existe.
  let cobroId = cobro?.id ?? null
  if (!cobroId) {
    const nuevo = await db
      .from('cobros')
      .insert({
        workspace_id: p.workspaceId,
        negocio_id: negocioId,
        plan_cobro_id: plan.data.id,
        numero_cuota: cuota.data.numero,
        monto: decision.monto,
        tipo_cobro: 'programado',
        fecha_esperada: cuota.data.fecha_vencimiento,
        // `cobros.fecha` tiene DEFAULT CURRENT_DATE: sin el null explícito nace «pagado».
        fecha: null,
        revisado: false,
        notas: `Cuota ${cuota.data.numero}${plan.data.total_cuotas ? ` de ${plan.data.total_cuotas}` : ''}`,
        retencion: 0,
      })
      .select('id')
      .single()
    if (nuevo.error?.code === '23505') {
      return { ok: false, error: 'Otra persona acaba de crear el cobro de esta cuota. Recarga la página y vuelve a intentarlo.' }
    }
    if (nuevo.error || !nuevo.data?.id) {
      return { ok: false, error: `No se pudo crear el cobro de la cuota: ${nuevo.error?.message ?? 'sin fila'}` }
    }
    cobroId = nuevo.data.id as string
  }

  // 2. El enlace en la pasarela.
  const enlace = await adapter.crearEnlacePago({
    cobroId,
    monto: decision.monto,
    descripcion: decision.descripcion,
    referencia: referenciaEnlaceCobro(cobroId, ahoraMs),
    expiraMs: ahoraMs + DIAS_VIGENCIA_ENLACE * 86_400_000,
  })
  if (!enlace.ok) return { ok: false, error: enlace.error }

  // 3. El enlace en el cobro. Guarda dentro del update: si en el medio alguien confirmó el pago,
  //    no se le pone enlace a una cuota pagada.
  const patch: Record<string, unknown> = { enlace_pago_url: enlace.url, enlace_pago_expira: enlace.expira }
  if (cobro && Math.round(cobro.monto) !== decision.monto) {
    // Regla del excedente: el cobro de esta cuota queda por lo que falta, no por el valor pleno.
    patch.monto = decision.monto
  }
  const escrito = await db
    .from('cobros')
    .update(patch)
    .eq('id', cobroId)
    .eq('workspace_id', p.workspaceId)
    .is('fecha', null)
    .is('anulado_at', null)
    .select('id')
  if (escrito.error) {
    return { ok: false, error: `La pasarela creó el enlace (${enlace.idEnlace}) pero no se pudo guardar: ${escrito.error.message}` }
  }
  if ((escrito.data ?? []).length === 0) {
    return { ok: false, error: `La cuota se pagó o se anuló mientras se generaba el enlace. La pasarela creó ${enlace.idEnlace}; no se guardó.` }
  }

  return { ok: true, estado: 'generado', url: enlace.url, expira: enlace.expira, monto: decision.monto, negocioId, numero: cuota.data.numero, pasarela }
}
