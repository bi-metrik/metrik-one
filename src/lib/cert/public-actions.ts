'use server'

import { createClient } from '@supabase/supabase-js'

// Cliente service-role sin tipo (tablas cert_* no estan en database.ts).
function svc() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

const UUID_RE = /^[0-9a-fA-F-]{36}$/

/**
 * Descarga del Databook protegida por contraseña = número de contrato.
 * Llamada desde la página pública (sin sesión). Valida la contraseña contra
 * cert_lotes.numero_contrato y, si coincide, devuelve un signed URL temporal
 * del bucket privado cert-databooks.
 */
export async function getDatabookUrl(
  loteId: string,
  password: string
): Promise<{ url?: string; error?: string }> {
  if (!UUID_RE.test(loteId)) return { error: 'Certificado no válido' }
  const db = svc()

  const { data: lote } = await db
    .from('cert_lotes')
    .select('numero_contrato, cert_producto_id, workspace_id')
    .eq('id', loteId)
    .eq('estado', 'publicado')
    .maybeSingle()
  if (!lote) return { error: 'Certificado no encontrado' }

  // Defensa: módulo activo
  const { data: ws } = await db.from('workspaces').select('modules').eq('id', lote.workspace_id).maybeSingle()
  if (!((ws?.modules ?? {}) as Record<string, boolean>).cert_qr) return { error: 'No disponible' }

  if (!lote.numero_contrato) return { error: 'Este certificado no tiene contrato registrado para descarga.' }
  if (!password || password.trim() !== String(lote.numero_contrato).trim()) {
    return { error: 'Número de contrato incorrecto.' }
  }

  if (!lote.cert_producto_id) return { error: 'Databook no disponible.' }
  const { data: prod } = await db
    .from('cert_productos').select('databook_path, databook_nombre').eq('id', lote.cert_producto_id).maybeSingle()
  if (!prod?.databook_path) return { error: 'El producto no tiene Databook cargado.' }

  const { data: signed, error } = await db.storage
    .from('cert-databooks')
    .createSignedUrl(prod.databook_path as string, 120, { download: (prod.databook_nombre as string | null) ?? 'Databook.pdf' })
  if (error || !signed?.signedUrl) return { error: 'No se pudo generar el enlace.' }

  return { url: signed.signedUrl }
}
