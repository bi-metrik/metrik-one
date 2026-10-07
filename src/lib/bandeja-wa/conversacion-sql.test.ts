import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * `wa_conversacion` y su RPC de salientes, con EL ARCHIVO de migración tal cual en Postgres en memoria (PGlite).
 *
 * Lo que se prueba: el saliente solo se guarda si el teléfono tiene un entrante en las últimas 24 h, con el workspace
 * del último entrante; el wamid no se repite; las restricciones de clase; y que nadie con sesión la alcanza.
 */

const MIGRACION = '20261006213100_wa_conversacion.sql'
const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_2 = '00000000-0000-4000-8000-0000000000a2'
const TEL = '573001112233'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key);
    insert into public.workspaces values ('${WS}'), ('${WS_2}');
  `)
  await db.exec(leer(MIGRACION))
})
afterAll(async () => { await db.close() })

async function entrante(ws: string, wamid: string, hace = '0 minutes', tel = TEL) {
  await db.query(
    `insert into public.wa_conversacion (workspace_id, phone, direccion, clase, texto, wa_message_id, created_at)
     values ($1, $2, 'entrante', 'escrito', 'hola', $3, now() - $4::interval)`,
    [ws, tel, wamid, hace],
  )
}

async function saliente(tel: string, wamid: string | null, texto = 'respuesta') {
  const r = await db.query<{ ok: boolean }>(
    `select public.wa_conversacion_registrar_saliente($1, $2, $3, 'botones', '[{"id":"a","titulo":"Sí"}]'::jsonb, 'bot', 'agente') as ok`,
    [tel, wamid, texto],
  )
  return r.rows[0].ok
}

describe('wa_conversacion_registrar_saliente', () => {
  it('sin entrante del teléfono no guarda nada', async () => {
    expect(await saliente('573009999999', 'wamid.nadie')).toBe(false)
    const r = await db.query(`select 1 from public.wa_conversacion where wa_message_id = 'wamid.nadie'`)
    expect(r.rows).toHaveLength(0)
  })

  it('un entrante de hace más de 24 h no abre la conversación', async () => {
    await entrante(WS, 'wamid.viejo', '25 hours', '573005550000')
    expect(await saliente('573005550000', 'wamid.tarde')).toBe(false)
  })

  it('con entrante reciente guarda el texto completo, las opciones y el workspace del ÚLTIMO entrante', async () => {
    await entrante(WS, 'wamid.e1', '10 minutes')
    await entrante(WS_2, 'wamid.e2', '1 minute')
    const largo = 'x'.repeat(3000)
    // El teléfono con «+» y espacios se normaliza a dígitos.
    expect(await saliente('+57 300 111 2233', 'wamid.s1', largo)).toBe(true)
    const r = await db.query<{ workspace_id: string; phone: string; texto: string; opciones: unknown; formato: string; clase: string }>(
      `select workspace_id, phone, texto, opciones, formato, clase from public.wa_conversacion where wa_message_id = 'wamid.s1'`,
    )
    expect(r.rows[0]).toMatchObject({ workspace_id: WS_2, phone: TEL, formato: 'botones', clase: 'bot', opciones: [{ id: 'a', titulo: 'Sí' }] })
    expect(r.rows[0].texto.length).toBe(3000)
  })

  it('el mismo wamid dos veces deja una fila', async () => {
    expect(await saliente(TEL, 'wamid.s2')).toBe(true)
    expect(await saliente(TEL, 'wamid.s2')).toBe(true)
    const r = await db.query(`select 1 from public.wa_conversacion where wa_message_id = 'wamid.s2'`)
    expect(r.rows).toHaveLength(1)
  })

  it('un envío sin wamid igual queda (varios nulos no chocan)', async () => {
    expect(await saliente(TEL, null, 'a')).toBe(true)
    expect(await saliente(TEL, null, 'b')).toBe(true)
  })
})

describe('restricciones', () => {
  it('un entrante duplicado choca con el índice único (el código lo trata como reintento de Meta)', async () => {
    await expect(entrante(WS, 'wamid.e1')).rejects.toThrow(/duplicate key/)
  })
  it('clase y dirección van juntas', async () => {
    await expect(db.query(
      `insert into public.wa_conversacion (workspace_id, phone, direccion, clase) values ($1, $2, 'saliente', 'escrito')`, [WS, TEL],
    )).rejects.toThrow(/wa_conversacion_clase/)
    await expect(db.query(
      `insert into public.wa_conversacion (workspace_id, phone, direccion, clase) values ($1, $2, 'entrante', 'bot')`, [WS, TEL],
    )).rejects.toThrow(/wa_conversacion_clase/)
  })
})

describe('server-only', () => {
  it('anon y authenticated no tienen privilegios en la tabla ni en la función, y el RLS está prendido', async () => {
    const r = await db.query<{ rol: string; tabla: boolean; fn: boolean }>(`
      select rol,
        has_table_privilege(rol, 'public.wa_conversacion', 'select') as tabla,
        has_function_privilege(rol, 'public.wa_conversacion_registrar_saliente(text,text,text,text,jsonb,text,text)', 'execute') as fn
      from unnest(array['anon', 'authenticated']) as rol`)
    expect(r.rows).toEqual([{ rol: 'anon', tabla: false, fn: false }, { rol: 'authenticated', tabla: false, fn: false }])
    const rls = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'wa_conversacion'`)
    expect(rls.rows[0].relrowsecurity).toBe(true)
    const sr = await db.query<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.wa_conversacion_registrar_saliente(text,text,text,text,jsonb,text,text)', 'execute') as ok`)
    expect(sr.rows[0].ok).toBe(true)
  })
})
