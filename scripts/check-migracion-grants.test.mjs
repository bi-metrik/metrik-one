// Pruebas de la guarda de migraciones, hoy solo de la regla de vistas.
//
// Existen porque el hallazgo que motivo esa regla fue exactamente esto: un chequeo que
// nadie ejercita no es un chequeo. Cada caso escribe un .sql temporal y corre la guarda
// como proceso, que es como la corre CI, en vez de importar sus funciones internas.

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RAIZ = new URL('..', import.meta.url).pathname
const GUARDA = join(RAIZ, 'scripts/check-migracion-grants.mjs')

// Devuelve la lista de problemas que la guarda reporta para ese SQL.
function revisar(sql) {
  const archivo = join(mkdtempSync(join(tmpdir(), 'guarda-')), 'm.sql')
  writeFileSync(archivo, sql)
  try {
    execFileSync('node', [GUARDA, archivo], { cwd: RAIZ, encoding: 'utf8', stdio: 'pipe' })
    return []
  } catch (e) {
    return (e.stderr ?? '').split('\n').filter((l) => l.includes('✗')).map((l) => l.trim())
  }
}

describe('vistas: security_invoker', () => {
  it('acepta la opcion declarada en la propia sentencia', () => {
    expect(revisar('create or replace view public.v_x with (security_invoker = on) as select 1 as n;')).toEqual([])
  })

  it('acepta la opcion puesta con un alter en el mismo archivo, en su forma =true', () => {
    expect(
      revisar('create or replace view public.v_y as select 1 as n;\nalter view public.v_y set (security_invoker = true);'),
    ).toEqual([])
  })

  it('acepta la vista definer cuando el archivo lo declara', () => {
    expect(
      revisar('-- vista-definer: se lee solo con service_role, cruza workspaces a proposito\ncreate view public.v_z as select 1 as n;'),
    ).toEqual([])
  })

  it('rechaza la vista que no dice nada', () => {
    const p = revisar('create or replace view public.v_w as select 1 as n;')
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('v_w')
  })

  // El caso real: CREATE OR REPLACE sin clausula WITH borra la opcion que puso una
  // migracion anterior. La vista ya estaba en invoker y aun asi hay que volver a decirlo.
  it('rechaza el reemplazo de una vista que YA estaba en invoker', () => {
    const p = revisar('create or replace view public.v_cobro_valor as select 1 as n, 2 as a_tramo1_base;')
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('v_cobro_valor')
  })

  it('rechaza la opcion apagada a proposito sin marca', () => {
    expect(revisar('create view public.v_q with (security_invoker = off) as select 1 as n;')).toHaveLength(1)
  })

  it('rechaza el alter que le quita la opcion a una vista existente', () => {
    const p = revisar('alter view public.v_cobro_valor reset (security_invoker);')
    expect(p).toHaveLength(1)
    expect(p[0]).toContain('pierde')
  })

  it('no opina sobre vistas materializadas, que no soportan la opcion', () => {
    expect(revisar('create materialized view public.mv_a as select 1 as n;')).toEqual([])
  })

  it('no opina sobre esquemas que no sean public', () => {
    expect(revisar('create or replace view privado.v_r as select 1 as n;')).toEqual([])
  })

  it('no confunde una sentencia comentada con una real', () => {
    expect(revisar('-- create or replace view public.v_fantasma as select 1;\nselect 1;')).toEqual([])
  })
})
