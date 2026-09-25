import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La bandeja de solicitudes por WhatsApp, ejecutada de verdad en Postgres en memoria (PGlite).
 *
 * El agrupamiento vive en SQL (`wa_bandeja_registrar_mensaje`) porque Meta manda cada mensaje
 * reenviado en un webhook aparte: la decisión de "¿hay entrega abierta?" tiene que tomarse en
 * la misma transacción que escribe. Probar una copia de esa lógica en TypeScript no probaría lo
 * que se aplica, así que aquí se cargan LOS ARCHIVOS de migración tal cual.
 *
 * Casos del encargo: un mensaje suelto, una ráfaga, un duplicado de Meta y una palabra de
 * cierre. El de "remitente con la ruta apagada sigue en gastos" es del código del webhook, no de
 * la base: está en `supabase/functions/_shared/wa-bandeja-reglas.test.ts`.
 *
 * Límite: una sola conexión, así que el candado por remitente (dos webhooks a la vez) no se
 * ejerce en concurrencia; lo que sí se prueba es el índice único que lo respalda.
 */

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const BANDEJA = '20260925200000_bandeja_wa_solicitudes.sql'
const CRON = '20260925200100_cron_bandeja_wa_cierre.sql'

const WS = '00000000-0000-4000-8000-0000000000a1'
const WS_LENTO = '00000000-0000-4000-8000-0000000000a2'
const STAFF = '00000000-0000-4000-8000-0000000000c1'
const TEL = '573001112233'
const TEL_2 = '573004445566'

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, config_extra jsonb default '{}'::jsonb, modules jsonb default '{}'::jsonb);
  create table public.staff (id uuid primary key, workspace_id uuid, profile_id uuid);
  create table public.wa_collaborators (id uuid primary key, workspace_id uuid);
  create function public.current_user_workspace_id() returns uuid language sql stable
    as $$ select nullif(current_setting('app.ws', true), '')::uuid $$;

  create schema vault;
  create table vault.secrets (name text primary key, secret text not null);
  create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
  insert into vault.secrets values ('SUPABASE_FUNCTIONS_URL', 'https://x.functions'), ('WA_ALERTS_SECRET', 's3cr3t');

  create schema cron;
  create table cron.job (jobid bigserial primary key, jobname text unique, schedule text not null, command text not null);
  create function cron.schedule(job_name text, schedule text, command text) returns bigint
    language sql as $$
      insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid $$;
  create function cron.unschedule(job_name text) returns boolean
    language sql as $$ delete from cron.job where jobname = job_name returning true $$;

  create schema net;
  create table net.llamadas (url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint
    language sql as $$ insert into net.llamadas values (url, body, headers) returning 1::bigint $$;

  insert into public.workspaces (id) values ('${WS}');
  insert into public.workspaces (id, config_extra) values ('${WS_LENTO}', '{"bandeja_solicitudes": {"ventana_minutos": 30}}');
  insert into public.staff (id, workspace_id) values ('${STAFF}', '${WS}');
`

let db: PGlite

type Fila = { accion: string; entrega: string | null; mensajes: number | null }

async function registrar(p: {
  wamid: string
  texto?: string | null
  tipo?: string
  reenviado?: boolean
  cierre?: boolean
  tel?: string
  ws?: string
}): Promise<Fila> {
  const r = await db.query<Fila>(
    `select * from public.wa_bandeja_registrar_mensaje(
       $1, $2, $3, null, $4, $5, $6, $7, $8, false, null, null, now(), $9, 24)`,
    [
      p.ws ?? WS, p.tel ?? TEL, STAFF, p.wamid, p.tipo ?? 'text',
      p.texto === undefined ? `texto ${p.wamid}` : p.texto,
      p.texto === null ? null : 'texto', p.reenviado ?? true, p.cierre ?? false,
    ],
  )
  return r.rows[0]
}

async function uno<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0]
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(BANDEJA))
  await db.exec(leer(CRON))
})

afterAll(async () => {
  await db.close()
})

describe('un mensaje suelto', () => {
  it('abre una entrega con un mensaje y guarda el texto completo', async () => {
    const largo = 'Hola, somos 4 adultos y 2 niños (7 y 9 años). '.repeat(20)
    const r = await registrar({ wamid: 'w.suelto', texto: largo, tel: '573009990000' })
    expect(r.accion).toBe('abrir')
    expect(r.mensajes).toBe(1)
    const m = await uno<{ cuerpo: string; reenviado: boolean; entrega_id: string; papel: string }>(
      `select cuerpo, reenviado, entrega_id, papel from public.wa_bandeja_mensajes where wa_message_id = 'w.suelto'`,
    )
    expect(m.cuerpo).toBe(largo)
    expect(m.cuerpo.length).toBeGreaterThan(100)
    expect(m.reenviado).toBe(true)
    expect(m.entrega_id).toBe(r.entrega)
    expect(m.papel).toBe('contenido')
    const e = await uno<{ estado: string; n_mensajes: number; remitente_staff_id: string }>(
      `select estado, n_mensajes, remitente_staff_id from public.wa_bandeja_entregas where id = $1`, [r.entrega],
    )
    expect(e).toEqual({ estado: 'abierta', n_mensajes: 1, remitente_staff_id: STAFF })
  })
})

describe('una ráfaga de reenvíos', () => {
  let entrega: string | null = null

  it('los mensajes seguidos del mismo remitente son UNA entrega', async () => {
    const a = await registrar({ wamid: 'w.r1' })
    const b = await registrar({ wamid: 'w.r2' })
    const c = await registrar({ wamid: 'w.r3', tipo: 'image', texto: null })
    expect([a.accion, b.accion, c.accion]).toEqual(['abrir', 'agregar', 'agregar'])
    expect(new Set([a.entrega, b.entrega, c.entrega]).size).toBe(1)
    expect(c.mensajes).toBe(3)
    entrega = a.entrega
    const n = await uno<{ n: number }>(`select count(*)::int as n from public.wa_bandeja_mensajes where entrega_id = $1`, [entrega])
    expect(n.n).toBe(3)
  })

  it('otro remitente no se mezcla en esa entrega', async () => {
    const r = await registrar({ wamid: 'w.otro', tel: TEL_2 })
    expect(r.accion).toBe('abrir')
    expect(r.entrega).not.toBe(entrega)
  })

  it('un duplicado de Meta no se guarda ni se cuenta dos veces', async () => {
    const r = await registrar({ wamid: 'w.r2' })
    expect(r.accion).toBe('duplicado')
    expect(r.entrega).toBe(entrega)
    const e = await uno<{ n_mensajes: number }>(`select n_mensajes from public.wa_bandeja_entregas where id = $1`, [entrega])
    expect(e.n_mensajes).toBe(3)
    const n = await uno<{ n: number }>(`select count(*)::int as n from public.wa_bandeja_mensajes where wa_message_id = 'w.r2'`)
    expect(n.n).toBe(1)
  })

  it('la base impide dos entregas abiertas para el mismo remitente', async () => {
    await expect(db.query(
      `insert into public.wa_bandeja_entregas (workspace_id, remitente_phone) values ($1, $2)`, [WS, TEL],
    )).rejects.toThrow(/uq_wa_bandeja_entrega_abierta/)
  })

  it('la palabra de cierre cierra la entrega y devuelve cuántos mensajes tiene', async () => {
    const r = await registrar({ wamid: 'w.listo', texto: 'listo', reenviado: false, cierre: true })
    expect(r).toEqual({ accion: 'cerrar', entrega, mensajes: 3 })
    const e = await uno<{ estado: string; motivo_cierre: string; n_mensajes: number }>(
      `select estado, motivo_cierre, n_mensajes from public.wa_bandeja_entregas where id = $1`, [entrega],
    )
    expect(e).toEqual({ estado: 'esperando_cliente', motivo_cierre: 'palabra_cierre', n_mensajes: 3 })
    const m = await uno<{ papel: string; entrega_id: string }>(
      `select papel, entrega_id from public.wa_bandeja_mensajes where wa_message_id = 'w.listo'`,
    )
    expect(m).toEqual({ papel: 'cierre', entrega_id: entrega })
  })

  it('la respuesta a «¿de qué cliente es?» se pega a esa entrega y no abre otra', async () => {
    await db.query(`update public.wa_bandeja_entregas set pregunta_enviada_at = now() where id = $1`, [entrega])
    const r = await registrar({ wamid: 'w.cliente', texto: 'Familia Restrepo', reenviado: false })
    expect(r).toEqual({ accion: 'respuesta_cliente', entrega, mensajes: 3 })
    const e = await uno<{ estado: string; cliente_texto: string }>(
      `select estado, cliente_texto from public.wa_bandeja_entregas where id = $1`, [entrega],
    )
    expect(e).toEqual({ estado: 'con_cliente', cliente_texto: 'Familia Restrepo' })
  })

  it('lo siguiente ya abre una entrega nueva', async () => {
    const r = await registrar({ wamid: 'w.nueva' })
    expect(r.accion).toBe('abrir')
    expect(r.entrega).not.toBe(entrega)
  })
})

describe('palabra de cierre sin nada abierto', () => {
  it('se guarda suelta y no inventa una entrega', async () => {
    const tel = '573007770000'
    const r = await registrar({ wamid: 'w.listo.solo', texto: 'listo', reenviado: false, cierre: true, tel })
    expect(r).toEqual({ accion: 'cierre_sin_abierta', entrega: null, mensajes: 0 })
    const n = await uno<{ n: number }>(`select count(*)::int as n from public.wa_bandeja_entregas where remitente_phone = $1`, [tel])
    expect(n.n).toBe(0)
  })

  it('un «listo» REENVIADO es contenido, no cierre', async () => {
    const tel = '573007770001'
    const r = await registrar({ wamid: 'w.listo.reenviado', texto: 'listo', reenviado: true, cierre: true, tel })
    expect(r.accion).toBe('abrir')
  })
})

describe('un reenvío mientras se espera la respuesta', () => {
  it('no se toma como respuesta: abre una entrega nueva', async () => {
    const tel = '573006660000'
    const a = await registrar({ wamid: 'w.e1', tel })
    await registrar({ wamid: 'w.e.fin', texto: 'listo', reenviado: false, cierre: true, tel })
    await db.query(`update public.wa_bandeja_entregas set pregunta_enviada_at = now() where id = $1`, [a.entrega])
    const b = await registrar({ wamid: 'w.e2', tel, reenviado: true })
    expect(b.accion).toBe('abrir')
    const e = await uno<{ estado: string }>(`select estado from public.wa_bandeja_entregas where id = $1`, [a.entrega])
    expect(e.estado).toBe('esperando_cliente')
  })
})

describe('cierre por inactividad', () => {
  it('cierra solo lo que lleva la ventana quieto, y una sola vez', async () => {
    const quieta = await registrar({ wamid: 'w.q1', tel: '573005550001' })
    const viva = await registrar({ wamid: 'w.v1', tel: '573005550002' })
    const lenta = await registrar({ wamid: 'w.l1', tel: '573005550003', ws: WS_LENTO })
    await db.query(
      `update public.wa_bandeja_entregas set ultimo_mensaje_at = now() - interval '6 minutes' where id in ($1, $2)`,
      [quieta.entrega, lenta.entrega],
    )

    const cerradas = (await db.query<{ entrega: string; telefono: string; mensajes: number }>(
      `select * from public.wa_bandeja_cerrar_vencidas()`,
    )).rows
    const ids = cerradas.map((c) => c.entrega)
    expect(ids).toContain(quieta.entrega)
    expect(ids).not.toContain(viva.entrega)
    // El workspace con ventana de 30 minutos no se cierra a los 6.
    expect(ids).not.toContain(lenta.entrega)
    expect(cerradas.find((c) => c.entrega === quieta.entrega)).toMatchObject({ telefono: '573005550001', mensajes: 1 })

    const e = await uno<{ estado: string; motivo_cierre: string }>(
      `select estado, motivo_cierre from public.wa_bandeja_entregas where id = $1`, [quieta.entrega],
    )
    expect(e).toEqual({ estado: 'esperando_cliente', motivo_cierre: 'inactividad' })

    const otra = (await db.query(`select * from public.wa_bandeja_cerrar_vencidas()`)).rows
    expect(otra.map((c) => (c as { entrega: string }).entrega)).not.toContain(quieta.entrega)
  })

  it('una ventana mal escrita en config_extra cae a 5 minutos en vez de romper el cierre', async () => {
    const r = await uno<{ v: number }>(`select public.wa_bandeja_ventana_minutos('{"bandeja_solicitudes": {"ventana_minutos": "diez"}}') as v`)
    expect(r.v).toBe(5)
    const r2 = await uno<{ v: number }>(`select public.wa_bandeja_ventana_minutos('{"bandeja_solicitudes": {"ventana_minutos": 999}}') as v`)
    expect(r2.v).toBe(5)
    const r3 = await uno<{ v: number }>(`select public.wa_bandeja_ventana_minutos(null) as v`)
    expect(r3.v).toBe(5)
  })
})

describe('el cron', () => {
  it('queda programado cada minuto contra wa-alerts, con el secreto del vault', async () => {
    const j = await uno<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'wa-bandeja-cierre'`)
    expect(j.schedule).toBe('* * * * *')
    expect(j.command).toMatch(/bandeja_cierre/)
    expect(j.command).not.toMatch(/s3cr3t/)
  })

  it('no llama a nadie si no hay entregas abiertas', async () => {
    const j = await uno<{ command: string }>(`select command from cron.job where jobname = 'wa-bandeja-cierre'`)
    await db.exec(`begin; update public.wa_bandeja_entregas set estado = 'esperando_cliente', cerrada_at = now(), motivo_cierre = 'inactividad' where estado = 'abierta';`)
    await db.exec(`delete from net.llamadas; ${j.command};`)
    const sin = await uno<{ n: number }>(`select count(*)::int as n from net.llamadas`)
    await db.exec('rollback;')
    expect(sin.n).toBe(0)

    await db.exec(`delete from net.llamadas; ${j.command};`)
    const con = await uno<{ url: string; auth: string }>(`select url, headers->>'Authorization' as auth from net.llamadas`)
    expect(con).toEqual({ url: 'https://x.functions/wa-alerts', auth: 'Bearer s3cr3t' })
  })
})

