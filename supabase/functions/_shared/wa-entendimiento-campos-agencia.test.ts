/**
 * El SQL PROVISIONAL `sql/trappvel/2026-10-01_campos-de-la-agencia-PROVISIONAL.sql`, ejecutado en
 * PGlite sobre bloques SINTÉTICOS (escritos aquí, nada copiado de producción): marca con
 * `lo_llena: "agencia"` los campos que produce la agencia y `camposEntendibles` los saca.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { camposEntendibles, type CampoEntendible } from './wa-entendimiento-reglas.ts';

const SQL = readFileSync(path.resolve(__dirname, '../../../sql/trappvel/2026-10-01_campos-de-la-agencia-PROVISIONAL.sql'), 'utf8');
const ETAPA = '3b6b4133-f656-4145-8e32-bf598cde68d0';
const OTRA_ETAPA = '00000000-0000-4000-8000-000000000001';

const VIAJE = [
  { slug: 'destino', tipo: 'texto' },
  { slug: 'requisitos_especiales', tipo: 'texto' },
  { slug: 'presentacion_destino', tipo: 'texto' },
];
const COMPLEJIDAD = [{ slug: 'clasificacion_complejidad', tipo: 'select', opciones: [{ value: 'simple' }, { value: 'compleja' }] }];
const FORMATO = [{ slug: 'formato_cotizacion', tipo: 'select', opciones: [{ value: 'a' }] }, { slug: 'nivel_detalle', tipo: 'select', opciones: [{ value: 'b' }] }];

let db: PGlite;

async function crear(filas: Array<[string, string, unknown[]]>) {
  await db.exec('drop table if exists public.bloque_configs');
  await db.exec('create table public.bloque_configs (id uuid primary key default gen_random_uuid(), etapa_id uuid, slug text, config_extra jsonb)');
  for (const [etapa, slug, fields] of filas) {
    await db.query('insert into public.bloque_configs (etapa_id, slug, config_extra) values ($1, $2, $3)', [etapa, slug, { fields }]);
  }
}

async function campos(etapa = ETAPA): Promise<CampoEntendible[]> {
  const r = await db.query<{ fields: CampoEntendible[] }>('select config_extra->\'fields\' as fields from public.bloque_configs where etapa_id = $1 order by slug', [etapa]);
  return r.rows.flatMap(x => x.fields);
}

beforeAll(async () => { db = new PGlite(); }, 30_000);
afterAll(async () => { await db.close(); });

describe('SQL PROVISIONAL: campos que escribe la agencia', () => {
  it('marca los cuatro campos de la etapa, conserva el orden y no toca otra etapa', async () => {
    await crear([[ETAPA, 'condiciones_del_viaje', VIAJE], [ETAPA, 'complejidad', COMPLEJIDAD], [ETAPA, 'formato', FORMATO], [OTRA_ETAPA, 'otro', VIAJE]]);
    await db.exec(SQL);
    const cs = await campos();
    expect(cs.filter(f => f.lo_llena === 'agencia').map(f => f.slug).sort()).toEqual(['clasificacion_complejidad', 'formato_cotizacion', 'nivel_detalle', 'presentacion_destino']);
    expect(camposEntendibles(cs).map(f => f.slug)).toEqual(['destino', 'requisitos_especiales']);
    expect((await campos(OTRA_ETAPA)).some(f => f.lo_llena)).toBe(false);
    // Idempotente.
    await db.exec(SQL);
    expect((await campos()).map(f => f.slug)).toEqual(cs.map(f => f.slug));
  });

  it('aborta si presentacion_destino no está en la etapa', async () => {
    await crear([[ETAPA, 'condiciones_del_viaje', VIAJE.filter(f => f.slug !== 'presentacion_destino')]]);
    await expect(db.exec(SQL)).rejects.toThrow(/presentacion_destino exactamente una vez/);
  });
});
