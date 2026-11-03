import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * Los dos SQL del viaje en bloqueo, ejecutados de verdad en PGlite:
 *  · la migración que amplía el CHECK de `cotizacion_ranuras.tipo` con 'paquete' (sobre la de 'otro');
 *  · la config de Trappvel (`sql/trappvel/…modalidad-bloqueo-PENDIENTE.sql`): dos campos detrás de `tipo_viaje`,
 *    idempotente.
 * Ninguno se aplica aquí a producción: los aplica la sesión principal.
 */

const leer = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8')

describe('migración 20261027174500: tipo de ranura paquete', { timeout: 30_000 }, () => {
  it('acepta paquete, sigue aceptando los cinco de antes y rechaza lo demás', async () => {
    const db = new PGlite()
    await db.exec(`
      create table public.cotizacion_ranuras (id serial primary key, tipo text not null check (tipo in ('vuelo', 'hotel', 'actividad', 'traslado')));
      insert into public.cotizacion_ranuras (tipo) values ('vuelo'), ('hotel');
    `)
    await db.exec(leer('supabase/migrations/20261013140000_cotizacion_ranuras_tipo_otro.sql'))
    await db.exec(leer('supabase/migrations/20261027174500_cotizacion_ranuras_tipo_paquete.sql'))
    for (const t of ['vuelo', 'hotel', 'actividad', 'traslado', 'otro', 'paquete']) {
      await db.query('insert into public.cotizacion_ranuras (tipo) values ($1)', [t])
    }
    await expect(db.query(`insert into public.cotizacion_ranuras (tipo) values ('bloqueo')`)).rejects.toThrow(/check/i)
    const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from pg_constraint where conrelid = 'public.cotizacion_ranuras'::regclass and contype = 'c'`)
    expect(rows[0].n).toBe(1)
    // Volver a correrla no rompe (busca el CHECK por su definición).
    await db.exec(leer('supabase/migrations/20261027174500_cotizacion_ranuras_tipo_paquete.sql'))
    await db.close()
  })
})

describe('config de Trappvel: modalidad_viaje y operador_bloqueo', { timeout: 30_000 }, () => {
  const ID = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417'
  async function base() {
    const db = new PGlite()
    await db.exec(`
      create table public.bloque_configs (id uuid primary key, slug text, config_extra jsonb);
      insert into public.bloque_configs values ('${ID}', 'condiciones_del_viaje',
        '{"fields":[{"slug":"destino"},{"slug":"destino_tipo"},{"slug":"tipo_viaje"},{"slug":"fecha_salida"}],"otra":1}');
    `)
    return db
  }
  const slugs = async (db: PGlite) => (await db.query<{ s: string }>(
    `select e->>'slug' as s from public.bloque_configs, jsonb_array_elements(config_extra->'fields') with ordinality t(e, n) where id = '${ID}' order by n`,
  )).rows.map(r => r.s)

  it('pone los dos campos detrás de tipo_viaje, con el showIf del operador, y no toca lo demás', async () => {
    const db = await base()
    await db.exec(leer('sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql'))
    expect(await slugs(db)).toEqual(['destino', 'destino_tipo', 'tipo_viaje', 'modalidad_viaje', 'operador_bloqueo', 'fecha_salida'])
    const { rows } = await db.query<{ c: { otra: number; fields: { slug: string; showIf?: unknown; opciones?: { value: string }[] }[] } }>(`select config_extra as c from public.bloque_configs`)
    expect(rows[0].c.otra).toBe(1)
    const op = rows[0].c.fields.find(f => f.slug === 'operador_bloqueo')
    expect(op?.showIf).toEqual({ field: 'modalidad_viaje', equals: 'bloqueo' })
    expect(rows[0].c.fields.find(f => f.slug === 'modalidad_viaje')?.opciones?.map(o => o.value)).toEqual(['a_medida', 'bloqueo'])
    await db.close()
  })

  it('idempotente: la segunda corrida no duplica', async () => {
    const db = await base()
    await db.exec(leer('sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql'))
    await db.exec(leer('sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql'))
    expect((await slugs(db)).filter(s => s === 'modalidad_viaje')).toHaveLength(1)
    await db.close()
  })

  it('se niega si el bloque no es condiciones_del_viaje', async () => {
    const db = await base()
    await db.exec(`update public.bloque_configs set slug = 'otro'`)
    await expect(db.exec(leer('sql/trappvel/2026-10-27_modalidad-bloqueo-PENDIENTE.sql'))).rejects.toThrow(/no es condiciones_del_viaje/)
    await db.close()
  })
})
