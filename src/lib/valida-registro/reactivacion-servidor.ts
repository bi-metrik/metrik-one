import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { adapterPara } from '@/lib/suscripciones/pasarela/registro'
import { enlaceVigente, MOTIVO_SIN_PASARELA, pasarelaDeEnlaces } from '@/lib/cobros/enlace-pago-cuota'
import { DIAS_VIGENCIA_ENLACE } from '@/lib/cobros/enlace-pago-cuota-servidor'
import { referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { anclaDeFila, columnasDeAncla } from '@/lib/suscripciones-producto/ancla'
import { configConCicloReversado, planSuspendidoPorReverso } from './plan'
import { fechaCorta } from '@/lib/valida-cda/pago-pendiente'

/**
 * «Pagar el período» de un plan suspendido por el reverso de su pago (decisión de Mauricio, 2026-10-27).
 *
 * Por qué un cobro aparte: el cobro de la cuota quedó ANULADO por el reverso (con su `monto_anulado`, su
 * factura si la hubo y su rastro), y la llave única `(plan_cobro_id, numero_cuota)` no admite otro cobro
 * de esa cuota. Tampoco se puede reusar: su referencia de ciclo (`one-ciclo:<cobro>`) quedó anulada en
 * Valida para siempre (409 ciclo_anulado). Así que el pago de reactivación es un cobro PROGRAMADO del
 * mismo cliente (misma ancla), SIN plan ni número de cuota, por el valor de la cuota, que se guarda en
 * `valida_plan.reversado.recobro_cobro_id`. Al pagarse por su enlace entra por el webhook de siempre y
 * `abrirCicloSiCorresponde` abre el ciclo del MISMO período con su propia referencia. El reparto FIFO lo
 * cuenta como plata del cliente: la cuota queda cubierta en la pestaña Pagos.
 *
 * Sin plan, nada del cron lo cobra solo: ni la tarjeta (7b) ni los enlaces automáticos (6). Lo pide la
 * persona desde `/valida` (o `/suscripcion`), y la tarjeta no se vuelve a cargar sin que lo pida.
 *
 * Todo con el cliente de servicio: el espacio sale de la sesión (la acción), nunca del navegador.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface DepsReactivacion {
  db: SupabaseClient
  adapterPara?: (pasarela: string) => PasarelaAdapter | null
  ahoraMs?: number
}

export type ResultadoReactivacion = { ok: true; url: string } | { ok: false; error: string }

export const SIN_SUSPENSION = 'Tu plan no está suspendido por la reversión de un pago.'

/** ⚠️ PENDIENTE DE VERA: texto propuesto por Max el 2026-10-29 (solo sale con la terminación encendida). */
export const PLAN_TERMINADO =
  'Tu plan terminó después de 30 días de suspensión sin pago (cláusula 11.2 de los Términos). Escríbenos a mauricio.moreno@metrik.com.co.'

export async function enlaceDeReactivacion(workspacePagadorId: string, deps: DepsReactivacion): Promise<ResultadoReactivacion> {
  const db = deps.db as Db
  const ahoraMs = deps.ahoraMs ?? Date.now()

  const ws = await db.from('workspaces').select('config_extra').eq('id', workspacePagadorId).maybeSingle()
  if (ws.error) return { ok: false, error: 'No se pudo leer tu plan. Intenta de nuevo en un momento.' }
  const config = (ws.data?.config_extra ?? {}) as Record<string, unknown>
  const plan = planSuspendidoPorReverso(config)
  if (!plan) return { ok: false, error: SIN_SUSPENSION }
  // Terminada por la 11.2: pagar ya no reabre el plan (el contrato está terminado y ningún ciclo se abre).
  if (plan.terminacion?.estado === 'terminada') return { ok: false, error: PLAN_TERMINADO }

  // El cobro reversado: el cliente, el plan y el valor del período.
  const rev = await db
    .from('cobros')
    .select('id, workspace_id, negocio_id, suscripcion_id, plan_cobro_id, numero_cuota, monto_anulado')
    .eq('id', plan.cobro_id)
    .maybeSingle()
  if (rev.error || !rev.data) return { ok: false, error: 'No encontramos el pago reversado. Escríbenos y lo resolvemos.' }
  const reversado = rev.data as {
    id: string
    workspace_id: string
    negocio_id: string | null
    suscripcion_id: string | null
    plan_cobro_id: string | null
    numero_cuota: number | null
    monto_anulado: number | string | null
  }
  const ancla = anclaDeFila(reversado)
  if (!ancla) return { ok: false, error: 'No encontramos el pago reversado. Escríbenos y lo resolvemos.' }

  // El valor del período: el de la cuota; si no se puede leer, lo que se reversó.
  let monto = Math.round(Number(reversado.monto_anulado ?? 0))
  let pasarelaPlan: string | null = null
  if (reversado.plan_cobro_id) {
    const [cuota, pl] = await Promise.all([
      reversado.numero_cuota !== null
        ? db.from('plan_cobro_cuotas').select('monto').eq('plan_cobro_id', reversado.plan_cobro_id).eq('numero', reversado.numero_cuota).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from('planes_cobro').select('pasarela').eq('id', reversado.plan_cobro_id).maybeSingle(),
    ])
    if (cuota.data?.monto) monto = Math.round(Number(cuota.data.monto))
    pasarelaPlan = (pl.data?.pasarela as string | null | undefined) ?? null
  }
  if (!(monto > 0)) return { ok: false, error: 'No encontramos el valor del período. Escríbenos y lo resolvemos.' }

  // 1. El cobro de reactivación: el que ya existe, o uno nuevo.
  let cobroId = plan.reversado.recobro_cobro_id ?? null
  let enlaceActual: { url: string | null; expira: string | null } = { url: null, expira: null }
  if (cobroId) {
    const c = await db.from('cobros').select('id, fecha, anulado_at, enlace_pago_url, enlace_pago_expira').eq('id', cobroId).maybeSingle()
    if (c.error) return { ok: false, error: 'No se pudo leer tu pago. Intenta de nuevo en un momento.' }
    const fila = c.data as { fecha: string | null; anulado_at: string | null; enlace_pago_url: string | null; enlace_pago_expira: string | null } | null
    if (fila?.fecha && !fila.anulado_at) return { ok: false, error: 'Ya recibimos el pago del período: tu plan se reactiva en unos minutos.' }
    if (!fila || fila.anulado_at) cobroId = null
    else {
      enlaceActual = { url: fila.enlace_pago_url, expira: fila.enlace_pago_expira }
      if (enlaceVigente({ enlacePagoUrl: fila.enlace_pago_url, enlacePagoExpira: fila.enlace_pago_expira }, ahoraMs)) {
        return { ok: true, url: fila.enlace_pago_url as string }
      }
    }
  }

  // La pasarela, por dato (la del plan o la de la configuración del espacio que cobra), como el enlace de una cuota.
  const cobrador = await db.from('workspaces').select('config_extra').eq('id', reversado.workspace_id).maybeSingle()
  const resolver = deps.adapterPara ?? adapterPara
  const pasarela = pasarelaDeEnlaces({
    pasarelaPlan,
    configWorkspace: cobrador.data?.config_extra ?? null,
    generaEnlaces: (x) => Boolean(resolver(x)?.crearEnlacePago),
  })
  const adapter = pasarela ? resolver(pasarela) : null
  if (!pasarela || !adapter?.crearEnlacePago) {
    console.error(`[reactivacion] ${MOTIVO_SIN_PASARELA}`)
    return { ok: false, error: 'El pago en línea no está disponible ahora. Escríbenos y te enviamos el enlace.' }
  }
  const faltante = adapter.faltaConfiguracion?.() ?? null
  if (faltante) {
    console.error(`[reactivacion] ${faltante}`)
    return { ok: false, error: 'El pago en línea no está disponible ahora. Escríbenos y te enviamos el enlace.' }
  }

  if (!cobroId) {
    const nuevo = await db
      .from('cobros')
      .insert({
        workspace_id: reversado.workspace_id,
        ...columnasDeAncla(ancla),
        // Sin plan ni cuota a propósito (ver la cabecera): la llave única de la cuota la tiene el anulado.
        plan_cobro_id: null,
        numero_cuota: null,
        monto,
        tipo_cobro: 'programado',
        fecha_esperada: todayBogotaISO(new Date(ahoraMs)),
        // `cobros.fecha` tiene DEFAULT CURRENT_DATE: sin el null explícito nace «pagado».
        fecha: null,
        revisado: false,
        retencion: 0,
        notas: `Reactivación de Valida: vuelve a pagar la cuota ${plan.cuota_numero} (período ${plan.desde} a ${plan.hasta}); el pago ${plan.reversado.referencia_pago} se reversó.`.slice(0, 1000),
      })
      .select('id')
      .single()
    if (nuevo.error || !nuevo.data?.id) return { ok: false, error: 'No pudimos preparar el pago. Intenta de nuevo en un momento.' }
    cobroId = nuevo.data.id as string
    // Se guarda en el plan, releyendo: si otra pestaña ya dejó el suyo en el medio, gana el primero.
    const re = await db.from('workspaces').select('config_extra').eq('id', workspacePagadorId).maybeSingle()
    const config2 = (re.data?.config_extra ?? {}) as Record<string, unknown>
    const plan2 = planSuspendidoPorReverso(config2)
    const otro = plan2?.reversado.recobro_cobro_id && plan2.reversado.recobro_cobro_id !== cobroId
    if (re.error || !plan2 || plan2.cobro_id !== plan.cobro_id || otro) {
      // El que sobra no queda como deuda pendiente: se anula sin pago.
      await db
        .from('cobros')
        .update({ monto: 0, monto_anulado: monto, anulado_at: new Date(ahoraMs).toISOString(), anulacion_motivo: 'Reactivación duplicada o descartada: el plan cambió en el medio.' })
        .eq('id', cobroId)
        .is('fecha', null)
      if (otro) return enlaceDeReactivacion(workspacePagadorId, deps)
      return { ok: false, error: 'Tu plan cambió mientras preparábamos el pago. Recarga la página.' }
    }
    const u = await db
      .from('workspaces')
      .update({ config_extra: configConCicloReversado(config2, plan2, { ...plan2.reversado, recobro_cobro_id: cobroId }) })
      .eq('id', workspacePagadorId)
    if (u.error) return { ok: false, error: 'No pudimos preparar el pago. Intenta de nuevo en un momento.' }
  }

  // 2. El enlace en la pasarela.
  const enlace = await adapter.crearEnlacePago({
    cobroId,
    monto,
    descripcion: `Valida · reactivación del período ${fechaCorta(plan.desde)} a ${fechaCorta(plan.hasta)}`.slice(0, 100),
    referencia: referenciaEnlaceCobro(cobroId, ahoraMs),
    expiraMs: ahoraMs + DIAS_VIGENCIA_ENLACE * 86_400_000,
  })
  if (!enlace.ok) {
    console.error(`[reactivacion] la pasarela no creó el enlace: ${enlace.error}`)
    return { ok: false, error: 'La pasarela no respondió. Intenta de nuevo en un momento.' }
  }

  // 3. El enlace en el cobro, con las guardas del enlace de una cuota: sin pagar, sin anular, y gana el primero.
  const base = db.from('cobros').update({ enlace_pago_url: enlace.url, enlace_pago_expira: enlace.expira }).eq('id', cobroId).is('fecha', null).is('anulado_at', null)
  const escrito = await (enlaceActual.url ? base.eq('enlace_pago_url', enlaceActual.url) : base.is('enlace_pago_url', null)).select('id')
  if (escrito.error || (escrito.data ?? []).length === 0) {
    return { ok: false, error: 'El pago cambió mientras preparábamos el enlace. Recarga la página.' }
  }
  return { ok: true, url: enlace.url }
}
