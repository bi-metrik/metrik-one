'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'

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
    // 1. Verify authenticated user
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return { success: false, error: 'Sesión expirada. Inicia sesión de nuevo.' }
    }

    // 2. Check user doesn't already have a profile
    const serviceClient = await createServiceClient()
    const { data: existingProfile } = await serviceClient
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (existingProfile) {
      return { success: false, error: 'Ya tienes una cuenta configurada.' }
    }

    // 3. Create workspace using service role (bypasses RLS)
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
      console.error('Workspace creation error:', wsError)
      return { success: false, error: 'Error creando tu espacio de trabajo.' }
    }

    // 4. Create profile linked to workspace
    const { error: profileError } = await serviceClient
      .from('profiles')
      .insert({
        id: user.id,
        workspace_id: workspace.id,
        full_name: data.fullName.trim(),
        role: 'owner',
      })

    if (profileError) {
      console.error('Profile creation error:', profileError)
      // Cleanup: remove orphan workspace
      await serviceClient.from('workspaces').delete().eq('id', workspace.id)
      return { success: false, error: 'Error creando tu perfil.' }
    }

    return { success: true, slug: workspace.slug }
  } catch (err) {
    console.error('Onboarding error:', err)
    return { success: false, error: 'Error inesperado. Intenta de nuevo.' }
  }
}
