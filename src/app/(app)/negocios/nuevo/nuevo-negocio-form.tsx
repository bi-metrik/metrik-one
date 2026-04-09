'use client'

import { useState, useTransition, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, User, Building2, FileText, Check, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { crearNegocio } from '../negocio-v2-actions'
import { searchContactos, searchEmpresas } from '@/app/(app)/directorio/actions'
import { SECTORES_EMPRESA } from '@/lib/pipeline/constants'

type ContactoResult = { id: string; nombre: string; telefono: string | null; email: string | null }
type EmpresaResult = { id: string; nombre: string; sector: string | null }

const STEPS = [
  { label: 'Contacto', icon: User },
  { label: 'Empresa', icon: Building2 },
  { label: 'Negocio', icon: FileText },
] as const

export default function NuevoNegocioForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(0)

  // Step 1 — Contacto
  const [contactoId, setContactoId] = useState<string | null>(null)
  const [contactoNombre, setContactoNombre] = useState('')
  const [contactoTelefono, setContactoTelefono] = useState('')
  const [contactoResults, setContactoResults] = useState<ContactoResult[]>([])
  const [contactoSearching, setContactoSearching] = useState(false)
  const [contactoFocused, setContactoFocused] = useState(false)
  const contactoInputRef = useRef<HTMLInputElement>(null)
  const [esPersonaNatural, setEsPersonaNatural] = useState(false)

  // Step 2 — Empresa
  const [empresaId, setEmpresaId] = useState<string | null>(null)
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [empresaSector, setEmpresaSector] = useState('')
  const [empresaResults, setEmpresaResults] = useState<EmpresaResult[]>([])
  const [empresaSearching, setEmpresaSearching] = useState(false)
  const [empresaFocused, setEmpresaFocused] = useState(false)
  const empresaInputRef = useRef<HTMLInputElement>(null)

  // Step 3 — Negocio
  const [nombre, setNombre] = useState('')
  const [precioEstimado, setPrecioEstimado] = useState('')

  // Cuando persona natural, saltamos el paso de empresa
  const totalSteps = esPersonaNatural ? 2 : 3
  const negocioStep = esPersonaNatural ? 1 : 2

  // ── Busqueda contactos ─────────────────────────────────────────────────────

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
    if (contactoId || contactoNombre.length < 2) { setContactoResults([]); return }
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
    setContactoResults([])
    contactoInputRef.current?.focus()
  }

  // ── Busqueda empresas ──────────────────────────────────────────────────────

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
    if (empresaId || empresaNombre.length < 2) { setEmpresaResults([]); return }
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

  // ── Validacion por paso ────────────────────────────────────────────────────

  const canAdvance = () => {
    if (step === 0) return contactoNombre.trim().length > 0
    if (step === 1 && !esPersonaNatural) return empresaNombre.trim().length > 0
    if (step === negocioStep) return nombre.trim().length > 0
    return false
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (!nombre.trim()) { toast.error('El nombre es requerido'); return }
    if (!esPersonaNatural && !empresaNombre.trim()) {
      toast.error('La empresa es requerida'); return
    }

    const precioNum = precioEstimado.trim()
      ? Number(precioEstimado.replace(/\D/g, ''))
      : undefined

    startTransition(async () => {
      const result = await crearNegocio({
        nombre: nombre.trim(),
        contacto_id: contactoId ?? undefined,
        contacto_nombre: contactoId ? undefined : contactoNombre.trim(),
        contacto_telefono: contactoId ? undefined : (contactoTelefono.trim() || undefined),
        empresa_id: esPersonaNatural ? undefined : (empresaId ?? undefined),
        empresa_nombre: (esPersonaNatural || empresaId) ? undefined : empresaNombre.trim(),
        empresa_sector: (esPersonaNatural || empresaId) ? undefined : (empresaSector || undefined),
        es_persona_natural: esPersonaNatural,
        precio_estimado: precioNum,
      })

      if (result.error) {
        toast.error('Error al crear negocio: ' + result.error)
      } else {
        toast.success('Negocio creado')
        router.push(`/negocios/${result.negocio_id}`)
      }
    })
  }

  const showContactoDropdown = contactoFocused && !contactoId && contactoNombre.length >= 2 &&
    (contactoResults.length > 0 || contactoSearching)
  const showEmpresaDropdown = empresaFocused && !empresaId && empresaNombre.length >= 2 &&
    (empresaResults.length > 0 || empresaSearching)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-lg space-y-5 px-4 py-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold">Nuevo negocio</h1>
          <p className="text-xs text-muted-foreground">Paso {step + 1} de {totalSteps}</p>
        </div>
      </div>

      {/* Step dots */}
      <div className="flex items-center gap-2">
        {STEPS.filter((_, i) => !(esPersonaNatural && i === 1)).map((s, idx) => {
          const Icon = s.icon
          const done = idx < step
          const active = idx === step
          return (
            <div key={s.label} className="flex items-center gap-2 flex-1">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium shrink-0 ${
                done ? 'bg-green-100 text-green-700' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                {s.label}
              </span>
              {idx < totalSteps - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          )
        })}
      </div>

      {/* Paso 1 — Contacto */}
      {step === 0 && (
        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold">¿Quién es el contacto?</h2>

          {contactoId ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 px-3 py-2.5">
              <User className="h-4 w-4 text-green-600 shrink-0" />
              <span className="flex-1 text-sm font-medium text-green-800 dark:text-green-300">{contactoNombre}</span>
              <button type="button" onClick={clearContacto} className="rounded-md p-0.5 text-green-600 hover:bg-green-100">
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
                  placeholder="Buscar o escribir nombre..."
                  autoFocus
                  className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
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
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectContacto(c)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
                    >
                      <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{c.nombre}</span>
                        {(c.telefono || c.email) && (
                          <span className="ml-2 text-xs text-muted-foreground">{c.telefono ?? c.email}</span>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">Seleccionar</span>
                    </button>
                  ))}
                  {!contactoSearching && contactoResults.length === 0 && contactoNombre.length >= 2 && (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">
                      No encontrado — se creará como nuevo contacto
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!contactoId && contactoNombre.length >= 2 && !contactoSearching && contactoResults.length === 0 && !contactoFocused && (
            <p className="text-xs text-amber-600">Se creará un nuevo contacto con este nombre</p>
          )}

          {/* Persona natural */}
          {contactoNombre.trim().length >= 2 && (
            <label className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 cursor-pointer hover:bg-accent/50 transition-colors">
              <input
                type="checkbox"
                checked={esPersonaNatural}
                onChange={e => setEsPersonaNatural(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <div>
                <span className="text-sm font-medium">Es persona natural</span>
                <p className="text-[10px] text-muted-foreground">Independiente — la empresa es el mismo contacto</p>
              </div>
            </label>
          )}

          {/* Teléfono si es nuevo contacto */}
          {!contactoId && contactoNombre.trim().length >= 2 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Teléfono</label>
              <input
                type="tel"
                value={contactoTelefono}
                onChange={e => setContactoTelefono(e.target.value)}
                placeholder="+57 300 123 4567"
                className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          )}
        </div>
      )}

      {/* Paso 2 — Empresa (solo si no es persona natural) */}
      {step === 1 && !esPersonaNatural && (
        <div className="rounded-lg border p-4 space-y-3">
          <h2 className="text-sm font-semibold">¿Para qué empresa es?</h2>

          {empresaId ? (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 dark:bg-green-900/20 px-3 py-2.5">
              <Building2 className="h-4 w-4 text-green-600 shrink-0" />
              <span className="flex-1 text-sm font-medium text-green-800 dark:text-green-300">{empresaNombre}</span>
              <button type="button" onClick={clearEmpresa} className="rounded-md p-0.5 text-green-600 hover:bg-green-100">
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
                  className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
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
                      type="button"
                      onMouseDown={ev => ev.preventDefault()}
                      onClick={() => selectEmpresa(e)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-accent"
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{e.nombre}</span>
                        {e.sector && <span className="ml-2 text-xs text-muted-foreground">{e.sector}</span>}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">Seleccionar</span>
                    </button>
                  ))}
                  {!empresaSearching && empresaResults.length === 0 && empresaNombre.length >= 2 && (
                    <div className="px-3 py-2.5 text-xs text-muted-foreground">
                      No encontrada — se creará como nueva empresa
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {!empresaId && empresaNombre.length >= 2 && !empresaSearching && empresaResults.length === 0 && !empresaFocused && (
            <p className="text-xs text-amber-600">Se creará una nueva empresa con este nombre</p>
          )}

          {/* Sector si es nueva empresa */}
          {!empresaId && empresaNombre.trim().length >= 2 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Sector</label>
              <select
                value={empresaSector}
                onChange={e => setEmpresaSector(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">Seleccionar...</option>
                {SECTORES_EMPRESA.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Paso 3 — Negocio */}
      {step === negocioStep && (
        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="text-sm font-semibold">Datos del negocio</h2>

          {/* Chips resumen */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs">
              <User className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium">{contactoNombre}</span>
            </div>
            {!esPersonaNatural && empresaNombre && (
              <div className="flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <span className="font-medium">{empresaNombre}</span>
              </div>
            )}
            {esPersonaNatural && (
              <div className="flex items-center gap-1.5 rounded-md bg-purple-100 dark:bg-purple-900/30 px-2.5 py-1 text-xs">
                <span className="font-medium text-purple-700 dark:text-purple-300">Persona natural</span>
              </div>
            )}
          </div>

          {/* Nombre */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre del negocio *</label>
            <input
              type="text"
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Certificación VE Honda Civic 2023"
              autoFocus
              maxLength={200}
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          {/* Precio estimado */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Precio estimado <span className="text-muted-foreground/60">(opcional)</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={precioEstimado}
                onChange={e => {
                  const raw = e.target.value.replace(/\D/g, '')
                  setPrecioEstimado(raw ? Number(raw).toLocaleString('es-CO') : '')
                }}
                placeholder="0"
                className="w-full rounded-md border bg-background pl-7 pr-3 py-2.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <p className="mt-0.5 text-[10px] text-muted-foreground">COP — sin IVA</p>
          </div>
        </div>
      )}

      {/* Navegación */}
      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep(s => s - 1)}
            className="flex-1 rounded-lg border py-2.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            Anterior
          </button>
        )}
        {step < negocioStep ? (
          <button
            type="button"
            onClick={() => setStep(s => s + 1)}
            disabled={!canAdvance()}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Siguiente <ArrowRight className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canAdvance() || isPending}
            className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creando...
              </span>
            ) : (
              'Crear negocio'
            )}
          </button>
        )}
      </div>
    </div>
  )
}
