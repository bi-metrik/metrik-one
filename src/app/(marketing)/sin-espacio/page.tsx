'use client'

import { createClient } from '@/lib/supabase/client'
import { useState } from 'react'
import MetrikLockup from '@/components/metrik-lockup'

const FONT = 'var(--font-montserrat), Montserrat, sans-serif'

export default function SinEspacioPage() {
  const [loading, setLoading] = useState(false)

  const handleSignOut = async () => {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        <MetrikLockup size="md" linkTo="/" />
        <div className="space-y-3">
          <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: FONT }}>
            No tienes un espacio asignado
          </h1>
          <p className="text-sm text-muted-foreground">
            Tu cuenta aun no esta vinculada a un espacio de trabajo. La creacion y activacion
            de usuarios la gestiona MéTRIK. Escribe a quien administra tu cuenta para que te asignen acceso.
          </p>
        </div>

        <button
          onClick={handleSignOut}
          disabled={loading}
          className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {loading ? 'Cerrando...' : 'Cerrar sesion'}
        </button>
      </div>
    </div>
  )
}
