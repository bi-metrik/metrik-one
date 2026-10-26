import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración del cargue masivo en el servidor, ejecutada en PGlite: la cola (`for update skip
 * locked`), el turno con tope y equidad, el conteo que suma UNA vez, el cierre del lote, el único lote
 * activo por espacio, la llave única fila → consulta, la huella de los contratos, y que la sesión solo
 * LEA lo de su espacio.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261015231700_valida_lotes_servidor.sql')
const WS1 = '00000000-0000-4000-8000-0000000000a1'
const WS2 = '00000000-0000-4000-8000-0000000000a2'
const T1 = '00000000-0000-4000-8000-0000000000f1'
const T2 = '00000000-0000-4000-8000-0000000000f2'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    grant usage on schema public to anon, authenticated, service_role;
    -- El default VIEJO de la base (concedía todo): la migración tiene que quitarlo ella misma.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.workspaces (id uuid primary key);
    create table public.profiles (id uuid primary key, workspace_id uuid);
    create table public.negocios (id uuid primary key, workspace_id uuid);
    create table public.valida_consultas (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null,
      lote_id uuid,
      severidad text not null
    );
    create table public.catalogo_servicios (slug text primary key, modulo text);
    create table public.servicios_contratados (
      id uuid primary key default gen_random_uuid(),
      servicio_slug text, estado text, vigente_hasta date, terminos_plazo_hasta date, workspace_pagador_id uuid
    );
    create table public.servicio_contratado_beneficiarios (servicio_contratado_id uuid, workspace_id uuid);
    create table public.sesion (uid uuid);
    create function public.current_user_workspace_id() returns uuid language sql stable as
      $$ select p.workspace_id from public.profiles p join public.sesion s on s.uid = p.id limit 1 $$;
    insert into public.workspaces values ('${WS1}'), ('${WS2}');
    insert into public.catalogo_servicios values ('valida-cda', 'valida_consulta'), ('otro', 'clarity');
  `)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
}, 30_000)

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.exec(`delete from public.valida_consultas; delete from public.valida_lote_filas; delete from public.valida_lotes;`)
})

async function crearLote(ws: string, filas: number, estado = 'en_cola', creado = '2026-10-15T10:00:00Z'): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.valida_lotes (workspace_id, estado, total, created_at) values ($1, $2, $3, $4) returning id`,
    [ws, estado, filas, creado],
  )
  const id = rows[0].id
  for (let i = 1; i <= filas; i++) {
    await db.query(
      `insert into public.valida_lote_filas (lote_id, workspace_id, posicion, entrada) values ($1, $2, $3, $4)`,
      [id, ws, i, JSON.stringify({ tipo: 'natural', nombre: `Persona ${i}` })],
    )
  }
  return id
}

const turno = (t: string, max = 3, s = 150) =>
  db.query<{ id: string; workspace_id: string }>(`select * from public.valida_lote_tomar_turno($1, $2, $3)`, [t, s, max])
const reclamar = (lote: string, t: string, s = 120) =>
  db.query<{ id: string; posicion: number; intentos: number }>(`select * from public.valida_lote_reclamar_fila($1, $2, $3)`, [lote, t, s])
const terminar = (fila: string, sev = 'sin_hallazgo', conteo = sev) =>
  db.query<{ valida_lote_fila_terminar: boolean }>(
    `select public.valida_lote_fila_terminar($1, 'hecha', $2, $3, null, 'val-1', 0, null)`,
    [fila, sev, conteo],
  )
const cerrar = (lote: string, t: string) =>
  db.query<{ valida_lote_cerrar_turno: string | null }>(`select public.valida_lote_cerrar_turno($1, $2)`, [lote, t])

describe('turno: tope y equidad entre espacios', () => {
  it('a lo sumo N lotes con turno a la vez', async () => {
    await crearLote(WS1, 1)
    await crearLote(WS2, 1)
    expect((await turno(T1, 1)).rows).toHaveLength(1)
    expect((await turno(T2, 1)).rows).toHaveLength(0)
    expect((await turno(T2, 2)).rows).toHaveLength(1)
  })

  it('el siguiente turno es para el lote que lleva más sin turno, no para el grande que ya tuvo', async () => {
    const grande = await crearLote(WS1, 3, 'en_cola', '2026-10-15T09:00:00Z')
    const t1 = await turno(T1, 3)
    expect(t1.rows[0].id).toBe(grande)
    await cerrar(grande, T1)
    // Llega un lote chico de otro espacio: aunque el grande es más viejo, pasa el chico.
    const chico = await crearLote(WS2, 1, 'en_cola', '2026-10-15T11:00:00Z')
    expect((await turno(T2, 3)).rows[0].id).toBe(chico)
  })

  it('un turno vencido lo toma otro trabajador; uno vigente no', async () => {
    const lote = await crearLote(WS1, 1)
    expect((await turno(T1, 3, 150)).rows).toHaveLength(1)
    expect((await turno(T2, 3)).rows).toHaveLength(0)
    await db.query(`update public.valida_lotes set turno_hasta = now() - interval '1 second' where id = $1`, [lote])
    expect((await turno(T2, 3)).rows[0].id).toBe(lote)
  })

  it('ni pausado, ni cancelado, ni preparando dan turno', async () => {
    await crearLote(WS1, 1, 'pausado')
    await crearLote(WS2, 1, 'preparando')
    expect((await turno(T1, 3)).rows).toHaveLength(0)
  })
})

