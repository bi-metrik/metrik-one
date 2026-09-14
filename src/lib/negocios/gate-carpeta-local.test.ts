import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SQLSTATE_GATE_CARPETA_LOCAL,
  CLAVE_EXIGIR_CARPETA_LOCAL,
  esRechazoCarpetaLocal,
  bloqueoCarpetaLocal,
} from './gate-carpeta-local'

/**
 * La regla vive en el trigger; aqui se prueba que la aplicacion reconoce su rechazo y que
 * las dos piezas nombran lo mismo.
 *
 * ⚠️ Estas pruebas NO ejecutan SQL. El comportamiento del trigger se ensayo contra
 * produccion en un `DO ... RAISE EXCEPTION` que se revierte solo (22 casos, 2026-09-14,
 * cuerpo de la migracion corrido dos veces). Lo que si fijan: si alguien cambia el SQLSTATE
 * o la clave en un lado sin el otro, la pantalla dejaria de reconocer el rechazo y volveria
 * a mostrarlo como un error generico, sin que ningun otro check lo note.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20260914223000_gate_carpeta_local.sql')

/** El SQL sin comentarios: el contrato es lo que corre, no lo que se explica. */
function sqlEjecutable(): string {
  return readFileSync(MIGRACION, 'utf8')
    .split('\n')
    .filter(l => !/^\s*--/.test(l))
    .join('\n')
}

describe('esRechazoCarpetaLocal', () => {
  it('reconoce el rechazo por su SQLSTATE', () => {
    expect(esRechazoCarpetaLocal({ code: 'MK001', message: 'x' })).toBe(true)
  })

  it('no confunde otros errores de la base', () => {
    // P0001 es el RAISE EXCEPTION sin codigo: lo usan otros triggers y no son este gate.
    expect(esRechazoCarpetaLocal({ code: 'P0001', message: 'x' })).toBe(false)
    expect(esRechazoCarpetaLocal({ code: '23505', message: 'duplicate key' })).toBe(false)
    expect(esRechazoCarpetaLocal({ message: 'sin codigo' })).toBe(false)
  })

  it('tolera lo que no es un error', () => {
    expect(esRechazoCarpetaLocal(null)).toBe(false)
    expect(esRechazoCarpetaLocal(undefined)).toBe(false)
    expect(esRechazoCarpetaLocal('MK001')).toBe(false)
  })
})

describe('bloqueoCarpetaLocal', () => {
  it('convierte el rechazo en un gate NO omitible con el texto de la base', () => {
    const msg = 'El negocio A2 26 1 no puede pasar a la etapa "Propuesta" sin su carpeta del cerebro: registra la ruta proyectos/{cliente}/{proyecto}/ en metadata.carpeta_local.'
    expect(bloqueoCarpetaLocal({ code: 'MK001', message: msg, hint: 'h', details: 'd' })).toEqual({
      nombre: msg,
      es_gate: true,
      omitible: false,
      // Sin esta marca el modal no sabe que puede resolverlo ahí mismo.
      tipo: 'carpeta_local',
    })
  })

  it('cualquier otro error sigue su camino normal', () => {
    expect(bloqueoCarpetaLocal({ code: 'P0001', message: 'otra cosa' })).toBeNull()
    expect(bloqueoCarpetaLocal(null)).toBeNull()
  })

  it('sin mensaje no deja el modal en blanco', () => {
    const b = bloqueoCarpetaLocal({ code: 'MK001', message: '   ' })
    expect(b?.nombre).toMatch(/carpeta del cerebro/)
    expect(b?.omitible).toBe(false)
  })
})

describe('contrato con la migracion', () => {
  const sql = sqlEjecutable()

  it('el trigger rechaza con el mismo SQLSTATE que reconoce la aplicacion', () => {
    const codigos = [...sql.matchAll(/errcode\s*=\s*'([A-Z0-9]{5})'/gi)].map(m => m[1])
    expect(codigos).toEqual([SQLSTATE_GATE_CARPETA_LOCAL])
  })

  it('lee la misma clave de config_extra, y solo como booleano JSON', () => {
    expect(sql).toContain(`config_extra -> '${CLAVE_EXIGIR_CARPETA_LOCAL}' = 'true'::jsonb`)
  })

  it('cubre el INSERT y el cambio de etapa, y nada mas', () => {
    expect(sql).toMatch(
      /create trigger trg_zz_gate_carpeta_local\s+before insert or update of etapa_actual_id on public\.negocios/i,
    )
  })

  it('un UPDATE que nombra la misma etapa no cuenta como cambio', () => {
    expect(sql).toMatch(/new\.etapa_actual_id is not distinct from old\.etapa_actual_id/i)
  })

  it('corre como definer y no queda ejecutable desde el cliente', () => {
    expect(sql).toMatch(/security definer/i)
    expect(sql).toMatch(
      /revoke execute on function public\.gate_carpeta_local_negocio\(\) from public, anon, authenticated/i,
    )
  })
})
