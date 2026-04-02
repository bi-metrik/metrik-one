'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Flame, Building2, User, Search, Clock, Trophy, X, ChevronRight, AlertTriangle, Info, FileText } from 'lucide-react'
import { toast } from 'sonner'
import EntityCard from '@/components/entity-card'
import { ETAPA_CONFIG, ETAPAS_ACTIVAS, TODAS_ETAPAS, RAZONES_PERDIDA } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import { moveOportunidad, ganarOportunidad, perderOportunidad, checkCotizacionExiste } from './actions-v2'
import type { WorkspaceStageWithProceso } from './actions-v2'
import type { EtapaPipeline } from '@/lib/pipeline/constants'

// D171: Soft gate messages por etapa destino
const SOFT_GATE_MSGS: Partial<Record<EtapaPipeline, string>> = {
  contacto_inicial: '¿Ya tomaste el primer contacto con este prospecto?',
  discovery_hecha: '¿Identificaste claramente la necesidad del cliente?',
  propuesta_enviada: '¿Tienes una cotización lista para presentar?',
  negociacion: '¿El cliente recibió y está evaluando la propuesta?',
}

interface OportunidadRow {
  id: string
  codigo: string
  descripcion: string | null
  etapa: string | null
  probabilidad: number | null
  valor_estimado: number | null
  created_at: string | null
  ultima_accion: string | null
  ultima_accion_fecha: string | null
  contactos: { nombre: string } | null
  empresas: { nombre: string; numero_documento: string | null; tipo_documento: string | null; tipo_persona: string | null; regimen_tributario: string | null; gran_contribuyente: boolean | null; agente_retenedor: boolean | null } | null
  responsable_id: string | null
  staff: { id: string; full_name: string } | null
}

// Labels para nombres de proceso mostrados en el selector
const PROCESO_LABELS: Record<string, string> = {
  ve: 'VE',
  kaeser: 'Kaeser',
  incentivos_b2b: 'Incentivos B2B',
}

interface Props {
  oportunidades: OportunidadRow[]
  sinResponsableCount?: number
  stages?: WorkspaceStageWithProceso[]
}

