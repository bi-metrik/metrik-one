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
