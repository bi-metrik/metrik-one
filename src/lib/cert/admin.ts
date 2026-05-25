'use server'

import { revalidatePath } from 'next/cache'
import QRCode from 'qrcode'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'

// Las tablas cert_* aun no estan en database.ts. Usamos el cliente autenticado
// (RLS aplica por la sesion del usuario) casteado a sin-tipo para esas tablas.
type AnyDB = SupabaseClient

async function ctx() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('No autenticado')
  const { data: profile } = await sb
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  const workspaceId = profile?.workspace_id as string | undefined
  if (!workspaceId) throw new Error('Sin workspace')

  // Certificador configurado (server-only) — solo el ingeniero matriculado firma.
  const svc = createServiceClient()
  const { data: ws } = await svc
    .from('workspaces')
    .select('slug, modules, config_extra')
    .eq('id', workspaceId)
    .single()
  const modules = (ws?.modules ?? {}) as Record<string, boolean>
  if (!modules.cert_qr) throw new Error('Modulo no activo')
  const cert = ((ws?.config_extra as Record<string, unknown> | null)?.cert ?? {}) as {
    ingeniero?: { profile_id?: string }
  }
  const esCertificador = !!cert.ingeniero?.profile_id && cert.ingeniero.profile_id === user.id

  return {
    db: sb as unknown as AnyDB,
    sb,
    userId: user.id,
    workspaceId,
    slug: ws?.slug as string,
    esCertificador,
  }
}

function requireCertificador(esCertificador: boolean) {
  if (!esCertificador) throw new Error('Solo el ingeniero certificador puede ejecutar esta acción')
}

export async function listCertData() {
  const { db, workspaceId, esCertificador } = await ctx()
  const { data: lotes } = await db
    .from('cert_lotes')
    .select('*, negocios(codigo), cert_productos(nombre, producto_tipo)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  const { data: productos } = await db
    .from('cert_productos')
    .select('id, sku, nombre, serie, ficha, databook_path, databook_nombre')
    .eq('workspace_id', workspaceId)
    .order('sku')
  const { data: negocios } = await db
    .from('negocios')
    .select('id, codigo, nombre')
    .eq('workspace_id', workspaceId)
    .order('codigo')
  const conDb = (productos ?? []).find((p: { databook_path?: string }) => p.databook_path)
  return {
    lotes: lotes ?? [],
    productos: productos ?? [],
    negocios: negocios ?? [],
    esCertificador,
    databookActual: (conDb?.databook_nombre as string | undefined) ?? null,
  }
}

// Sube el DataBook de línea (un PDF que aplica a TODAS las referencias del ws).
export async function subirDatabookLinea(formData: FormData) {
  const { db, workspaceId, esCertificador } = await ctx()
  requireCertificador(esCertificador)
  const file = formData.get('file') as File | null
  if (!file) throw new Error('Selecciona un archivo PDF')
  if (file.type !== 'application/pdf') throw new Error('El DataBook debe ser PDF')
  if (file.size > 50 * 1024 * 1024) throw new Error('Máximo 50 MB')

  const svc = createServiceClient()
  const buf = Buffer.from(await file.arrayBuffer())
  const path = `${workspaceId}/databook-linea.pdf`
  const { error: upErr } = await svc.storage.from('cert-databooks').upload(path, buf, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error(upErr.message)

  // Aplica a todas las referencias de la línea (databook único).
  const { error } = await db.from('cert_productos')
    .update({ databook_path: path, databook_nombre: file.name })
    .eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)
  revalidatePath('/certificaciones')
}

export interface CrearBorradorInput {
  negocio_id: string
  cert_producto_id: string
  cantidad: number
  ubicacion?: string | null
  numero_contrato?: string | null
}

export async function crearBorrador(input: CrearBorradorInput) {
  const { db, workspaceId } = await ctx()

  // Negocio debe pertenecer al workspace
  const { data: neg } = await db
    .from('negocios').select('id').eq('id', input.negocio_id).eq('workspace_id', workspaceId).maybeSingle()
  if (!neg) throw new Error('Negocio inválido para este workspace')

  // El producto YA es la variante validada (su material está en ficha.material).
  const { data: prod } = await db
    .from('cert_productos').select('id, sku, ficha').eq('id', input.cert_producto_id).eq('workspace_id', workspaceId).maybeSingle()
  if (!prod) throw new Error('Producto inválido')
  const ficha = (prod.ficha ?? {}) as { material?: { ratio?: number; cumple?: boolean; perfil?: string; calibre?: string; orientacion?: string | null } }
  const mat = ficha.material
  if (!mat || mat.cumple !== true) {
    throw new Error('El producto no tiene un material validado (CUMPLE). No se puede certificar.')
  }

  const cantidad = Math.max(1, Math.floor(input.cantidad || 1))
  const { error } = await db.from('cert_lotes').insert({
    workspace_id: workspaceId,
    negocio_id: input.negocio_id,
    cert_producto_id: input.cert_producto_id,
    sku: prod.sku,
    // numero_lote lo asigna el trigger cert_lote_set_numero (consecutivo por producto)
    serie_desde: 1,
    serie_hasta: cantidad,
    material_perfil: mat.perfil ?? null,
    material_calibre: mat.calibre ?? null,
    orientacion_instalacion: mat.orientacion ?? null,
    cumple: mat.cumple,
    ratio_critico: mat.ratio ?? null,
    ratio_descripcion: 'Ratio gobernante validado',
    ubicacion: input.ubicacion?.trim() || null,
    numero_contrato: input.numero_contrato?.trim() || null,
    estado: 'borrador',
    certificado_para: 'WMC Soluciones Metálicas',
    vigencia_meses: 12,
  })
  if (error) throw new Error(error.message)
  revalidatePath('/certificaciones')
}

export async function enviarAprobacion(id: string) {
  const { db, workspaceId } = await ctx()
  const { error } = await db.from('cert_lotes')
    .update({ estado: 'pendiente_aprobacion', enviado_aprobacion_at: new Date().toISOString() })
    .eq('id', id).eq('workspace_id', workspaceId).eq('estado', 'borrador')
  if (error) throw new Error(error.message)
  revalidatePath('/certificaciones')
}

export async function aprobarPublicar(id: string) {
  const { db, workspaceId, userId, esCertificador } = await ctx()
  requireCertificador(esCertificador)
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: lote, error } = await db.from('cert_lotes')
    .update({
      estado: 'publicado',
      fecha_certificacion: hoy,
      publicado_por: userId,
      publicado_at: new Date().toISOString(),
    })
    .eq('id', id).eq('workspace_id', workspaceId).in('estado', ['pendiente_aprobacion', 'borrador'])
    .select('id, fecha_certificacion, fecha_vencimiento, ratio_critico')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (lote) {
    await db.from('cert_recertificaciones').insert({
      workspace_id: workspaceId,
      cert_lote_id: id,
      fecha_certificacion: lote.fecha_certificacion,
      fecha_vencimiento: lote.fecha_vencimiento,
      ratio_critico: lote.ratio_critico,
      created_by: userId,
    })
  }
  revalidatePath('/certificaciones')
}