export default function PipelineList({ oportunidades, sinResponsableCount = 0, stages = [] }: Props) {
  const [search, setSearch] = useState('')
  const [etapaFilter, setEtapaFilter] = useState<string | null>('activas')
  const [procesoFilter, setProcesoFilter] = useState<string | null>(null) // null = Todos
  const [isPending, startTransition] = useTransition()
  const [lostModal, setLostModal] = useState<{ id: string; name: string } | null>(null)
  const [selectedReason, setSelectedReason] = useState('')
  // D171: Soft gate state
  const [softGateModal, setSoftGateModal] = useState<{
    id: string
    currentEtapa: string | null
    nextEtapa: EtapaPipeline
    mensaje: string
    bloqueado?: boolean
    motivoBloqueado?: string
  } | null>(null)
  const router = useRouter()

  // Calcular procesos disponibles a partir de las etapas del workspace
  // Solo mostrar selector si hay al menos un proceso definido
  const procesosDisponibles = Array.from(
    new Set(stages.filter(s => s.proceso !== null).map(s => s.proceso as string))
  )
  const tieneMultiProceso = procesosDisponibles.length > 0

  // Etapas activas para un proceso dado (o todas las etapas si proceso = null)
  // Una etapa aplica si: proceso IS NULL O proceso = procesoSeleccionado
  const getEtapasActivas = (proceso: string | null): string[] => {
    if (stages.length === 0) {
      // Sin stages de DB — usar constantes hardcodeadas (compatibilidad)
      return ETAPAS_ACTIVAS as unknown as string[]
    }
    return stages
      .filter(s => !s.es_terminal && s.activo)
      .filter(s => proceso === null || s.proceso === null || s.proceso === proceso)
      .sort((a, b) => a.orden - b.orden)
      .map(s => s.sistema_slug || s.slug)
  }

  // getNextEtapa para una oportunidad específica usando las etapas de su proceso
  const getNextEtapaForOpp = (currentEtapa: string | null, proceso: string | null): EtapaPipeline | null => {
    const etapasActivas = getEtapasActivas(proceso)
    const current = currentEtapa ?? 'lead_nuevo'
    const idx = etapasActivas.indexOf(current)
    if (idx === -1 || idx >= etapasActivas.length - 1) return null
    return etapasActivas[idx + 1] as EtapaPipeline
  }

  // Inferir el proceso de una oportunidad a partir de su etapa actual
  const getProcesoForEtapa = (etapaSlug: string | null): string | null => {
    if (!etapaSlug || stages.length === 0) return null
    const stage = stages.find(s => (s.sistema_slug || s.slug) === etapaSlug)
    return stage?.proceso ?? null
  }

  // D171: Ejecutar movimiento real de etapa
  const ejecutarMoveEtapa = (id: string, next: EtapaPipeline) => {
    const nextLabel = ETAPA_CONFIG[next]?.label ?? next
    startTransition(async () => {
      const res = await moveOportunidad(id, next)
      if (res.success) {
        toast.success(`Etapa: ${nextLabel}`)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  // D171: Soft gate — muestra prompt antes de mover etapa
  const cycleEtapa = (id: string, currentEtapa: string | null) => {
    // Inferir el proceso de la oportunidad a partir de su etapa actual
    const opp = oportunidades.find(o => o.id === id)
    const proceso = getProcesoForEtapa(currentEtapa ?? opp?.etapa ?? null)
    const next = getNextEtapaForOpp(currentEtapa, proceso)
    if (!next) return // terminal state — don't cycle

    const mensaje = SOFT_GATE_MSGS[next]
    if (!mensaje) {
      ejecutarMoveEtapa(id, next)
      return
    }

    // Semi-hard gate: propuesta_enviada requiere cotización existente
    if (next === 'propuesta_enviada') {
      startTransition(async () => {
        const { tieneCotizacion } = await checkCotizacionExiste(id)
        setSoftGateModal({
          id,
          currentEtapa,
          nextEtapa: next,
          mensaje,
          bloqueado: !tieneCotizacion,
          motivoBloqueado: tieneCotizacion ? undefined : 'Esta etapa requiere una cotización creada. Crea una cotización primero.',
        })
      })
      return
    }

    setSoftGateModal({ id, currentEtapa, nextEtapa: next, mensaje })
  }

  const handleConfirmarSoftGate = () => {
    if (!softGateModal || softGateModal.bloqueado) return
    const { id, nextEtapa } = softGateModal
    setSoftGateModal(null)
    ejecutarMoveEtapa(id, nextEtapa)
  }

  const handleGanar = (id: string) => {
    startTransition(async () => {
      const res = await ganarOportunidad(id)
      if (res.success) {
        toast.success('¡Oportunidad ganada! Proyecto creado.')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error al marcar como ganada')
      }
    })
  }

  const handlePerder = () => {
    if (!lostModal || !selectedReason) return
    const id = lostModal.id
    setLostModal(null)
    setSelectedReason('')
    startTransition(async () => {
      const res = await perderOportunidad(id, selectedReason)
      if (res.success) {
        toast.info('Oportunidad marcada como perdida')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  const getNextEtapa = (current: string | null, proceso: string | null): EtapaPipeline | null => {
    return getNextEtapaForOpp(current, proceso)
  }

  // Etapas activas del proceso seleccionado (para filtro "activas")
  const etapasActivasActuales = getEtapasActivas(procesoFilter)

  const filtered = oportunidades.filter(o => {
    const matchSearch = !search ||
      o.descripcion?.toLowerCase().includes(search.toLowerCase()) ||
      (o.contactos as { nombre: string } | null)?.nombre?.toLowerCase().includes(search.toLowerCase()) ||
      (o.empresas as { nombre: string } | null)?.nombre?.toLowerCase().includes(search.toLowerCase())
    const matchEtapa = !etapaFilter
      || (etapaFilter === 'activas' && etapasActivasActuales.includes(o.etapa ?? ''))
      || o.etapa === etapaFilter

    // Filtro de proceso: si hay proceso seleccionado, mostrar solo ops cuya etapa pertenece a ese proceso
    // (proceso IS NULL = etapa estándar que aparece en todos) O (proceso = procesoSeleccionado)
    const matchProceso = procesoFilter === null || (() => {
      const proceso = getProcesoForEtapa(o.etapa)
      return proceso === null || proceso === procesoFilter
    })()

    return matchSearch && matchEtapa && matchProceso
  })

  const diasSinActividad = (fecha: string | null) => {
    if (!fecha) return null
    const diff = Date.now() - new Date(fecha).getTime()
    return Math.floor(diff / 86400000)
  }

  const timeAgo = (date: string | null) => {
    if (!date) return undefined
    const diff = Date.now() - new Date(date).getTime()
    const days = Math.floor(diff / 86400000)
    if (days === 0) return 'Hoy'
    if (days === 1) return 'Ayer'
    if (days < 30) return `Hace ${days} días`
    if (days < 365) return `Hace ${Math.floor(days / 30)} meses`
    return `Hace ${Math.floor(days / 365)} años`
  }

  // Value pipeline summary — usar etapas activas del proceso seleccionado
  const activeOps = oportunidades.filter(o => etapasActivasActuales.includes(o.etapa ?? ''))
  const totalPipeline = activeOps.reduce((sum, o) => sum + (o.valor_estimado ?? 0), 0)
  const totalPonderado = activeOps.reduce((sum, o) => {
    const prob = (o.probabilidad ?? 0) / 100
    return sum + (o.valor_estimado ?? 0) * prob
  }, 0)

  if (oportunidades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
        <Flame className="h-12 w-12 text-muted-foreground/30" />
        <h3 className="mt-4 text-base font-medium">
          Aún no tienes oportunidades
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Crea tu primera oportunidad para empezar a vender
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Unassigned warning banner */}
      {sinResponsableCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span className="text-amber-800 dark:text-amber-300">
            Tienes {sinResponsableCount} oportunidad{sinResponsableCount !== 1 ? 'es' : ''} sin responsable comercial asignado
          </span>
        </div>
      )}

      {/* Pipeline summary */}
      <div className="flex gap-3 rounded-lg bg-muted/50 p-3">
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total oportunidades</p>
          <p className="text-sm font-bold">{formatCOP(totalPipeline)}</p>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ponderado</p>
          <p className="text-sm font-bold text-green-600">{formatCOP(totalPonderado)}</p>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Activas</p>
          <p className="text-sm font-bold">{activeOps.length}</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar oportunidad..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-sm"
        />
      </div>

      {/* Selector de proceso (chips) — solo visible si hay multi-proceso configurado */}
      {tieneMultiProceso && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setProcesoFilter(null)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              procesoFilter === null ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
            }`}
          >
            Todos
          </button>
          {procesosDisponibles.map(p => (
            <button
              key={p}
              onClick={() => setProcesoFilter(procesoFilter === p ? null : p)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                procesoFilter === p ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {PROCESO_LABELS[p] ?? p}
            </button>
          ))}
        </div>
      )}

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <button
          onClick={() => setEtapaFilter('activas')}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            etapaFilter === 'activas' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          Activas ({activeOps.length})
        </button>
        <button
          onClick={() => setEtapaFilter(null)}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            !etapaFilter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground hover:bg-accent'
          }`}
        >
          Todas ({oportunidades.length})
        </button>
        {TODAS_ETAPAS.map(e => {
          const config = ETAPA_CONFIG[e]
          const count = oportunidades.filter(o => o.etapa === e).length
          if (count === 0) return null
          return (
            <button
              key={e}
              onClick={() => setEtapaFilter(etapaFilter === e ? null : e)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                etapaFilter === e ? config.chipClass : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
              {config.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {filtered.map(o => {
          // Para etapas custom (no en ETAPA_CONFIG), construir config básica desde stages
          const etapaConfig = ETAPA_CONFIG[o.etapa as EtapaPipeline] ?? (() => {
            const stage = stages.find(s => (s.sistema_slug || s.slug) === o.etapa || s.slug === o.etapa)
            if (!stage) return undefined
            return {
              label: stage.nombre,
              probabilidad: 50,
              chipClass: 'bg-slate-100 text-slate-700',
              dotClass: 'bg-slate-400',
              order: stage.orden,
            }
          })()
          const empresa = o.empresas as { nombre: string } | null
          const contacto = o.contactos as { nombre: string } | null
          const responsable = o.staff as { id: string; full_name: string } | null
          const dias = diasSinActividad(o.ultima_accion_fecha ?? o.created_at)
          const stale = dias !== null && dias > 7

          const oppProceso = getProcesoForEtapa(o.etapa)
          const isActive = etapasActivasActuales.includes(o.etapa ?? '')
          const nextEtapa = getNextEtapa(o.etapa, oppProceso)

          return (
            <EntityCard
              key={o.id}
              href={`/pipeline/${o.id}`}
              title={o.descripcion || 'Sin descripcion'}
              titlePrefix={o.codigo ? `O ${o.codigo}` : undefined}
              subtitle={[empresa?.nombre, contacto?.nombre].filter(Boolean).join(' · ')}
              value={o.valor_estimado ? formatCOP(o.valor_estimado) : undefined}
              summaryLines={[
                ...(empresa ? [{ icon: <Building2 className="h-3 w-3" />, text: empresa.nombre }] : []),
                ...(contacto ? [{ icon: <User className="h-3 w-3" />, text: contacto.nombre }] : []),
                ...(responsable ? [{ icon: <User className="h-3 w-3 text-blue-500" />, text: responsable.full_name }] : [{ icon: <AlertTriangle className="h-3 w-3 text-amber-500" />, text: 'Sin responsable' }]),
                ...(stale ? [{ icon: <Clock className="h-3 w-3 text-amber-500" />, text: `${dias} días sin actividad` }] : []),
              ]}
              badges={etapaConfig ? [{
                label: etapaConfig.label,
                className: etapaConfig.chipClass,
                ...(isActive ? { onClick: () => cycleEtapa(o.id, o.etapa) } : {}),
              }] : undefined}
              timeAgo={timeAgo(o.created_at)}
              footerContent={isActive ? (
                <div className="flex items-center gap-1.5">
                  {/* Advance to next stage */}
                  {nextEtapa && (
                    <button
                      onClick={() => cycleEtapa(o.id, o.etapa)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                    >
                      {ETAPA_CONFIG[nextEtapa]?.label ?? nextEtapa}
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  )}
                  {/* Won */}
                  <button
                    onClick={() => handleGanar(o.id)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2.5 py-1.5 text-xs font-medium text-green-600 transition-colors hover:bg-green-500/20 disabled:opacity-50 dark:text-green-400"
                  >
                    <Trophy className="h-3 w-3" />
                    Ganada
                  </button>
                  {/* Lost */}
                  <button
                    onClick={() => setLostModal({ id: o.id, name: o.descripcion || 'Sin descripcion' })}
                    disabled={isPending}
                    className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                    Perdida
                  </button>
                </div>
              ) : undefined}
            />
          )
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No se encontraron oportunidades
          </p>
        )}
      </div>

      {/* D171: Soft Gate Modal */}
      {softGateModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
            <div className="flex items-start gap-3">
              {softGateModal.bloqueado ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              ) : (
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
              )}
              <div>
                <h3 className="text-base font-semibold">
                  Mover a {ETAPA_CONFIG[softGateModal.nextEtapa]?.label}
                </h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  {softGateModal.bloqueado ? softGateModal.motivoBloqueado : softGateModal.mensaje}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {/* Cuando está bloqueado por falta de cotización, ofrecer CTA para crear una */}
              {softGateModal.bloqueado && (
                <a
                  href={`/pipeline/${softGateModal.id}/cotizacion/nueva`}
                  onClick={() => setSoftGateModal(null)}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <FileText className="h-4 w-4" />
                  Crear cotizacion
                </a>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setSoftGateModal(null)}
                  className="flex h-10 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
                >
                  {softGateModal.bloqueado ? 'Cancelar' : 'Cancelar'}
                </button>
                {!softGateModal.bloqueado && (
                  <button
                    onClick={handleConfirmarSoftGate}
                    disabled={isPending}
                    className="flex h-10 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Si, mover
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lost Reason Modal */}
      {lostModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
            <h3 className="text-lg font-semibold">¿Por qué se perdió?</h3>
            <p className="mt-1 text-sm text-muted-foreground">{lostModal.name}</p>
            <div className="mt-4 space-y-2">
              {RAZONES_PERDIDA.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedReason(r.value)}
                  className={`flex w-full items-center rounded-lg border px-4 py-3 text-sm transition-colors ${
                    selectedReason === r.value
                      ? 'border-destructive bg-destructive/5 font-medium text-destructive'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => { setLostModal(null); setSelectedReason('') }}
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={handlePerder}
                disabled={!selectedReason || isPending}
                className="flex h-10 flex-1 items-center justify-center rounded-lg bg-destructive text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
