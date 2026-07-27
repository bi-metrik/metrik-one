import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { extractSlug } from '@/lib/tenant/extract-slug'
import LoginClient from './login-client'

// El login del subdominio muestra el logo del cliente. Se resuelve server-side
// desde el slug del tenant (sin sesion): slug -> workspace -> name + logo_url.
// Solo esos dos campos cruzan al browser; el service role nunca sale del servidor.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const h = await headers()
  const sp = await searchParams
  // El slug lo pasa el middleware (edge, host correcto) por rewrite (?__ws=slug),
  // porque en la funcion serverless que renderiza /login el host NO es el
  // subdominio del cliente. Fallbacks: header x-tenant-slug y, en dev local, host.
  const wsParam = typeof sp?.__ws === 'string' ? sp.__ws : ''
  const slug =
    wsParam ||
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
