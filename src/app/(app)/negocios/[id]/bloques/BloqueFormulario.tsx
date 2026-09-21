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
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import {
  generarFormulario,
  resolverFormularioParaEdicion,
  guardarFormularioOverrides,
  guardarSeccional,
  confirmarNitFormulario,
  type CasillaEditable,
  type EstadoConfirmacionNit,
  type FormularioVersionItem,
} from '@/lib/actions/formulario-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'

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
  // ── Transcripción a ciegas del NIT ──────────────────────────────────────
  const [confirmNit, setConfirmNit] = useState<EstadoConfirmacionNit | undefined>(undefined)
  const [nitTecleado, setNitTecleado] = useState('')
  // Cuando NO coincide, el campo para teclear NO vuelve en esta vista. Al mostrar los
  // dos números lado a lado el guardado queda a la vista, así que reofrecerlo dejaría
  // que se copie el que está en pantalla — y eso es exactamente el rubber-stamp que
  // este control existe para evitar (en V0446 alguien ya había mirado ese número).
  // La salida es corregir el bloque de origen; al cambiar el NIT, la pantalla vuelve a
  // pedir la transcripción con otro valor.
  const [desajusteNit, setDesajusteNit] = useState<{ tecleado: string; guardado: string } | null>(null)
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
    setConfirmNit(res.confirmacion_nit)
    const init: Record<string, string> = {}
    res.casillas.forEach((c) => { init[c.slug] = c.value })
    setValores(init)
    setLoading(false)
  }

  function handleConfirmarNit() {
    startTransition(async () => {
      const r = await confirmarNitFormulario(negocioBloqueId, nitTecleado)
      if (r.ok) {
        setNitTecleado('')
        setDesajusteNit(null)
        await cargar() // recarga: ahora sí llega el valor de la casilla del NIT
        toast.success('NIT confirmado')
        return
      }
      if (r.tecleado && r.guardado) {
        setDesajusteNit({ tecleado: r.tecleado, guardado: r.guardado })
        return
      }
      toast.error(r.error ?? 'No se pudo confirmar')
    })
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
          <a href={hrefArchivo(driveUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
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
  const pideConfirmarNit = Boolean(confirmNit?.requiere) && !confirmNit?.confirmado

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
          <a href={hrefArchivo(driveUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="shrink-0 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
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

      {/* ── Transcripción a ciegas del NIT ──────────────────────────────── */}
      {pideConfirmarNit && (
        <div data-testid="panel-confirmacion-nit" className="rounded-lg border border-amber-300 bg-amber-50/50 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Confirma el NIT antes de generar
          </p>

          {desajusteNit ? (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-red-700">
                <XCircle className="h-3.5 w-3.5 shrink-0" />
                Los dos números no coinciden
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-white px-2 py-1.5">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Escribiste</p>
                  <p data-testid="nit-tecleado" className="font-mono text-sm">{desajusteNit.tecleado}</p>
                </div>
                <div className="rounded-md border border-red-300 bg-white px-2 py-1.5">
                  <p className="text-[9px] uppercase tracking-wide text-muted-foreground">Guardado (va a la DIAN)</p>
                  <p data-testid="nit-guardado" className="font-mono text-sm text-red-700">{desajusteNit.guardado}</p>
                </div>
              </div>
              <p className="text-[11px] text-amber-800">
                Si lo que escribiste es lo que dice el documento, el que está mal es el guardado.
                Corrígelo en el bloque{confirmNit?.documento_label ? ` «${confirmNit.documento_label}»` : ' del documento'} —
                te va a pedir la causa— y vuelve aquí. Este formulario no se genera hasta entonces.
              </p>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-amber-800">
                Abre el documento y escribe la casilla 5 tal como aparece. No se muestra en pantalla:
                el número tiene que salir del documento, no de aquí.
              </p>
              {confirmNit?.documento_url && (
                <a
                  href={hrefArchivo(confirmNit.documento_url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" /> Abrir {confirmNit.documento_label ?? 'el documento'}
                </a>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={nitTecleado}
                  onChange={(e) => setNitTecleado(e.target.value)}
                  placeholder="Casilla 5 del RUT"
                  aria-label="Casilla 5 del RUT"
                  className="w-44 rounded-md border border-amber-400 bg-white px-2 py-1 font-mono text-xs focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
                />
                <button
                  type="button"
                  onClick={handleConfirmarNit}
                  disabled={isPending || nitTecleado.trim() === ''}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500 bg-white px-3 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Confirmar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {confirmNit?.requiere && confirmNit.confirmado && (
        <p data-testid="nit-confirmado" className="flex items-center gap-1.5 text-[11px] text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          NIT confirmado{confirmNit.por_nombre ? ` por ${confirmNit.por_nombre}` : ''}
        </p>
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
                    {c.fijo && <span className="text-[9px] font-normal text-muted-foreground">fijo</span>}
                    {c.oculto && <span className="text-[9px] font-normal text-amber-700">oculto</span>}
                  </span>
                  {/* La casilla del NIT sin confirmar se pinta tapada y sin input: no hay
                      valor que mostrar (el servidor no lo manda) y tampoco debe poder
                      escribirse aquí, porque un texto tecleado quedaría como override. */}
                  {c.oculto ? (
                    <div
                      data-testid={`casilla-oculta-${c.slug}`}
                      title="Se muestra al confirmar el NIT"
                      className="w-full cursor-not-allowed select-none rounded-md border border-amber-400 bg-amber-50/60 px-2 py-1 font-mono text-xs text-amber-700"
                    >
                      •••••••• <span className="font-sans text-[10px]">se muestra al confirmar</span>
                    </div>
                  ) : (
                  <input
                    type="text"
                    value={valores[c.slug] ?? ''}
                    onChange={(e) => handleChange(c.slug, e.target.value)}
                    onBlur={() => void flushOverrides()}
                    readOnly={c.fijo}
                    title={c.fijo ? 'Lo fija el sistema: el solicitante se identifica con NIT (31)' : undefined}
                    className={`w-full rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-primary/15 ${
                      c.fijo
                        ? 'border-border bg-muted/60 text-muted-foreground cursor-not-allowed'
                        : c.faltante && !valores[c.slug] ? 'border-amber-400 bg-amber-50/40' : 'border-border focus:border-primary'
                    }`}
                  />
                  )}
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
          data-testid="generar-formulario"
          onClick={handleGenerar}
          // Sin confirmación del NIT no se genera. El servidor lo frena igual
          // (`generarFormularioCore`); esto solo evita el viaje y explica por qué.
          disabled={isPending || pideConfirmarNit}
          title={pideConfirmarNit ? 'Confirma el NIT del documento antes de generar' : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
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
                <a href={hrefArchivo(v.drive_url) ?? undefined} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-primary hover:underline">
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
