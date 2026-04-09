'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  ChevronRight,
  FolderOpen,
  CheckCircle2,
  Circle,
  LayoutGrid,
  AlertTriangle,
  X,
  XCircle,
  ArrowLeft,
  Pencil,
  Building2,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  NegocioDetalle,
  EtapaNegocio,
  BloqueConfig,
  NegocioBloque,
} from '../negocio-v2-actions'
import { cambiarEtapaNegocioConGate, actualizarCarpetaUrlNegocio } from '../negocio-v2-actions'
import ActivityLog from '@/components/activity-log'
import CierreNegocioDialog from './cierre-negocio-dialog'

// Bloques renderers
import BloqueEquipo from './bloques/BloqueEquipo'
import BloqueDatos from './bloques/BloqueDatos'
import type { DatosField } from './bloques/BloqueDatos'
import BloqueChecklist from './bloques/BloqueChecklist'
import BloqueChecklistSoporte from './bloques/BloqueChecklistSoporte'
import BloqueDocumentos from './bloques/BloqueDocumentos'
import type { DocumentoConfig } from './bloques/BloqueDocumentos'
import BloqueCotizacion from './bloques/BloqueCotizacion'
import type { CotizacionResumen } from '../negocio-v2-actions'
import BloqueCobros from './bloques/BloqueCobros'
import BloqueDatosMultiPago from './bloques/BloqueDatosMultiPago'
import type { MultiPagoField } from './bloques/BloqueDatosMultiPago'
import BloqueAprobacion from './bloques/BloqueAprobacion'
import BloqueCronograma from './bloques/BloqueCronograma'
import BloqueResumenFinanciero from './bloques/BloqueResumenFinanciero'
import BloqueEjecucion from './bloques/BloqueEjecucion'
import BloqueHistorial from './bloques/BloqueHistorial'
import type { HistorialData } from './bloques/BloqueHistorial'

// ── Tipos auxiliares ──────────────────────────────────────────────────────────

interface EjecucionData {
  totalGastos: number
  totalHoras: number
  costoHoras: number
  gastosPorCategoria: Array<{ categoria: string; total: number }>
  presupuestoPorRubro?: Array<{ tipo: string; nombre: string; total: number }>
  precioAprobado?: number
}

// ── Helpers de formato ───────────────────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

function formatNegocioCodigo(codigo: string | null): string {
  if (!codigo) return codigo ?? ''
  return codigo
}

// ── Editor inline de carpeta URL ──────────────────────────────────────────────

