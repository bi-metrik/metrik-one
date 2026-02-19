'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  Plus,
  ChevronRight,
  DollarSign,
  RotateCcw,
  MoreVertical,
  X,
  ArrowRight,
  GripVertical,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core'
import {
  STAGE_CONFIG,
  ACTIVE_STAGES,
  PIPELINE_STAGES,
  LOST_REASONS,
  type PipelineStage,
} from './pipeline-config'
import {
  moveOpportunity,
  reactivateOpportunity,
} from './actions'
import type { Opportunity } from '@/types/database'
import OpportunityModal from './opportunity-modal'
import OpportunityDetail from './opportunity-detail'

// ── Types ──────────────────────────────────────────────

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface PipelineBoardProps {
  initialOpportunities: OpportunityWithClient[]
}

// ── Helpers ────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString('es-CO')}`
}

function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = ACTIVE_STAGES.indexOf(current)
  if (idx === -1 || idx >= ACTIVE_STAGES.length - 1) return null
  return ACTIVE_STAGES[idx + 1]
}

// ── Draggable Card ─────────────────────────────────────

function DraggableCard({
  opp,
  stage,
  children,
}: {
  opp: OpportunityWithClient
  stage: PipelineStage
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: opp.id,
    data: { opp, stage },
  })

  return (
    <div
      ref={setNodeRef}
      className={`${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="flex items-center px-1 cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground touch-none"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  )
}

// ── Droppable Column ───────────────────────────────────

function DroppableColumn({
  stage,
  children,
}: {
  stage: PipelineStage
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage })

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 space-y-2 overflow-y-auto p-3 transition-colors ${
        isOver ? 'bg-primary/5 ring-2 ring-primary/20 ring-inset rounded-b-xl' : ''
      }`}
      style={{ maxHeight: '60vh' }}
    >
      {children}
    </div>
  )
}

// ── Card Preview (for drag overlay) ────────────────────

function CardPreview({ opp }: { opp: OpportunityWithClient }) {
  return (
    <div className="w-64 rounded-lg border bg-background p-3 shadow-xl ring-2 ring-primary/30">
      {opp.clients?.name && (
        <p className="mb-1 text-xs text-muted-foreground">{opp.clients.name}</p>
      )}
      <p className="text-sm font-medium leading-tight">{opp.name}</p>
      <p className="mt-1.5 text-sm font-semibold text-primary">
        {formatCurrency(opp.estimated_value)}
      </p>
    </div>
  )
}

// ── Portal wrapper ─────────────────────────────────────

function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  return createPortal(children, document.body)
}

// ── Pipeline Board ─────────────────────────────────────

