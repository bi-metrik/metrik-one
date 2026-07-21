'use client'

import { createClient } from '@/lib/supabase/client'
import { useState, useEffect } from 'react'
import MetrikLockup from '@/components/metrik-lockup'

const FONT = 'var(--font-montserrat), Montserrat, sans-serif'
const BASE_DOMAIN = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'

type Mode = 'loading' | 'bare' | 'tenant'

interface TenantBranding {
  name: string
  logoUrl: string | null
}

interface LoginClientProps {
  // Resuelto server-side desde el subdominio. null en el dominio pelado.
  tenantBranding: TenantBranding | null
}

export default function LoginClient({ tenantBranding }: LoginClientProps) {
  // Modo de la pagina: en el dominio pelado (metrikone.co) NO se inicia sesion
  // directamente — se muestra un selector que envia al subdominio del espacio.
  // El magic link solo se dispara desde el subdominio para que el callback
  // aterrice en el workspace correcto (no en el ultimo visitado).
  const [mode, setMode] = useState<Mode>('loading')

  // Selector de espacio (modo bare)
  const [slug, setSlug] = useState('')

  // Magic link (modo tenant)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const baseHost = BASE_DOMAIN.split(':')[0]
    const host = window.location.hostname
    const isDev = host === 'localhost' || host === '127.0.0.1'
    const isBare = !isDev && (host === baseHost || host === `www.${baseHost}`)
    setMode(isBare ? 'bare' : 'tenant')
  }, [])

  const handleGoToWorkspace = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (!clean) {
      setError('Escribe el nombre de tu espacio')
      return
    }
    window.location.href = `https://${clean}.${BASE_DOMAIN}/login`
  }

  // Pass redirectTo through to auth callback
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const redirectTo = searchParams?.get('redirectTo')

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const callbackUrl = redirectTo
      ? `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`
      : `${window.location.origin}/auth/callback`

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl,
      },
    })

    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  // --- Co-branding del subdominio ---
  // El logo del cliente es protagonista; MéTRIK firma discreto al pie. Si el
  // workspace no tiene logo, cae al lockup MéTRIK (cero regresion).
  const clientLogo = tenantBranding?.logoUrl || null

  const tenantBrand = clientLogo ? (
    // eslint-disable-next-line @next/next/no-img-element -- dinámico desde Supabase storage, tamaño variable
    <img
      src={clientLogo}
      alt={tenantBranding?.name ?? 'Tu espacio'}
      className="h-14 max-w-[220px] object-contain"
    />
  ) : (
    <MetrikLockup size="md" linkTo="/" />
  )

  const metrikSignature = clientLogo ? (
    <div className="flex flex-col items-center gap-1 pt-2">
      <MetrikLockup size="sm" />
      <p className="text-[11px] text-muted-foreground">con la infraestructura de MéTRIK</p>
    </div>
  ) : null

  // --- Estado: cargando (evita flash de hidratacion antes de saber el modo) ---
  if (mode === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        {tenantBrand}
      </div>
    )
  }

  // --- Modo dominio pelado: selector de espacio (siempre marca MéTRIK) ---
  if (mode === 'bare') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col items-center space-y-6">
            <MetrikLockup size="md" linkTo="/" />
            <div className="space-y-1 text-center">
              <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
                Iniciar sesion
              </h1>
              <p className="text-sm text-muted-foreground">
                Ingresa el nombre de tu espacio de trabajo
              </p>
            </div>
          </div>

          <form onSubmit={handleGoToWorkspace} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="slug" className="text-sm font-medium text-foreground">
                Tu espacio
              </label>
              <div className="flex items-center rounded-lg border border-border bg-background focus-within:ring-2 focus-within:ring-primary/30">
                <input
                  id="slug"
                  type="text"
                  placeholder="tuempresa"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  autoFocus
                  required
                  className="h-11 w-full min-w-0 rounded-l-lg bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
                />
                <span className="shrink-0 px-3 text-sm text-muted-foreground">.{BASE_DOMAIN}</span>
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              type="submit"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Continuar
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Ingresa siempre desde la direccion de tu espacio. Si no la conoces, escribe a quien administra tu cuenta.
          </p>
        </div>
      </div>
    )
  }

  // --- Modo tenant (subdominio): magic link ---
  if (sent) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-8 text-center">
          <div className="flex flex-col items-center">{tenantBrand}</div>
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
              Revisa tu correo
            </h1>
            <p className="text-sm text-muted-foreground">
              Enviamos un link magico a <strong className="text-foreground">{email}</strong>. Haz clic en el link para iniciar sesion.
            </p>
          </div>
          {metrikSignature}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex flex-col items-center space-y-6">
          {tenantBrand}
          <div className="space-y-1 text-center">
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
              Iniciar sesion
            </h1>
            <p className="text-sm text-muted-foreground">
              Ingresa a tu cuenta de MéTRIK one
            </p>
          </div>
        </div>

        <form onSubmit={handleMagicLink} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              Correo electronico
            </label>
            <input
              id="email"
              type="email"
              placeholder="ana@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="flex h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              onFocus={(e) => {
                e.currentTarget.style.borderColor = '#10B981'
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(16,185,129,0.15)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = ''
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? 'Enviando...' : 'Enviar link magico'}
          </button>
        </form>

        {metrikSignature}
      </div>
    </div>
  )
}
