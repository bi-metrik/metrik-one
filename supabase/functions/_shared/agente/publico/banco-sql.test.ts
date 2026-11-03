import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { REGLAMENTO_SABOR } from './reglamento-sabor'
import { huellaPublicable } from '../reglamento'

/**
 * La migración 20261030190000 (encargo 2026-10-30, versiones con banco) con LOS ARCHIVOS de migración en Postgres en
 * memoria (PGlite): publicar el asistente público sin banco se sigue pudiendo (ensayo), pero prender el canal exige que
 * la versión vigente tenga un banco válido, y `banco_valido` lo dice para `chatwoot-agente`.
 */

const MIGRACION = '20261030190000_asistente_publico_banco_para_atender.sql'
const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')
const WS = '00000000-0000-4000-8000-0000000000f1'
const WS_ROLES = '00000000-0000-4000-8000-0000000000f2'
const BOT = 'asistente-publico'

let db: PGlite

const uno = async <T>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows[0]
const banco = (huella: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ pasa: true, k: 3, fecha: '2026-10-30T12:00:00Z', huella_fichas: huella, ...extra })

/** Publica las fichas de `bot_parametros` con o sin banco y devuelve el id de la versión. */
const publicar = async (ws: string, b: string | null) =>
  (await uno<{ id: string }>('select public.bot_publicar_reglamento($1, $2, $3, $4::jsonb) as id', [ws, BOT, 'prueba', b])).id
/** La huella de lo publicado, como la calcula la base (la misma que `huellaPublicable` del arnés, ver roles-sql.test). */
const huellaDe = async (id: string) =>
  (await uno<{ h: string }>('select public.asistente_huella_fichas(fichas) as h from public.bot_reglamentos where id = $1', [id])).h
const bancoValido = async (id: string) =>
  (await uno<{ v: boolean }>('select public.banco_valido(r) as v from public.bot_reglamentos r where id = $1', [id])).v

/** Prende (o cambia) la config de chatwoot del workspace. */
const config = (ws: string, chatwoot: Record<string, unknown>) =>
  db.query(`update public.workspaces set config_extra = jsonb_build_object('bot_conversacional', jsonb_build_object('chatwoot', $2::jsonb)) where id = $1`, [ws, JSON.stringify(chatwoot)])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key, slug text, config_extra jsonb not null default '{}'::jsonb);
    insert into public.workspaces (id, slug) values ('${WS}', 'dimpro'), ('${WS_ROLES}', 'sabor');
    create table public.staff (id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade, profile_id uuid unique);
    create table public.wa_collaborators (id uuid primary key, workspace_id uuid not null references public.workspaces(id) on delete cascade);
  `)
  await db.exec(leer('20261006213100_wa_conversacion.sql'))
  await db.exec(leer('20261006213200_bot_reglamento_y_uso.sql'))
  await db.exec(leer('20261026183000_asistentes_roles.sql'))
  await db.exec(leer(MIGRACION))
  // Unas fichas globales del público para publicar (las de Sabor, que ya tienen su huella cruzada con el arnés).
  for (const f of REGLAMENTO_SABOR) {
    await db.query(
      `insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
       values (null, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [BOT, f.clave, f.tipo, f.carga, f.cuando ?? null, f.hacer, f.herramientas ?? null, f.prioridad ?? null, f.fuente || null, f.valores ? JSON.stringify(f.valores) : null],
    )
  }
}, 30_000)
afterAll(async () => { await db.close() })
beforeEach(async () => {
  await db.exec(`
    update public.workspaces set config_extra = '{}'::jsonb;
    delete from public.asistente_roles;
    delete from public.bot_reglamentos;
  `)
})

