import 'server-only'

import type { DevolucionDelNegocio } from './devolucion-dinero'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

/**
 * Devoluciones de dinero de un negocio, para la ficha (SOE-007). Con el cliente de SESIÓN: la
 * tabla se lee por RLS del propio workspace. Nunca lanza: sin la lectura la ficha se pinta
 * igual, sin la tarjeta.
 */
export async function leerDevolucionesDelNegocio(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<DevolucionDelNegocio[]> {
  try {
    const { data, error } = await db(supabase)
      .from('devoluciones_dinero')
      .select('id, fecha, monto, motivo, cerro_caso, soporte, creado_por_staff')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .order('fecha', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) {
      console.warn('[negocio] no se pudieron leer las devoluciones:', error.message)
      return []
    }
    const filas = (data ?? []) as Array<{
      id: string
      fecha: string
      monto: number
      motivo: string
      cerro_caso: boolean
      soporte: { url?: string; file_name?: string } | null
      creado_por_staff: string | null
    }>
    if (filas.length === 0) return []

    const staffIds = Array.from(new Set(filas.map((f) => f.creado_por_staff).filter((v): v is string => !!v)))
    const nombres = new Map<string, string>()
    if (staffIds.length > 0) {
      const { data: staff } = await db(supabase)
        .from('staff')
        .select('id, full_name')
        .eq('workspace_id', workspaceId)
        .in('id', staffIds)
      for (const s of (staff ?? []) as Array<{ id: string; full_name: string | null }>) {
        if (s.full_name) nombres.set(s.id, s.full_name)
      }
    }

    return filas.map((f) => ({
      id: f.id,
      fecha: f.fecha,
      monto: Number(f.monto),
      motivo: f.motivo,
      cerro_caso: f.cerro_caso,
      soporte_url: f.soporte?.url ?? null,
      soporte_nombre: f.soporte?.file_name ?? null,
      autor: f.creado_por_staff ? (nombres.get(f.creado_por_staff) ?? null) : null,
    }))
  } catch (e) {
    console.warn('[negocio] no se pudieron leer las devoluciones:', e instanceof Error ? e.message : e)
    return []
  }
}
