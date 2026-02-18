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
  error?: string
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

    return { success: true, slug: workspace.slug }
  } catch (err) {
    console.error('Onboarding error:', err)
    return { success: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}
