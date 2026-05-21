/**
 * Areas del modelo roles · areas · stages.
 * Tokens visuales MeTRIK (NO Tailwind generico). Fuente:
 *   - cerebro/conceptos/identidad-visual-metrik.md
 *   - docs/specs/2026-05-20_ux-roles-areas-stages.md (mapeo area → color)
 */

import type { Area } from './can-edit'

export const AREAS_OPERATIVAS: readonly Area[] = ['comercial', 'operaciones', 'financiera'] as const
export const ALL_AREAS: readonly Area[] = ['comercial', 'operaciones', 'financiera', 'direccion'] as const

export const AREA_LABELS: Record<Area, string> = {
  comercial: 'Comercial',
  operaciones: 'Operaciones',
  financiera: 'Financiera',
  direccion: 'Direccion',
}

export const AREA_DESCRIPTIONS: Record<Area, string> = {
  comercial: 'Ventas, atencion al cliente, cotizaciones, seguimiento.',
  operaciones: 'Ejecucion de proyectos, coordinacion de campo, produccion.',
  financiera: 'Cobros, cartera, facturacion, conciliacion.',
  direccion: 'Acceso transversal a las 3 areas operativas.',
}

/**
 * Tokens canonicos MeTRIK por area.
 * NO usar Tailwind generico (slate/zinc/gray/emerald). Estos son los hex
 * definidos en cerebro/conceptos/identidad-visual-metrik.md aplicados con
 * opacidades segun docs/specs/2026-05-20_ux-roles-areas-stages.md.
 */
export const AREA_CLASSES: Record<Area, { bg: string; text: string; border: string }> = {
  comercial: {
    bg: 'bg-[#10B981]/10',
    text: 'text-[#059669]',
    border: 'border-[#10B981]',
  },
  operaciones: {
    bg: 'bg-[#1A1A1A]/[0.08]',
    text: 'text-[#1A1A1A]',
    border: 'border-[#1A1A1A]/30',
  },
  financiera: {
    bg: 'bg-[#6B7280]/[0.12]',
    text: 'text-[#6B7280]',
    border: 'border-[#6B7280]/40',
  },
  direccion: {
    bg: 'bg-[#F5F4F2]',
    text: 'text-[#1A1A1A]',
    border: 'border-[#E5E7EB] border-dashed',
  },
}

/**
 * Roles que requieren al menos un area asignada (regla 14a).
 * `contador` y `read_only` quedan fuera del modelo de areas.
 */
import type { Role } from './can-edit'

export const ROLES_QUE_REQUIEREN_AREA: readonly Role[] = [
  'operator',
  'supervisor',
  'admin',
  'owner',
] as const

export function roleRequiresAreas(role: Role): boolean {
  return (ROLES_QUE_REQUIEREN_AREA as readonly string[]).includes(role)
}
