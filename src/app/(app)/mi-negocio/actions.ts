'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Update Extended Fiscal Fields ────────────────────────

export async function updateFiscalExtended(data: {
  nit?: string
  razon_social?: string
  direccion_fiscal?: string
  email_facturacion?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('fiscal_profiles')
    .update({
      nit: data.nit?.trim() || null,
      razon_social: data.razon_social?.trim() || null,
      direccion_fiscal: data.direccion_fiscal?.trim() || null,
      email_facturacion: data.email_facturacion?.trim() || null,
    })
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  return { success: true }
}

// ── Update Branding (logo, colors) ──────────────────────

export async function updateBranding(data: {
  logo_url?: string
  color_primario?: string
  color_secundario?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('workspaces')
    .update({
      logo_url: data.logo_url?.trim() || null,
      color_primario: data.color_primario || '#10B981',
      color_secundario: data.color_secundario || '#1A1A1A',
    })
    .eq('id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  return { success: true }
}

// ── Upload Logo File ────────────────────────────────────

export async function uploadLogo(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const file = formData.get('logo') as File
  if (!file || file.size === 0) return { success: false, error: 'No se seleccionó archivo' }

  // Validate
  const MAX_SIZE = 2 * 1024 * 1024 // 2MB
  const ALLOWED_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']

  if (file.size > MAX_SIZE) return { success: false, error: 'El archivo no puede superar 2MB' }
  if (!ALLOWED_TYPES.includes(file.type)) return { success: false, error: 'Solo se permiten PNG, SVG, JPEG o WebP' }

  const ext = file.name.split('.').pop() || 'png'
  const filePath = `${workspaceId}/logo.${ext}`

  // Upload (upsert — replaces if exists)
  const { error: uploadError } = await supabase.storage
    .from('workspace-logos')
    .upload(filePath, file, { upsert: true })

  if (uploadError) return { success: false, error: uploadError.message }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('workspace-logos')
    .getPublicUrl(filePath)

  // Update workspace logo_url
  const { error: updateError } = await supabase
    .from('workspaces')
    .update({ logo_url: publicUrl })
    .eq('id', workspaceId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  return { success: true, url: publicUrl }
}

// ── Update Equipo Declarado ─────────────────────────────

export async function updateEquipoDeclarado(size: number) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('workspaces')
    .update({ equipo_declarado: Math.max(1, Math.floor(size)) })
    .eq('id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}
