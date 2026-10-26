// Pruebas de la guarda de epoca (`check-migracion-epoca.mjs`).
//
// Dos capas: la deteccion (funciones puras sobre el SQL) y el veredicto del PR, que corre la
// guarda como proceso dentro de un repo git DESECHABLE, igual que la corre CI: el camino que
// compara la epoca del PR contra la de la base vive en git, y una prueba que lo saltara no
// probaria la decision que importa.

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cambiosQueRompen, analizar, marcaNoRompe, leerEpocaDe } from './check-migracion-epoca.mjs'

const RAIZ = new URL('..', import.meta.url).pathname
const GUARDA = join(RAIZ, 'scripts/check-migracion-epoca.mjs')

const ques = (sql) => cambiosQueRompen(sql).map((h) => h.que)

describe('deteccion: lo que rompe', () => {
  it.each([
    ['DROP TABLE', 'drop table public.viejas;', 'DROP TABLE'],
    ['DROP TABLE IF EXISTS', 'DROP TABLE IF EXISTS viejas CASCADE;', 'DROP TABLE'],
    ['DROP VIEW sin recrear', 'drop view if exists public.v_cartera;', 'DROP VIEW'],
    ['DROP MATERIALIZED VIEW', 'drop materialized view mv_x;', 'DROP MATERIALIZED VIEW'],
    ['DROP FUNCTION sin recrear', 'drop function if exists public.f(int);', 'DROP FUNCTION'],
    ['DROP PROCEDURE', 'drop procedure p();', 'DROP PROCEDURE'],
    ['DROP TYPE', 'drop type estado_negocio;', 'DROP TYPE'],
    ['DROP SCHEMA', 'drop schema legado cascade;', 'DROP SCHEMA'],
    ['DROP COLUMN', 'alter table negocios drop column precio;', 'DROP COLUMN'],
    ['DROP COLUMN IF EXISTS', 'ALTER TABLE negocios DROP COLUMN IF EXISTS precio;', 'DROP COLUMN'],
    ['DROP sin la palabra COLUMN', 'alter table negocios drop precio;', 'DROP COLUMN'],
    ['RENAME TABLE', 'alter table negocios rename to tratos;', 'RENAME de TABLE'],
    ['RENAME COLUMN', 'alter table negocios rename column precio to valor;', 'RENAME de columna o valor'],
    ['RENAME de funcion', 'alter function public.f(int) rename to g;', 'RENAME de FUNCTION'],
    ['RENAME VALUE de un enum', "alter type estado rename value 'a' to 'b';", 'RENAME de columna o valor'],
    ['ALTER COLUMN TYPE', 'alter table negocios alter column precio type numeric;', 'ALTER COLUMN ... TYPE'],
    ['ALTER COLUMN SET DATA TYPE', 'alter table negocios alter column precio set data type bigint;', 'ALTER COLUMN ... TYPE'],
    ['ALTER sin COLUMN ... TYPE', 'alter table negocios alter precio type text;', 'ALTER COLUMN ... TYPE'],
    ['dentro de un DO block', "do $$ begin alter table negocios drop column precio; end $$;", 'DROP COLUMN'],
  ])('%s', (_n, sql, esperado) => {
    expect(ques(sql)).toContain(esperado)
  })

  it('reporta cada DROP de una sentencia con varias columnas, con su linea', () => {
    const sql = 'alter table t\n  drop column a,\n  drop column b;'
    expect(cambiosQueRompen(sql)).toEqual([
      { linea: 2, que: 'DROP COLUMN' },
      { linea: 3, que: 'DROP COLUMN' },
    ])
  })
})

