import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { extractSlug } from '@/lib/tenant/extract-slug'
import LoginClient from './login-client'

// El login del subdominio muestra el logo del cliente. Se resuelve server-side
// desde el Host (sin sesion): el slug -> workspace -> name + logo_url. Solo esos
// dos campos cruzan al browser; el service role nunca sale del servidor.
export default async function LoginPage() {
  // En las funciones serverless de Vercel, `host` puede traer el host interno
  // del deployment (no el subdominio del cliente); el host externo real llega en
  // `x-forwarded-host`. Preferirlo y caer a `host` en local/dev (donde no existe).
  const h = await headers()
  const host = h.get('x-forwarded-host') || h.get('host') || ''
  const slug = extractSlug(host)

  let tenantBranding: { name: string; logoUrl: string | null } | null = null

  if (slug) {
    const svc = createServiceClient()
    const { data } = await svc
      .from('workspaces')
      .select('name, logo_url')
      .eq('slug', slug)
      .single()

    if (data) {
      tenantBranding = { name: data.name, logoUrl: data.logo_url }
    }
  }

  return <LoginClient tenantBranding={tenantBranding} />
}