function CarpetaUrlEditor({
  negocioId,
  initialUrl,
}: {
  negocioId: string
  initialUrl: string | null
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialUrl ?? '')
  const [savedUrl, setSavedUrl] = useState(initialUrl ?? '')
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  function startEditing() {
    setValue(savedUrl)
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function save() {
    setEditing(false)
    const trimmed = value.trim()
    if (trimmed === savedUrl) return
    startTransition(async () => {
      const res = await actualizarCarpetaUrlNegocio(negocioId, trimmed)
      if (res.error) {
        toast.error('Error guardando carpeta: ' + res.error)
        setValue(savedUrl)
      } else {
        setSavedUrl(trimmed)
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') { setEditing(false); setValue(savedUrl) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKeyDown}
        placeholder="https://drive.google.com/..."
        disabled={isPending}
        className="h-[30px] w-56 rounded-md border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:border-primary focus:outline-none"
      />
    )
  }

  if (savedUrl) {
    return (
      <span className="inline-flex items-center gap-1.5 group">
        <a
          href={savedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 hover:bg-amber-100 transition-colors"
        >
          <FolderOpen className="h-4 w-4 text-amber-500 shrink-0" />
          <span className="text-xs font-medium text-amber-700">Carpeta Drive</span>
        </a>
        <button
          onClick={startEditing}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/50 hover:text-muted-foreground"
          title="Editar link de carpeta"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={startEditing}
      className="inline-flex items-center gap-1.5 border border-dashed border-muted-foreground/30 rounded-md px-2.5 py-1.5 hover:border-muted-foreground/50 hover:bg-accent transition-colors"
    >
      <FolderOpen className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      <span className="text-xs text-muted-foreground/60">Agregar carpeta Drive</span>
    </button>
  )
}

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

// ── Modal de gates bloqueados ─────────────────────────────────────────────────

function ModalGateBloqueado({
  bloques,
  onClose,
  onOverride,
}: {
  bloques: Array<{ nombre: string; es_gate: boolean }>
  onClose: () => void
  onOverride: (motivo: string) => void
}) {
  const [motivo, setMotivo] = useState('')
  const [showOverride, setShowOverride] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
        <div className="flex items-start gap-3 border-b border-[#E5E7EB] p-4">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-[#1A1A1A]">Bloques gate pendientes</h3>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              Los siguientes bloques deben completarse antes de avanzar:
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 text-[#6B7280] hover:text-[#1A1A1A]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-2">
          {bloques.map((b, i) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              <span className="text-xs text-[#1A1A1A]">{b.nombre}</span>
              <span className="ml-auto text-[10px] font-semibold text-amber-600">GATE</span>
            </div>
          ))}
        </div>

        <div className="border-t border-[#E5E7EB] p-4 space-y-3">
          {!showOverride ? (
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-xs font-medium text-[#1A1A1A] hover:bg-slate-50"
              >
                Volver
              </button>
              <button
                onClick={() => setShowOverride(true)}
                className="flex-1 rounded-lg border border-amber-200 bg-amber-50 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100"
              >
                Omitir gate (owner)
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-[#6B7280]">
                Motivo del override <span className="text-red-500">*</span>
              </label>
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Explica por qué omites los gates..."
                rows={2}
                className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowOverride(false)}
                  className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-xs font-medium text-[#6B7280]"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => motivo.trim() && onOverride(motivo)}
                  disabled={!motivo.trim()}
                  className="flex-1 rounded-lg bg-amber-500 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
                >
                  Confirmar override
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Selector de etapa ─────────────────────────────────────────────────────────

function SelectorEtapa({
  negocioId,
  etapasLinea,
  etapaActualId,
  negocioEstado,
  stageActual,
  resumenFinanciero,
  precioAprobado,
}: {
  negocioId: string
  etapasLinea: EtapaNegocio[]
  etapaActualId: string | null
  negocioEstado: string | null
  stageActual: string | null
  resumenFinanciero: { totalCobrado: number; porCobrar: number; costosEjecutados: number; precioAprobado?: number }
  precioAprobado: number | null
}) {
  const [isPending, startTransition] = useTransition()
  const [gateModal, setGateModal] = useState<{
    etapaId: string
    bloques: Array<{ nombre: string; es_gate: boolean }>
  } | null>(null)
  const [showCierreDialog, setShowCierreDialog] = useState(false)

  const etapaActual = etapasLinea.find(e => e.id === etapaActualId)

  // Solo la siguiente etapa en orden estricto
  const siguienteEtapa = etapaActual
    ? [...etapasLinea]
        .sort((a, b) => a.orden - b.orden)
        .find(e => e.orden === etapaActual.orden + 1) ?? null
    : null

  // Si ya esta cerrado/perdido/cancelado/completado, no mostrar nada
  const estadosCerrados = ['cerrado', 'perdido', 'cancelado', 'completado']
  if (negocioEstado && estadosCerrados.includes(negocioEstado)) return null

  function handleAvanzar() {
    if (!siguienteEtapa) return
    startTransition(async () => {
      const result = await cambiarEtapaNegocioConGate(negocioId, siguienteEtapa.id)
      if (result.error === 'gate_bloqueado') {
        setGateModal({ etapaId: siguienteEtapa.id, bloques: result.bloquesPendientes ?? [] })
      } else if (result.error) {
        toast.error('Error al cambiar etapa: ' + result.error)
      } else {
        toast.success(`Avanzado a: ${siguienteEtapa.nombre}`)
      }
    })
  }

  function handleOverride(etapaId: string, motivo: string) {
    setGateModal(null)
    startTransition(async () => {
      const result = await cambiarEtapaNegocioConGate(negocioId, etapaId, motivo)
      if (result.error) {
        toast.error('Error: ' + result.error)
      } else {
        toast.success('Etapa actualizada con override')
      }
    })
  }

  // Texto y estilo del boton de cierre segun stage
  const cierreConfig = {
    venta: { label: 'Perder', icon: XCircle, btnClass: 'border-red-200 text-red-500 hover:bg-red-50' },
    ejecucion: { label: 'Cancelar', icon: XCircle, btnClass: 'border-red-200 text-red-500 hover:bg-red-50' },
    cobro: { label: 'Cerrar', icon: CheckCircle2, btnClass: 'border-green-200 text-green-600 hover:bg-green-50' },
  }[stageActual ?? 'venta'] ?? { label: 'Cerrar', icon: XCircle, btnClass: 'border-red-200 text-red-500 hover:bg-red-50' }

  const CierreIcon = cierreConfig.icon

  // Sin siguiente etapa (etapa final del stage): boton principal es cierre
  if (!siguienteEtapa) {
    return (
      <>
        <button
          onClick={() => setShowCierreDialog(true)}
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors disabled:opacity-60 ${cierreConfig.btnClass}`}
        >
          <CierreIcon className="h-3.5 w-3.5" />
          {cierreConfig.label}
        </button>

        {showCierreDialog && (
          <CierreNegocioDialog
            negocioId={negocioId}
            stage={stageActual ?? 'venta'}
            resumenFinanciero={resumenFinanciero}
            precioAprobado={precioAprobado}
            onClose={() => setShowCierreDialog(false)}
          />
        )}
      </>
    )
  }

  // Con siguiente etapa: boton avanzar + boton secundario de cierre
  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          onClick={handleAvanzar}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent disabled:opacity-60"
        >
          {isPending ? (
            <span className="text-muted-foreground">Cambiando...</span>
          ) : (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="truncate max-w-[120px]">{siguienteEtapa.nombre}</span>
            </>
          )}
        </button>
        <button
          onClick={() => setShowCierreDialog(true)}
          disabled={isPending}
          title={cierreConfig.label}
          className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${cierreConfig.btnClass}`}
        >
          <CierreIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{cierreConfig.label}</span>
        </button>
      </div>

      {gateModal && (
        <ModalGateBloqueado
          bloques={gateModal.bloques}
          onClose={() => setGateModal(null)}
          onOverride={motivo => handleOverride(gateModal.etapaId, motivo)}
        />
      )}

      {showCierreDialog && (
        <CierreNegocioDialog
          negocioId={negocioId}
          stage={stageActual ?? 'venta'}
          resumenFinanciero={resumenFinanciero}
          precioAprobado={precioAprobado}
          onClose={() => setShowCierreDialog(false)}
        />
      )}
    </>
  )
}

// ── Renderer de bloque según tipo ─────────────────────────────────────────────

interface BloqueExtendido extends BloqueConfig {
  instancia: NegocioBloque | null
  config_extra: Record<string, unknown>
  _currentUserId?: string | null
  items: Array<{
    id: string
    label: string
    tipo: string
    completado: boolean
    completado_por: string | null
    completado_at: string | null
    link_url: string | null
    imagen_data: string | null
    orden: number
  }>
}

function BloqueRenderer({
  bloque,
  negocioId,
  profiles,
  cobros,
  cotizacionesNegocio,
  resumenFinanciero,
  ejecucionData,
  historialData,
  precioTotal,
  userRole,
}: {
  bloque: BloqueExtendido
  negocioId: string
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    estado_causacion: string
    tipo_cobro: string | null
    fecha: string | null
    notas: string | null
    external_ref: string | null
  }>
  cotizacionesNegocio: CotizacionResumen[]
  resumenFinanciero: { totalCobrado: number; porCobrar: number; costosEjecutados: number; precioAprobado?: number }
  ejecucionData: EjecucionData
  historialData: HistorialData
  precioTotal: number
  userRole: string
}) {
  const tipo = bloque.bloque_definitions?.tipo ?? ''
  const modo = (bloque.estado as string) === 'completo' ? 'visible' : 'editable'
  const instanciaId = bloque.instancia?.id ?? ''
  const configExtra = bloque.config_extra
  const profilesTyped = profiles.map(p => ({
    id: p.id,
    full_name: p.full_name,
    email: p.email ?? undefined,
  }))

  // Equipo: editable solo para owner/supervisor, visible para el resto
  const canEditEquipo = ['owner', 'supervisor'].includes(userRole)

  switch (tipo) {
    case 'equipo':
      return (
        <BloqueEquipo
          negocioId={negocioId}
          negocioBloqueId={instanciaId}
          instancia={bloque.instancia}
          modo={canEditEquipo ? 'editable' : 'visible'}
          profiles={profilesTyped}
          configExtra={configExtra}
        />
      )

    case 'datos': {
      const fields = (configExtra.fields ?? []) as DatosField[]
      if (configExtra.es_multi_pago) {
        return (
          <BloqueDatosMultiPago
            negocioBloqueId={instanciaId}
            instancia={bloque.instancia}
            modo={modo}
            fields={fields as MultiPagoField[]}
          />
        )
      }
      return (
        <BloqueDatos
          negocioBloqueId={instanciaId}
          instancia={bloque.instancia}
          modo={modo}
          fields={fields}
          requireConfirm={!!configExtra.require_confirm}
          confirmLabel={configExtra.confirm_label as string | undefined}
        />
      )
    }

    case 'checklist': {
      const itemTemplates = (configExtra.items ?? []) as { label: string; tipo: string }[]
      const items = bloque.items.map(i => ({
        id: i.id,
        label: i.label,
        completado: i.completado,
        completado_por: i.completado_por,
        completado_at: i.completado_at,
        link_url: i.link_url,
      }))
      const withSupport = (configExtra.withSupport as boolean) ?? false
      return (
        <BloqueChecklist
          negocioId={negocioId}
          negocioBloqueId={instanciaId}
          instancia={bloque.instancia}
          modo={modo}
          itemTemplates={itemTemplates}
          initialItems={items}
          withSupport={withSupport}
        />
      )
    }

    case 'checklist_soporte': {
      const itemTemplates = (configExtra.items ?? []) as { label: string; tipo: string }[]
      const items = bloque.items.map(i => ({
        id: i.id,
        label: i.label,
        completado: i.completado,
        completado_por: i.completado_por,
        completado_at: i.completado_at,
        link_url: i.link_url,
      }))
      return (
        <BloqueChecklistSoporte
          negocioId={negocioId}
          negocioBloqueId={instanciaId}
          instancia={bloque.instancia}
          modo={modo}
          itemTemplates={itemTemplates}
          initialItems={items}
        />
      )
    }

    case 'documentos': {
      const documentos = (configExtra.documentos ?? []) as DocumentoConfig[]
      return (
        <BloqueDocumentos
          negocioBloqueId={instanciaId}
          negocioId={negocioId}
          instancia={bloque.instancia}
          modo={modo}
          documentos={documentos}
        />
      )
    }

    case 'cotizacion':
      return (
        <BloqueCotizacion
          negocioId={negocioId}
          modo={modo}
          cotizaciones={cotizacionesNegocio}
        />
      )

    case 'cobros':
      return (
        <BloqueCobros
          negocioId={negocioId}
          cobros={cobros}
          modo={modo}
          precioTotal={precioTotal}
        />
      )

    case 'aprobacion':
      return (
        <BloqueAprobacion
          negocioId={negocioId}
          negocioBloqueId={instanciaId}
          instancia={bloque.instancia}
          modo={modo}
          profiles={profilesTyped}
          currentUserId={bloque._currentUserId ?? undefined}
        />
      )

    case 'cronograma': {
      const items = bloque.items.map(i => ({
        id: i.id,
        label: i.label,
        completado: i.completado,
        completado_por: i.completado_por,
        completado_at: i.completado_at,
        link_url: i.link_url,
        fecha_inicio: (i as Record<string, unknown>).fecha_inicio as string | null | undefined,
        fecha_fin: (i as Record<string, unknown>).fecha_fin as string | null | undefined,
      }))
      return (
        <BloqueCronograma
          negocioId={negocioId}
          negocioBloqueId={instanciaId}
          instancia={bloque.instancia}
          modo={modo}
          initialItems={items}
          requireAllDates={(configExtra.require_all_dates as boolean) ?? false}
          profiles={profilesTyped}
        />
      )
    }

    case 'resumen_financiero':
      return <BloqueResumenFinanciero data={resumenFinanciero} />

    case 'ejecucion':
      return <BloqueEjecucion negocioId={negocioId} data={ejecucionData} />

    case 'historial':
      return <BloqueHistorial data={historialData} />

    default:
      return (
        <p className="text-xs text-[#6B7280] italic">
          Tipo de bloque &ldquo;{tipo}&rdquo; no soportado aún
        </p>
      )
  }
}

// ── Card de bloque ────────────────────────────────────────────────────────────

function BloqueCard({
  bloque,
  negocioId,
  profiles,
  cobros,
  cotizacionesNegocio,
  resumenFinanciero,
  ejecucionData,
  historialData,
  precioTotal,
  userRole,
}: {
  bloque: BloqueExtendido
  negocioId: string
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    estado_causacion: string
    tipo_cobro: string | null
    fecha: string | null
    notas: string | null
    external_ref: string | null
  }>
  cotizacionesNegocio: CotizacionResumen[]
  resumenFinanciero: { totalCobrado: number; porCobrar: number; costosEjecutados: number; precioAprobado?: number }
  ejecucionData: EjecucionData
  historialData: HistorialData
  precioTotal: number
  userRole: string
}) {
  const def = bloque.bloque_definitions
  const isVisualization = def?.is_visualization ?? false
  const instancia = bloque.instancia
  const estado = instancia?.estado ?? 'pendiente'
  const isCompleto = estado === 'completo'
  const isGate = bloque.es_gate
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`rounded-xl border transition-colors ${
        isGate
          ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/30 dark:bg-amber-950/10'
          : 'border-border bg-card'
      }`}
    >
      {/* Header del bloque */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <div className="shrink-0 mt-0.5">
          {isVisualization ? (
            <LayoutGrid className="h-4 w-4 text-muted-foreground/40" />
          ) : isCompleto ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <Circle className="h-4 w-4 text-muted-foreground/40" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-tight ${isCompleto && !isVisualization ? 'text-muted-foreground' : 'text-foreground'}`}>
            {bloque.nombre ?? def?.nombre ?? 'Bloque'}
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

        <div className="flex items-center gap-2 shrink-0">
          {!isVisualization && (
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                isCompleto
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {isCompleto ? 'Completo' : 'Pendiente'}
            </span>
          )}
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {/* Contenido del bloque */}
      {expanded && (
        <div className="border-t border-border/50 px-3 py-3">
          {!instancia ? (
            <p className="text-xs text-muted-foreground italic">
              Sin instancia creada para este bloque
            </p>
          ) : (
            <BloqueRenderer
              bloque={bloque}
              negocioId={negocioId}
              profiles={profiles}
              cobros={cobros}
              cotizacionesNegocio={cotizacionesNegocio}
              resumenFinanciero={resumenFinanciero}
              ejecucionData={ejecucionData}
              historialData={historialData}
              precioTotal={precioTotal}
              userRole={userRole}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Tipos Props ────────────────────────────────────────────────────────────────

interface Props {
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & {
    instancia: NegocioBloque | null
    config_extra: Record<string, unknown>
    items: Array<{
      id: string
      label: string
      tipo: string
      completado: boolean
      completado_por: string | null
      completado_at: string | null
      link_url: string | null
      imagen_data: string | null
      orden: number
    }>
  }>
  etapasLinea: EtapaNegocio[]
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  currentUserId: string | null
  userRole: string
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    estado_causacion: string
    tipo_cobro: string | null
    fecha: string | null
    notas: string | null
    external_ref: string | null
  }>
  cotizacionesNegocio: CotizacionResumen[]
  resumenFinanciero: { totalCobrado: number; porCobrar: number; costosEjecutados: number; precioAprobado?: number }
  ejecucionData: EjecucionData
  historialData: HistorialData
  actividad: Array<{
    id: string
    tipo: string
    autor_id: string | null
    contenido: string | null
    created_at: string
    autor_nombre: string | null
  }>
  staffList: Array<{ id: string; full_name: string }>
  errorMsg?: string
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function NegocioDetailClient({
  negocio,
  bloques,
  etapasLinea,
  profiles,
  currentUserId,
  userRole,
  cobros,
  cotizacionesNegocio,
  actividad,
  resumenFinanciero,
  ejecucionData,
  historialData,
  staffList,
  errorMsg,
}: Props) {
  useEffect(() => {
    if (errorMsg) toast.error(errorMsg)
  }, [errorMsg])

  const precio = negocio.precio_aprobado ?? negocio.precio_estimado
  const estaAprobado = negocio.precio_aprobado !== null && negocio.precio_aprobado !== undefined
  const etapaActual = negocio.etapas_negocio

  // Evaluar condiciones: filtrar bloques cuya condition no se cumpla
  const allBloques = (bloques as BloqueExtendido[]).map(b => ({
    ...b,
    _currentUserId: currentUserId,
  }))

  // Recopilar datos de todos los bloques de esta etapa para evaluar condiciones
  const datosEtapa: Record<string, unknown> = {}
  for (const b of allBloques) {
    const d = b.instancia?.data as Record<string, unknown> | null
    if (d) Object.assign(datosEtapa, d)
  }

  const bloquesExtendidos = allBloques.filter(b => {
    const cond = b.config_extra?.condition as { field: string; value: string } | undefined
    if (!cond) return true
    return String(datosEtapa[cond.field] ?? '') === cond.value
  })

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      {/* ── HEADER NOOR 5 FILAS ── */}
      <div className="space-y-2.5 mb-4">
        {/* Fila 1 — nav */}
        <div className="flex items-center">
          <Link
            href="/negocios"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3 w-3" />
            Negocios
          </Link>
        </div>

        {/* Fila 2 — titulo + accion */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-0.5">
              <StageBadge stage={negocio.stage_actual} />
            </div>
            <h1 className="flex items-baseline gap-1.5 text-lg font-bold leading-tight">
              {negocio.codigo && (
                <>
                  <span className="shrink-0 font-mono text-foreground select-all">
                    {formatNegocioCodigo(negocio.codigo)}
                  </span>
                  <span className="text-muted-foreground font-normal">—</span>
                </>
              )}
              <span className="truncate">{negocio.nombre}</span>
            </h1>
          </div>
          <div className="shrink-0 mt-1">
            <SelectorEtapa
              negocioId={negocio.id}
              etapasLinea={etapasLinea}
              etapaActualId={negocio.etapa_actual_id}
              negocioEstado={negocio.estado}
              stageActual={negocio.stage_actual}
              resumenFinanciero={resumenFinanciero}
              precioAprobado={negocio.precio_aprobado}
            />
          </div>
        </div>

        {/* Fila 3 — empresa + contacto + precio */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
            {negocio.empresas?.nombre && (
              <Link
                href={`/directorio/empresa/${negocio.empresas.id}`}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent transition-colors"
              >
                <Building2 className="h-3 w-3 text-purple-400 shrink-0" />
                <span className="truncate">{negocio.empresas.nombre}</span>
              </Link>
            )}
            {negocio.empresas?.nombre && negocio.contactos?.nombre && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {negocio.contactos?.nombre && (
              <Link
                href={`/directorio/contacto/${negocio.contactos.id}`}
                className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent transition-colors"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-bold uppercase">
                  {negocio.contactos.nombre.charAt(0)}
                </span>
                <span className="truncate">{negocio.contactos.nombre}</span>
              </Link>
            )}
          </div>
          {precio !== null && precio !== undefined && (
            <span className={`shrink-0 tabular-nums text-base ${estaAprobado ? 'text-foreground font-bold' : 'text-muted-foreground font-semibold'}`}>
              {fmt(precio)}
            </span>
          )}
        </div>

        {/* Fila 4 — carpeta Drive */}
        <div>
          <CarpetaUrlEditor
            negocioId={negocio.id}
            initialUrl={negocio.carpeta_url}
          />
        </div>

        {/* Fila 5 — progreso */}
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

          {bloquesExtendidos.length > 0 && (
            <div className="space-y-2">
              {bloquesExtendidos.map(bloque => (
                <BloqueCard
                  key={bloque.id}
                  bloque={bloque}
                  negocioId={negocio.id}
                  profiles={profiles}
                  cobros={cobros}
                  cotizacionesNegocio={cotizacionesNegocio}
                  resumenFinanciero={resumenFinanciero}
                  ejecucionData={ejecucionData}
                  historialData={historialData}
                  precioTotal={negocio.precio_aprobado ?? negocio.precio_estimado ?? 0}
                  userRole={userRole}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Activity log ── */}
        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Actividad</h3>
          </div>
          <div className="p-4">
            <ActivityLog
              entidadTipo="negocio"
              entidadId={negocio.id}
              staffList={staffList}
            />
          </div>
        </div>
      </div>

    </div>
  )
}
