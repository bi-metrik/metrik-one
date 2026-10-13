'use server'

/**
 * Riel de facturación del viaje (F5, Noor «Riel B»): «Facturar ya» con motivo (solo la dirección) y
 * los datos de facturación del titular, editables hasta emitir.
 *
 * El servidor revisa el rol (Vera C15, §7.4): forzar la factura es de la dirección
 * (`aprobaciones.staff_ids`, Edgar por defecto); no alcanza con el permiso genérico de corregir
 * documentos (Vera C4). Corregir los datos es de la comercial dueña o de la dirección.
 */

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { accionIdempotente } from '@/lib/idempotencia/accion'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { contextoViaje } from '@/lib/viaje/contexto-viaje'
import { leerTitular, type TitularFacturacion } from '@/lib/viaje/confirmacion'
import { configFacturacionLinea, MIN_MOTIVO_FORZAR } from '@/lib/facturacion/regla-viaje'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { emitirReciboViaje } from '@/lib/viaje/riel-cobro-datos'
import { entornoSiigo } from '@/lib/siigo/config-viaje'
import type { SiigoConfig } from '@/lib/siigo/client'
import { negociosDePruebaOcultos, sinOcultos } from '@/lib/negocios/negocios-de-prueba'

const MENSAJE_EN_CURSO = 'Tu acción anterior todavía se está guardando. Espera un momento.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

type Resultado = { ok: true } | { ok: false; error: string }

/**
 * «Facturar ya» (Vera C4, F5-3): la dirección pone la factura en la cola antes de su evento, con
 * motivo. Queda como aprobación `forzar_factura` aprobada (la decide quien la pide: es la dirección).
 */
async function forzarFacturaViajeSinClave(negocioId: string, motivo: string): Promise<Resultado> {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return { ok: false, error: c.error }
  const ctx = c.ctx
  if (!ctx.esDireccion) return { ok: false, error: 'Solo la dirección puede facturar antes de tiempo.' }
  if (!ctx.staffId) return { ok: false, error: 'Tu usuario no está en el equipo del espacio.' }
  const f = configFacturacionLinea(ctx.configLinea)
  if (!f.activo || !f.porTitular) return { ok: false, error: 'La facturación del viaje no está encendida en esta línea.' }
  const razon = (motivo ?? '').trim()
  if (razon.length < MIN_MOTIVO_FORZAR) return { ok: false, error: '¿Por qué antes de tiempo? Escribe el motivo.' }
  if ((ctx.negocio.metadata as { siigo_factura?: { numero?: string } } | null)?.siigo_factura?.numero) {
    return { ok: false, error: 'Este viaje ya está facturado.' }
  }

  const svc = createServiceClient() as Db
  const ahora = new Date().toISOString()
  const { error } = await svc.from('aprobaciones_excepcion').insert({
    workspace_id: ctx.workspaceId,
    negocio_id: negocioId,
    entidad_tipo: 'factura',
    entidad_id: negocioId,
    tipo: 'forzar_factura',
    estado: 'aprobada',
    huella: `forzar_factura|${negocioId}`,
    detalle: { motivo: razon },
    motivo: razon,
    solicitada_por: ctx.staffId,
    decidida_por: ctx.staffId,
    decidida_at: ahora,
  })
  // 23505: ya estaba forzada (índice único de la vigente). Es el mismo resultado.
  if (error && (error as { code?: string }).code !== '23505') return { ok: false, error: `No se pudo poner en la cola: ${error.message}` }
  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: `Mandó a facturar antes de tiempo: ${razon}`.slice(0, 280),
  }, 'forzarFacturaViaje')
  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/facturacion')
  return { ok: true }
}