describe('deteccion: lo que NO rompe', () => {
  it.each([
    ['DROP POLICY', 'drop policy if exists p on t;'],
    ['DROP TRIGGER', 'drop trigger if exists tg on t;'],
    ['DROP INDEX', 'drop index if exists idx_x;'],
    ['DROP CONSTRAINT', 'alter table t drop constraint t_chk;'],
    ['DROP DEFAULT', 'alter table t alter column c drop default;'],
    ['DROP NOT NULL', 'alter table t alter column c drop not null;'],
    ['RENAME CONSTRAINT', 'alter table t rename constraint a to b;'],
    ['ALTER INDEX RENAME', 'alter index idx_a rename to idx_b;'],
    ['ALTER TRIGGER RENAME', 'alter trigger tg on t rename to tg2;'],
    ['ALTER TYPE ADD VALUE', "alter type estado add value 'nuevo';"],
    ['ADD COLUMN', 'alter table t add column c text;'],
    ['comentario de linea', '-- drop table t;\nselect 1;'],
    ['comentario de bloque', '/* alter table t drop column c; */ select 1;'],
    ['CREATE OR REPLACE FUNCTION', 'create or replace function f() returns int language sql as $$ select 1 $$;'],
  ])('%s', (_n, sql) => {
    expect(cambiosQueRompen(sql)).toEqual([])
  })

  // DROP + CREATE del mismo nombre es la forma de cambiarle columnas a una vista. Se avisa,
  // no se frena: era el 80 % de los hallazgos sobre el historico.
  it('una vista borrada y recreada en el mismo archivo queda como aviso', () => {
    const sql = 'DROP VIEW IF EXISTS public.v_pyl_mes;\nCREATE VIEW v_pyl_mes AS select 1;'
    const r = analizar(sql)
    expect(r.hallazgos).toEqual([])
    expect(r.avisos[0].que).toContain('v_pyl_mes')
  })

  it('una funcion borrada y recreada en el mismo archivo queda como aviso', () => {
    const sql =
      'drop function if exists public.get_x(int);\ncreate or replace function public.get_x(p int, q int default null) returns int as $$ select 1 $$ language sql;'
    expect(analizar(sql).hallazgos).toEqual([])
    expect(analizar(sql).avisos).toHaveLength(1)
  })

  it('recrear OTRA vista no absuelve a la borrada', () => {
    const sql = 'drop view v_vieja;\ncreate view v_nueva as select 1;'
    expect(ques(sql)).toEqual(['DROP VIEW'])
  })

  it('una tabla recreada SI frena (los datos y las columnas se van)', () => {
    expect(ques('drop table t;\ncreate table t (id int);')).toEqual(['DROP TABLE'])
  })
})

describe('marca y epoca', () => {
  it('lee la marca con su motivo', () => {
    expect(marcaNoRompe('-- epoca: no-rompe la columna dejo de leerse en #990\ndrop table t;')).toBe(
      'la columna dejo de leerse en #990',
    )
  })

  it('una marca sin motivo no vale', () => {
    expect(marcaNoRompe('-- epoca: no-rompe\ndrop table t;')).toBeNull()
    expect(marcaNoRompe('-- epoca: no-rompe  \ndrop table t;')).toBeNull()
  })

  it('lee EPOCA del archivo de la app', () => {
    expect(leerEpocaDe('export const EPOCA = 7\n')).toBe(7)
    expect(leerEpocaDe('/** doc */\nexport const EPOCA: number = 12')).toBe(12)
    expect(leerEpocaDe('export const OTRA = 1')).toBeNull()
  })
})

// ── El veredicto del PR, por git ──────────────────────────────────────────────────────

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
}

function escribir(repo, ruta, contenido) {
  writeFileSync(join(repo, ruta), contenido)
}

const epocaTs = (n) => `export const EPOCA = ${n}\n`

