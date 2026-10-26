import 'server-only'

/**
 * El lado de Supabase del resumen diario (ver `resumen.ts`). Cliente de SERVICIO: las tablas son server-only y no
 * están en los tipos generados.
 */
import { calificaConTexto } from './calificacion'
import { puertoCalificacionSupabase, filasDelDiaSupabase } from './calificacion-servidor'
import { leerPaginado } from './conversaciones'
import type { CalificacionLeida, EscalamientoLeido, PuertoResumen, WorkspaceLeido } from './resumen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export function puertoResumenSupabase(db: Db): PuertoResumen {
  return {
    filasDelDia: (desde, hasta) => filasDelDiaSupabase(db, desde, hasta),
    escalamientos: (desde, hasta) =>
      leerPaginado<EscalamientoLeido>((a, b) =>
        db.from('asistente_escalamientos').select('workspace_id, rol_clave, conversacion, motivo, modo')
          .gte('created_at', desde).lt('created_at', hasta).order('id').range(a, b)),
    calificaciones: (fecha) =>
      leerPaginado<CalificacionLeida>((a, b) =>
        db.from('asistente_calificaciones').select('workspace_id, rol_clave, conversacion, fallas, resuelta, nota, juez')
          .eq('fecha', fecha).order('id').range(a, b)),
    async workspaces(ids) {
      const { data, error } = await db.from('workspaces').select('id, name, slug, config_extra').in('id', ids)
      if (error) throw new Error(`workspaces: ${error.message}`)
      const m = new Map<string, WorkspaceLeido>()
      for (const w of (data ?? []) as Array<{ id: string; name: string | null; slug: string | null; config_extra: unknown }>) {
        m.set(w.id, { nombre: [w.name, w.slug ? `(${w.slug})` : null].filter(Boolean).join(' ') || w.id, conTexto: calificaConTexto(w.config_extra) })
      }
      return m
    },
    precios: () => puertoCalificacionSupabase(db).precios(),
  }
}
