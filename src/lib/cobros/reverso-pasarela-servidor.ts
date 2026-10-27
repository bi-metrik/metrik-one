import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'
import type { CobroParaPago } from './pago-en-linea'
import { anclaDeFila, filtrarPorAncla } from '@/lib/suscripciones-producto/ancla'
import { configConCicloReversado, planDeConfig } from '@/lib/valida-registro/plan'
import {
  AVISO_REVERSO_PARA,
  correoAvisoReverso,
  detalleReverso,
  motivoAnulacionPorReverso,
  notasConReverso,
  type DatosAvisoReverso,
} from './reverso-pasarela'

/**
 * El lado de Supabase del reverso de un pago (ver `reverso-pasarela.ts`): anula el cobro, mira si ya
 * tenía factura y avisa a MéTRIK. Lo llama el repositorio del pago en línea (`anularPorReverso`), desde
 * la confirmación de ePayco o desde la conciliación (`reversos-epayco-servidor.ts`), con el cliente de
 * SERVICIO. Sin `server-only`: recibe el cliente y el envío; las pruebas lo importan directo.
 *
 * La escritura lleva las guardas de la anulación manual (`pagos-externos.ts`): solo un cobro sin anular
 * y, además, pagado con ESA transacción. Si otro camino lo anuló entre la lectura y la escritura, no se
 * pisa su `monto_anulado` con un 0 y no se manda otro aviso.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface CorreoInterno {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
}

export type EnvioCorreoInterno = (m: CorreoInterno) => Promise<{ ok: true } | { ok: false; error: string }>

const FROM_INTERNO = 'MéTRIK ONE <noreply@metrikone.co>'

export async function enviarCorreoInternoPorResend(m: CorreoInterno): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'sin RESEND_API_KEY' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotencyKey },
      body: JSON.stringify({ from: FROM_INTERNO, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok ? { ok: true } : { ok: false, error: `Resend respondió ${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface DepsReverso {
  enviarCorreo?: EnvioCorreoInterno
  ahora?: () => Date
}

/** La factura del cobro (`facturas_cobro`, una por cobro). Una lectura fallida no se toma por «sin factura». */
async function facturaDelCobro(db: Db, cobroId: string): Promise<DatosAvisoReverso['factura']> {
  const r = await db.from('facturas_cobro').select('numero, fecha_emision').eq('cobro_id', cobroId).maybeSingle()
  if (r.error) return 'desconocida'
  const f = r.data as { numero: string; fecha_emision: string | null } | null
  return f ? { numero: f.numero, fecha: f.fecha_emision } : null
}

/** Quién paga y qué cuota, para el aviso. Lo que no se pueda leer queda en null: el aviso sale igual. */
async function contextoDelCobro(db: Db, cobro: CobroParaPago): Promise<{ cliente: string | null; numeroCuota: number | null }> {
  let numeroCuota: number | null = null
  let cliente: string | null = null
  try {
    const c = await db.from('cobros').select('numero_cuota').eq('id', cobro.id).maybeSingle()
    numeroCuota = (c.data as { numero_cuota: number | null } | null)?.numero_cuota ?? null
    if (cobro.suscripcionId) {
      const s = await db.from('suscripciones_producto').select('razon_social, numero_documento').eq('id', cobro.suscripcionId).maybeSingle()
      const f = s.data as { razon_social: string | null; numero_documento: string | null } | null
      if (f?.razon_social) cliente = f.numero_documento ? `${f.razon_social} (NIT ${f.numero_documento})` : f.razon_social
    } else if (cobro.negocioId) {
      const n = await db.from('negocios').select('codigo, nombre').eq('id', cobro.negocioId).maybeSingle()
      const f = n.data as { codigo: string | null; nombre: string | null } | null
      if (f) cliente = [f.codigo, f.nombre].filter(Boolean).join(' · ') || null
    }
  } catch {
    // Solo es contexto del aviso.
  }
  return { cliente, numeroCuota }
}

/**
 * Si el pago reversado es el que abrió el ciclo VIGENTE de Valida de un espacio autogestionado
 * (`config_extra.valida_plan.cobro_id`), lo marca (`valida_plan.reversado`) y lo dice. NO lo cierra en
 * Valida: no hay ruta para eso y es una decisión de Términos. Una falla aquí no deshace la anulación:
 * queda dicha en el detalle (`'error'`).
 */
