import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

/**
 * La migración de configuración del freno de titulares (SOENA), ejecutada de verdad en
 * PGlite sobre una línea con la forma de la de producción (solo `slug` y lo que la
 * migración lee de cada cruce: ningún dato de cliente).
 *
 *   * agrega el cruce nuevo UNA vez y es re-aplicable;
 *   * los dos cruces de factura contra titularidad pasan a frenar en 6 y 7 sin perder otra
 *     etapa que tuvieran ni el resto de su definición;
 *   * no reordena ni pierde ningún otro cruce;
 *   * sin los cruces de 20260924190000 se niega a correr.
 */

const MIGRACION = join(process.cwd(), 'supabase/migrations/20261001100000_soena_freno_titular_2_antes_de_radicar.sql')
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const LINEA = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
const OTRA_LINEA = '00000000-0000-4000-8000-0000000000b1'

const CRUCES_ANTES = [
  { slug: 'factura_compradores_vs_titularidad', tipo: 'cantidad', bloquea_en_etapas: [6], a: { field: 'cantidad_compradores' } },
  { slug: 'rut_entre_compradores', tipo: 'documento_en_lista', bloquea_en_etapas: [6] },
  { slug: 'rut2_entre_compradores', tipo: 'documento_en_lista', bloquea_en_etapas: [6, 12] },
  { slug: 'certificado_personas_vs_titularidad', tipo: 'cantidad', bloquea_en_etapas: [9, 10] },
  { slug: 'certificado_correo_titular', tipo: 'coincide', bloquea_en_etapas: [] },
  { slug: 'certificado_direccion_titular_2', tipo: 'coincide', bloquea_en_etapas: [] },
]

let db: PGlite
const sql = readFileSync(MIGRACION, 'utf8')

async function cruces(linea = LINEA): Promise<Array<Record<string, unknown>>> {
  const r = await db.query<{ c: Array<Record<string, unknown>> }>(
    `select config_extra->'cruces' as c from lineas_negocio where id = $1`, [linea])
  return r.rows[0].c
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create table lineas_negocio (id uuid primary key, workspace_id uuid not null, config_extra jsonb);
    insert into lineas_negocio values
      ('${LINEA}', '${WS}', jsonb_build_object('cruces', '${JSON.stringify(CRUCES_ANTES)}'::jsonb, 'otra', 1)),
      ('${OTRA_LINEA}', '${WS}', jsonb_build_object('cruces', '${JSON.stringify(CRUCES_ANTES)}'::jsonb));
  `)
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('migración 20261001100000 (freno de titulares)', () => {
  it('aplica, y aplicada dos veces deja lo mismo', async () => {
    await db.exec(sql)
    const una = await cruces()
    await db.exec(sql)
    expect(await cruces()).toEqual(una)
  })

  it('agrega el cruce nuevo una sola vez, al final', async () => {
    const c = await cruces()
    expect(c.map(x => x.slug)).toEqual([...CRUCES_ANTES.map(x => x.slug), 'titular_2_completo_antes_de_radicar'])
    const nuevo = c[c.length - 1]
    expect(nuevo.tipo).toBe('requeridos')
    expect(nuevo.bloquea_en_etapas).toEqual([6, 7])
  })

  it('los cruces de factura frenan en 6 y 7 sin perder etapas ni definición', async () => {
    const c = await cruces()
    const porSlug = Object.fromEntries(c.map(x => [x.slug, x]))
    expect(porSlug.factura_compradores_vs_titularidad.bloquea_en_etapas).toEqual([6, 7])
    expect(porSlug.factura_compradores_vs_titularidad.a).toEqual({ field: 'cantidad_compradores' })
    expect(porSlug.rut2_entre_compradores.bloquea_en_etapas).toEqual([6, 7, 12])
    // Los demás, tal cual.
    expect(porSlug.rut_entre_compradores.bloquea_en_etapas).toEqual([6])
    expect(porSlug.certificado_personas_vs_titularidad.bloquea_en_etapas).toEqual([9, 10])
  })

  it('no toca otra línea ni el resto de config_extra', async () => {
    expect(await cruces(OTRA_LINEA)).toEqual(CRUCES_ANTES)
    const r = await db.query<{ otra: number }>(`select (config_extra->>'otra')::int as otra from lineas_negocio where id = $1`, [LINEA])
    expect(r.rows[0].otra).toBe(1)
  })

  it('sin los cruces de titularidad previos, se niega a correr', async () => {
    await db.query(
      `update lineas_negocio set config_extra = jsonb_build_object('cruces', '[]'::jsonb) where id = $1`, [LINEA])
    await expect(db.exec(sql)).rejects.toThrow(/faltan los cruces de titularidad/)
  })
})