describe('permisos', () => {
  it('ni anon ni authenticated ejecutan las funciones; service_role sí', async () => {
    const r = (await db.query<{ proname: string; anon: boolean; auth: boolean; svc: boolean }>(`
      select proname,
             has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('service_role', p.oid, 'execute') as svc
        from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'wa_bandeja_%'
       order by proname`)).rows
    expect(r.map((x) => x.proname)).toEqual([
      'wa_bandeja_cerrar_vencidas', 'wa_bandeja_registrar_mensaje', 'wa_bandeja_ventana_minutos',
    ])
    for (const f of r) expect(f, f.proname).toMatchObject({ anon: false, auth: false, svc: true })
  })

  it('authenticated lee solo su workspace y no escribe; anon no lee', async () => {
    expect((await uno<{ v: boolean }>(`select has_table_privilege('anon', 'public.wa_bandeja_mensajes', 'select') as v`)).v).toBe(false)
    expect((await uno<{ v: boolean }>(`select has_table_privilege('authenticated', 'public.wa_bandeja_mensajes', 'insert') as v`)).v).toBe(false)
    expect((await uno<{ v: boolean }>(`select has_table_privilege('authenticated', 'public.wa_bandeja_entregas', 'update') as v`)).v).toBe(false)

    await db.exec(`set app.ws = '${WS_LENTO}'; set role authenticated;`)
    const propias = await uno<{ n: number }>(`select count(*)::int as n from public.wa_bandeja_mensajes`)
    const ajenas = await uno<{ n: number }>(`select count(*)::int as n from public.wa_bandeja_mensajes where workspace_id = '${WS}'`)
    await db.exec(`reset role; reset app.ws;`)
    expect(propias.n).toBe(1)
    expect(ajenas.n).toBe(0)
  })
})