export default function PipelineBoard({ initialOpportunities }: PipelineBoardProps) {
  const [opportunities, setOpportunities] = useState(initialOpportunities)

  // Sync state when server re-renders with fresh data (e.g. FAB creation + router.refresh)
  useEffect(() => {
    setOpportunities(initialOpportunities)
  }, [initialOpportunities])

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createStage, setCreateStage] = useState<PipelineStage>('lead')
  const [lostModal, setLostModal] = useState<{ id: string; name: string } | null>(null)
  const [selectedReason, setSelectedReason] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [selectedOpp, setSelectedOpp] = useState<OpportunityWithClient | null>(null)
  const [isPending, startTransition] = useTransition()
  const [activeOpp, setActiveOpp] = useState<OpportunityWithClient | null>(null)

  // dnd-kit sensors — require 8px movement before dragging starts (to allow clicks)
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  // Group by stage
  const groupedByStage = useCallback(
    (stage: PipelineStage) => opportunities.filter((o) => o.stage === stage),
    [opportunities]
  )

  // Stage totals
  const stageTotal = (stage: PipelineStage) =>
    groupedByStage(stage).reduce((sum, o) => sum + o.estimated_value, 0)

  // Pipeline total (active only, weighted)
  const pipelineWeighted = ACTIVE_STAGES.reduce((sum, stage) => {
    const stageOpps = groupedByStage(stage)
    const prob = STAGE_CONFIG[stage].probability / 100
    return sum + stageOpps.reduce((s, o) => s + o.estimated_value * prob, 0)
  }, 0)

  const pipelineTotal = ACTIVE_STAGES.reduce((sum, stage) => {
    return sum + stageTotal(stage)
  }, 0)

  // ── Drag & Drop Handlers ─────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const opp = event.active.data.current?.opp as OpportunityWithClient | undefined
    if (opp) setActiveOpp(opp)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveOpp(null)
    const { active, over } = event
    if (!over) return

    const oppId = active.id as string
    const fromStage = active.data.current?.stage as PipelineStage
    const toStage = over.id as PipelineStage

    if (fromStage === toStage) return
    if (!PIPELINE_STAGES.includes(toStage)) return

    // If dropping on 'lost', open the lost reason modal
    if (toStage === 'lost') {
      const opp = opportunities.find((o) => o.id === oppId)
      if (opp) setLostModal({ id: oppId, name: opp.name })
      return
    }

    handleAdvance(oppId, toStage)
  }

  // ── Action Handlers ──────────────────────────────────

  const handleAdvance = (oppId: string, nextStage: PipelineStage) => {
    if (nextStage === 'lost') {
      const opp = opportunities.find((o) => o.id === oppId)
      if (opp) setLostModal({ id: oppId, name: opp.name })
      return
    }

    // Optimistic update
    setOpportunities((prev) =>
      prev.map((o) =>
        o.id === oppId
          ? { ...o, stage: nextStage, probability: STAGE_CONFIG[nextStage].probability }
          : o
      )
    )
    setMenuOpen(null)

    startTransition(async () => {
      const result = await moveOpportunity(oppId, nextStage)
      if (!result.success) {
        toast.error(result.error || 'Error moviendo oportunidad')
        setOpportunities(initialOpportunities)
      } else {
        if (nextStage === 'won') {
          toast.success('¡Oportunidad ganada! Proyecto creado.')
        } else {
          toast.success(`Movida a ${STAGE_CONFIG[nextStage].label}`)
        }
      }
    })
  }

  const handleMarkLost = () => {
    if (!lostModal || !selectedReason) return

    const oppId = lostModal.id

    setOpportunities((prev) =>
      prev.map((o) =>
        o.id === oppId
          ? { ...o, stage: 'lost' as const, probability: 0, lost_reason: selectedReason }
          : o
      )
    )
    setLostModal(null)
    setSelectedReason('')

    startTransition(async () => {
      const result = await moveOpportunity(oppId, 'lost', selectedReason)
      if (!result.success) {
        toast.error(result.error || 'Error marcando como perdida')
        setOpportunities(initialOpportunities)
      } else {
        toast.info('Oportunidad marcada como perdida')
      }
    })
  }

  const handleReactivate = (oppId: string, targetStage: 'lead' | 'prospect') => {
    setOpportunities((prev) =>
      prev.map((o) =>
        o.id === oppId
          ? { ...o, stage: targetStage, probability: STAGE_CONFIG[targetStage].probability, lost_reason: null }
          : o
      )
    )
    setMenuOpen(null)

    startTransition(async () => {
      const result = await reactivateOpportunity(oppId, targetStage)
      if (!result.success) {
        toast.error(result.error || 'Error reactivando')
        setOpportunities(initialOpportunities)
      } else {
        toast.success(`Reactivada como ${STAGE_CONFIG[targetStage].label}`)
      }
    })
  }

  const handleOpportunityCreated = (newOpp: OpportunityWithClient) => {
    setOpportunities((prev) => [newOpp, ...prev])
    setShowCreateModal(false)
  }

  const openCreate = (stage: PipelineStage = 'lead') => {
    setCreateStage(stage)
    setShowCreateModal(true)
  }

  // ── Render ─────────────────────────────────────────

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
            <span>Total: <strong className="text-foreground">{formatCurrency(pipelineTotal)}</strong></span>
            <span>Ponderado: <strong className="text-foreground">{formatCurrency(pipelineWeighted)}</strong></span>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="-mx-6 px-6">
          <div className="flex gap-4 overflow-x-auto pb-4" style={{ minWidth: 'max-content' }}>
            {/* Active stages */}
            {ACTIVE_STAGES.map((stage) => {
              const config = STAGE_CONFIG[stage]
              const opps = groupedByStage(stage)

              return (
                <div
                  key={stage}
                  className="flex w-72 shrink-0 flex-col rounded-xl border bg-card"
                >
                  {/* Stage header */}
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${config.color}`} />
                      <span className="text-sm font-semibold">{config.label}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {opps.length}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">{config.probability}%</span>
                  </div>

                  {/* Stage total */}
                  <div className="border-b px-4 py-2">
                    <p className="text-xs text-muted-foreground">
                      <DollarSign className="mr-0.5 inline h-3 w-3" />
                      {formatCurrency(stageTotal(stage))}
                    </p>
                  </div>

                  {/* Cards — droppable zone */}
                  <DroppableColumn stage={stage}>
                    {opps.length === 0 ? (
                      <button
                        onClick={() => openCreate(stage)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-8 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Agregar
                      </button>
                    ) : (
                      opps.map((opp) => {
                        const next = getNextStage(stage)
                        return (
                          <DraggableCard key={opp.id} opp={opp} stage={stage}>
                            <div
                              className="group relative cursor-pointer rounded-lg border bg-background p-3 transition-shadow hover:shadow-md"
                              onClick={() => setSelectedOpp(opp)}
                            >
                              {/* Client name */}
                              {opp.clients?.name && (
                                <p className="mb-1 text-xs text-muted-foreground">{opp.clients.name}</p>
                              )}
                              {/* Opportunity name */}
                              <Link href={`/pipeline/${opp.id}`} className="text-sm font-medium leading-tight hover:underline" onClick={e => e.stopPropagation()}>
                                {opp.name}
                              </Link>
                              {/* Value */}
                              <p className="mt-1.5 text-sm font-semibold text-primary">
                                {formatCurrency(opp.estimated_value)}
                              </p>

                              {/* Actions */}
                              <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                {/* Advance button */}
                                {next && (
                                  <button
                                    onClick={() => handleAdvance(opp.id, next)}
                                    disabled={isPending}
                                    className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                                  >
                                    {STAGE_CONFIG[next].label}
                                    <ChevronRight className="h-3 w-3" />
                                  </button>
                                )}

                                {/* Won button (from negotiation) */}
                                {stage === 'negotiation' && (
                                  <button
                                    onClick={() => handleAdvance(opp.id, 'won')}
                                    disabled={isPending}
                                    className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-600 transition-colors hover:bg-green-500/20 disabled:opacity-50 dark:text-green-400"
                                  >
                                    Ganada
                                  </button>
                                )}

                                {/* More menu */}
                                <div className="relative ml-auto">
                                  <button
                                    onClick={() => setMenuOpen(menuOpen === opp.id ? null : opp.id)}
                                    className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </button>

                                  {menuOpen === opp.id && (
                                    <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border bg-popover p-1 shadow-lg">
                                      {stage !== 'negotiation' && (
                                        <button
                                          onClick={() => handleAdvance(opp.id, 'won')}
                                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent"
                                        >
                                          <ArrowRight className="h-3.5 w-3.5 text-green-500" />
                                          Marcar ganada
                                        </button>
                                      )}
                                      <button
                                        onClick={() => {
                                          setMenuOpen(null)
                                          setLostModal({ id: opp.id, name: opp.name })
                                        }}
                                        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-destructive hover:bg-accent"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                        Marcar perdida
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </DraggableCard>
                        )
                      })
                    )}
                  </DroppableColumn>

                  {/* Add button at bottom */}
                  {opps.length > 0 && (
                    <div className="border-t p-2">
                      <button
                        onClick={() => openCreate(stage)}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="h-3 w-3" />
                        Agregar
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Won column */}
            <div className="flex w-72 shrink-0 flex-col rounded-xl border border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
              <div className="flex items-center justify-between border-b border-green-200 px-4 py-3 dark:border-green-900">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">Ganada</span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-400">
                    {groupedByStage('won').length}
                  </span>
                </div>
                <span className="text-xs text-green-600 dark:text-green-500">100%</span>
              </div>
              <div className="border-b border-green-200 px-4 py-2 dark:border-green-900">
                <p className="text-xs text-green-600 dark:text-green-500">
                  <DollarSign className="mr-0.5 inline h-3 w-3" />
                  {formatCurrency(stageTotal('won'))}
                </p>
              </div>
              <DroppableColumn stage="won">
                {groupedByStage('won').length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Las oportunidades ganadas aparecen aquí
                  </p>
                ) : (
                  groupedByStage('won').map((opp) => (
                    <DraggableCard key={opp.id} opp={opp} stage="won">
                      <div
                        className="cursor-pointer rounded-lg border border-green-200 bg-white p-3 transition-shadow hover:shadow-md dark:border-green-900 dark:bg-green-950/30"
                        onClick={() => setSelectedOpp(opp)}
                      >
                        {opp.clients?.name && (
                          <p className="mb-1 text-xs text-muted-foreground">{opp.clients.name}</p>
                        )}
                        <p className="text-sm font-medium leading-tight">{opp.name}</p>
                        <p className="mt-1.5 text-sm font-semibold text-green-600 dark:text-green-400">
                          {formatCurrency(opp.estimated_value)}
                        </p>
                      </div>
                    </DraggableCard>
                  ))
                )}
              </DroppableColumn>
            </div>

            {/* Lost column */}
            <div className="flex w-72 shrink-0 flex-col rounded-xl border border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
              <div className="flex items-center justify-between border-b border-red-200 px-4 py-3 dark:border-red-900">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                  <span className="text-sm font-semibold text-red-700 dark:text-red-400">Perdida</span>
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900 dark:text-red-400">
                    {groupedByStage('lost').length}
                  </span>
                </div>
              </div>
              <div className="border-b border-red-200 px-4 py-2 dark:border-red-900">
                <p className="text-xs text-red-600 dark:text-red-500">
                  <DollarSign className="mr-0.5 inline h-3 w-3" />
                  {formatCurrency(stageTotal('lost'))}
                </p>
              </div>
              <DroppableColumn stage="lost">
                {groupedByStage('lost').length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Mejor que no haya nada aquí 😄
                  </p>
                ) : (
                  groupedByStage('lost').map((opp) => {
                    const reason = LOST_REASONS.find((r) => r.value === opp.lost_reason)
                    return (
                      <DraggableCard key={opp.id} opp={opp} stage="lost">
                        <div
                          className="group relative cursor-pointer rounded-lg border border-red-200 bg-white p-3 transition-shadow hover:shadow-md dark:border-red-900 dark:bg-red-950/30"
                          onClick={() => setSelectedOpp(opp)}
                        >
                          {opp.clients?.name && (
                            <p className="mb-1 text-xs text-muted-foreground">{opp.clients.name}</p>
                          )}
                          <p className="text-sm font-medium leading-tight">{opp.name}</p>
                          <p className="mt-1 text-sm text-muted-foreground line-through">
                            {formatCurrency(opp.estimated_value)}
                          </p>
                          {reason && (
                            <p className="mt-1 text-xs text-red-500">{reason.label}</p>
                          )}
                          {/* D173: Reactivate */}
                          <div className="mt-2 flex gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleReactivate(opp.id, 'lead')}
                              disabled={isPending}
                              className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-500/20 disabled:opacity-50 dark:text-blue-400"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Lead
                            </button>
                            <button
                              onClick={() => handleReactivate(opp.id, 'prospect')}
                              disabled={isPending}
                              className="inline-flex items-center gap-1 rounded-md bg-indigo-500/10 px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-500/20 disabled:opacity-50 dark:text-indigo-400"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Prospecto
                            </button>
                          </div>
                        </div>
                      </DraggableCard>
                    )
                  })
                )}
              </DroppableColumn>
            </div>
          </div>
        </div>
      </div>

      {/* Drag overlay — rendered via portal to avoid overflow clipping */}
      <DragOverlay>
        {activeOpp ? <CardPreview opp={activeOpp} /> : null}
      </DragOverlay>

      {/* Lost Reason Modal — D174 */}
      {lostModal && (
        <Portal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
              <h3 className="text-lg font-semibold">¿Por qué se perdió?</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {lostModal.name}
              </p>

              <div className="mt-4 space-y-2">
                {LOST_REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    onClick={() => setSelectedReason(reason.value)}
                    className={`flex w-full items-center rounded-lg border px-4 py-3 text-sm transition-colors ${
                      selectedReason === reason.value
                        ? 'border-destructive bg-destructive/5 font-medium text-destructive'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    {reason.label}
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
                  onClick={handleMarkLost}
                  disabled={!selectedReason || isPending}
                  className="flex h-10 flex-1 items-center justify-center rounded-lg bg-destructive text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* Create Opportunity Modal */}
      {showCreateModal && (
        <OpportunityModal
          defaultStage={createStage}
          onClose={() => setShowCreateModal(false)}
          onCreated={handleOpportunityCreated}
        />
      )}

      {/* Opportunity Detail Panel — via Portal to escape overflow:hidden */}
      {selectedOpp && (
        <Portal>
          <OpportunityDetail
            opportunity={selectedOpp}
            onClose={() => setSelectedOpp(null)}
            onUpdated={(updated) => {
              setOpportunities((prev) =>
                prev.map((o) => (o.id === updated.id ? updated : o))
              )
              setSelectedOpp(null)
            }}
          />
        </Portal>
      )}
    </DndContext>
  )
}