export async function devolverBorrador(id: string) {
  const { db, workspaceId, esCertificador } = await ctx()
  requireCertificador(esCertificador)
  const { error } = await db.from('cert_lotes')
    .update({ estado: 'borrador' }).eq('id', id).eq('workspace_id', workspaceId).eq('estado', 'pendiente_aprobacion')
  if (error) throw new Error(error.message)
  revalidatePath('/certificaciones')
}

export async function revocar(id: string) {
  const { db, workspaceId, esCertificador } = await ctx()
  requireCertificador(esCertificador)
  const { error } = await db.from('cert_lotes')
    .update({ estado: 'revocado' }).eq('id', id).eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)
  revalidatePath('/certificaciones')
}

// Recertificacion: el ingeniero renueva la vigencia de un lote y registra el evento.
export async function recertificar(id: string) {
  const { db, workspaceId, userId, esCertificador } = await ctx()
  requireCertificador(esCertificador)
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: lote, error } = await db.from('cert_lotes')
    .update({
      estado: 'publicado',
      fecha_certificacion: hoy,
      publicado_por: userId,
      publicado_at: new Date().toISOString(),
    })
    .eq('id', id).eq('workspace_id', workspaceId)
    .select('id, fecha_certificacion, fecha_vencimiento, ratio_critico')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (lote) {
    await db.from('cert_recertificaciones').insert({
      workspace_id: workspaceId,
      cert_lote_id: id,
      fecha_certificacion: lote.fecha_certificacion,
      fecha_vencimiento: lote.fecha_vencimiento,
      ratio_critico: lote.ratio_critico,
      notas: 'Recertificación',
      created_by: userId,
    })
  }
  revalidatePath('/certificaciones')
}

async function loteUrl(id: string): Promise<string> {
  const { db, workspaceId, slug } = await ctx()
  const { data } = await db.from('cert_lotes').select('short_code').eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
  const base = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co'
  return `https://${slug}.${base}/c/${data?.short_code}`
}

export async function getQr(id: string): Promise<{ svg: string; png: string; url: string }> {
  const url = await loteUrl(id)
  const opts = { errorCorrectionLevel: 'H' as const, margin: 2 }
  const svg = await QRCode.toString(url, { ...opts, type: 'svg' })
  const png = await QRCode.toDataURL(url, { ...opts, width: 1200 })
  return { svg, png, url }
}
