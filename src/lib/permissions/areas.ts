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
    bg: 'bg-acento/10',
    text: 'text-acento',
    border: 'border-acento',
  },
  operaciones: {
    bg: 'bg-tinta/[0.08]',
    text: 'text-tinta',
    border: 'border-tinta/30',
  },
  financiera: {
    bg: 'bg-tinta-suave/[0.12]',
    text: 'text-tinta-suave',
    border: 'border-tinta-suave/40',
  },
  direccion: {
    bg: 'bg-papel',
    text: 'text-tinta',
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