// Repo con la epoca de la base y, en una rama, las migraciones y la epoca del PR.
function repoCon({ epocaBase = 1, epocaPr = epocaBase, migraciones = {}, sinEpoca = false }) {
  const repo = mkdtempSync(join(tmpdir(), 'epoca-'))
  mkdirSync(join(repo, 'supabase/migrations'), { recursive: true })
  mkdirSync(join(repo, 'src/lib/version'), { recursive: true })
  git(repo, 'init', '--quiet', '--initial-branch=main')
  git(repo, 'config', 'user.email', 'guarda@test')
  git(repo, 'config', 'user.name', 'Guarda')
  escribir(repo, 'supabase/migrations/20260101000000_base.sql', 'drop table vieja;\n')
  if (!sinEpoca) escribir(repo, 'src/lib/version/epoca.ts', epocaTs(epocaBase))
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD').trim()

  git(repo, 'checkout', '--quiet', '-b', 'pr')
  for (const [nombre, sql] of Object.entries(migraciones)) escribir(repo, `supabase/migrations/${nombre}`, sql)
  if (!sinEpoca) escribir(repo, 'src/lib/version/epoca.ts', epocaTs(epocaPr))
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '--allow-empty', '-m', 'pr')
  return { repo, base }
}

function revisar({ repo, base }) {
  try {
    const out = execFileSync('node', [GUARDA], {
      cwd: repo,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, BASE_REF: base },
    })
    return { ok: true, codigo: 0, salida: out }
  } catch (e) {
    return { ok: false, codigo: e.status, salida: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('veredicto del PR', () => {
  it('sin migraciones nuevas pasa (la DROP de la base no cuenta)', () => {
    expect(revisar(repoCon({})).ok).toBe(true)
  })

  it('una migracion inofensiva pasa sin tocar la epoca', () => {
    const r = revisar(repoCon({ migraciones: { '20260201000000_a.sql': 'alter table t add column c text;' } }))
    expect(r.ok).toBe(true)
  })

  it('un DROP COLUMN sin subir la epoca FALLA y nombra archivo, linea y salida', () => {
    const r = revisar(
      repoCon({ migraciones: { '20260201000000_quita.sql': 'select 1;\nalter table t drop column c;\n' } }),
    )
    expect(r.ok).toBe(false)
    expect(r.codigo).toBe(1)
    expect(r.salida).toContain('20260201000000_quita.sql')
    expect(r.salida).toContain('linea 2: DROP COLUMN')
    expect(r.salida).toContain('-- epoca: no-rompe')
  })

  it('el mismo DROP pasa si la epoca sube en el PR', () => {
    const r = revisar(
      repoCon({ epocaPr: 2, migraciones: { '20260201000000_quita.sql': 'alter table t drop column c;' } }),
    )
    expect(r.ok).toBe(true)
    expect(r.salida).toContain('1 → 2')
  })

  it('bajar la epoca no cuenta como subirla', () => {
    const r = revisar(
      repoCon({ epocaBase: 3, epocaPr: 2, migraciones: { '20260201000000_quita.sql': 'drop table t;' } }),
    )
    expect(r.ok).toBe(false)
  })

  it('el mismo DROP pasa con la marca y su motivo', () => {
    const r = revisar(
      repoCon({
        migraciones: {
          '20260201000000_quita.sql': '-- epoca: no-rompe la columna no la lee nadie desde #900\nalter table t drop column c;',
        },
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.salida).toContain('declarada no-rompe')
  })

  it('la marca de UN archivo no cubre a otro del mismo PR', () => {
    const r = revisar(
      repoCon({
        migraciones: {
          '20260201000000_a.sql': '-- epoca: no-rompe motivo valido\ndrop table a;',
          '20260201000001_b.sql': 'drop table b;',
        },
      }),
    )
    expect(r.ok).toBe(false)
    expect(r.salida).toContain('20260201000001_b.sql')
    expect(r.salida).not.toContain('✗ supabase/migrations/20260201000000_a.sql')
  })

  it('sin el archivo de la epoca no adivina: sale con error de configuracion', () => {
    const r = revisar(repoCon({ sinEpoca: true, migraciones: { '20260201000000_q.sql': 'drop table t;' } }))
    expect(r.codigo).toBe(2)
  })
})
