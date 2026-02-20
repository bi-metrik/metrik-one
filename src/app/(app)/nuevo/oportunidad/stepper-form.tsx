'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, User, Building2, FileText, Check } from 'lucide-react'
import { toast } from 'sonner'
import { createOportunidad } from '@/app/(app)/pipeline/actions-v2'
import { searchContactos, searchEmpresas } from '@/app/(app)/directorio/actions'
import { FUENTES_ADQUISICION, SECTORES_EMPRESA } from '@/lib/pipeline/constants'

const STEPS = [
  { label: 'Contacto', icon: User },
  { label: 'Empresa', icon: Building2 },
  { label: 'Trabajo', icon: FileText },
] as const

export default function StepperForm() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState(0)

  // Step 1
  const [contactoId, setContactoId] = useState<string | null>(null)
  const [contactoNombre, setContactoNombre] = useState('')
  const [contactoTelefono, setContactoTelefono] = useState('')
  const [contactoFuente, setContactoFuente] = useState('')
  const [contactoResults, setContactoResults] = useState<{ id: string; nombre: string; telefono: string | null }[]>([])
  const [showContactoSugg, setShowContactoSugg] = useState(false)

  // Step 2
  const [empresaId, setEmpresaId] = useState<string | null>(null)
  const [empresaNombre, setEmpresaNombre] = useState('')
  const [empresaSector, setEmpresaSector] = useState('')
  const [empresaResults, setEmpresaResults] = useState<{ id: string; nombre: string; sector: string | null }[]>([])
  const [showEmpresaSugg, setShowEmpresaSugg] = useState(false)

  // Step 3
  const [descripcion, setDescripcion] = useState('')
  const [valorEstimado, setValorEstimado] = useState('')

  useEffect(() => {
    if (contactoNombre.length < 2 || contactoId) { setContactoResults([]); return }
    const t = setTimeout(async () => {
      const r = await searchContactos(contactoNombre)
      setContactoResults(r as { id: string; nombre: string; telefono: string | null }[])
      setShowContactoSugg(r.length > 0)
    }, 300)
    return () => clearTimeout(t)
  }, [contactoNombre, contactoId])

  useEffect(() => {
    if (empresaNombre.length < 2 || empresaId) { setEmpresaResults([]); return }
    const t = setTimeout(async () => {
      const r = await searchEmpresas(empresaNombre)
      setEmpresaResults(r as { id: string; nombre: string; sector: string | null }[])
      setShowEmpresaSugg(r.length > 0)
    }, 300)
    return () => clearTimeout(t)
  }, [empresaNombre, empresaId])

  const canAdvance = () => {
    if (step === 0) return contactoNombre.trim().length > 0
    if (step === 1) return empresaNombre.trim().length > 0
    if (step === 2) return descripcion.trim().length > 0 && Number(valorEstimado) > 0
    return false
  }

  const handleSubmit = () => {
    startTransition(async () => {
      const res = await createOportunidad({
        contacto_id: contactoId ?? undefined,
        empresa_id: empresaId ?? undefined,
        contacto_nombre: contactoId ? undefined : contactoNombre,
        contacto_telefono: contactoId ? undefined : contactoTelefono,
        contacto_fuente: contactoId ? undefined : contactoFuente,
        empresa_nombre: empresaId ? undefined : empresaNombre,
        empresa_sector: empresaId ? undefined : empresaSector,
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

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link href="/pipeline" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">Nueva oportunidad</h1>
          <p className="text-xs text-muted-foreground">Paso {step + 1} de 3</p>
        </div>
      </div>

      {/* Step dots */}
      <div className="flex items-center gap-2">
        {STEPS.map((s, i) => {
          const Icon = s.icon
          const done = i < step
          const active = i === step
          return (
            <div key={i} className="flex items-center gap-2 flex-1">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
                done ? 'bg-green-100 text-green-700' : active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}>
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <span className={`text-xs font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>{s.label}</span>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border p-4">
        {step === 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Quien es el contacto?</h2>
            <div className="relative">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre *</label>
              <input value={contactoNombre} onChange={e => { setContactoNombre(e.target.value); setContactoId(null) }} placeholder="Nombre del contacto" autoFocus className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
              {showContactoSugg && contactoResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-popover shadow-lg">
                  {contactoResults.map(c => (
                    <button key={c.id} onClick={() => { setContactoId(c.id); setContactoNombre(c.nombre); setContactoTelefono(c.telefono ?? ''); setShowContactoSugg(false) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                      <User className="h-3.5 w-3.5 text-muted-foreground" /><span>{c.nombre}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {contactoId && <p className="text-xs text-green-600">Contacto existente seleccionado</p>}
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

        {step === 1 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Para que empresa es?</h2>
            <div className="relative">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre empresa *</label>
              <input value={empresaNombre} onChange={e => { setEmpresaNombre(e.target.value); setEmpresaId(null) }} placeholder="Nombre de la empresa" autoFocus className="w-full rounded-md border bg-background px-3 py-2.5 text-sm" />
              {showEmpresaSugg && empresaResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-popover shadow-lg">
                  {empresaResults.map(e => (
                    <button key={e.id} onClick={() => { setEmpresaId(e.id); setEmpresaNombre(e.nombre); setEmpresaSector(e.sector ?? ''); setShowEmpresaSugg(false) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
                      <Building2 className="h-3.5 w-3.5 text-muted-foreground" /><span>{e.nombre}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {empresaId && <p className="text-xs text-green-600">Empresa existente seleccionada</p>}
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

        {step === 2 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Describe el trabajo</h2>
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
        {step < 2 ? (
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