describe('la cola de filas', () => {
  it('entrega en el orden del archivo, una vez cada una, solo a quien tiene el turno', async () => {
    const lote = await crearLote(WS1, 3)
    await turno(T1)
    expect((await reclamar(lote, T2)).rows).toHaveLength(0)
    const a = await reclamar(lote, T1)
    const b = await reclamar(lote, T1)
    expect([a.rows[0].posicion, b.rows[0].posicion]).toEqual([1, 2])
    expect(a.rows[0].intentos).toBe(1)
  })

  it('una fila con el reclamo vencido vuelve a salir, con un intento más', async () => {
    const lote = await crearLote(WS1, 1)
    await turno(T1)
    const a = await reclamar(lote, T1, 0)
    const b = await reclamar(lote, T1)
    expect(b.rows[0].id).toBe(a.rows[0].id)
    expect(b.rows[0].intentos).toBe(2)
  })

  it('un lote pausado no entrega más filas aunque el trabajador siga vivo', async () => {
    const lote = await crearLote(WS1, 2)
    await turno(T1)
    await db.query(`update public.valida_lotes set estado = 'pausado' where id = $1`, [lote])
    expect((await reclamar(lote, T1)).rows).toHaveLength(0)
  })
})

describe('terminar una fila', () => {
  it('suma al lote UNA vez aunque dos trabajadores la terminen', async () => {
    const lote = await crearLote(WS1, 2)
    await turno(T1)
    const f = (await reclamar(lote, T1)).rows[0]
    expect((await terminar(f.id, 'alto')).rows[0].valida_lote_fila_terminar).toBe(true)
    expect((await terminar(f.id, 'alto')).rows[0].valida_lote_fila_terminar).toBe(false)
    const { rows } = await db.query<{ procesadas: number; severidades: Record<string, number> }>(
      `select procesadas, severidades from public.valida_lotes where id = $1`,
      [lote],
    )
    expect(rows[0]).toEqual({ procesadas: 1, severidades: { alto: 1 } })
  })

  it('el contador usa la severidad del conteo (fila mal escrita = error), la fila guarda la real', async () => {
    const lote = await crearLote(WS1, 1)
    await turno(T1)
    const f = (await reclamar(lote, T1)).rows[0]
    await terminar(f.id, 'sin_hallazgo', 'error')
    const l = await db.query<{ severidades: Record<string, number> }>(`select severidades from public.valida_lotes where id = $1`, [lote])
    const fila = await db.query<{ severidad: string; estado: string }>(`select severidad, estado from public.valida_lote_filas where id = $1`, [f.id])
    expect(l.rows[0].severidades).toEqual({ error: 1 })
    expect(fila.rows[0]).toEqual({ severidad: 'sin_hallazgo', estado: 'hecha' })
  })

  it('cerrar el turno con todo hecho completa el lote; con filas pendientes lo suelta en procesando', async () => {
    const lote = await crearLote(WS1, 2)
    await turno(T1)
    const f1 = (await reclamar(lote, T1)).rows[0]
    await terminar(f1.id)
    expect((await cerrar(lote, T1)).rows[0].valida_lote_cerrar_turno).toBe('procesando')
    await turno(T1)
    const f2 = (await reclamar(lote, T1)).rows[0]
    await terminar(f2.id)
    expect((await cerrar(lote, T1)).rows[0].valida_lote_cerrar_turno).toBe('completado')
  })

  it('una fila en curso de un trabajador muerto impide completar', async () => {
    const lote = await crearLote(WS1, 1)
    await turno(T1)
    await reclamar(lote, T1)
    expect((await cerrar(lote, T1)).rows[0].valida_lote_cerrar_turno).toBe('procesando')
  })

  it('cerrar un turno que ya no es suyo (pausado entretanto) no toca nada', async () => {
    const lote = await crearLote(WS1, 1)
    await turno(T1)
    await db.query(`update public.valida_lotes set estado = 'pausado', trabajador = null where id = $1`, [lote])
    expect((await cerrar(lote, T1)).rows[0].valida_lote_cerrar_turno).toBeNull()
  })
})

