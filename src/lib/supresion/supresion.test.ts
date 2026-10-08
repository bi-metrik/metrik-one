import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { candidatosNit, huella, huellasDe, normalizarEmail, normalizarNit, normalizarTelefono } from './huella'
import { estaSuprimido } from './esta-suprimido'
import { filasDeBajas } from './csv-bajas'

function falso(filas: { tipo: string; huella: string }[] | null, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        in: async (_c: string, v: string[]) => ({
          data: filas ? filas.filter((f) => v.includes(f.huella)).map((f) => ({ ...f, baja_at: '2026-10-07T00:00:00Z', canal: 'email' })) : null,
          error,
        }),
      }),
    }),
  }
}

describe('normalizacion', () => {
  it('email: minusculas, espacios y mailto', () => {
    expect(normalizarEmail('  Info@Empresa.CO ')).toBe('info@empresa.co')
    expect(normalizarEmail('mailto:a@b.co')).toBe('a@b.co')
    expect(normalizarEmail('no-es-correo')).toBeNull()
  })
  it('telefono: el mismo movil en cualquier forma da la misma huella', () => {
    const a = normalizarTelefono('315 950 9103')
    expect(a).toBe('573159509103')
    expect(normalizarTelefono('+57 315-950-9103')).toBe(a)
    expect(normalizarTelefono('3159509103.0')).toBe(a)
    expect(normalizarTelefono('abc')).toBeNull()
  })
  it('nit: quita puntos y DV; variante sin DV pegado', () => {
    expect(normalizarNit('902.079.601-9')).toBe('902079601')
    expect(candidatosNit('9020796019')).toEqual(['9020796019', '902079601'])
    expect(candidatosNit('902.079.601-9')).toEqual(['902079601'])
    expect(candidatosNit('x')).toEqual([])
  })
  it('la huella es sha256 hex y depende del tipo', () => {
    expect(huella('email', 'a@b.co')).toMatch(/^[0-9a-f]{64}$/)
    expect(huella('email', '123456789')).not.toBe(huella('nit', '123456789'))
  })
})

describe('estaSuprimido', () => {
  const h = huellasDe({ email: 'Baja@X.co', telefono: '3159509103', nit: '900.123.456-2' })
  it('sin datos no consulta y no suprime', async () => {
    expect((await estaSuprimido(falso(null), {})).suprimido).toBe(false)
  })
  it('suprime por email aunque venga con otra capitalizacion', async () => {
    const r = await estaSuprimido(falso([h[0]]), { email: ' BAJA@x.co' })
    expect(r.suprimido).toBe(true)
    expect(r.coincidencias[0].tipo).toBe('email')
  })
  it('suprime por telefono o por NIT aunque el correo este limpio', async () => {
    expect((await estaSuprimido(falso([h[1]]), { email: 'otro@x.co', telefono: '+57 315 950 9103' })).suprimido).toBe(true)
    expect((await estaSuprimido(falso([h[2]]), { nit: '900.123.456-2' })).suprimido).toBe(true)
  })
  it('no suprime si nada coincide', async () => {
    expect((await estaSuprimido(falso([h[0]]), { email: 'otro@x.co' })).suprimido).toBe(false)
  })
  it('un huella de otro tipo con el mismo valor no cuenta', async () => {
    const r = await estaSuprimido(falso([{ tipo: 'telefono', huella: huella('email', 'a@b.co') }]), { email: 'a@b.co' })
    expect(r.suprimido).toBe(false)
  })
  it('falla cerrado ante error de consulta', async () => {
    const r = await estaSuprimido(falso(null, new Error('red')), { email: 'a@b.co' })
    expect(r).toMatchObject({ suprimido: true, porError: true })
  })
})

