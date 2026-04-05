'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  FolderOpen,
  CheckCircle2,
  Circle,
  LayoutGrid,
  ChevronDown,
  MessageSquare,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  NegocioDetalle,
  EtapaNegocio,
  BloqueConfig,
  NegocioBloque,
} from '../negocio-v2-actions'
import { cambiarEtapaNegocio } from '../negocio-v2-actions'

// ── Helpers de formato ───────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

// ── Stage badge ──────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  venta: 'VENTA',
  ejecucion: 'EJECUCIÓN',
  cobro: 'COBRO',
}

const STAGE_CLASSES: Record<string, string> = {
  venta: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  ejecucion: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cobro: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}

function StageBadge({ stage }: { stage: string | null }) {
  const cls = STAGE_CLASSES[stage ?? ''] ?? 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${cls}`}>
      {STAGE_LABELS[stage ?? ''] ?? (stage?.toUpperCase() ?? 'ACTIVO')}
    </span>
  )
}

// ── Barra de progreso del stage ──────────────────────────────────────────────

function BarraProgreso({
  etapasLinea,
  etapaActualId,
  stageActual,
}: {
  etapasLinea: EtapaNegocio[]
  etapaActualId: string | null
  stageActual: string | null
}) {
  if (etapasLinea.length === 0) return null

  // Filtrar etapas del stage actual
  const etapasStage = etapasLinea.filter(e => e.stage === stageActual)
  if (etapasStage.length === 0) return null

  const idxActual = etapasStage.findIndex(e => e.id === etapaActualId)
  const completadas = idxActual >= 0 ? idxActual : 0
  const total = etapasStage.length
  const pct = total > 0 ? Math.round((completadas / total) * 100) : 0

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground">
          {completadas} / {total} etapas en {STAGE_LABELS[stageActual ?? ''] ?? stageActual}
        </span>
        <span className="text-[10px] font-semibold text-muted-foreground">{pct}%</span>
      </div>
      <div className="h-1 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Selector de etapa ─────────────────────────────────────────────────────────

function SelectorEtapa({
  negocioId,
  etapasLinea,
  etapaActualId,
}: {
  negocioId: string
  etapasLinea: EtapaNegocio[]
  etapaActualId: string | null
}) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  const etapaActual = etapasLinea.find(e => e.id === etapaActualId)

  if (etapasLinea.length === 0) return null

  function handleSelect(etapaId: string) {
    setOpen(false)
    startTransition(async () => {
      const result = await cambiarEtapaNegocio(negocioId, etapaId)
      if (result.error) {
        toast.error('Error al cambiar etapa: ' + result.error)
      } else {
        toast.success('Etapa actualizada')
      }
    })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-60"
      >
        {isPending ? (
          <span className="text-muted-foreground">Cambiando...</span>
        ) : (
          <>
            <span>{etapaActual?.nombre ?? 'Seleccionar etapa'}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
            {etapasLinea.map(etapa => {
              const isActive = etapa.id === etapaActualId
              return (
                <button
                  key={etapa.id}
                  onClick={() => handleSelect(etapa.id)}
                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors hover:bg-accent ${
                    isActive ? 'font-semibold text-primary' : 'text-foreground'
                  }`}
                >
                  <StageBadge stage={etapa.stage} />
                  <span className="flex-1 truncate">{etapa.nombre}</span>
                  {isActive && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Card de bloque ────────────────────────────────────────────────────────────

function BloqueCard({
  bloque,
}: {
  bloque: BloqueConfig & { instancia: NegocioBloque | null }
}) {
  const def = bloque.bloque_definitions
  const isVisualization = def?.is_visualization ?? false
  const instancia = bloque.instancia
  const estado = instancia?.estado ?? 'pendiente'
  const isCompleto = estado === 'completo'
  const isGate = bloque.es_gate

  return (
    <div
      className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${
        isGate
          ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/10'
          : 'border-border bg-card'
      }`}
    >
      {/* Estado icon — solo para bloques de registro */}
      {!isVisualization && (
        <div className="shrink-0 mt-0.5">
          {isCompleto ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground/40" />
          )}
        </div>
      )}

      {isVisualization && (
        <div className="shrink-0 mt-0.5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground/40" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium leading-tight ${isCompleto ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
          {def?.nombre ?? 'Bloque'}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {def?.tipo && (
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
              {def.tipo}
            </span>
          )}
          {isGate && (
            <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
              GATE
            </span>
          )}
          {isVisualization && (
            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">
              Visualización
            </span>
          )}
        </div>
      </div>

      {!isVisualization && (
        <div className="shrink-0">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              isCompleto
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {isCompleto ? 'Completo' : 'Pendiente'}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }>
  etapasLinea: EtapaNegocio[]
}

export default function NegocioDetailClient({ negocio, bloques, etapasLinea }: Props) {
  const precio = negocio.precio_aprobado ?? negocio.precio_estimado
  const etapaActual = negocio.etapas_negocio

  // ID corto: últimos 6 chars del UUID
  const idCorto = negocio.id.slice(-6).toUpperCase()

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      {/* ── HEADER CONDENSADO ── */}
      <div className="mb-4 rounded-xl border border-border bg-card p-4 shadow-sm">
        {/* Fila 1: Badge stage + ID + Nombre + Botón cambiar etapa */}
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-2 shrink-0 mt-0.5">
            <StageBadge stage={negocio.stage_actual} />
            <span className="text-[10px] font-mono text-muted-foreground/60">{idCorto}</span>
          </div>
          <h1 className="flex-1 min-w-0 text-sm font-bold leading-tight truncate">
            {negocio.nombre}
          </h1>
          <div className="shrink-0">
            <SelectorEtapa
              negocioId={negocio.id}
              etapasLinea={etapasLinea}
              etapaActualId={negocio.etapa_actual_id}
            />
          </div>
        </div>

        {/* Fila 2: Precio + Drive + Contacto + Empresa */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {precio !== null && precio !== undefined && (
            <span className="font-semibold text-foreground tabular-nums">
              {fmt(precio)}
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                {negocio.precio_aprobado ? 'aprobado' : 'estimado'}
              </span>
            </span>
          )}

          {negocio.carpeta_url && (
            <a
              href={negocio.carpeta_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <FolderOpen className="h-3 w-3" />
              Drive
            </a>
          )}

          {negocio.contactos?.nombre && (
            <span className="inline-flex items-center gap-1">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-bold uppercase">
                {negocio.contactos.nombre.charAt(0)}
              </span>
              {negocio.contactos.nombre}
            </span>
          )}

          {negocio.empresas?.nombre && (
            <span className="font-medium text-foreground/80">{negocio.empresas.nombre}</span>
          )}

          {negocio.lineas_negocio?.nombre && (
            <span className="text-[10px] text-muted-foreground/60">
              {negocio.lineas_negocio.nombre}
            </span>
          )}
        </div>

        {/* Barra de progreso del stage */}
        <BarraProgreso
          etapasLinea={etapasLinea}
          etapaActualId={negocio.etapa_actual_id}
          stageActual={negocio.stage_actual}
        />
      </div>

      {/* ── BODY: Etapa actual + Bloques ── */}
      <div className="space-y-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Etapa actual:{' '}
              <span className="text-primary">
                {etapaActual?.nombre ?? '—'}
              </span>
            </h2>
            {etapaActual?.stage && (
              <StageBadge stage={etapaActual.stage} />
            )}
          </div>

          {bloques.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Sin bloques configurados para esta etapa
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                MéTRIK configura los bloques vía{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/configure-gates</code>
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {bloques.map(bloque => (
                <BloqueCard key={bloque.id} bloque={bloque} />
              ))}
            </div>
          )}
        </div>

        {/* ── Activity log (placeholder) ── */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Actividad del negocio</h3>
          </div>
          <p className="text-xs text-muted-foreground py-4 text-center">
            Actividad del negocio — próximamente
          </p>
        </div>
      </div>

      {/* Breadcrumb de vuelta */}
      <div className="mt-6">
        <Link
          href="/negocios"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Volver a Negocios
        </Link>
      </div>
    </div>
  )
}
