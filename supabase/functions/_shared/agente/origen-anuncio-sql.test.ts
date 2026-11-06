import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * El origen del anuncio de Meta (20261105231500_origen_anuncio_meta.sql) con EL ARCHIVO de migración en Postgres en
 * memoria (PGlite), encima de la guarda de misma empresa (20261105170000): primer toque único por alcance e inmutable,
 * idempotencia por mensaje, guarda MK002, empresa por `origen_canales`, origen al contacto y al negocio sin pisar lo
 * declarado, y Messenger en `chatwoot_conversacion.canal`.
 */

const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')
const WS_A = '00000000-0000-4000-8000-0000000000a1'
const WS_B = '00000000-0000-4000-8000-0000000000b1'
const CON_B = '00000000-0000-4000-8000-00000000c0b1'
const PNID = '1111111111'
const REFERRAL = { source_url: 'https://fb.me/abc', source_id: '120000000001', source_type: 'ad', headline: 'Cerraduras', ctwa_clid: 'ARAkLk' }

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table public.workspaces (id uuid primary key);
    insert into public.workspaces values ('${WS_A}'), ('${WS_B}');
    create table public.contactos (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
      nombre text, telefono text, origen_tipo text, origen_ref text, campana_origen text, origen_capturado_at timestamptz,
      created_at timestamptz not null default now());
    alter table public.contactos add constraint contactos_origen_tipo_chk check (origen_tipo is null or origen_tipo in ('inbound_formulario', 'evento')) not valid;
    insert into public.contactos (id, workspace_id, telefono) values ('${CON_B}', '${WS_B}', '3009999999');
    create table public.negocios (id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
      contacto_id uuid references public.contactos(id), origen text);
    create table public.gastos (id serial primary key, workspace_id uuid not null, negocio_id uuid references public.negocios(id));
    create table public.cobros (id serial primary key, workspace_id uuid not null, negocio_id uuid references public.negocios(id));
    create table public.activity_log (id serial primary key, workspace_id uuid not null, entidad_tipo text not null, entidad_id uuid not null);
    create table public.contacto_perfil_hechos (id serial primary key, workspace_id uuid not null, contacto_id uuid not null references public.contactos(id));
    create table public.chatwoot_conversacion (id serial primary key, canal text not null,
      constraint chatwoot_conversacion_canal check (canal in ('instagram', 'tiktok', 'whatsapp', 'otro')));
  `)
  await db.exec(leer('20261105170000_guarda_misma_empresa.sql'))
  await db.exec(leer('20261105231500_origen_anuncio_meta.sql'))
}, 30_000)
afterAll(async () => { await db.close() })

async function codigoDe(sql: string, p: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, p)
    return null
  } catch (e) {
    return (e as { code?: string }).code ?? 'sin-codigo'
  }
}

type Toque = { id: string; workspace_id: string | null; es_primero: boolean; contacto_id: string | null; id_externo: string }

async function registrar(p: { canal?: string; alcance?: string; externo: string; ws?: string | null; mensaje?: string | null; adId?: string }): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `select public.registrar_toque_origen(p_canal => $1, p_alcance => $2, p_id_externo => $3, p_fuente => 'wa-webhook', p_crudo => $4::jsonb,
       p_workspace_id => $5, p_mensaje_id => $6, p_source_id => $7, p_ad_id => $8, p_source_url => $9, p_ctwa_clid => $10) as id`,
    [p.canal ?? 'whatsapp', p.alcance ?? PNID, p.externo, JSON.stringify(REFERRAL), p.ws ?? null, p.mensaje ?? null, REFERRAL.source_id,
      p.adId ?? null, REFERRAL.source_url, REFERRAL.ctwa_clid],
  )
  return rows[0].id
}

const toque = async (id: string) => (await db.query<Toque>('select * from public.origen_toques where id = $1', [id])).rows[0]

describe('origen_toques: primer toque', () => {
  it('el primero por (canal, alcance, persona) es_primero; los siguientes son filas aparte', async () => {
    const a = await registrar({ externo: '573001110001', ws: WS_A, mensaje: 'wamid.1' })
    const b = await registrar({ externo: '573001110001', ws: WS_A, mensaje: 'wamid.2' })
    expect((await toque(a)).es_primero).toBe(true)
    expect((await toque(b)).es_primero).toBe(false)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int n from public.origen_toques where id_externo = '573001110001' and es_primero`)
    expect(rows[0].n).toBe(1)
  })

  it('el mismo teléfono en otro alcance (otro número) tiene su propio primero', async () => {
    const a = await registrar({ externo: '573001110002', alcance: '2222', mensaje: 'wamid.x1' })
    const b = await registrar({ externo: '573001110002', alcance: '3333', mensaje: 'wamid.x2' })
    expect((await toque(a)).es_primero).toBe(true)
    expect((await toque(b)).es_primero).toBe(true)
  })

  it('el índice único rechaza un segundo primero escrito a mano', async () => {
    await registrar({ externo: '573001110003', mensaje: 'wamid.u1' })
    expect(await codigoDe(
      `insert into public.origen_toques (canal, alcance, id_externo, es_primero, fuente, crudo) values ('whatsapp', $1, '573001110003', true, 'wa-webhook', '{}')`,
      [PNID],
    )).toBe('23505')
  })

  it('el reintento del mismo mensaje no duplica: devuelve el mismo id', async () => {
    const a = await registrar({ externo: '573001110004', mensaje: 'wamid.r' })
    const b = await registrar({ externo: '573001110004', mensaje: 'wamid.r' })
    expect(b).toBe(a)
  })

  it('normaliza el celular de 10 dígitos al wa_id', async () => {
    const a = await registrar({ externo: '300 111 0005', mensaje: 'wamid.n' })
    expect((await toque(a)).id_externo).toBe('573001110005')
  })

  it('el BSUID se guarda tal cual', async () => {
    const a = await registrar({ externo: 'CO.123ABC', mensaje: 'wamid.bsuid' })
    expect((await toque(a)).id_externo).toBe('CO.123ABC')
  })
})

