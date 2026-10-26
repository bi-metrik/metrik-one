import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { TIPO_AVISO_FACTURA } from './aviso-factura-cuota'

/**
 * La migración del tipo `factura_cargada`, ejecutada en PGlite: amplía el CHECK de
 * `notificaciones.tipo` LEYENDO el que está en la base, así que conserva un tipo que las migraciones
 * no conocen, y correrla dos veces no lo vuelve a tocar.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261022153000_notificaciones_tipo_factura_cargada.sql')

// La lista vigente al 2026-10-20 (20261020230000) más un tipo que solo existiera en producción.
const ESQUEMA_BASE = `
  create table public.notificaciones (id serial primary key, tipo text not null);
  alter table public.notificaciones add constraint notificaciones_tipo_check check (
    tipo = any (array[
      'inactividad_oportunidad', 'handoff', 'mencion', 'cuota_por_vencer', 'compliance_hallazgo',
      'tipo_solo_en_produccion'
    ])
  );
  insert into public.notificaciones (tipo) values ('tipo_solo_en_produccion');
`

let db: PGlite

async function falla(sql: string): Promise<string | null> {
  try {
    await db.query(sql)
    return null
  } catch (e) {
    return (e as Error).message
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(readFileSync(MIGRACION, 'utf8'))
})

afterAll(async () => {
  await db.close()
})

describe('notificaciones.tipo: factura_cargada', () => {
  it('el tipo del código es el que la migración admite', () => {
    expect(TIPO_AVISO_FACTURA).toBe('factura_cargada')
  })

  it('admite factura_cargada y conserva los tipos que ya estaban, incluido uno que solo existe en la base', async () => {
    expect(await falla(`insert into public.notificaciones (tipo) values ('factura_cargada')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('compliance_hallazgo')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('tipo_solo_en_produccion')`)).toBeNull()
    expect(await falla(`insert into public.notificaciones (tipo) values ('otro')`)).toMatch(/notificaciones_tipo_check/)
  })

  it('correrla dos veces no vuelve a tocar el CHECK', async () => {
    await db.exec(readFileSync(MIGRACION, 'utf8'))
    const r = await db.query<{ def: string }>(
      `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'notificaciones_tipo_check'`,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].def.match(/factura_cargada/g)).toHaveLength(1)
  })
})
