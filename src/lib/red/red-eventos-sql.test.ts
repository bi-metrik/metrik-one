import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { filasDeEventos } from './guardar-eventos'
import type { EventoRed } from './eventos'

/**
 * La migración del piloto de red, cargada TAL CUAL en Postgres en memoria (PGlite): la tabla
 * acepta las filas que arma `filasDeEventos`, el `id` deduplica, y la vista diaria cuenta bien
 * cortes, fallas por superficie y el porcentaje con service worker (antes/después).
 */

const MIGRACION = '20261006121500_red_eventos_piloto.sql'
const WS = '00000000-0000-4000-8000-0000000000a1'
const STAFF = '00000000-0000-4000-8000-0000000000c1'
// 2026-10-06 10:00 en Bogotá.
const T = Date.UTC(2026, 9, 6, 15, 0, 0)

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    set time zone 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table public.workspaces (id uuid primary key, slug text);
    create table public.staff (id uuid primary key, workspace_id uuid, full_name text);
    insert into public.workspaces values ('${WS}', 'soena');
    insert into public.staff values ('${STAFF}', '${WS}', 'Jessica Tejada');
  `)
  await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations', MIGRACION), 'utf8'))
})
afterAll(async () => db?.close())

async function insertar(ctx: Parameters<typeof filasDeEventos>[0], eventos: EventoRed[]) {
  for (const f of filasDeEventos(ctx, eventos)) {
    await db.query(
      `insert into public.red_eventos (id, workspace_id, persona_staff_id, tipo, superficie, ocurrido_at, dur_ms, operador, asn, ciudad, region, dispositivo, sw, detalle)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) on conflict (id) do nothing`,
      [f.id, f.workspace_id, f.persona_staff_id, f.tipo, f.superficie, f.ocurrido_at, f.dur_ms, f.operador, f.asn, f.ciudad, f.region, f.dispositivo, f.sw, JSON.stringify(f.detalle)],
    )
  }
}

const pulso = (id: string, sw: boolean): EventoRed => ({
  tipo: 'pulso', id, t0: T, t1: T + 300_000, visible_ms: 300_000, offline_ms: 0, sw,
  vercel: { n: 20, perdidas: 2 }, control: { n: 20, perdidas: 0 },
})

describe('red_eventos + v_red_resumen_diario', () => {
  it('guarda, deduplica por id y resume por día, persona y operador', async () => {
    const jessica = { workspaceId: WS, personaStaffId: STAFF, operador: 'Claro', asn: 14080 }
    const eventos: EventoRed[] = [
      pulso('p1', true),
      pulso('p2', false),
      { tipo: 'corte', id: 'c1', inicio: T + 1_000, dur_ms: 6_000, vercel: true, control: false, sw: true },
      { tipo: 'corte', id: 'c2', inicio: T + 9_000, dur_ms: 3_000, vercel: true, control: true, sw: true },
      { tipo: 'falla', id: 'f1', t: T + 2_000, superficie: 'carga', recuperado: true },
      { tipo: 'falla', id: 'f2', t: T + 3_000, superficie: 'carga', recuperado: false },
      { tipo: 'falla', id: 'f3', t: T + 4_000, superficie: 'subida' },
    ]
    await insertar(jessica, eventos)
    await insertar(jessica, eventos.slice(2, 4)) // reenvío de la bandeja: no duplica
    // Alguien fuera de la lista, en otro operador: fila aparte, sin persona.
    await insertar({ workspaceId: WS, personaStaffId: null, operador: 'Movistar', asn: 3816 }, [pulso('p3', false)])

    const { rows } = await db.query<Record<string, unknown>>(
      `select *, fecha::text as fecha_txt from public.v_red_resumen_diario order by persona nulls last`,
    )
    expect(rows).toHaveLength(2)
    const [j, anon] = rows
    expect(j).toMatchObject({
      workspace: 'soena',
      persona: 'Jessica Tejada',
      operador: 'Claro',
      cortes: 2,
      cortes_internet: 1,
      cortes_solo_vercel: 1,
      fallas_carga: 2,
      cargas_salvadas: 1,
      fallas_subida: 1,
    })
    expect(Number(j.minutos_medidos)).toBe(10)
    expect(Number(j.sw_pct)).toBe(50)
    expect(Number(j.perdidas_vercel)).toBe(4)
    expect(Number(j.segundos_corte)).toBe(9)
    expect(j.fecha_txt).toBe('2026-10-06')
    expect(anon).toMatchObject({ persona: null, operador: 'Movistar', cortes: 0 })
  })

  it('rechaza un tipo o una superficie que no existen', async () => {
    await expect(
      db.query(`insert into public.red_eventos (id, workspace_id, tipo, ocurrido_at) values ('x1', '${WS}', 'otro', now())`),
    ).rejects.toThrow()
    await expect(
      db.query(`insert into public.red_eventos (id, workspace_id, tipo, superficie, ocurrido_at) values ('x2', '${WS}', 'falla', 'impresora', now())`),
    ).rejects.toThrow()
  })

  it('nadie del navegador la ve: RLS sin policy ni grant', async () => {
    const { rows } = await db.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where relname = 'red_eventos'`)
    expect(rows[0].relrowsecurity).toBe(true)
    const grants = await db.query(
      `select 1 from information_schema.role_table_grants where table_name in ('red_eventos', 'v_red_resumen_diario') and grantee in ('anon', 'authenticated')`,
    )
    expect(grants.rows).toHaveLength(0)
  })
})
