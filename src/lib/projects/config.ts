// ── Project Status Configuration ───────────────────────────
// Shared constants used by both server actions and client components.
// This file intentionally has NO 'use server' or 'use client' directive
// so it can be imported from either context.

export type ProjectStatus = 'active' | 'paused' | 'rework' | 'completed' | 'closed' | 'cancelled'

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; color: string; dotColor: string }> = {
  active:    { label: 'Activo',     color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',   dotColor: 'bg-green-500' },
  paused:    { label: 'Pausado',    color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', dotColor: 'bg-yellow-500' },
  rework:    { label: 'Reproceso',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', dotColor: 'bg-orange-500' },
  completed: { label: 'Completado', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',     dotColor: 'bg-blue-500' },
  closed:    { label: 'Cerrado',    color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',         dotColor: 'bg-gray-500' },
  cancelled: { label: 'Cancelado',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',         dotColor: 'bg-red-500' },
}

// Column order for kanban board
export const PROJECT_STATUSES: ProjectStatus[] = ['active', 'paused', 'rework', 'completed', 'closed', 'cancelled']

// Statuses considered "in progress" (active columns)
export const ACTIVE_STATUSES: ProjectStatus[] = ['active', 'paused', 'rework']

// Terminal statuses
export const TERMINAL_STATUSES: ProjectStatus[] = ['closed', 'cancelled']

// Valid state machine transitions
export const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  active:    ['paused', 'completed', 'cancelled'],
  paused:    ['active', 'cancelled'],
  completed: ['active', 'rework', 'closed'],
  rework:    ['completed', 'cancelled'],
  cancelled: ['closed'],
  closed:    [],
}

export const REWORK_REASONS = [
  { value: 'execution_error', label: 'Error de ejecucion' },
  { value: 'client_change', label: 'Cambio de criterio del cliente' },
  { value: 'scope_issue', label: 'Alcance mal definido' },
  { value: 'damage', label: 'Dano / deterioro' },
  { value: 'other', label: 'Otro' },
] as const

export type ReworkReason = typeof REWORK_REASONS[number]['value']
