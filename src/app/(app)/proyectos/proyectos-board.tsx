'use client'

import { useState, useTransition, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  DollarSign,
  GripVertical,
  MoreVertical,
  Play,
  Pause,
  Check,
  RotateCcw,
  X,
  Lock,
  FolderKanban,
  ArrowRight,
  Clock,
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
  STATUS_CONFIG,
  PROJECT_STATUSES,
  ACTIVE_STATUSES,
  VALID_TRANSITIONS,
  REWORK_REASONS,
  type ProjectStatus,
} from '@/lib/projects/config'
import { moveProject } from './actions'

// ── Types ──────────────────────────────────────────────

interface ProjectForBoard {
  id: string
  name: string
  status: string
  client_id: string | null
  clientName: string | null
  approved_budget: number | null
  rework_reason: string | null
  created_at: string
  totalExpenses: number
  totalHours: number
  totalInvoiced: number
  totalCollected: number
  marginPct: number
}

interface ProyectosBoardProps {
  initialProjects: ProjectForBoard[]
}

// ── Helpers ────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value.toLocaleString('es-CO')}`
}

const STATUS_ICONS: Record<string, React.ElementType> = {
  active: Play,
  paused: Pause,
  rework: RotateCcw,
  completed: Check,
  closed: Lock,
  cancelled: X,
}

// ── Draggable Card ─────────────────────────────────────