export async function forzarFacturaViaje(negocioId: string, motivo: string, intencion?: string): Promise<Resultado> {
  return accionIdempotente<Resultado>(
    { accion: 'forzarFacturaViaje', clave: intencion, args: [negocioId, motivo], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => forzarFacturaViajeSinClave(negocioId, motivo),
  )
}

/**
 * Los datos de facturación del titular (Noor, Riel B: «Ver datos de facturación», editables hasta
 * emitir; «A nombre de otra persona o empresa»). Con dirección y ciudad, que el tercero de Siigo
 * exige y la confirmación no pide.
 */
async function guardarDatosFacturacionViajeSinClave(negocioId: string, datos: unknown): Promise<Resultado> {
  const c = await contextoViaje(negocioId)
  if (!c.ok) return { ok: false, error: c.error }
  const ctx = c.ctx
  if (!ctx.puedeConfirmar) return { ok: false, error: 'Solo la comercial del negocio o la dirección cambian los datos de facturación.' }
  const meta = (ctx.negocio.metadata ?? {}) as Record<string, unknown>
  if ((meta.siigo_factura as { numero?: string } | undefined)?.numero) {
    return { ok: false, error: 'La factura ya salió: los datos no se cambian, la factura se anula y se hace otra.' }
  }

  const { data: contacto } = ctx.negocio.contacto_id
    ? await ctx.supabase.from('contactos').select('nombre, email, telefono').eq('id', ctx.negocio.contacto_id).maybeSingle()
    : { data: null }
  const ct = contacto as { nombre?: string | null; email?: string | null; telefono?: string | null } | null
  const leido = leerTitular(datos, { nombre: ct?.nombre?.trim() || ctx.negocio.nombre || '', correo: ct?.email ?? null, telefono: ct?.telefono ?? null })
  if (!leido.ok) return { ok: false, error: leido.error }
  const titular: TitularFacturacion = leido.titular

  const { error } = await ctx.supabase
    .from('negocios')
    .update({ metadata: { ...meta, titular_facturacion: titular } })
    .eq('id', negocioId)
    .eq('workspace_id', ctx.workspaceId)
  if (error) return { ok: false, error: error.message }
  await registrarActividad(ctx.supabase, {
    workspace_id: ctx.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: ctx.staffId,
    contenido: `Actualizó los datos de facturación: a nombre de ${titular.nombre}.`.slice(0, 280),
  }, 'guardarDatosFacturacionViaje')
  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/facturacion')
  return { ok: true }
}

// ── «Emitir pendientes» (adenda Siigo) ───────────────────────────────────────

/**
 * Encender Siigo NO vacía la cola sola: lo que quedó pendiente mientras no había credenciales se
 * emite con «Emitir pendientes» (lote con confirmación y conteo) o caso por caso con «Reintentar».
 * Lo puede la financiera o la dirección.
 */
async function puedeEmitirPendientes(): Promise<{ ok: true; workspaceId: string; staffId: string | null } | { ok: false; error: string }> {
  const { workspaceId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }
  const financiera = ((areas ?? []) as string[]).includes('financiera')
  if (!(role === 'owner' || role === 'admin' || financiera)) return { ok: false, error: 'Solo la financiera o la dirección emiten los pendientes.' }
  return { ok: true, workspaceId, staffId: staffId ?? null }
}

interface PendienteRecibo { negocioId: string; cobroId: string; configLinea: Record<string, unknown> }

/** Los recibos de viaje que quedaron pendientes (`negocios.metadata.recibos_viaje`). */
async function recibosPendientes(svc: Db, workspaceId: string, staffId: string | null): Promise<PendienteRecibo[]> {
  const { data, error } = await svc
    .from('negocios')
    .select('id, metadata, linea_id')
    .eq('workspace_id', workspaceId)
    .not('metadata->recibos_viaje', 'is', null)
  if (error) throw new Error(`No se pudieron leer los pendientes: ${error.message}`)
  // Los recibos del viaje de prueba (F8-1) no los cuenta ni los emite quien no lo lleva ni lo
  // aprueba: el lote de la financiera real no puede mandar un recibo de prueba a su Siigo.
  const negocios = sinOcultos(
    (data ?? []) as Array<{ id: string; metadata: Record<string, unknown> | null; linea_id: string | null }>,
    await negociosDePruebaOcultos(svc, workspaceId, staffId),
    n => n.id,
  )
  const lineaIds = [...new Set(negocios.map(n => n.linea_id).filter((x): x is string => !!x))]
  const { data: lineas } = lineaIds.length > 0
    ? await svc.from('lineas_negocio').select('id, config_extra').in('id', lineaIds)
    : { data: [] }
  const configDe = new Map(((lineas ?? []) as Array<{ id: string; config_extra: Record<string, unknown> | null }>).map(l => [l.id, l.config_extra ?? {}]))
  const out: PendienteRecibo[] = []
  for (const n of negocios) {
    const pend = (n.metadata?.recibos_viaje ?? {}) as Record<string, unknown>
    for (const cobroId of Object.keys(pend)) out.push({ negocioId: n.id, cobroId, configLinea: configDe.get(n.linea_id ?? '') ?? {} })
  }
  return out
}

export async function contarPendientesSiigoViaje(): Promise<{ ok: true; recibos: number; entorno: 'pruebas' | 'produccion' | null } | { ok: false; error: string }> {
  const q = await puedeEmitirPendientes()
  if (!q.ok) return q
  const svc = createServiceClient() as Db
  try {
    const [pend, { data: ws }] = await Promise.all([
      recibosPendientes(svc, q.workspaceId, q.staffId),
      svc.from('workspaces').select('config_extra').eq('id', q.workspaceId).maybeSingle(),
    ])
    const cfg = ((ws as { config_extra?: { siigo_config?: Partial<SiigoConfig> } } | null)?.config_extra?.siigo_config) ?? null
    return { ok: true, recibos: pend.length, entorno: cfg ? entornoSiigo(cfg) : null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Emite en lote los recibos pendientes. Exige el conteo que la persona vio y confirmó: si cambió
 * (entró otro pago, alguien reintentó uno), no emite y devuelve el conteo nuevo para volver a
 * confirmar. Uno por cobro, nunca dos (idempotencia del recibo de siempre).
 */
async function emitirPendientesSiigoViajeSinClave(conteoConfirmado: number): Promise<{ ok: true; emitidos: number; siguenPendientes: number } | { ok: false; error: string; conteo?: number }> {
  const q = await puedeEmitirPendientes()
  if (!q.ok) return q
  const svc = createServiceClient() as Db
  const pend = await recibosPendientes(svc, q.workspaceId, q.staffId)
  if (!Number.isInteger(conteoConfirmado) || conteoConfirmado !== pend.length) {
    return { ok: false, error: `Ahora hay ${pend.length} recibos pendientes. Confirma de nuevo.`, conteo: pend.length }
  }
  if (pend.length === 0) return { ok: true, emitidos: 0, siguenPendientes: 0 }
  const { data: st } = q.staffId ? await svc.from('staff').select('full_name').eq('id', q.staffId).maybeSingle() : { data: null }
  const nombre = ((st as { full_name?: string | null } | null)?.full_name ?? '').trim() || null
  let emitidos = 0
  let siguen = 0
  // Uno detrás de otro: Siigo limita la tasa y cada recibo consume numeración.
  for (const p of pend) {
    const r = await emitirReciboViaje({ workspaceId: q.workspaceId, negocioId: p.negocioId, cobroId: p.cobroId, staffNombre: nombre, configLinea: p.configLinea })
    if (r.numero) emitidos++
    else siguen++
  }
  revalidatePath('/conciliacion')
  return { ok: true, emitidos, siguenPendientes: siguen }
}

export async function emitirPendientesSiigoViaje(conteoConfirmado: number, intencion?: string) {
  return accionIdempotente<Awaited<ReturnType<typeof emitirPendientesSiigoViajeSinClave>>>(
    { accion: 'emitirPendientesSiigoViaje', clave: intencion, args: [conteoConfirmado], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => emitirPendientesSiigoViajeSinClave(conteoConfirmado),
  )
}

export async function guardarDatosFacturacionViaje(negocioId: string, datos: unknown, intencion?: string): Promise<Resultado> {
  return accionIdempotente<Resultado>(
    { accion: 'guardarDatosFacturacionViaje', clave: intencion, args: [negocioId, datos], enCurso: () => ({ ok: false, error: MENSAJE_EN_CURSO }) },
    () => guardarDatosFacturacionViajeSinClave(negocioId, datos),
  )
}
