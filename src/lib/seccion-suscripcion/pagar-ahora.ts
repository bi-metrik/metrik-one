import { filtrarPorAncla } from '@/lib/suscripciones-producto/ancla'

/**
 * «Pagar ahora» de una cuota vencida de una SUSCRIPCIÓN (Valida autogestionada, 2026-10-19). Antes, tras
 * el rechazo de la tarjeta, la pantalla decía «MéTRIK te enviará el enlace» y no había nada que hacer:
 * el enlace solo lo genera el cron (paso 6), al día hábil siguiente. Aquí la persona lo pide YA, con la
 * MISMA función del botón y del cron (`generarEnlacePagoCuota`): nada de la lógica del enlace se duplica.
 *
 * Solo contratos colgados de una suscripción: los CDA (negocios) siguen con su «Pagar el mes» del Plan
 * Anual y lo de siempre. Reintentar con la misma tarjeta NO se ofrece: el primer cobro no se reintenta
 * (Condiciones 7.5, Términos 3.6). Cambiar la tarjeta no está construido.
 *
 * Sin `server-only`: recibe el cliente y el generador (las pruebas lo importan directo).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CtxPagarAhora {
  contrato: { suscripcionId: string | null; cobradorId: string }
  pago: { estado: 'ok'; pago: { estado: string; numero?: number; enlacePago?: string | null } } | { estado: string } | null
}

/** ¿La pantalla ofrece «Pagar ahora»? Suscripción, cuota pendiente y sin enlace vigente. */
export function ofrecePagarAhora(ctx: CtxPagarAhora): boolean {
  if (!ctx.contrato.suscripcionId || ctx.pago?.estado !== 'ok') return false
  const p = (ctx.pago as { pago: { estado: string; enlacePago?: string | null } }).pago
  return p.estado === 'pendiente' && !p.enlacePago
}

export async function enlaceDeCuotaPendiente(
  ctx: CtxPagarAhora,
  deps: {
    db: unknown
    generar: (p: { workspaceId: string; cuotaId: string }) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
  },
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (!ctx.contrato.suscripcionId || ctx.pago?.estado !== 'ok') return { ok: false, error: 'No hay una cuota pendiente para pagar.' }
  const p = (ctx.pago as { pago: { estado: string; numero?: number; enlacePago?: string | null } }).pago
  if (p.estado !== 'pendiente' || typeof p.numero !== 'number') return { ok: false, error: 'No hay una cuota pendiente para pagar.' }
  if (p.enlacePago) return { ok: true, url: p.enlacePago }
  const db = deps.db as Db
  const plan = await filtrarPorAncla(db.from('planes_cobro').select('id').eq('workspace_id', ctx.contrato.cobradorId), {
    tipo: 'suscripcion',
    id: ctx.contrato.suscripcionId,
  }).maybeSingle()
  if (plan.error || !plan.data) return { ok: false, error: 'No encontramos el plan de tu suscripción. Escríbenos y lo resolvemos.' }
  const cuota = await db.from('plan_cobro_cuotas').select('id').eq('plan_cobro_id', plan.data.id).eq('numero', p.numero).maybeSingle()
  if (cuota.error || !cuota.data) return { ok: false, error: 'No encontramos la cuota. Escríbenos y lo resolvemos.' }
  return deps.generar({ workspaceId: ctx.contrato.cobradorId, cuotaId: cuota.data.id as string })
}

/**
 * El último rechazo de la tarjeta en esa cuota, para decirlo en pantalla («el banco rechazó…»). Solo un
 * rechazo del banco (`resultado = 'rechazado'`); una falla técnica nuestra no se le cuenta a la tarjeta.
 * El mensaje se guarda como `<código>: <respuesta>`; se muestra la respuesta.
 */
export async function rechazoDeLaTarjeta(ctx: CtxPagarAhora, db: unknown): Promise<string | null> {
  if (!ctx.contrato.suscripcionId || ctx.pago?.estado !== 'ok') return null
  const p = (ctx.pago as { pago: { estado: string; numero?: number } }).pago
  if (p.estado !== 'pendiente' || typeof p.numero !== 'number') return null
  const d = db as Db
  const plan = await filtrarPorAncla(d.from('planes_cobro').select('id').eq('workspace_id', ctx.contrato.cobradorId), {
    tipo: 'suscripcion',
    id: ctx.contrato.suscripcionId,
  }).maybeSingle()
  if (plan.error || !plan.data) return null
  const r = await d
    .from('cobro_intentos_tarjeta')
    .select('mensaje, updated_at')
    .eq('plan_cobro_id', plan.data.id)
    .eq('numero_cuota', p.numero)
    .eq('resultado', 'rechazado')
    .order('updated_at', { ascending: false })
    .limit(1)
  const fila = ((r.data ?? []) as { mensaje: string | null }[])[0]
  if (r.error || !fila) return null
  const m = (fila.mensaje ?? '').replace(/^[^:]{1,40}:\s*/, '').trim()
  return m || 'la tarjeta no pasó'
}
