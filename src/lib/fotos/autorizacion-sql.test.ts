import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de la autorización de las fotos subidas (`20261016233000`), su dry-run y su
 * reversa, corridos de verdad en Postgres en memoria (PGlite) sobre las tres migraciones de la
 * biblioteca cargadas TAL CUAL.
 */
const raiz = process.cwd()
const migracion = (a: string) => readFileSync(join(raiz, 'supabase/migrations', a), 'utf8')
const sql = (a: string) => readFileSync(join(raiz, 'sql/fotos', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const USUARIO = '00000000-0000-4000-8000-0000000000b2'
const MIGRACION = '20261016233000_fotos_catalogo_autorizacion.sql'
const DRY_RUN = '2026-10-16_dry-run_fotos-catalogo-autorizacion.sql'

const BASE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  insert into auth.users values ('${USUARIO}');
  create table public.workspaces (id uuid primary key);
  create table public.staff (id uuid primary key);
  create function public.current_user_workspace_id() returns uuid language sql stable as $$ select null::uuid $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  insert into public.workspaces values ('${WS}');
`

const fila = (posicion: number) => `
  insert into public.fotos_catalogo (workspace_id, tipo, clave, nombre_clave, nombre, ref, origen, revisada, posicion, principal)
  values ('${WS}', 'hotel', 'arts|barcelona', 'arts', 'Arts', 'one://fotos-catalogo/${WS}/hotel/${String(posicion).padStart(16, '0')}.jpg', 'asesora', true, ${posicion}, ${posicion === 1});
`

const columnas = async (db: PGlite) =>
  (
    await db.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns where table_name = 'fotos_catalogo' and column_name in ('autorizada_por', 'autorizada_at', 'procedencia')`,
    )
  ).rows[0].n

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(BASE)
  await db.exec(migracion('20261014221500_fotos_catalogo.sql'))
  await db.exec(migracion('20261016153000_fotos_catalogo_tres_por_elemento.sql'))
  await db.exec(migracion('20261016221500_fotos_catalogo_categoria.sql'))
  await db.exec(fila(1) + fila(2))
})
afterAll(async () => db.close())

describe('fotos_catalogo: autorización de la foto subida', () => {
  it('el dry-run lleva el cuerpo de la migración tal cual', () => {
    const cuerpo = (/EXECUTE \$mig\$([\s\S]*?)\$mig\$/.exec(sql(DRY_RUN))?.[1] ?? 'no está').trim()
    expect(cuerpo.length).toBeGreaterThan(200)
    expect(migracion(MIGRACION)).toContain(cuerpo)
  })

  it('el dry-run dice OK, ensaya los CHECK y la llave, y no deja nada escrito', async () => {
    const r = await db.exec(sql(DRY_RUN)).then(() => 'sin error', (e: Error) => e.message)
    expect(r).toMatch(/^DRY-RUN OK /)
    expect(r).toContain('valida=t')
    expect(r).toContain('sin_fecha=t')
    expect(r).toContain('procedencia_vacia=t')
    expect(r).toContain('usuario_inexistente=t')
    expect(await columnas(db)).toBe(0)
  })

  it('la migración agrega las tres columnas: las fotos viejas quedan sin autorización y los CHECK frenan lo incompleto', async () => {
    await db.exec(migracion(MIGRACION))
    expect(await columnas(db)).toBe(3)
    const filas = (await db.query<{ autorizada_por: string | null; procedencia: string | null }>('select autorizada_por, procedencia from public.fotos_catalogo')).rows
    expect(filas).toHaveLength(2)
    expect(filas.every((f) => f.autorizada_por === null && f.procedencia === null)).toBe(true)
    await db.exec(`update public.fotos_catalogo set autorizada_por = '${USUARIO}', autorizada_at = now(), procedencia = 'kit de medios del hotel' where posicion = 1`)
    await expect(db.exec(`update public.fotos_catalogo set autorizada_por = '${USUARIO}', autorizada_at = null where posicion = 2`)).rejects.toThrow(/fotos_catalogo_autorizada_con_fecha/)
    await expect(db.exec(`update public.fotos_catalogo set procedencia = '' where posicion = 2`)).rejects.toThrow(/fotos_catalogo_procedencia_check/)
    await expect(db.exec(`update public.fotos_catalogo set procedencia = repeat('x', 201) where posicion = 2`)).rejects.toThrow(/fotos_catalogo_procedencia_check/)
    // Si el usuario se borra, la foto queda con la fecha sola (no se borra la foto).
    await db.exec(`delete from auth.users where id = '${USUARIO}'`)
    const quedo = (await db.query<{ autorizada_por: string | null; autorizada_at: string | null }>('select autorizada_por, autorizada_at from public.fotos_catalogo where posicion = 1')).rows[0]
    expect(quedo.autorizada_por).toBeNull()
    expect(quedo.autorizada_at).not.toBeNull()
  })

  it('la reversa la quita sin tocar las fotos', async () => {
    await db.exec(sql('2026-10-16_reversa_fotos-catalogo-autorizacion.sql'))
    expect(await columnas(db)).toBe(0)
    expect((await db.query<{ n: number }>('select count(*)::int as n from public.fotos_catalogo')).rows[0].n).toBe(2)
  })
})
