import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { extractSlug } from '@/lib/tenant/extract-slug'
import LoginClient from './login-client'

// El login del subdominio muestra el logo del cliente. Se resuelve server-side
// desde el slug del tenant (sin sesion): slug -> workspace -> name + logo_url.
// Solo esos dos campos cruzan al browser; el service role nunca sale del servidor.
export default async function LoginPage() {
  const h = await headers()
  // Fuente de verdad del slug: el header `x-tenant-slug` que inyecta el middleware
  // (corre en el edge, donde el host SI es el subdominio del cliente). En la funcion
  // serverless, headers().get('host')/x-forwarded-host NO traen el subdominio, por
  // eso no se puede resolver aqui a partir del host. Fallback a extraerlo del host
  // solo para dev local (donde middleware y funcion comparten el mismo host real).
  const slug =
    h.get('x-tenant-slug') ||
    extractSlug(h.get('x-forwarded-host') || h.get('host') || '')

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
