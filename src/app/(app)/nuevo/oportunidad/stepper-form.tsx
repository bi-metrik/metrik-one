'use client'

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, User, Building2, FileText, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { createOportunidad } from '@/app/(app)/pipeline/actions-v2'
import { searchContactos, searchEmpresas } from '@/app/(app)/directorio/actions'
import { FUENTES_ADQUISICION, SECTORES_EMPRESA } from '@/lib/pipeline/constants'

const STEPS = [
  { label: 'Contacto', icon: User },
  { label: 'Empresa', icon: Building2 },
  { label: 'Trabajo', icon: FileText },
] as const

type ContactoResult = { id: string; nombre: string; telefono: string | null; email: string | null }
type EmpresaResult = { id: string; nombre: string; sector: string | null; numero_documento: string | null }

export default function StepperForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(0)

  // Prefill from query params (when coming from directorio)
  const prefillContactoId = searchParams.get('contacto_id')
  const prefillContactoNombre = searchParams.get('contacto_nombre')
  const prefillEmpresaId = searchParams.get('empresa_id')
  const prefillEmpresaNombre = searchParams.get('empresa_nombre')

  // Step 1 — Contacto
  const [contactoId, setContactoId] = useState<string | null>(prefillContactoId)
  const [contactoNombre, setContactoNombre] = useState(prefillContactoNombre ?? '')
  const [contactoTelefono, setContactoTelefono] = useState('')
  const [contactoFuente, setContactoFuente] = useState('')
  const [contactoResults, setContactoResults] = useState<ContactoResult[]>([])
  const [contactoSearching, setContactoSearching] = useState(false)
  const [contactoFocused, setContactoFocused] = useState(false)
  const contactoInputRef = useRef<HTMLInputElement>(null)

  // Persona natural toggle
  const [esPersonaNatural, setEsPersonaNatural] = useState(false)

  // Step 2 — Empresa
  const [empresaId, setEmpresaId] = useState<string | null>(prefillEmpresaId)
  const [empresaNombre, setEmpresaNombre] = useState(prefillEmpresaNombre ?? '')
  const [empresaSector, setEmpresaSector] = useState('')
  const [empresaResults, setEmpresaResults] = useState<EmpresaResult[]>([])
  const [empresaSearching, setEmpresaSearching] = useState(false)
  const [empresaFocused, setEmpresaFocused] = useState(false)
  const empresaInputRef = useRef<HTMLInputElement>(null)

  // Step 3 — Trabajo
  const [descripcion, setDescripcion] = useState('')
  const [valorEstimado, setValorEstimado] = useState('')

  // If prefilled with contacto, start at step 1 (empresa)
  // If prefilled with both contacto + empresa, start at step 2 (trabajo)
  const [initialStepSet, setInitialStepSet] = useState(false)
  useEffect(() => {
    if (initialStepSet) return
    if (prefillContactoId && prefillEmpresaId) {
      setStep(2)
    } else if (prefillEmpresaId) {
      setStep(0)
    }
    // When only prefillContactoId, stay on step 0 so user can toggle persona natural
    setInitialStepSet(true)
  }, [prefillContactoId, prefillEmpresaId, initialStepSet])

  // ── Contacto search ───────────────────────────────────────
  const doSearchContactos = useCallback(async (query: string) => {
    if (query.length < 2) { setContactoResults([]); return }
    setContactoSearching(true)
    try {
      const r = await searchContactos(query)
      setContactoResults(r as ContactoResult[])
    } finally {
      setContactoSearching(false)
    }
  }, [])

  useEffect(() => {
    if (contactoId || contactoNombre.length < 2) {
      setContactoResults([])
      return
    }
    const t = setTimeout(() => doSearchContactos(contactoNombre), 300)
    return () => clearTimeout(t)
  }, [contactoNombre, contactoId, doSearchContactos])

  const selectContacto = (c: ContactoResult) => {
    setContactoId(c.id)
    setContactoNombre(c.nombre)
    setContactoTelefono(c.telefono ?? '')
    setContactoResults([])
    setContactoFocused(false)
  }

  const clearContacto = () => {
    setContactoId(null)
    setContactoNombre('')
    setContactoTelefono('')
    setContactoFuente('')
    setContactoResults([])
    contactoInputRef.current?.focus()
  }

  // ── Empresa search ────────────────────────────────────────
  const doSearchEmpresas = useCallback(async (query: string) => {
    if (query.length < 2) { setEmpresaResults([]); return }
    setEmpresaSearching(true)
    try {
      const r = await searchEmpresas(query)
      setEmpresaResults(r as EmpresaResult[])
    } finally {
      setEmpresaSearching(false)
    }
  }, [])

  useEffect(() => {
    if (empresaId || empresaNombre.length < 2) {
      setEmpresaResults([])
      return
    }
    const t = setTimeout(() => doSearchEmpresas(empresaNombre), 300)
    return () => clearTimeout(t)
  }, [empresaNombre, empresaId, doSearchEmpresas])

  const selectEmpresa = (e: EmpresaResult) => {
    setEmpresaId(e.id)
    setEmpresaNombre(e.nombre)
    setEmpresaSector(e.sector ?? '')
    setEmpresaResults([])
    setEmpresaFocused(false)
  }

  const clearEmpresa = () => {
    setEmpresaId(null)
    setEmpresaNombre('')
    setEmpresaSector('')
    setEmpresaResults([])
    empresaInputRef.current?.focus()
  }

  // When persona natural, the effective last step shifts
  const totalSteps = esPersonaNatural ? 2 : 3
  const trabajoStep = esPersonaNatural ? 1 : 2

  const canAdvance = () => {
    if (step === 0) return contactoNombre.trim().length > 0
    if (step === 1 && !esPersonaNatural) return empresaNombre.trim().length > 0
    if (step === trabajoStep) return descripcion.trim().length > 0 && Number(valorEstimado) > 0
    return false
  }

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await createOportunidad({
        contacto_id: contactoId ?? undefined,
        empresa_id: esPersonaNatural ? undefined : (empresaId ?? undefined),
        contacto_nombre: contactoId ? undefined : contactoNombre,
        contacto_telefono: contactoId ? undefined : contactoTelefono,
        contacto_fuente: contactoId ? undefined : contactoFuente,
        empresa_nombre: esPersonaNatural ? undefined : (empresaId ? undefined : empresaNombre),
        empresa_sector: esPersonaNatural ? undefined : (empresaId ? undefined : empresaSector),
        es_persona_natural: esPersonaNatural,
        descripcion,
        valor_estimado: Number(valorEstimado),
      })
      if (res.success) {
        toast.success('Oportunidad creada')
        router.push('/pipeline')
      } else {
        toast.error(res.error)
      }
    })
  }

  const showContactoDropdown = contactoFocused && !contactoId && contactoNombre.length >= 2 && (contactoResults.length > 0 || contactoSearching)
  const showEmpresaDropdown = empresaFocused && !empresaId && empresaNombre.length >= 2 && (empresaResults.length > 0 || empresaSearching)

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link href="/pipeline" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">Nueva oportunidad</h1>
          <p className="text-xs text-muted-foreground">Paso {step + 1} de {totalSteps}</p>
        </div>
      </div>

      {/* Step dots */}
      <div className="flex items-center gap-2">
        {STEPS.filter((_, i) => !(esPersonaNatural && i === 1)).map((s, i) => {
          const Icon = s.icon
          const done = i < step
          const active = i === step
          return (
            <div key={s.label} className="flex items-center gap-2 flex-1">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                done ? 'bg-green-100 text-green-700' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
              {i < totalSteps - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border p-4">
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Quien es el contacto?</h2>

            {/* Selected contacto chip */}
            {contactoId ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                <User className="h-4 w-4 text-green-600" />
                <span className="flex-1 text-sm font-medium text-green-800">{contactoNombre}</span>
                <button onClick={clearContacto} className="rounded-md p-0.5 text-green-600 hover:bg-green-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre *</label>
                <div className="relative">
                  <input
                    ref={contactoInputRef}
                    value={contactoNombre}
                    onChange={e => { setContactoNombre(e.target.value); setContactoId(null) }}
                    onFocus={() => setContactoFocused(true)}
                    onBlur={() => setTimeout(() => setContactoFocused(false), 200)}
                    placeholder="Buscar o crear contacto..."
                    autoFocus
                    className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
                  />
                  {contactoSearching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                {showContactoDropdown && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
                    {contactoSearching && contactoResults.length === 0 && (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                      </div>
                    )}
                    {contactoResults.map(c => (
                      <button
                        key={c.id}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => selectContacto(c)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
                      >
                        <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{c.nombre}</span>
                          {(c.telefono || c.email) && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {c.telefono ?? c.email}
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">Seleccionar</span>
                      </button>
                    ))}
                    {!contactoSearching && contactoResults.length === 0 && contactoNombre.length >= 2 && (
                      <div className="px-3 py-2.5 text-xs text-muted-foreground">
                        No encontrado — se creara como nuevo contacto
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!contactoId && contactoNombre.length >= 2 && !contactoSearching && contactoResults.length === 0 && !contactoFocused && (
              <p className="text-xs text-amber-600">Se creara un nuevo contacto con este nombre</p>
            )}

            {/* Persona natural toggle */}
            {(contactoId || contactoNombre.trim().length >= 2) && (
              <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors">
                <input
                  type="checkbox"
                  checked={esPersonaNatural}
                  onChange={e => setEsPersonaNatural(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <div>
                  <span className="text-sm font-medium">Es persona natural</span>
                  <p className="text-[10px] text-muted-foreground">La empresa es el mismo contacto (freelancer, independiente)</p>
                </div>
              </label>
            )}

            {!contactoId && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Telefono</label>
                  <input value={contactoTelefono} onChange={e => setContactoTelefono(e.target.value)} placeholder="+57 300 123 4567" className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">Fuente</label>
                  <select value={contactoFuente} onChange={e => setContactoFuente(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2.5 text-sm">
                    <option value="">Seleccionar</option>
                    {FUENTES_ADQUISICION.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
              </>
            )}
          </div>
        )}

        {step === 1 && !esPersonaNatural && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Para que empresa es?</h2>

            {/* Selected empresa chip */}
            {empresaId ? (
              <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5">
                <Building2 className="h-4 w-4 text-green-600" />
                <span className="flex-1 text-sm font-medium text-green-800">{empresaNombre}</span>
                <button onClick={clearEmpresa} className="rounded-md p-0.5 text-green-600 hover:bg-green-100">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre empresa *</label>
                <div className="relative">
                  <input
                    ref={empresaInputRef}
                    value={empresaNombre}
                    onChange={e => { setEmpresaNombre(e.target.value); setEmpresaId(null) }}
                    onFocus={() => setEmpresaFocused(true)}
                    onBlur={() => setTimeout(() => setEmpresaFocused(false), 200)}
                    placeholder="Buscar o crear empresa..."
                    autoFocus
                    className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
                  />
                  {empresaSearching && (
                    <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                {showEmpresaDropdown && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border bg-popover shadow-lg">
                    {empresaSearching && empresaResults.length === 0 && (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                      </div>
                    )}
                    {empresaResults.map(e => (
                      <button
                        key={e.id}
                        onMouseDown={e2 => e2.preventDefault()}
                        onClick={() => selectEmpresa(e)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
                      >
                        <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <span className="font-medium">{e.nombre}</span>
                          {e.sector && (
                            <span className="ml-2 text-xs text-muted-foreground">{e.sector}</span>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] text-muted-foreground">Seleccionar</span>
                      </button>
                    ))}
                    {!empresaSearching && empresaResults.length === 0 && empresaNombre.length >= 2 && (
                      <div className="px-3 py-2.5 text-xs text-muted-foreground">
                        No encontrada — se creara como nueva empresa
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {!empresaId && empresaNombre.length >= 2 && !empresaSearching && empresaResults.length === 0 && !empresaFocused && (
              <p className="text-xs text-amber-600">Se creara una nueva empresa con este nombre</p>
            )}
            {!empresaId && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Sector</label>
                <select value={empresaSector} onChange={e => setEmpresaSector(e.target.value)} className="w-full rounded-md border bg-background px-3 py-2.5 text-sm">
                  <option value="">Seleccionar</option>
                  {SECTORES_EMPRESA.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {step === trabajoStep && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Describe el trabajo</h2>

            {/* Summary of selected contacto + empresa */}
            <div className="flex gap-2">
              <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs">
                <User className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{contactoNombre}</span>
              </div>
              {!esPersonaNatural && (
                <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs">
                  <Building2 className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium">{empresaNombre}</span>
                </div>
              )}
              {esPersonaNatural && (
                <div className="flex items-center gap-1.5 rounded-md bg-purple-100 px-2.5 py-1 text-xs">
                  <span className="font-medium text-purple-700">Persona natural</span>
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripcion *</label>
              <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Que trabajo te estan pidiendo?" rows={3} autoFocus className="w-full rounded-md border bg-background px-3 py-2.5 text-sm resize-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor estimado *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input type="number" value={valorEstimado} onChange={e => setValorEstimado(e.target.value)} placeholder="8000000" min="0" className="w-full rounded-md border bg-background py-2.5 pl-7 pr-3 text-sm" />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {step > 0 && <button onClick={() => setStep(s => s - 1)} className="flex-1 rounded-lg border py-2.5 text-sm font-medium hover:bg-accent">Anterior</button>}
        {step < trabajoStep ? (
          <button onClick={() => setStep(s => s + 1)} disabled={!canAdvance()} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            Siguiente <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={!canAdvance() || isPending} className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isPending ? 'Creando...' : 'Crear oportunidad'}
          </button>
        )}
      </div>
    </div>
  )
}
