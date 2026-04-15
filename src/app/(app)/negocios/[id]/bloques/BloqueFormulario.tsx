'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  FileOutput,
  Loader2,
  CheckCircle2,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { generarFormulario } from '@/lib/actions/formulario-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

// ── Types ────────────────────────────────────────────────────────────────────

interface BloqueFormularioProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  configExtra: {
    label: string
    template: string
    campos_fuente: Array<{
      slug: string
      source: { etapa_orden: number; bloque_orden: number; campo_slug: string; tipo: string }
    }>
    campos_constantes?: Record<string, string>
  }
}

type GenerateState = 'idle' | 'generating' | 'complete' | 'error' | 'missing_data'

// ── Component ────────────────────────────────────────────────────────────────

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

  const [isPending, startTransition] = useTransition()
  const [state, setState] = useState<GenerateState>(() => {
    if (saved.drive_url) return 'complete'
    return 'idle'
  })
  const [driveUrl, setDriveUrl] = useState<string | null>((saved.drive_url as string) ?? null)
  const [faltantes, setFaltantes] = useState<string[]>([])

  const handleGenerar = () => {
    setState('generating')
    startTransition(async () => {
      const result = await generarFormulario(negocioBloqueId, negocioId)

      if (result.success) {
        setState('complete')
        setDriveUrl(result.drive_url ?? null)
        setFaltantes([])
        toast.success(`${label} generado correctamente`)
        router.refresh()
      } else if (result.faltantes && result.faltantes.length > 0) {
        setState('missing_data')
        setFaltantes(result.faltantes)
        toast.error(`Faltan datos para generar ${label}`)
      } else {
        setState('error')
        toast.error(result.error ?? 'Error generando formulario')
      }
    })
  }

  // ── Modo visible ──────────────────────────────────────────────────────

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {state === 'complete' ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
          ) : (
            <FileOutput className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium">{label}</span>
          {driveUrl && (
            <a
              href={driveUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="h-3 w-3" />
              Ver PDF
            </a>
          )}
        </div>
      </div>
    )
  }

  // ── Modo editable ─────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Idle — ready to generate */}
      {state === 'idle' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-4">
          <FileOutput className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-medium">{label}</span>
            <p className="text-[11px] text-muted-foreground/60">
              Se generará automáticamente con datos de etapas anteriores
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerar}
            disabled={isPending}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            Generar
          </button>
        </div>
      )}

      {/* Generating */}
      {state === 'generating' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          <div>
            <span className="text-sm font-medium text-primary">{label}</span>
            <p className="text-[11px] text-primary/70">Generando documento...</p>
          </div>
        </div>
      )}

      {/* Complete */}
      {state === 'complete' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-solid border-green-300 bg-green-50/30 p-4">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-green-800">{label}</span>
            {driveUrl && (
              <a
                href={driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[11px] text-green-600 hover:underline"
              >
                <ExternalLink className="inline h-3 w-3 mr-0.5" />
                Ver en Drive
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={handleGenerar}
            disabled={isPending}
            className="rounded-md border border-green-300 bg-white px-2 py-0.5 text-[10px] font-medium text-green-700 hover:bg-green-50 shrink-0 inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Regenerar
          </button>
        </div>
      )}

      {/* Missing data */}
      {state === 'missing_data' && (
        <div className="rounded-lg border-2 border-dashed border-amber-300 bg-amber-50/30 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            <div>
              <span className="text-sm font-medium text-amber-800">{label}</span>
              <p className="text-[11px] text-amber-600">
                Faltan datos de etapas anteriores para generar este documento
              </p>
            </div>
          </div>
          <div className="ml-7 flex flex-wrap gap-1.5">
            {faltantes.map(f => (
              <span
                key={f}
                className="inline-block rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"
              >
                {f.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <div className="ml-7">
            <button
              type="button"
              onClick={handleGenerar}
              disabled={isPending}
              className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
            >
              Reintentar
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {state === 'error' && (
        <div className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-red-300 bg-red-50/30 p-4">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <div className="flex-1">
            <span className="text-sm font-medium text-red-700">{label}</span>
            <p className="text-[11px] text-red-500">Error generando documento</p>
          </div>
          <button
            type="button"
            onClick={handleGenerar}
            disabled={isPending}
            className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-[10px] font-medium text-red-600 hover:bg-red-50 shrink-0"
          >
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}