describe('origen_toques: inmutable', () => {
  it('no deja cambiar los campos de origen', async () => {
    const a = await registrar({ externo: '573001110010', mensaje: 'wamid.i1' })
    expect(await codigoDe(`update public.origen_toques set ctwa_clid = 'otro' where id = $1`, [a])).toBe('P0001')
    expect(await codigoDe(`update public.origen_toques set crudo = '{"x":1}' where id = $1`, [a])).toBe('P0001')
    expect(await codigoDe(`update public.origen_toques set es_primero = false where id = $1`, [a])).toBe('P0001')
  })

  it('deja asignar la empresa una sola vez, y no cambiarla después', async () => {
    const a = await registrar({ externo: '573001110011', alcance: '4444', mensaje: 'wamid.i2' })
    expect((await toque(a)).workspace_id).toBeNull()
    expect(await codigoDe(`update public.origen_toques set workspace_id = $1 where id = $2`, [WS_A, a])).toBeNull()
    expect(await codigoDe(`update public.origen_toques set workspace_id = $1 where id = $2`, [WS_B, a])).toBe('P0001')
  })

  it('se puede borrar (supresión de datos)', async () => {
    const a = await registrar({ externo: '573001110012', mensaje: 'wamid.i3' })
    expect(await codigoDe(`delete from public.origen_toques where id = $1`, [a])).toBeNull()
  })
})

describe('origen_toques: guarda de misma empresa', () => {
  it('rechaza con MK002 un contacto de otra empresa', async () => {
    const a = await registrar({ externo: '573001110020', ws: WS_A, mensaje: 'wamid.g1' })
    expect(await codigoDe(`update public.origen_toques set contacto_id = $1 where id = $2`, [CON_B, a])).toBe('MK002')
  })

  it('rechaza un toque sin empresa que apunte a un contacto', async () => {
    const a = await registrar({ externo: '573001110021', alcance: '5555', mensaje: 'wamid.g2' })
    expect(await codigoDe(`update public.origen_toques set contacto_id = $1 where id = $2`, [CON_B, a])).toBe('MK002')
  })

  it('no vincula el contacto de otra empresa con el mismo teléfono', async () => {
    const a = await registrar({ externo: '3009999999', ws: WS_A, mensaje: 'wamid.g3' })
    expect((await toque(a)).contacto_id).toBeNull()
  })
})

describe('empresa por origen_canales', () => {
  it('sin empresa explícita, la toma del alcance registrado', async () => {
    await db.query(`insert into public.origen_canales (workspace_id, canal, alcance) values ($1, 'messenger', 'page-1')`, [WS_A])
    const a = await registrar({ canal: 'messenger', alcance: 'page-1', externo: 'psid-1', mensaje: 'mid.1' })
    expect((await toque(a)).workspace_id).toBe(WS_A)
  })
})

