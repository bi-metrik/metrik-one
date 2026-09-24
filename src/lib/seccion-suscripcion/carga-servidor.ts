import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { cupoDelEspacio, type Cupo, type UsuarioDelEspacio } from '@/lib/usuarios-espacio/reglas'
import { listarUsuarios } from '@/lib/usuarios-espacio/servidor'
import type { ContextoSuscripcion } from './contexto-servidor'
import { leerLicencias, type EstadoLicencias } from './licencias-servidor'

type Ctx = Extract<ContextoSuscripcion, { tipo: 'ok' }>

/**
 * Cuántas personas puede tener el espacio: las licencias del contrato y, si el contrato no las
 * declara, el `max_seats` del espacio. `null` = ninguna de las dos está registrada.
 */
export async function licenciasTotales(ctx: Ctx, estado?: EstadoLicencias | 'error'): Promise<number | null> {
  const e = estado ?? (await leerLicencias(ctx))
  if (e !== 'error' && e.licencias !== null) return e.licencias
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = await (createServiceClient() as any).from('workspaces').select('max_seats').eq('id', ctx.workspaceId).maybeSingle()
  const n = Number(r.data?.max_seats)
  return Number.isInteger(n) && n > 0 ? n : null
}

export interface EquipoDelEspacio {
  usuarios: UsuarioDelEspacio[]
  licencias: EstadoLicencias
  /**
   * `null` si ni el contrato ni el espacio declaran licencias: no se invita hasta resolverlo. Cuenta
   * solo a los usuarios operativos: la persona designada es el administrador sin costo.
   */
  cupo: Cupo | null
}

/** Usuarios (todos, la persona designada incluida), licencias y cupo, en una sola lectura por request. */
export async function leerEquipo(ctx: Ctx): Promise<EquipoDelEspacio | 'error'> {
  const [usuarios, licencias] = await Promise.all([listarUsuarios(ctx.workspaceId), leerLicencias(ctx)])
  if (usuarios === 'error' || licencias === 'error') return 'error'
  const total = await licenciasTotales(ctx, licencias)
  return { usuarios, licencias, cupo: total === null ? null : cupoDelEspacio({ licencias: total, usuarios, designadoId: ctx.designadoId }) }
}
