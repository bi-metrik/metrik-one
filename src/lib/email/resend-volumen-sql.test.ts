/**
 * `20261026221500_resend_suprimido_avisos_equipo_volumen.sql` corrida de verdad en Postgres en
 * memoria (PGlite).
 *
 * Lo que la BASE garantiza sola:
 *   · `avisos_cliente.estado` acepta `suprimido` y sigue rechazando lo que no conoce;
 *   · `avisos_equipo` se lee por workspace y no se escribe con sesión;
 *   · `resend_contar_enviado` cuenta una vez por svix-id, devuelve cada umbral UNA vez por
 *     período, calcula el período con el día de corte en hora de Bogotá y purga los ids viejos;
 *   · `resend_volumen_desmarcar` deja el umbral listo para reintentar;
 *   · nada de eso lo ejecuta `anon` ni `authenticated`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261026221500_resend_suprimido_avisos_equipo_volumen.sql'),
  'utf8',
)

const WS = '00000000-0000-4000-8000-00000000e001'
const OTRO_WS = '00000000-0000-4000-8000-00000000e002'
const PERFIL = '00000000-0000-4000-8000-00000000e003'
const NEGOCIO = '00000000-0000-4000-8000-00000000e004'

// El CHECK como está HOY en producción (leído el 2026-10-26).
const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles   (id uuid primary key, workspace_id uuid);
  create table public.negocios   (id uuid primary key, workspace_id uuid not null);
  create function public.current_user_workspace_id() returns uuid language sql stable security definer as $$
    select workspace_id from public.profiles where id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table public.avisos_cliente (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, negocio_id uuid not null,
    canal text not null check (canal in ('email', 'whatsapp')),
    estado text not null,
    proveedor_id text, motivo text,
    created_at timestamptz not null default now()
  );
  alter table public.avisos_cliente add constraint avisos_cliente_estado_check
    check (estado in ('enviado', 'disparado', 'omitido', 'fallido', 'rebotado', 'diferido'));

  insert into public.workspaces values ('${WS}', 'uno'), ('${OTRO_WS}', 'otro');
  insert into public.profiles values ('${PERFIL}', '${WS}');
  insert into public.negocios values ('${NEGOCIO}', '${WS}');
`

let db: PGlite

type Conteo = {
  contado: boolean
  periodo: string | null
  periodo_fin: string | null
  enviados: number | null
  incluidos: number | null
  umbral_cruzado: number | null
}

async function contar(id: string, ahora = '2026-10-26T15:00:00Z'): Promise<Conteo> {
  const r = await db.query<Conteo>(
    `select contado, periodo::text, periodo_fin::text, enviados, incluidos, umbral_cruzado
       from public.resend_contar_enviado($1, $2::timestamptz)`,
    [id, ahora],
  )
  return r.rows[0]
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(MIGRACION)
})

afterAll(async () => {
  await db.close()
})

describe('avisos_cliente.estado', () => {
  it('acepta suprimido y sigue rechazando lo que no conoce', async () => {
    await db.query(`insert into public.avisos_cliente (workspace_id, negocio_id, canal, estado) values ($1, $2, 'email', 'suprimido')`, [WS, NEGOCIO])
    await expect(
      db.query(`insert into public.avisos_cliente (workspace_id, negocio_id, canal, estado) values ($1, $2, 'email', 'perdido')`, [WS, NEGOCIO]),
    ).rejects.toThrow(/avisos_cliente_estado_check/)
  })

  it('los estados de siempre siguen entrando', async () => {
    for (const e of ['enviado', 'disparado', 'omitido', 'fallido', 'rebotado', 'diferido']) {
      await db.query(`insert into public.avisos_cliente (workspace_id, negocio_id, canal, estado) values ($1, $2, 'email', $3)`, [WS, NEGOCIO, e])
    }
  })
})

describe('avisos_equipo', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into public.avisos_equipo (workspace_id, negocio_id, origen, estado, destino, titulo, proveedor_id)
      values ('${WS}', '${NEGOCIO}', 'notificar-etapa', 'enviado', 'a@x.co', 'Llegó a Entrega', 'em_1'),
             ('${OTRO_WS}', null, 'alertas-plazo', 'enviado', 'b@x.co', 'Plazo', 'em_2'),
             (null, null, 'resend-volumen', 'enviado', 'm@x.co', 'Resend', 'em_3');
    `)
  })

  it('el webhook la actualiza con la misma guarda: solo una fila enviado pasa a suprimido', async () => {
    const r1 = await db.query(`update public.avisos_equipo set estado = 'suprimido' where proveedor_id = 'em_1' and canal = 'email' and estado = 'enviado' returning id`)
    const r2 = await db.query(`update public.avisos_equipo set estado = 'suprimido' where proveedor_id = 'em_1' and canal = 'email' and estado = 'enviado' returning id`)
    expect(r1.rows).toHaveLength(1)
    expect(r2.rows).toHaveLength(0)
    await expect(db.query(`update public.avisos_equipo set estado = 'diferido' where proveedor_id = 'em_2'`)).rejects.toThrow()
  })

  it('con sesión se lee solo lo del propio workspace y no se escribe', async () => {
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${PERFIL}', false);`)
    try {
      const r = await db.query<{ origen: string }>('select origen from public.avisos_equipo')
      expect(r.rows.map((f) => f.origen)).toEqual(['notificar-etapa'])
      await expect(
        db.query(`insert into public.avisos_equipo (workspace_id, origen, estado) values ('${WS}', 'x', 'enviado')`),
      ).rejects.toThrow(/permission denied/)
      await expect(db.query(`update public.avisos_equipo set titulo = 'x'`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })

  it('anon no la lee', async () => {
    await db.exec('set role anon')
    try {
      await expect(db.query('select 1 from public.avisos_equipo')).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('resend_contar_enviado', () => {
  beforeEach(async () => {
    await db.exec(`
      delete from public.resend_eventos_contados;
      delete from public.resend_volumen_mensual;
      update public.resend_volumen_config set dia_corte = 1, umbrales = '{20000,40000,45000}', incluidos = 50000;
    `)
  })

  it('la configuración nace con día 1, los tres umbrales y 50.000 incluidos', async () => {
    const r = await db.query<{ dia_corte: number; umbrales: number[]; incluidos: number }>('select dia_corte, umbrales, incluidos from public.resend_volumen_config')
    expect(r.rows).toEqual([{ dia_corte: 1, umbrales: [20000, 40000, 45000], incluidos: 50000 }])
  })

  it('cuenta una vez por svix-id', async () => {
    expect(await contar('msg_1')).toMatchObject({ contado: true, periodo: '2026-10-01', periodo_fin: '2026-11-01', enviados: 1, incluidos: 50000, umbral_cruzado: null })
    expect(await contar('msg_1')).toMatchObject({ contado: false, enviados: null })
    expect(await contar('msg_2')).toMatchObject({ contado: true, enviados: 2 })
  })

  it('cada umbral se devuelve UNA vez por período, y el siguiente período empieza de cero', async () => {
    await db.exec(`update public.resend_volumen_config set umbrales = '{2,4,5}'`)
    const cruces: (number | null)[] = []
    for (let i = 1; i <= 7; i++) cruces.push((await contar(`m${i}`)).umbral_cruzado)
    expect(cruces).toEqual([null, 2, null, 4, 5, null, null])
    const nov = await contar('nov_1', '2026-11-03T15:00:00Z')
    expect(nov).toMatchObject({ periodo: '2026-11-01', enviados: 1 })
    expect((await db.query<{ umbrales_avisados: number[] }>(`select umbrales_avisados from public.resend_volumen_mensual where periodo = '2026-10-01'`)).rows[0].umbrales_avisados).toEqual([2, 4, 5])
  })

  it('si se cruzan varios de golpe se avisa el más alto y se dan todos por avisados', async () => {
    await db.exec(`insert into public.resend_volumen_mensual (periodo, enviados) values ('2026-10-01', 44999)`)
    expect((await contar('x')).umbral_cruzado).toBe(45000)
    expect((await contar('y')).umbral_cruzado).toBeNull()
  })

  it('desmarcar deja el umbral listo para el siguiente email.sent', async () => {
    await db.exec(`update public.resend_volumen_config set umbrales = '{1}'`)
    expect((await contar('a')).umbral_cruzado).toBe(1)
    await db.exec(`select public.resend_volumen_desmarcar('2026-10-01', 1)`)
    expect((await contar('b')).umbral_cruzado).toBe(1)
    expect((await contar('c')).umbral_cruzado).toBeNull()
  })

  it('el período sale en hora de Bogotá', async () => {
    // 1 de noviembre 03:00 UTC = 31 de octubre 22:00 en Bogotá.
    expect(await contar('borde', '2026-11-01T03:00:00Z')).toMatchObject({ periodo: '2026-10-01', periodo_fin: '2026-11-01' })
    expect(await contar('borde2', '2026-11-01T05:00:00Z')).toMatchObject({ periodo: '2026-11-01' })
  })

  it('con día de corte 15 el período va del 15 al 14', async () => {
    await db.exec('update public.resend_volumen_config set dia_corte = 15')
    expect(await contar('a', '2026-10-10T15:00:00Z')).toMatchObject({ periodo: '2026-09-15', periodo_fin: '2026-10-15' })
    expect(await contar('b', '2026-10-15T15:00:00Z')).toMatchObject({ periodo: '2026-10-15', periodo_fin: '2026-11-15' })
    expect(await contar('c', '2027-01-05T15:00:00Z')).toMatchObject({ periodo: '2026-12-15', periodo_fin: '2027-01-15' })
  })

  it('el día de corte no pasa de 28', async () => {
    await expect(db.exec('update public.resend_volumen_config set dia_corte = 31')).rejects.toThrow()
  })

  it('purga los ids de más de 7 días', async () => {
    await contar('viejo', '2026-10-10T15:00:00Z')
    await contar('nuevo', '2026-10-26T15:00:00Z')
    const r = await db.query<{ svix_id: string }>('select svix_id from public.resend_eventos_contados order by 1')
    expect(r.rows.map((f) => f.svix_id)).toEqual(['nuevo'])
  })

  it('un svix-id vacío es un error, no un conteo', async () => {
    await expect(contar('')).rejects.toThrow(/svix_id vacio/)
  })

  it('ni anon ni authenticated ejecutan las funciones ni leen las tablas', async () => {
    for (const rol of ['anon', 'authenticated']) {
      await db.exec(`set role ${rol}`)
      try {
        await expect(db.query(`select * from public.resend_contar_enviado('z')`)).rejects.toThrow(/permission denied/)
        await expect(db.query(`select public.resend_volumen_desmarcar('2026-10-01', 1)`)).rejects.toThrow(/permission denied/)
        await expect(db.query('select 1 from public.resend_volumen_mensual')).rejects.toThrow(/permission denied/)
        await expect(db.query('select 1 from public.resend_volumen_config')).rejects.toThrow(/permission denied/)
        await expect(db.query('select 1 from public.resend_eventos_contados')).rejects.toThrow(/permission denied/)
      } finally {
        await db.exec('reset role')
      }
    }
  })

  it('service_role sí cuenta', async () => {
    await db.exec('set role service_role')
    try {
      expect(await contar('srv')).toMatchObject({ contado: true, enviados: 1 })
    } finally {
      await db.exec('reset role')
    }
  })
})