async function marcarCicloDeValida(db: Db, cobro: CobroParaPago, referenciaPago: string, ahora: string): Promise<DatosAvisoReverso['cicloValida']> {
  try {
    const ancla = anclaDeFila({ negocio_id: cobro.negocioId, suscripcion_id: cobro.suscripcionId ?? null })
    if (!ancla) return null
    const sc = await filtrarPorAncla(db.from('servicios_contratados').select('workspace_pagador_id').eq('workspace_id', cobro.workspaceId), ancla)
    if (sc.error) throw new Error(sc.error.message)
    const pagadores = [...new Set(((sc.data ?? []) as { workspace_pagador_id: string | null }[]).map((c) => c.workspace_pagador_id).filter(Boolean))] as string[]
    for (const id of pagadores) {
      const ws = await db.from('workspaces').select('config_extra').eq('id', id).maybeSingle()
      if (ws.error) throw new Error(ws.error.message)
      const config = ((ws.data as { config_extra: Record<string, unknown> | null } | null)?.config_extra ?? {}) as Record<string, unknown>
      const plan = planDeConfig(config)
      if (!plan || plan.cobro_id !== cobro.id) continue
      if (!plan.reversado) {
        const u = await db.from('workspaces').update({ config_extra: configConCicloReversado(config, plan, { at: ahora, referencia_pago: referenciaPago }) }).eq('id', id)
        if (u.error) throw new Error(u.error.message)
      }
      return { hasta: plan.hasta, consultas: plan.limite_mes, cuota: plan.cuota_numero }
    }
    return null
  } catch (err) {
    console.error(`[reverso] no se pudo marcar el ciclo de Valida del cobro ${cobro.id}:`, err instanceof Error ? err.message : err)
    return 'error'
  }
}

export async function anularCobroPorReverso(
  dbCliente: SupabaseClient,
  pasarela: string,
  cobro: CobroParaPago,
  e: EventoPasarela,
  deps: DepsReverso = {},
): Promise<{ anulado: boolean; detalle: string }> {
  const db = dbCliente as Db
  const ahora = (deps.ahora ?? (() => new Date()))().toISOString()
  const motivo = motivoAnulacionPorReverso(pasarela, e.referenciaPago)
  const monto = Math.round(cobro.monto)

  const u = await db
    .from('cobros')
    .update({
      monto: 0,
      monto_anulado: monto,
      anulado_at: ahora,
      // No lo anuló una persona: `anulado_por` es FK a profiles y queda vacío.
      anulado_por: null,
      anulacion_motivo: motivo,
      notas: notasConReverso(motivo, ahora, cobro.notas),
    })
    .eq('id', cobro.id)
    .eq('workspace_id', cobro.workspaceId)
    .eq('external_ref', e.referenciaPago)
    .is('anulado_at', null)
    .select('id')
  if (u.error) throw new Error(`anular el cobro ${cobro.id} por el reverso ${e.referenciaPago}: ${u.error.message}`)
  if ((u.data ?? []).length !== 1) {
    return { anulado: false, detalle: `Reverso del pago ${e.referenciaPago}: el cobro ya se había anulado por otro camino. No se tocó nada.` }
  }

  const [factura, ctx, cicloValida] = await Promise.all([
    facturaDelCobro(db, cobro.id),
    contextoDelCobro(db, cobro),
    marcarCicloDeValida(db, cobro, e.referenciaPago, ahora),
  ])
  const datos: DatosAvisoReverso = { pasarela, referenciaPago: e.referenciaPago, cobroId: cobro.id, monto, factura, cicloValida, ...ctx }
  const correo = correoAvisoReverso(datos)
  let envio: { ok: true } | { ok: false; error: string }
  try {
    envio = await (deps.enviarCorreo ?? enviarCorreoInternoPorResend)({
      to: AVISO_REVERSO_PARA,
      ...correo,
      idempotencyKey: `reverso-${pasarela}-${e.transaccionId}`,
    })
  } catch (err) {
    envio = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!envio.ok) console.error(`[reverso-${pasarela}] no salió el aviso interno del cobro ${cobro.id}: ${envio.error}`)
  const aviso = envio.ok ? 'Aviso interno enviado a MéTRIK.' : `El aviso interno NO salió (${envio.error}).`
  return { anulado: true, detalle: `${detalleReverso(datos)} ${aviso}` }
}
