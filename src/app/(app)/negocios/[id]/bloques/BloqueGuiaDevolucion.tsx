'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, ExternalLink, FileText, Loader2, Sparkles, AlertTriangle, MapPin } from 'lucide-react'
import { toast } from 'sonner'
import { generarVersionGuia, aprobarVersionGuia } from '@/lib/actions/guia-devolucion-actions'
import type { GuiaData } from '@/lib/actions/guia-devolucion-types'
import { SECCIONALES_DIAN, type SeccionalDIAN } from '@/lib/dian/seccionales'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface Props {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  configExtra: Record<string, unknown>
  /** Datos resueltos server-side (nombre, nit, ciudad, fechaCita, seccional sugerida) */
  preview?: {
    nombre?: string | null
    nit?: string | null
    ciudad_venta?: string | null
    fecha_cita?: string | null
    seccional_sugerida_slug?: string | null
  }
}

const SECCIONALES_CON_CITA = SECCIONALES_DIAN.filter(s => s.cita)
const SECCIONALES_SIN_CITA = SECCIONALES_DIAN.filter(s => !s.cita)

function fmtFecha(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('es-CO', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function BloqueGuiaDevolucion({
  negocioBloqueId,
  instancia,
  modo,
  preview,
}: Props) {
  const saved = (instancia?.data ?? {}) as GuiaData
  const versiones = saved.versiones ?? []
  const versionActiva = versiones.find(v => v.n === saved.version_activa) ?? versiones[versiones.length - 1]
  const aprobado = !!saved.aprobado_at

  const [seccionalOverride, setSeccionalOverride] = useState<string>(
    preview?.seccional_sugerida_slug ?? ''
  )
  const [generating, setGenerating] = useState(false)
  const [approving, setApproving] = useState(false)
  const [, startTransition] = useTransition()

  const seccionalActual: SeccionalDIAN | undefined = SECCIONALES_DIAN.find(
    s => s.slug === (seccionalOverride || preview?.seccional_sugerida_slug),
  )

  const handleGenerar = () => {
    setGenerating(true)
    startTransition(async () => {
      const res = await generarVersionGuia({
        bloqueId: negocioBloqueId,
        seccional_slug_override: seccionalOverride || undefined,
      })
      if (!res.ok) {
        toast.error(res.error)
      } else if (res.warning) {
        toast.warning(res.warning)
      } else {
        toast.success(`Guía v${(versiones.at(-1)?.n ?? 0) + 1} generada`)
      }
      setGenerating(false)
    })
  }

  const handleAprobar = (n: number) => {
    setApproving(true)
    startTransition(async () => {
      const res = await aprobarVersionGuia(negocioBloqueId, n)
      if (!res.ok) toast.error(res.error)
      else toast.success(`Guía v${n} aprobada`)
      setApproving(false)
    })
  }

  // ── Modo visible (heredado o post-aprobacion) ──
  if (modo === 'visible') {
    if (versiones.length === 0) {
      return <p className="text-xs text-[#6B7280] italic">Aún no se ha generado la guía.</p>
    }
    return (
      <div className="space-y-2">
        {aprobado && versionActiva && (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50/40 px-3 py-2 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
            <span className="text-green-700 font-medium">Aprobada v{versionActiva.n}</span>
            <span className="text-green-600/70">· {versionActiva.seccional_label}</span>
          </div>
        )}
        <ul className="space-y-1">
          {versiones.map(v => (
            <li key={v.n} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-white px-3 py-1.5 text-xs">
              <span className="font-mono text-foreground">v{v.n}</span>
              <span className="flex-1 text-muted-foreground truncate">{v.seccional_label}</span>
              {v.pdf_url ? (
                <a href={v.pdf_url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3 w-3" />PDF
                </a>
              ) : (
                <span className="text-[10px] text-muted-foreground italic">sin pdf</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ── Modo editable ──
  return (
    <div className="space-y-3">
      {/* Preview de datos */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Solicitante</p>
          <p className="text-foreground truncate">{preview?.nombre ?? '—'}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">NIT / Cédula</p>
          <p className="text-foreground truncate">{preview?.nit ?? '—'}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Ciudad factura</p>
          <p className="text-foreground truncate">{preview?.ciudad_venta ?? '—'}</p>
        </div>
        <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
          <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Fecha cita</p>
          <p className="text-foreground truncate">{preview?.fecha_cita ?? 'No requiere'}</p>
        </div>
      </div>

      {/* Selector seccional */}
      <div>
        <label className="block text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1">
          <MapPin className="inline h-3 w-3 mr-1" />
          Seccional DIAN
          {preview?.seccional_sugerida_slug && !seccionalOverride && (
            <span className="ml-2 text-[9px] text-green-600 normal-case">auto-detectada desde factura</span>
          )}
        </label>
        <select
          value={seccionalOverride}
          onChange={e => setSeccionalOverride(e.target.value)}
          className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
        >
          <option value="">— Auto-detectar desde factura —</option>
          <optgroup label="Requieren cita previa">
            {SECCIONALES_CON_CITA.map(s => (
              <option key={s.slug} value={s.slug}>{s.label}</option>
            ))}
          </optgroup>
          <optgroup label="Sin cita previa">
            {SECCIONALES_SIN_CITA.map(s => (
              <option key={s.slug} value={s.slug}>{s.label}</option>
            ))}
          </optgroup>
        </select>
        {seccionalActual && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            Buzón: <span className="font-mono">{seccionalActual.email}</span>
            {seccionalActual.cita && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-700">
                <AlertTriangle className="h-3 w-3" /> Requiere cita previa (fecha desde DA-Fecha cita DIAN)
              </span>
            )}
          </p>
        )}
      </div>

      {/* Boton generar */}
      <button
        type="button"
        onClick={handleGenerar}
        disabled={generating || approving}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {generating ? 'Generando…' : `Generar v${(versiones.at(-1)?.n ?? 0) + 1}`}
      </button>

      {/* Lista de versiones */}
      {versiones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Versiones generadas</p>
          {[...versiones].reverse().map(v => {
            const isActiva = v.n === saved.version_activa
            const isAprobada = aprobado && v.n === saved.aprobado_version
            return (
              <div
                key={v.n}
                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
                  isAprobada
                    ? 'border-green-300 bg-green-50/40'
                    : isActiva
                      ? 'border-primary/30 bg-primary/5'
                      : 'border-border/60 bg-white'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`font-mono font-semibold ${isAprobada ? 'text-green-700' : 'text-foreground'}`}>
                    v{v.n}
                  </span>
                  <div className="min-w-0">
                    <p className="text-foreground truncate">{v.seccional_label}</p>
                    <p className="text-[10px] text-muted-foreground">{fmtFecha(v.generated_at)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {v.pdf_url ? (
                    <a href={v.pdf_url} target="_blank" rel="noopener noreferrer"
                       className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-[10px] hover:bg-muted/50">
                      <FileText className="h-3 w-3" /> PDF
                    </a>
                  ) : (
                    <span className="text-[10px] text-muted-foreground italic">sin pdf</span>
                  )}
                  {!aprobado && (
                    <button
                      type="button"
                      onClick={() => handleAprobar(v.n)}
                      disabled={approving || generating}
                      className="inline-flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      Aprobar v{v.n}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
