'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  FileOutput,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
  History,
} from 'lucide-react'
import {
  generarFormulario,
  resolverFormularioParaEdicion,
  guardarFormularioOverrides,
  guardarSeccional,
  type CasillaEditable,
  type FormularioVersionItem,
} from '@/lib/actions/formulario-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface BloqueFormularioProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  configExtra: {
    label: string
    template: string
    campos_fuente?: unknown[]
    campos_constantes?: Record<string, string>
  }
}

type GenerateState = 'idle' | 'generating' | 'error'

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function BloqueFormulario({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  configExtra,
}: BloqueFormularioProps) {
  const router = useRouter()
  const saved = (instancia?.data ?? {}) as Record<string, unknown>
  const label = configExtra.label ?? 'Formulario'

  const [loading, setLoading] = useState(true)
  const [casillas, setCasillas] = useState<CasillaEditable[]>([])
  const [valores, setValores] = useState<Record<string, string>>({})
  const [versiones, setVersiones] = useState<FormularioVersionItem[]>([])
  const [seccionales, setSeccionales] = useState<string[] | undefined>(undefined)
  const [seccional, setSeccional] = useState<string | null>(null)
  const [seccionalSugerida, setSeccionalSugerida] = useState(false)
  const [state, setState] = useState<GenerateState>('idle')
  const [isPending, startTransition] = useTransition()
  const [verHistorial, setVerHistorial] = useState(false)
  const dirtyRef = useRef<Record<string, string>>({})
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const driveUrl = (saved.drive_url as string) ?? null
  const versionActual = (saved.version_actual as number) ?? versiones[0]?.version_n ?? null

  async function cargar() {
    const res = await resolverFormularioParaEdicion(negocioBloqueId, negocioId)
    if (res.error) { toast.error(res.error); setLoading(false); return }
    setCasillas(res.casillas)
    setVersiones(res.versiones)
    setSeccionales(res.seccionales)
    setSeccional(res.seccional ?? null)
    setSeccionalSugerida(res.seccional_sugerida ?? false)
    const init: Record<string, string> = {}
    res.casillas.forEach((c) => { init[c.slug] = c.value })
    setValores(init)
    setLoading(false)
  }

  function handleSeccionalChange(value: string) {
    setSeccional(value)
    setSeccionalSugerida(false)
    startTransition(async () => {
      const r = await guardarSeccional(negocioBloqueId, value)
      if (r.error) { toast.error(r.error); return }
      await cargar() // recarga casillas con el preset de la nueva seccional
      toast.success(`Seccional: ${value}`)
    })
  }

  useEffect(() => {
    if (modo === 'editable') void cargar()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Guardado diferido de overrides (solo los campos tocados).
  function flushOverrides(): Promise<void> {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null }
    if (Object.keys(dirtyRef.current).length === 0) return Promise.resolve()
    const overrides = { ...dirtyRef.current }
    return guardarFormularioOverrides(negocioBloqueId, overrides).then((r) => {
      if (r.error) toast.error(r.error)
    })
  }

  function handleChange(slug: string, value: string) {
    setValores((v) => ({ ...v, [slug]: value }))
    dirtyRef.current[slug] = value
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void flushOverrides() }, 1200)
  }

  function handleGenerar() {
    setState('generating')
    startTransition(async () => {
      await flushOverrides()
      const result = await generarFormulario(negocioBloqueId, negocioId)
      if (result.success) {
        setState('idle')
        toast.success(`${label} generado (v${result.version_n})`)
        await cargar()
        router.refresh()
      } else if (result.faltantes && result.faltantes.length > 0) {
        setState('idle')
        toast.error(`Faltan datos: ${result.faltantes.map((f) => f.replace(/_/g, ' ')).join(', ')}`)
      } else {
        setState('error')
        toast.error(result.error ?? 'Error generando formulario')
      }
    })
  }

  // ── Modo visible (read-only desde historial / etapas previas) ─────────────
  if (modo === 'visible') {
    return (
      <div className="flex items-center gap-2">
        {driveUrl ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" /> : <FileOutput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <span className="text-xs font-medium">{label}</span>
        {versionActual && <span className="text-[10px] text-muted-foreground">v{versionActual}</span>}
        {driveUrl && (
          <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
            <ExternalLink className="h-3 w-3" /> Ver PDF
          </a>
        )}
      </div>
    )
  }

  // ── Modo editable ─────────────────────────────────────────────────────────
  if (loading) {
    return <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando casillas…</div>
  }

  // Agrupar casillas por grupo, preservando orden.
  const grupos: string[] = []
  const porGrupo: Record<string, CasillaEditable[]> = {}
  for (const c of casillas) {
    if (!porGrupo[c.grupo]) { porGrupo[c.grupo] = []; grupos.push(c.grupo) }
    porGrupo[c.grupo].push(c)
  }
  const hayFaltantes = casillas.some((c) => c.faltante && !valores[c.slug])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileOutput className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{label}</span>
          {versionActual && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">v{versionActual}</span>
          )}
        </div>
        {driveUrl && (
          <a href={driveUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            <ExternalLink className="h-3 w-3" /> Ver PDF actual
          </a>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground/70">
        Revisa y ajusta las casillas si lo necesitas. El PDF se genera con estos valores — no se edita el PDF.
      </p>

      {/* Selector de seccional DIAN (solo 010 con config de seccionales) */}
      {seccionales && seccionales.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-3">
          <label className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Seccional DIAN
              {seccionalSugerida && (
                <span className="rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium text-amber-700">Revisar — sugerida</span>
              )}
            </span>
            <select
              value={seccional ?? ''}
              onChange={(e) => handleSeccionalChange(e.target.value)}
              disabled={isPending}
              className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 sm:max-w-xs"
            >
              {seccionales.map((s) => (<option key={s} value={s}>{s}</option>))}
            </select>
            <span className="text-[10px] text-muted-foreground/70">
              Autocompleta la casilla 12 (nombre oficial + código DIAN) y las casillas 50, 51 y 57 (y la firma en Cali). Sugerida por la ciudad de la factura — confírmala.
            </span>
          </label>
        </div>
      )}

      {/* Casillas editables agrupadas */}
      <div className="space-y-3">
        {grupos.map((g) => (
          <div key={g} className="rounded-lg border border-border/60 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {porGrupo[g].map((c) => (
                <label key={c.slug} className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
                    {c.casilla && <span className="rounded bg-muted px-1 font-mono">{c.casilla}</span>}
                    {c.label}
                    {c.editado && <span className="text-[9px] font-normal text-primary">editado</span>}
                  </span>
                  <input
                    type="text"
                    value={valores[c.slug] ?? ''}
                    onChange={(e) => handleChange(c.slug, e.target.value)}
                    onBlur={() => void flushOverrides()}
                    className={`w-full rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/15 ${
                      c.faltante && !valores[c.slug] ? 'border-amber-400 bg-amber-50/40' : 'border-border focus:border-primary'
                    }`}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hayFaltantes && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Hay casillas sin dato (resaltadas). Puedes llenarlas a mano antes de generar.
        </div>
      )}

      {/* Acciones */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerar}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {state === 'generating' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {versionActual ? 'Modificar y regenerar' : 'Generar PDF'}
        </button>
        {versiones.length > 0 && (
          <button
            type="button"
            onClick={() => setVerHistorial((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <History className="h-3.5 w-3.5" /> {versiones.length} versión{versiones.length > 1 ? 'es' : ''}
          </button>
        )}
      </div>

      {/* Historial de versiones */}
      {verHistorial && versiones.length > 0 && (
        <div className="space-y-1 rounded-lg border border-border/60 p-2">
          {versiones.map((v) => (
            <div key={v.version_n} className="flex items-center gap-2 text-[11px]">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">v{v.version_n}</span>
              <span className="text-muted-foreground">{fmtFecha(v.generated_at)}</span>
              {v.autor && <span className="text-muted-foreground/70">· {v.autor}</span>}
              {v.drive_url && (
                <a href={v.drive_url} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" /> PDF
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
