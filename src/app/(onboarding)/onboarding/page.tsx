'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { completeOnboarding } from './actions'

const PROFESSIONS = [
  { value: 'arquitecto', label: 'Arquitectura' },
  { value: 'ingeniero', label: 'Ingeniería' },
  { value: 'disenador', label: 'Diseño' },
  { value: 'abogado', label: 'Derecho' },
  { value: 'contador', label: 'Contabilidad' },
  { value: 'medico', label: 'Salud' },
  { value: 'consultor', label: 'Consultoría' },
  { value: 'otro', label: 'Otra profesión' },
]

const YEARS_OPTIONS = [
  { value: 1, label: 'Menos de 1 año' },
  { value: 2, label: '1 a 3 años' },
  { value: 5, label: '3 a 5 años' },
  { value: 8, label: '5 a 10 años' },
  { value: 15, label: 'Más de 10 años' },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Form data
  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [profession, setProfession] = useState('')
  const [yearsIndependent, setYearsIndependent] = useState<number | null>(null)

  const totalSteps = 3

  const handleNext = () => {
    if (step === 1 && !fullName.trim()) {
      setError('Tu nombre es necesario para continuar')
      return
    }
    if (step === 2 && !businessName.trim()) {
      setError('Necesitamos un nombre para tu espacio de trabajo')
      return
    }
    setError('')
    setStep(step + 1)
  }

  const handleBack = () => {
    setError('')
    setStep(step - 1)
  }

  const handleComplete = async () => {
    if (!profession) {
      setError('Selecciona tu profesión')
      return
    }
    if (!yearsIndependent) {
      setError('Selecciona tu experiencia')
      return
    }

    setLoading(true)
    setError('')

    // Server action — uses service role to bypass RLS
    const result = await completeOnboarding({
      fullName: fullName.trim(),
      businessName: businessName.trim(),
      profession,
      yearsIndependent,
    })

    if (!result.success) {
      setError(result.error || 'Error creando tu cuenta.')
      setLoading(false)
      return
    }

    // Redirect to story mode on the tenant subdomain
    const slug = result.slug!
    const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'localhost:3000'
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

    if (isDev) {
      router.push('/story-mode')
    } else {
      window.location.href = `https://${slug}.${baseDomain}/story-mode`
    }
  }

  return (
    <div className="w-full max-w-md space-y-8 px-4">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Paso {step} de {totalSteps}</span>
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < step ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Step 1: Name */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">¿Cómo te llamas?</h1>
            <p className="text-muted-foreground">
              Así te identificaremos dentro de MéTRIK ONE.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="fullName" className="text-sm font-medium">
              Tu nombre completo
            </label>
            <input
              id="fullName"
              type="text"
              placeholder="Ana María López"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoFocus
              className="flex h-12 w-full rounded-lg border border-input bg-background px-4 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && handleNext()}
            />
          </div>
        </div>
      )}

      {/* Step 2: Business name */}
      {step === 2 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">¿Cuál es tu negocio?</h1>
            <p className="text-muted-foreground">
              Puede ser tu nombre, tu empresa, o como quieras llamarlo. Esto crea tu espacio de trabajo.
            </p>
          </div>
          <div className="space-y-2">
            <label htmlFor="businessName" className="text-sm font-medium">
              Nombre del negocio
            </label>
            <input
              id="businessName"
              type="text"
              placeholder="Ana López Arquitectura"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              autoFocus
              className="flex h-12 w-full rounded-lg border border-input bg-background px-4 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && handleNext()}
            />
            <p className="text-xs text-muted-foreground">
              Tu URL será: <strong>{businessName.trim() ? businessName.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-').slice(0, 20) : 'tu-negocio'}.metrikone.co</strong>
            </p>
          </div>
        </div>
      )}

      {/* Step 3: Profession + Experience */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">Cuéntanos de ti</h1>
            <p className="text-muted-foreground">
              Esto nos ayuda a personalizar tu experiencia.
            </p>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">¿En qué campo trabajas?</label>
            <div className="grid grid-cols-2 gap-2">
              {PROFESSIONS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProfession(p.value)}
                  className={`flex h-11 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                    profession === p.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">¿Cuánto tiempo llevas como independiente?</label>
            <div className="space-y-2">
              {YEARS_OPTIONS.map((y) => (
                <button
                  key={y.value}
                  type="button"
                  onClick={() => setYearsIndependent(y.value)}
                  className={`flex h-11 w-full items-center rounded-lg border px-4 text-sm transition-colors ${
                    yearsIndependent === y.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-input bg-background hover:bg-accent'
                  }`}
                >
                  {y.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 1 && (
          <button
            type="button"
            onClick={handleBack}
            className="flex h-12 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
          >
            Atrás
          </button>
        )}

        {step < totalSteps ? (
          <button
            type="button"
            onClick={handleNext}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Continuar
          </button>
        ) : (
          <button
            type="button"
            onClick={handleComplete}
            disabled={loading}
            className="flex h-12 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creando tu espacio...
              </>
            ) : (
              'Comenzar'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