describe('banco_valido', () => {
  it('sin banco: se publica (ensayo) y no es válido', async () => {
    const id = await publicar(WS, null)
    expect(await bancoValido(id)).toBe(false)
  })

  it('con banco que pasa, k >= 3, fecha y la huella de sus fichas: válido', async () => {
    const huella = await huellaPublicable(REGLAMENTO_SABOR)
    const id = await publicar(WS, banco(huella))
    expect(await huellaDe(id)).toBe(huella)
    expect(await bancoValido(id)).toBe(true)
  })

  it('no es válido con otra huella, k < 3, pasa falso, sin fecha o k que no es número', async () => {
    const huella = await huellaPublicable(REGLAMENTO_SABOR)
    for (const b of [
      banco('a'.repeat(64)), banco(huella, { k: 2 }), banco(huella, { pasa: false }), banco(huella, { pasa: 'true' }),
      banco(huella, { fecha: '' }), banco(huella, { k: 'tres' }),
    ]) {
      expect(await bancoValido(await publicar(WS, b))).toBe(false)
    }
  })
})

describe('prender el canal', () => {
  it('con la última versión sin banco: se rechaza (23514)', async () => {
    await publicar(WS, null)
    await expect(config(WS, { activo: true })).rejects.toMatchObject({ code: '23514' })
  })

  it('sin ninguna versión publicada: se rechaza', async () => {
    await expect(config(WS, { activo: true })).rejects.toMatchObject({ code: '23514' })
  })

  it('con la última versión con banco válido: pasa', async () => {
    await publicar(WS, null)
    await publicar(WS, banco(await huellaPublicable(REGLAMENTO_SABOR)))
    await config(WS, { activo: true })
    expect((await uno<{ a: boolean }>(`select (config_extra #> '{bot_conversacional,chatwoot,activo}')::boolean as a from public.workspaces where id = $1`, [WS])).a).toBe(true)
  })

  it('el puntero manda: apuntando a una versión sin banco se rechaza aunque la última lo tenga', async () => {
    const vieja = await publicar(WS, null)
    await publicar(WS, banco(await huellaPublicable(REGLAMENTO_SABOR)))
    await expect(config(WS, { activo: true, reglamento_id: vieja })).rejects.toMatchObject({ code: '23514' })
  })

  it('un puntero que no es una versión del público de ese workspace: se rechaza', async () => {
    await publicar(WS, banco(await huellaPublicable(REGLAMENTO_SABOR)))
    await expect(config(WS, { activo: true, reglamento_id: '00000000-0000-4000-8000-000000000099' })).rejects.toMatchObject({ code: '23514' })
  })

  it('apagado se puede guardar sin banco; ya prendido, cambiar otras llaves no vuelve a revisar', async () => {
    await publicar(WS, null)
    await config(WS, { activo: false, apiUrl: 'https://app.chatwoot.com' })
    const id = await publicar(WS, banco(await huellaPublicable(REGLAMENTO_SABOR)))
    await config(WS, { activo: true, reglamento_id: id })
    // Una versión nueva sin banco después de prender: la base no apaga nada, lo ataja `chatwoot-agente` al leerla.
    await publicar(WS, null)
    await config(WS, { activo: true, reglamento_id: id, apiUrl: 'https://otra' })
  })

  it('con roles en el canal chatwoot no se mira el reglamento de siempre', async () => {
    await publicar(WS_ROLES, null)
    await db.query(`insert into public.asistente_roles (workspace_id, clave, familia, canal) values ($1, 'asesor_vendedor', 'clientes', 'chatwoot')`, [WS_ROLES])
    await config(WS_ROLES, { activo: true })
  })

  it('al crear un workspace ya prendido también revisa', async () => {
    await expect(db.query(
      `insert into public.workspaces (id, slug, config_extra) values ('00000000-0000-4000-8000-0000000000f3', 'nuevo', '{"bot_conversacional":{"chatwoot":{"activo":true}}}')`,
    )).rejects.toMatchObject({ code: '23514' })
  })
})

describe('permisos', () => {
  it('ninguna función nueva la ejecuta anon ni authenticated', async () => {
    const r = await db.query<{ f: string; anon: boolean; auth: boolean }>(`
      select p.oid::regprocedure::text as f,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('bot_banco_valido', 'banco_valido', 'asistente_publico_prender_exige_banco')`)
    expect(r.rows).toHaveLength(3)
    for (const x of r.rows) expect([x.f, x.anon, x.auth]).toEqual([x.f, false, false])
  })
})
