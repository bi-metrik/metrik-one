'use server'

import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

interface OnboardingData {
  fullName: string
  businessName: string
  profession: string
  yearsIndependent: number
}

interface OnboardingResult {
  success: boolean
  slug?: string
  workspaceId?: string
  error?: string
}

// Helper: cast Supabase client to untyped for tables not in database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

export async function completeOnboarding(data: OnboardingData): Promise<OnboardingResult> {
  try {
    // 1. Verify authenticated user (uses cookies to read session)
    const supabase = await createServerClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Sesión expirada. Inicia sesión de nuevo.' }
    }

    // 2. Service client — direct connection, no cookies, bypasses RLS
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 3. Check user doesn't already have a profile
    const { data: existingProfile } = await serviceClient
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (existingProfile) {
      return { success: false, error: 'Ya tienes una cuenta configurada.' }
    }

    // 4. Create workspace using service role (bypasses RLS)
    const { data: workspace, error: wsError } = await serviceClient
      .from('workspaces')
      .insert({
        name: data.businessName.trim(),
        profession: data.profession,
        years_independent: data.yearsIndependent,
        onboarding_completed: true,
      })
      .select()
      .single()

    if (wsError) {
      console.error('Workspace creation error:', JSON.stringify(wsError))
      return { success: false, error: `Error creando tu espacio de trabajo: ${wsError.message}` }
    }

    // 5. Create profile linked to workspace
    const { error: profileError } = await serviceClient
      .from('profiles')
      .insert({
        id: user.id,
        workspace_id: workspace.id,
        full_name: data.fullName.trim(),
        role: 'owner',
      })

    if (profileError) {
      console.error('Profile creation error:', JSON.stringify(profileError))
      // Cleanup: remove orphan workspace
      await serviceClient.from('workspaces').delete().eq('id', workspace.id)
      return { success: false, error: `Error creando tu perfil: ${profileError.message}` }
    }

    return { success: true, slug: workspace.slug, workspaceId: workspace.id }
  } catch (err) {
    console.error('Onboarding error:', err)
    return { success: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}

// ── Plantillas disponibles para onboarding ──────────────────────────────────

export interface PlantillaOption {
  id: string
  nombre: string
  descripcion: string | null
  label: string
}

export async function getPlantillas(): Promise<PlantillaOption[]> {
  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data } = await db(serviceClient)
    .from('lineas_negocio')
    .select('id, nombre, descripcion')
    .eq('tipo', 'plantilla')
    .is('workspace_id', null)
    .order('nombre', { ascending: true })

  if (!data) return []

  // Map plantilla names to user-facing labels
  const labelMap: Record<string, string> = {
    'Soy profesional': 'Vendo conocimiento',
    'Ejecuto proyectos': 'Entrego proyectos',
    'Atiendo clientes': 'Atiendo clientes',
  }

  return (data as Array<{ id: string; nombre: string; descripcion: string | null }>).map(l => ({
    id: l.id,
    nombre: l.nombre,
    descripcion: l.descripcion,
    label: labelMap[l.nombre] ?? l.nombre,
  }))
}

// ── Aplicar plantilla al workspace ──────────────────────────────────────────

export async function applyPlantilla(workspaceId: string, lineaId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. Call the SQL function to create bloque_configs
    const { error: rpcError } = await db(serviceClient).rpc('apply_plantilla_to_workspace', {
      p_workspace_id: workspaceId,
      p_linea_id: lineaId,
    })

    if (rpcError) {
      console.error('apply_plantilla error:', JSON.stringify(rpcError))
      return { success: false, error: rpcError.message }
    }

    // 2. Set linea_activa_id on the workspace
    const { error: updateError } = await db(serviceClient)
      .from('workspaces')
      .update({ linea_activa_id: lineaId })
      .eq('id', workspaceId)

    if (updateError) {
      console.error('update linea_activa error:', JSON.stringify(updateError))
      return { success: false, error: updateError.message }
    }

    return { success: true }
  } catch (err) {
    console.error('applyPlantilla error:', err)
    return { success: false, error: 'Error inesperado.' }
  }
}
