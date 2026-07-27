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
  const wsParam = typeof sp?.__ws === 'string' ? sp.__ws : ''
  const xTenantSlug = h.get('x-tenant-slug')
  const xfh = h.get('x-forwarded-host')
  const host = h.get('host')
  const slug = wsParam || xTenantSlug || extractSlug(xfh || host || '')

  let tenantBranding: { name: string; logoUrl: string | null } | null = null
  let diagErr: string | null = null
  let diagFound = false

  if (slug) {
    const svc = createServiceClient()
    const { data, error } = await svc
      .from('workspaces')
      .select('name, logo_url')
      .eq('slug', slug)
      .single()
    if (error) diagErr = `${error.code ?? ''}:${error.message ?? ''}`
    if (data) {
      diagFound = true
      tenantBranding = { name: data.name, logoUrl: data.logo_url }
    }
  }

  // DIAGNOSTICO TEMPORAL (rama diag). Solo con ?__diag=1, div oculto, sin secretos.
  let diag: React.ReactNode = null
  if (sp?.__diag === '1') {
    const headerKeys = Array.from(h.keys()).filter((k) =>
      /tenant|forwarded|host|middleware|vercel/i.test(k)
    )
    const parts = [
      `wsParam=${wsParam || 'NULL'}`,
      `xTenantSlug=${xTenantSlug ?? 'NULL'}`,
      `host=${host ?? ''}`,
      `xfh=${xfh ?? 'NULL'}`,
      `resolvedSlug=${slug || 'NULL'}`,
      `found=${diagFound}`,
      `logoUrl=${tenantBranding?.logoUrl ? 'SET' : 'NULL'}`,
      `err=${diagErr ?? 'none'}`,
      `hasServiceKey=${!!process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      `nodeEnv=${process.env.NODE_ENV}`,
      `baseDomain=${process.env.NEXT_PUBLIC_BASE_DOMAIN ?? ''}`,
      `relevantHeaderKeys=${headerKeys.join(',')}`,
    ]
    diag = <div id="__diag" data-diag={parts.join('|')} style={{ display: 'none' }} />
  }

  return (
    <>
      {diag}
      <LoginClient tenantBranding={tenantBranding} />
    </>
  )
}
