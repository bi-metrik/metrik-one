/**
 * `20261019120000_guardar_reparto_comercial.sql` corrida de verdad en Postgres en memoria (PGlite).
 *
 * Lo que la BASE tiene que garantizar sola, aunque el servidor tenga un defecto:
 *   · el reparto nuevo entra entero o no entra (un negocio cerrado en la lista no deja
 *     ninguna porción a medias);
 *   · si no cuadra con el total, no se escribe nada;
 *   · editar reemplaza las porciones vigentes en la misma operación y devuelve el antes y
 *     el después;
 *   · con una porción aprobada por la financiera (o su negocio conciliado), editar se
 *     rechaza aunque se llame la función directo;
 *   · una referencia registrada por otra vía (pago entero, reparto de la financiera) no la
 *     reemplaza el comercial;
 *   · el workspace sale de la sesión: con la sesión de otro espacio no toca nada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261019120000_guardar_reparto_comercial.sql'),
  'utf8',
)

const WS = '00000000-0000-4000-8000-0000000e0001'
const OTRO_WS = '00000000-0000-4000-8000-0000000e0002'
const PERFIL = '00000000-0000-4000-8000-0000000e0003'
const STAFF = '00000000-0000-4000-8000-0000000e0004'
const PERFIL_OTRO = '00000000-0000-4000-8000-0000000e0005'
const V0587 = '00000000-0000-4000-8000-0000000e0010'
const V0589 = '00000000-0000-4000-8000-0000000e0011'
const CERRADO = '00000000-0000-4000-8000-0000000e0012'
const REF = '389928481'

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles   (id uuid primary key, workspace_id uuid);
  create table public.staff      (id uuid primary key, workspace_id uuid, profile_id uuid);
  create table public.negocios (
    id uuid primary key, workspace_id uuid not null, codigo text, estado text not null default 'abierto'
  );
  create table public.cobros (
    id uuid primary key default gen_random_uuid(), workspace_id uuid not null, negocio_id uuid,
    monto numeric(15,2) not null check (monto >= 0), fecha date, tipo_cobro text, notas text,
    external_ref text, fuente text, created_by uuid, split_json jsonb, anulado_at timestamptz,
    created_at timestamptz default now()
  );
  create table public.negocio_conciliacion (
    negocio_id uuid primary key, workspace_id uuid, conciliado boolean, updated_at timestamptz
  );
  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select workspace_id from public.profiles where id = auth.uid() $$;

  insert into public.workspaces values ('${WS}', 'soena'), ('${OTRO_WS}', 'otro');
  insert into public.profiles values ('${PERFIL}', '${WS}'), ('${PERFIL_OTRO}', '${OTRO_WS}');
  insert into public.staff values ('${STAFF}', '${WS}', '${PERFIL}');
  insert into public.negocios values
    ('${V0587}', '${WS}', 'V0587', 'abierto'),
    ('${V0589}', '${WS}', 'V0589', 'abierto'),
    ('${CERRADO}', '${WS}', 'V0001', 'perdido');
`

let db: PGlite

async function como(perfil: string) {
  await db.exec(`select set_config('prueba.uid', '${perfil}', false)`)
}

async function guardar(
  porciones: Array<[string, number]>,
  modo: 'nuevo' | 'editar',
  total = 2_653_451,
): Promise<{ ok: true; r: { antes: unknown[]; despues: Array<{ negocio_id: string; monto: number }> } } | { ok: false; error: string }> {
  const json = JSON.stringify(porciones.map(([negocio_id, monto]) => ({ negocio_id, monto })))
  try {
    const res = await db.query<{ r: { antes: unknown[]; despues: Array<{ negocio_id: string; monto: number }> } }>(
      `select public.guardar_reparto_comercial($1, $2, $3::jsonb, null, 'epayco', $4) as r`,
      [REF, total, json, modo],
    )
    return { ok: true, r: res.rows[0].r }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function porciones(): Promise<Array<{ negocio_id: string; monto: number; version: number; fuente: string | null }>> {
  const res = await db.query<{ negocio_id: string; monto: string; version: string; fuente: string | null }>(
    `select negocio_id, monto, split_json->>'version' as version, fuente from public.cobros
      where external_ref = $1 and anulado_at is null order by negocio_id`,
    [REF],
  )
  return res.rows.map(r => ({ negocio_id: r.negocio_id, monto: Number(r.monto), version: Number(r.version), fuente: r.fuente }))
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIGRACION)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  await db.exec(`delete from public.cobros; delete from public.negocio_conciliacion;`)
  await como(PERFIL)
})

describe('guardar_reparto_comercial', () => {
  it('nuevo: crea una porción por negocio, marcadas como propuesta del comercial', async () => {
    const r = await guardar([[V0587, 1_316_062], [V0589, 1_337_389]], 'nuevo')
    expect(r.ok).toBe(true)
    const p = await porciones()
    expect(p.map(x => x.monto).sort()).toEqual([1_316_062, 1_337_389])
    expect(p.every(x => x.version === 1 && x.fuente === 'epayco')).toBe(true)
    const meta = await db.query<{ origen: string; propuesto_por: string }>(
      `select split_json->>'origen' as origen, split_json->>'propuesto_por' as propuesto_por from public.cobros limit 1`,
    )
    expect(meta.rows[0]).toEqual({ origen: 'comercial', propuesto_por: STAFF })
  })

  it('no cuadra: no escribe nada', async () => {
    const r = await guardar([[V0587, 1_326_725], [V0589, 1_000_000]], 'nuevo')
    expect(r).toMatchObject({ ok: false })
    expect((r as { error: string }).error).toContain('REPARTO_NO_CUADRA')
    expect(await porciones()).toHaveLength(0)
  })

  it('un negocio cerrado en la lista no deja ninguna porción a medias', async () => {
    const r = await guardar([[V0587, 1_316_062], [CERRADO, 1_337_389]], 'nuevo')
    expect((r as { error: string }).error).toContain('REPARTO_NEGOCIO_CERRADO:V0001')
    expect(await porciones()).toHaveLength(0)
  })

  it('un segundo «nuevo» sobre la misma referencia se frena: se corrige con editar', async () => {
    await guardar([[V0587, 2_653_451]], 'nuevo')
    const r = await guardar([[V0589, 2_653_451]], 'nuevo')
    expect((r as { error: string }).error).toContain('REPARTO_YA_ENVIADO')
    expect((await porciones()).map(x => x.negocio_id)).toEqual([V0587])
  })

  it('editar reemplaza todo en una operación y devuelve el antes y el después', async () => {
    // El caso de Tatiana: mitades iguales, cuando cada negocio debía distinto.
    await guardar([[V0587, 1_326_725], [V0589, 1_326_726]], 'nuevo')
    const r = await guardar([[V0587, 1_316_062], [V0589, 1_337_389]], 'editar')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.r.antes).toHaveLength(2)
    expect(r.r.despues.map(d => Number(d.monto)).sort()).toEqual([1_316_062, 1_337_389])
    const p = await porciones()
    expect(p).toHaveLength(2)
    expect(p.every(x => x.version === 2)).toBe(true)
  })

  it('editar que no cuadra deja intacta la versión anterior', async () => {
    await guardar([[V0587, 1_326_725], [V0589, 1_326_726]], 'nuevo')
    const r = await guardar([[V0587, 1_316_062]], 'editar')
    expect((r as { error: string }).error).toContain('REPARTO_NO_CUADRA')
    expect((await porciones()).map(x => x.monto).sort()).toEqual([1_326_725, 1_326_726])
  })

  it('aprobado por la financiera: editar lo rechaza la base, aunque se llame directo', async () => {
    await guardar([[V0587, 1_326_725], [V0589, 1_326_726]], 'nuevo')
    await db.exec(`update public.cobros set split_json = split_json || '{"confirmado_at":"2026-10-15T20:00:00Z"}'
                    where negocio_id = '${V0587}'`)
    const r = await guardar([[V0587, 1_316_062], [V0589, 1_337_389]], 'editar')
    expect((r as { error: string }).error).toContain('REPARTO_APROBADO')
    expect((await porciones()).map(x => x.monto).sort()).toEqual([1_326_725, 1_326_726])
  })

  it('negocio conciliado (aprobación anterior a la marca): también cuenta como aprobado', async () => {
    await guardar([[V0587, 2_653_451]], 'nuevo')
    await db.exec(`insert into public.negocio_conciliacion values ('${V0587}', '${WS}', true, now())`)
    const r = await guardar([[V0589, 2_653_451]], 'editar')
    expect((r as { error: string }).error).toContain('REPARTO_APROBADO')
  })

  it('guardar baja el check de conciliación de los negocios que toca', async () => {
    await guardar([[V0587, 2_653_451]], 'nuevo')
    // V0589 no tiene porción de esta referencia: su check es de otra plata y no la aprueba.
    await db.exec(`insert into public.negocio_conciliacion values ('${V0589}', '${WS}', true, now())`)
    const r = await guardar([[V0587, 1_000_000], [V0589, 1_653_451]], 'editar')
    expect(r.ok).toBe(true)
    const c = await db.query<{ conciliado: boolean }>(`select conciliado from public.negocio_conciliacion`)
    expect(c.rows.map(x => x.conciliado)).toEqual([false])
  })

  it('una referencia ya registrada como pago entero no la reemplaza el comercial', async () => {
    await db.exec(`insert into public.cobros (workspace_id, negocio_id, monto, external_ref, tipo_cobro)
                   values ('${WS}', '${V0587}', 2653451, '${REF}', 'pago')`)
    const r = await guardar([[V0587, 1_316_062], [V0589, 1_337_389]], 'nuevo')
    expect((r as { error: string }).error).toContain('REPARTO_REF_EN_USO:V0587')
  })

  it('editar sin reparto previo se rechaza', async () => {
    const r = await guardar([[V0587, 2_653_451]], 'editar')
    expect((r as { error: string }).error).toContain('REPARTO_NO_EXISTE')
  })

  it('con la sesión de otro espacio no alcanza los negocios de SOENA', async () => {
    await como(PERFIL_OTRO)
    const r = await guardar([[V0587, 2_653_451]], 'nuevo')
    expect((r as { error: string }).error).toContain('REPARTO_NEGOCIO_AJENO')
    expect(await porciones()).toHaveLength(0)
  })
})