function DraggableCard({
  project,
  children,
}: {
  project: ProjectForBoard
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: project.id,
    data: { project, status: project.status },
  })

  return (
    <div
      ref={setNodeRef}
      className={`${isDragging ? 'opacity-30' : ''}`}
    >
      <div className="flex">
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
  status,
  children,
}: {
  status: string
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

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

function CardPreview({ project }: { project: ProjectForBoard }) {
  return (
    <div className="w-64 rounded-lg border bg-background p-3 shadow-xl ring-2 ring-primary/30">
      {project.clientName && (
        <p className="mb-1 text-xs text-muted-foreground">{project.clientName}</p>
      )}
      <p className="text-sm font-medium leading-tight">{project.name}</p>
      {project.approved_budget && (
        <p className="mt-1.5 text-sm font-semibold text-primary">
          {formatCurrency(project.approved_budget)}
        </p>
      )}
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

// ── Proyectos Board ────────────────────────────────────

export default function ProyectosBoard({ initialProjects }: ProyectosBoardProps) {
  const [projects, setProjects] = useState(initialProjects)

  useEffect(() => {
    setProjects(initialProjects)
  }, [initialProjects])

  const [reworkModal, setReworkModal] = useState<{ id: string; name: string } | null>(null)
  const [selectedReason, setSelectedReason] = useState('')
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [activeProject, setActiveProject] = useState<ProjectForBoard | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  )

  const groupByStatus = useCallback(
    (status: ProjectStatus) => projects.filter((p) => p.status === status),
    [projects]
  )

  const statusTotal = (status: ProjectStatus) =>
    groupByStatus(status).reduce((sum, p) => sum + (p.approved_budget || 0), 0)

  // Board totals
  const totalBudget = projects.reduce((sum, p) => sum + (p.approved_budget || 0), 0)
  const avgMargin = projects.length > 0
    ? projects.reduce((s, p) => s + p.marginPct, 0) / projects.length
    : 0

  // ── Drag & Drop Handlers ─────────────────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const project = event.active.data.current?.project as ProjectForBoard | undefined
    if (project) setActiveProject(project)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveProject(null)
    const { active, over } = event
    if (!over) return

    const projectId = active.id as string
    const fromStatus = active.data.current?.status as ProjectStatus
    const toStatus = over.id as ProjectStatus

    if (fromStatus === toStatus) return
    if (!PROJECT_STATUSES.includes(toStatus)) return

    // Validate transition
    const validTargets = VALID_TRANSITIONS[fromStatus] || []
    if (!validTargets.includes(toStatus)) {
      toast.error(`No puedes mover de ${STATUS_CONFIG[fromStatus].label} a ${STATUS_CONFIG[toStatus].label}`)
      return
    }

    // If dropping on 'rework', open the rework reason modal
    if (toStatus === 'rework') {
      const proj = projects.find((p) => p.id === projectId)
      if (proj) setReworkModal({ id: projectId, name: proj.name })
      return
    }

    handleStatusChange(projectId, toStatus)
  }

  // ── Action Handlers ──────────────────────────────────

  const handleStatusChange = (projectId: string, newStatus: ProjectStatus) => {
    if (newStatus === 'rework') {
      const proj = projects.find((p) => p.id === projectId)
      if (proj) setReworkModal({ id: projectId, name: proj.name })
      return
    }

    // Optimistic update
    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, status: newStatus } : p
      )
    )
    setMenuOpen(null)

    startTransition(async () => {
      const result = await moveProject(projectId, newStatus)
      if (!result.success) {
        toast.error(result.error || 'Error moviendo proyecto')
        setProjects(initialProjects)
      } else {
        toast.success(`Proyecto -> ${STATUS_CONFIG[newStatus].label}`)
      }
    })
  }

  const handleReworkSubmit = () => {
    if (!reworkModal || !selectedReason) return

    const projectId = reworkModal.id
    const reasonLabel = REWORK_REASONS.find(r => r.value === selectedReason)?.label || selectedReason

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId ? { ...p, status: 'rework', rework_reason: reasonLabel } : p
      )
    )
    setReworkModal(null)
    setSelectedReason('')

    startTransition(async () => {
      const result = await moveProject(projectId, 'rework', reasonLabel)
      if (!result.success) {
        toast.error(result.error || 'Error marcando reproceso')
        setProjects(initialProjects)
      } else {
        toast.info('Proyecto en reproceso')
      }
    })
  }

  // ── Empty state ───────────────────────────────────────

  if (projects.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todos tus proyectos nacen del Pipeline.
          </p>
        </div>
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <FolderKanban className="mx-auto h-12 w-12 text-muted-foreground/30" />
          <h3 className="mt-4 text-sm font-medium">Sin proyectos aun</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Cuando marques una oportunidad como &ldquo;Ganada&rdquo; en el Pipeline, tu proyecto aparecera aqui automaticamente.
          </p>
          <Link
            href="/pipeline"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Ir al Pipeline
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold">Proyectos</h1>
          <div className="mt-1 flex items-center gap-4 text-sm text-muted-foreground">
            <span>{projects.length} proyecto{projects.length !== 1 ? 's' : ''}</span>
            <span>Presupuesto: <strong className="text-foreground">{formatCurrency(totalBudget)}</strong></span>
            <span>Margen prom: <strong className="text-foreground">{avgMargin.toFixed(0)}%</strong></span>
          </div>
        </div>

        {/* Kanban Board */}
        <div className="-mx-6 px-6">
          <div className="flex gap-4 overflow-x-auto pb-4" style={{ minWidth: 'max-content' }}>
            {PROJECT_STATUSES.map((status) => {
              const config = STATUS_CONFIG[status]
              const projs = groupByStatus(status)
              const StatusIcon = STATUS_ICONS[status] || FolderKanban
              const isTerminal = status === 'closed' || status === 'cancelled'

              return (
                <div
                  key={status}
                  className={`flex w-72 shrink-0 flex-col rounded-xl border bg-card ${
                    isTerminal ? 'opacity-75' : ''
                  }`}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between border-b px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2.5 w-2.5 rounded-full ${config.dotColor}`} />
                      <span className="text-sm font-semibold">{config.label}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {projs.length}
                      </span>
                    </div>
                  </div>

                  {/* Column total */}
                  <div className="border-b px-4 py-2">
                    <p className="text-xs text-muted-foreground">
                      <DollarSign className="mr-0.5 inline h-3 w-3" />
                      {formatCurrency(statusTotal(status))}
                    </p>
                  </div>

                  {/* Cards — droppable zone */}
                  <DroppableColumn status={status}>
                    {projs.length === 0 ? (
                      <p className="py-8 text-center text-xs text-muted-foreground">
                        {isTerminal ? 'Vacio' : 'Arrastra proyectos aqui'}
                      </p>
                    ) : (
                      projs.map((proj) => {
                        const validTargets = VALID_TRANSITIONS[proj.status as ProjectStatus] || []
                        return (
                          <DraggableCard key={proj.id} project={proj}>
                            <div className="group relative cursor-pointer rounded-lg border bg-background p-3 transition-shadow hover:shadow-md">
                              {/* Client name */}
                              {proj.clientName && (
                                <p className="mb-1 text-xs text-muted-foreground">{proj.clientName}</p>
                              )}
                              {/* Project name */}
                              <Link
                                href={`/proyectos/${proj.id}`}
                                className="text-sm font-medium leading-tight hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {proj.name}
                              </Link>

                              {/* Budget + margin */}
                              <div className="mt-1.5 flex items-center gap-2">
                                {proj.approved_budget ? (
                                  <span className="text-sm font-semibold text-primary">
                                    {formatCurrency(proj.approved_budget)}
                                  </span>
                                ) : null}
                                {proj.marginPct !== 0 && (
                                  <span className={`text-xs font-medium ${
                                    proj.marginPct >= 0 ? 'text-green-600' : 'text-red-500'
                                  }`}>
                                    {proj.marginPct.toFixed(0)}%
                                  </span>
                                )}
                              </div>

                              {/* Hours badge */}
                              {proj.totalHours > 0 && (
                                <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                                  <Clock className="h-3 w-3" />
                                  {proj.totalHours.toFixed(1)}h
                                </div>
                              )}

                              {/* Rework reason */}
                              {proj.status === 'rework' && proj.rework_reason && (
                                <p className="mt-1 text-xs text-orange-500">{proj.rework_reason}</p>
                              )}

                              {/* Actions */}
                              {validTargets.length > 0 && (
                                <div className="mt-2 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  {/* Quick action buttons */}
                                  {validTargets.slice(0, 2).map((target) => {
                                    const TargetIcon = STATUS_ICONS[target] || Check
                                    return (
                                      <button
                                        key={target}
                                        onClick={() => handleStatusChange(proj.id, target)}
                                        disabled={isPending}
                                        className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
                                      >
                                        <TargetIcon className="h-3 w-3" />
                                        {STATUS_CONFIG[target].label}
                                      </button>
                                    )
                                  })}

                                  {/* More menu */}
                                  {validTargets.length > 2 && (
                                    <div className="relative ml-auto">
                                      <button
                                        onClick={() => setMenuOpen(menuOpen === proj.id ? null : proj.id)}
                                        className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                                      >
                                        <MoreVertical className="h-3.5 w-3.5" />
                                      </button>

                                      {menuOpen === proj.id && (
                                        <div className="absolute right-0 top-8 z-20 w-44 rounded-lg border bg-popover p-1 shadow-lg">
                                          {validTargets.slice(2).map((target) => {
                                            const TargetIcon = STATUS_ICONS[target] || Check
                                            const isDanger = target === 'cancelled'
                                            return (
                                              <button
                                                key={target}
                                                onClick={() => {
                                                  setMenuOpen(null)
                                                  handleStatusChange(proj.id, target)
                                                }}
                                                className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-accent ${
                                                  isDanger ? 'text-destructive' : ''
                                                }`}
                                              >
                                                <TargetIcon className="h-3.5 w-3.5" />
                                                {STATUS_CONFIG[target].label}
                                              </button>
                                            )
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </DraggableCard>
                        )
                      })
                    )}
                  </DroppableColumn>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activeProject ? <CardPreview project={activeProject} /> : null}
      </DragOverlay>

      {/* Rework Reason Modal */}
      {reworkModal && (
        <Portal>
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
              <h3 className="text-lg font-semibold">Razon del reproceso</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {reworkModal.name}
              </p>

              <div className="mt-4 space-y-2">
                {REWORK_REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    onClick={() => setSelectedReason(reason.value)}
                    className={`flex w-full items-center rounded-lg border px-4 py-3 text-sm transition-colors ${
                      selectedReason === reason.value
                        ? 'border-orange-500 bg-orange-50 font-medium text-orange-700 dark:bg-orange-950/20 dark:text-orange-400'
                        : 'border-border hover:bg-accent'
                    }`}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  onClick={() => { setReworkModal(null); setSelectedReason('') }}
                  className="flex h-10 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReworkSubmit}
                  disabled={!selectedReason || isPending}
                  className="flex h-10 flex-1 items-center justify-center rounded-lg bg-orange-600 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:opacity-50"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </DndContext>
  )
}