describe('llaves', () => {
  it('un solo lote activo por espacio; pausado o terminado no cuenta', async () => {
    await crearLote(WS1, 1, 'en_cola')
    await expect(crearLote(WS1, 1, 'procesando')).rejects.toThrow(/valida_lotes_uno_activo_por_espacio/)
    await crearLote(WS1, 1, 'pausado')
    await crearLote(WS1, 1, 'completado')
    await crearLote(WS2, 1, 'en_cola')
  })

  it('una fila deja a lo sumo una consulta en el historial', async () => {
    const lote = await crearLote(WS1, 1)
    const { rows } = await db.query<{ id: string }>(`select id from public.valida_lote_filas where lote_id = $1`, [lote])
    const ins = `insert into public.valida_consultas (workspace_id, lote_id, severidad, lote_fila_id) values ($1, $2, 'alto', $3)`
    await db.query(ins, [WS1, lote, rows[0].id])
    await expect(db.query(ins, [WS1, lote, rows[0].id])).rejects.toThrow(/valida_consultas_lote_fila_unica/)
    // Las consultas sin fila (puntuales, lotes viejos) no chocan entre sí.
    await db.query(`insert into public.valida_consultas (workspace_id, severidad) values ($1, 'alto'), ($1, 'alto')`, [WS1])
  })

  it('el lote no pasa de 10.000 filas', async () => {
    await expect(
      db.query(`insert into public.valida_lotes (workspace_id, total) values ($1, 10001)`, [WS1]),
    ).rejects.toThrow(/check/i)
  })
})

describe('huella de los contratos de Valida', () => {
  it('vacía sin contrato; cambia si el contrato cambia de estado; ignora otros módulos', async () => {
    const h = async (ws: string) =>
      (await db.query<{ h: string }>(`select public.valida_lote_huella_acceso($1) as h`, [ws])).rows[0].h
    expect(await h(WS1)).toBe('')
    await db.query(`insert into public.servicios_contratados (servicio_slug, estado, workspace_pagador_id) values ('otro', 'activo', $1)`, [WS1])
    expect(await h(WS1)).toBe('')
    const { rows } = await db.query<{ id: string }>(
      `insert into public.servicios_contratados (servicio_slug, estado, workspace_pagador_id) values ('valida-cda', 'activo', $1) returning id`,
      [WS1],
    )
    const activo = await h(WS1)
    expect(activo).not.toBe('')
    // El beneficiario ve la misma huella.
    await db.query(`insert into public.servicio_contratado_beneficiarios values ($1, $2)`, [rows[0].id, WS2])
    expect(await h(WS2)).toBe(activo)
    await db.query(`update public.servicios_contratados set estado = 'cancelado' where id = $1`, [rows[0].id])
    expect(await h(WS1)).not.toBe(activo)
  })
})

describe('permisos', () => {
  it('la sesión solo LEE, y solo lo de su espacio; las funciones son del servidor', async () => {
    const r = await db.query<{ rol: string; s: boolean; i: boolean; u: boolean }>(`
      select rol,
             has_table_privilege(rol, 'public.valida_lotes', 'select') as s,
             has_table_privilege(rol, 'public.valida_lotes', 'insert') as i,
             has_table_privilege(rol, 'public.valida_lote_filas', 'update') as u
        from unnest(array['anon', 'authenticated']) as rol order by rol`)
    expect(r.rows).toEqual([
      { rol: 'anon', s: false, i: false, u: false },
      { rol: 'authenticated', s: true, i: false, u: false },
    ])
    const f = await db.query<{ x: boolean }>(`
      select bool_or(has_function_privilege(rol, p.oid, 'execute')) as x
        from pg_proc p, unnest(array['anon', 'authenticated']) as rol
       where p.proname like 'valida_lote_%'`)
    expect(f.rows[0].x).toBe(false)

    const lote1 = await crearLote(WS1, 1)
    await crearLote(WS2, 1)
    const yo = '00000000-0000-4000-8000-00000000aaa1'
    await db.query(`insert into public.profiles values ($1, $2) on conflict do nothing`, [yo, WS1])
    await db.exec(`delete from public.sesion`)
    await db.query(`insert into public.sesion values ($1)`, [yo])
    await db.exec(`grant select on public.sesion, public.profiles to authenticated; set role authenticated;`)
    try {
      const visibles = await db.query<{ id: string }>(`select id from public.valida_lotes`)
      expect(visibles.rows.map((x) => x.id)).toEqual([lote1])
      const filas = await db.query<{ workspace_id: string }>(`select workspace_id from public.valida_lote_filas`)
      expect(new Set(filas.rows.map((x) => x.workspace_id))).toEqual(new Set([WS1]))
    } finally {
      await db.exec(`reset role;`)
    }
  })
})
