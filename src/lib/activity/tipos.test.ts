import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ACTIVITY_LOG_TIPOS, esActivityLogTipo } from './tipos'

/**
 * El contrato entre la constante y el CHECK de la base.
 *
 * Decir "hay una sola fuente" no la hace única: la migración transcribe la lista a SQL
 * y nadie impide que las dos se separen. Esta prueba lee el archivo de migración y
 * exige que las dos listas coincidan **exactamente**. Sin ella, agregar un tipo a la
 * constante y olvidar la migración vuelve a producir el fallo mudo original — que es
 * justo lo que este PR viene a cerrar.
 */
const MIGRACION = join(
  process.cwd(),
  'supabase/migrations/20260901000010_activity_log_tipos_vocabulario.sql',
)

/** Extrae los literales del `check (tipo in (...))` del archivo de migración. */
function tiposDelCheck(sql: string): string[] {
  const bloque = sql.match(/check\s*\(\s*tipo\s+in\s*\(([\s\S]*?)\)\s*\)/i)
  if (!bloque) throw new Error('No se encontró el `check (tipo in (...))` en la migración')
  return [...bloque[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
}

describe('vocabulario de activity_log.tipo', () => {
  it('el CHECK de la migración dice exactamente lo mismo que ACTIVITY_LOG_TIPOS', () => {
    const enElCheck = tiposDelCheck(readFileSync(MIGRACION, 'utf8'))

    // Ordenados: la migración los agrupa por familia y la constante también, pero el
    // contrato es de conjunto, no de orden.
    expect([...enElCheck].sort()).toEqual([...ACTIVITY_LOG_TIPOS].sort())
  })

  it('no hay tipos repetidos', () => {
    expect(new Set(ACTIVITY_LOG_TIPOS).size).toBe(ACTIVITY_LOG_TIPOS.length)
  })

  it('conserva los 7 tipos que el CHECK ya admitía — ampliar no puede quitar', () => {
    // Si alguno de estos saliera, `ADD CONSTRAINT` abortaría al validar las filas
    // existentes de producción. Es la comprobación que convierte esta migración en
    // "no toca datos".
    const yaVigentes = [
      'comentario',
      'cambio',
      'sistema',
      'cambio_etapa',
      'cambio_estado',
      'solicitud_conciliacion',
      'conciliacion_atendida',
    ]
    for (const t of yaVigentes) {
      expect(ACTIVITY_LOG_TIPOS).toContain(t)
    }
  })

  it('incluye los 8 tipos que el código insertaba y el CHECK rechazaba', () => {
    // Derivados por grep sobre `src/` y `supabase/functions/` el 2026-09-01.
    const losQueFallaban = [
      'propuesta_aprobada',
      'cambio_sistema',
      'stage_auto_transition',
      'platform_admin_enter',
      'platform_admin_exit',
      'drive_health_failed',
      'drive_folder_skipped',
      'drive_folder_failed',
    ]
    for (const t of losQueFallaban) {
      expect(ACTIVITY_LOG_TIPOS).toContain(t)
    }
  })

  it('esActivityLogTipo rechaza lo que no está en el catálogo', () => {
    // `reproceso` es un caso real: `reproceso-actions.ts` lo insertó durante un tiempo
    // y la traza del reproceso nunca se escribió.
    expect(esActivityLogTipo('reproceso')).toBe(false)
    expect(esActivityLogTipo('')).toBe(false)
    expect(esActivityLogTipo('propuesta_aprobada')).toBe(true)
  })
})