describe('origen al contacto y al negocio', () => {
  it('el contacto creado después del toque toma el origen y queda vinculado', async () => {
    const a = await registrar({ externo: '573001110030', ws: WS_A, mensaje: 'wamid.c1', adId: 'AD-1' })
    const { rows } = await db.query<{ id: string; origen_tipo: string; campana_origen: string; origen_ref: string }>(
      `insert into public.contactos (workspace_id, telefono) values ($1, '+57 300 111 0030') returning id`, [WS_A])
    const c = (await db.query<{ origen_tipo: string; campana_origen: string; origen_ref: string; origen_capturado_at: string | null }>(
      'select * from public.contactos where id = $1', [rows[0].id])).rows[0]
    expect(c.origen_tipo).toBe('anuncio_meta')
    expect(c.campana_origen).toBe('AD-1')
    expect(c.origen_ref).toContain('https://fb.me/abc')
    expect(c.origen_capturado_at).not.toBeNull()
    expect((await toque(a)).contacto_id).toBe(rows[0].id)
  })

  it('el toque de un contacto que ya existe lo vincula y le llena el origen', async () => {
    const { rows } = await db.query<{ id: string }>(`insert into public.contactos (workspace_id, telefono) values ($1, '3001110031') returning id`, [WS_A])
    const a = await registrar({ externo: '573001110031', ws: WS_A, mensaje: 'wamid.c2' })
    expect((await toque(a)).contacto_id).toBe(rows[0].id)
    const c = (await db.query<{ origen_tipo: string }>('select origen_tipo from public.contactos where id = $1', [rows[0].id])).rows[0]
    expect(c.origen_tipo).toBe('anuncio_meta')
  })

  it('no pisa el origen que alguien declaró', async () => {
    await registrar({ externo: '573001110032', ws: WS_A, mensaje: 'wamid.c3' })
    const { rows } = await db.query<{ id: string }>(
      `insert into public.contactos (workspace_id, telefono, origen_tipo) values ($1, '3001110032', 'evento') returning id`, [WS_A])
    const c = (await db.query<{ origen_tipo: string }>('select origen_tipo from public.contactos where id = $1', [rows[0].id])).rows[0]
    expect(c.origen_tipo).toBe('evento')
  })

  it('con dos contactos del mismo teléfono no adivina', async () => {
    await db.query(`insert into public.contactos (workspace_id, telefono, origen_tipo) values ($1, '3001110033', 'evento'), ($1, '3001110033', 'evento')`, [WS_A])
    const a = await registrar({ externo: '573001110033', ws: WS_A, mensaje: 'wamid.c4' })
    expect((await toque(a)).contacto_id).toBeNull()
  })

  it('el negocio de ese contacto nace con origen meta; uno declarado se respeta', async () => {
    await registrar({ externo: '573001110034', ws: WS_A, mensaje: 'wamid.c5' })
    const { rows } = await db.query<{ id: string }>(`insert into public.contactos (workspace_id, telefono) values ($1, '3001110034') returning id`, [WS_A])
    const n1 = await db.query<{ origen: string }>(`insert into public.negocios (workspace_id, contacto_id) values ($1, $2) returning origen`, [WS_A, rows[0].id])
    expect(n1.rows[0].origen).toBe('meta')
    const n2 = await db.query<{ origen: string }>(`insert into public.negocios (workspace_id, contacto_id, origen) values ($1, $2, 'referido') returning origen`, [WS_A, rows[0].id])
    expect(n2.rows[0].origen).toBe('referido')
  })

  it('un contacto sin toque queda como estaba', async () => {
    const { rows } = await db.query<{ origen_tipo: string | null }>(`insert into public.contactos (workspace_id, telefono) values ($1, '3001110099') returning origen_tipo`, [WS_A])
    expect(rows[0].origen_tipo).toBeNull()
  })
})

describe('chatwoot_conversacion.canal', () => {
  it('acepta messenger y sigue rechazando lo desconocido', async () => {
    expect(await codigoDe(`insert into public.chatwoot_conversacion (canal) values ('messenger')`)).toBeNull()
    expect(await codigoDe(`insert into public.chatwoot_conversacion (canal) values ('telegram')`)).toBe('23514')
  })
})