describe('csv de bajas', () => {
  const def = { canal: 'email', motivo: 'baja', campana: 'ola-1', ahora: new Date('2026-10-07T10:00:00Z') }
  it('carga filas, aplica defectos y deduplica', () => {
    const { filas, errores } = filasDeBajas('email,fecha\nA@x.co,2026-10-06\na@x.co,\n"b@x.co",\n', def)
    expect(errores).toEqual([])
    expect(filas.map((f) => f.huella)).toEqual([huella('email', 'a@x.co'), huella('email', 'b@x.co')])
    expect(filas[0]).toMatchObject({ canal: 'email', motivo: 'baja', campana: 'ola-1' })
    expect(filas[0].baja_at.startsWith('2026-10-06')).toBe(true)
  })
  it('una fila con varios datos genera una baja por dato', () => {
    const { filas } = filasDeBajas('email,telefono,nit\na@x.co,3159509103,900.123-4\n', def)
    expect(filas.map((f) => f.tipo)).toEqual(['email', 'telefono', 'nit'])
  })
  it('reporta errores y no inventa filas', () => {
    const r = filasDeBajas('email,canal\nmal,email\na@x.co,carta\n,email\n', def)
    expect(r.filas).toEqual([])
    expect(r.errores).toHaveLength(3)
  })
  it('exige alguna columna de dato', () => {
    expect(filasDeBajas('nombre\nx\n', def).errores[0]).toMatch(/cabecera/)
  })
})

describe('migracion 20261007120000 (PGlite)', () => {
  const MIG = join(process.cwd(), 'supabase/migrations/20261007120000_supresion_y_origen_del_dato.sql')
  let db: PGlite
  beforeAll(async () => {
    db = new PGlite()
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.contactos (id uuid primary key default gen_random_uuid(), nombre text, fuente_adquisicion text);
      create table public.empresas (id uuid primary key default gen_random_uuid(), nombre text);
      insert into public.contactos (nombre, fuente_adquisicion) values ('Ana', 'referido');
      insert into public.empresas (nombre) values ('Acme');
    `)
    await db.exec(readFileSync(MIG, 'utf8'))
  })
  afterAll(async () => { await db.close() })

  it('es aditiva: filas existentes intactas, columnas nuevas en null; idempotente', async () => {
    await db.exec(readFileSync(MIG, 'utf8'))
    const { rows } = await db.query<{ n: number; fuente_adquisicion: string; base_legal: string | null }>(
      `select count(*)::int n, max(fuente_adquisicion) fuente_adquisicion, max(base_legal) base_legal from public.contactos`)
    expect(rows[0]).toEqual({ n: 1, fuente_adquisicion: 'referido', base_legal: null })
  })
  it('rechaza base_legal fuera del catalogo', async () => {
    await expect(db.query(`update public.contactos set base_legal = 'porque_si'`)).rejects.toThrow()
    await db.query(`update public.contactos set base_legal = 'canal_corporativo_pj'`)
  })
  it('supresiones: server-only, unica y append-only', async () => {
    const h = 'a'.repeat(64)
    await db.query(`insert into public.supresiones (tipo, huella, canal) values ('email', '${h}', 'email')`)
    await expect(db.query(`insert into public.supresiones (tipo, huella, canal) values ('email', '${h}', 'email')`)).rejects.toThrow()
    await db.query(`insert into public.supresiones (tipo, huella, canal) values ('email', '${h}', 'email') on conflict (tipo, huella) do nothing`)
    await expect(db.query(`insert into public.supresiones (tipo, huella, canal) values ('email', 'no-es-hash', 'email')`)).rejects.toThrow()
    await expect(db.query(`delete from public.supresiones`)).rejects.toThrow(/append-only/)
    await expect(db.query(`update public.supresiones set canal = 'otro'`)).rejects.toThrow(/append-only/)
    const { rows } = await db.query<{ a: boolean; u: boolean }>(
      `select has_table_privilege('anon','public.supresiones','select') a, has_table_privilege('authenticated','public.supresiones','select') u`)
    expect(rows[0]).toEqual({ a: false, u: false })
  })
  it('dry-run: DO + RAISE al final revierte todo', async () => {
    const d2 = new PGlite()
    await d2.exec(`create role anon nologin; create role authenticated nologin;
      create table public.contactos (id uuid primary key); create table public.empresas (id uuid primary key);`)
    await expect(d2.exec(readFileSync(MIG, 'utf8') + `\ndo $$ begin raise exception 'DRY-RUN OK'; end $$;`)).rejects.toThrow(/DRY-RUN OK/)
    const { rows } = await d2.query<{ t: string | null }>(`select to_regclass('public.supresiones')::text t`)
    expect(rows[0].t).toBeNull()
    await d2.close()
  })
})
