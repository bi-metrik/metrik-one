/**
 * SOE-035: `20261030163500_soe035_solo_iva_sin_techo_tarifa.sql` corrida de verdad en
 * Postgres en memoria (PGlite), con `v_cobro_valor` cargada desde su migración real.
 *
 * El defecto: un negocio `solo_iva` (el cliente le paga la UPME él mismo) traía
 * `techo_tarifa > 0` si el bloque de la tarifa quedó confirmado, y el sobrepago del honorario
 * caía en `a_tarifa`. Eso lo volvía candidato a un RC-3 que nunca existirá (V0475 $12.500,
 * V0531 $65, V0610 $87).
 *
 * Lo que se fija:
 *   · `solo_iva` → `techo_tarifa = 0`, y el sobrepago deja de caer en `a_tarifa`;
 *   · un negocio `completo` conserva su techo y su reparto byte a byte;
 *   · la vista nace con `security_invoker` y sin grant a `anon`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const MIGRACION = '20261030163500_soe035_solo_iva_sin_techo_tarifa.sql'
const HONORARIO_NETO = '20260902220053_tableros_honorario_neto_de_iva.sql'

function vistaCobroValor(): string {
  const sql = leer(HONORARIO_NETO)
  const inicio = sql.indexOf('CREATE OR REPLACE VIEW public.v_cobro_valor AS')
  const fin = sql.indexOf('COMMENT ON VIEW public.v_cobro_valor')
  return sql.slice(inicio, fin)
}

const WS = '00000000-0000-4000-8000-0000000e0001'
const LINEA = '00000000-0000-4000-8000-0000000e0002'
const BC_TARIFA = '00000000-0000-4000-8000-0000000e0003'
const BC_SERVICIO = '00000000-0000-4000-8000-0000000e0004'
const BD = '00000000-0000-4000-8000-0000000e0005'
const SOLO_IVA = '00000000-0000-4000-8000-0000000e0010'
const COMPLETO = '00000000-0000-4000-8000-0000000e0011'

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create table public.workspaces (id uuid primary key, config_extra jsonb);
  create table public.lineas_negocio (id uuid primary key, config_extra jsonb);
  create table public.etapas_negocio (id uuid primary key, linea_id uuid);
  create table public.servicios (id uuid primary key, tarifa_iva numeric);
  create table public.bloque_definitions (id uuid primary key, tipo text);
  create table public.bloque_configs (
    id uuid primary key, slug text, etapa_id uuid, bloque_definition_id uuid, config_extra jsonb
  );
  create table public.negocios (
    id uuid primary key, workspace_id uuid, linea_id uuid,
    precio_aprobado numeric, precio_estimado numeric
  );
  create table public.negocio_bloques (
    id uuid primary key default gen_random_uuid(), negocio_id uuid, bloque_config_id uuid, data jsonb
  );
  create table public.cobros (
    id uuid primary key, workspace_id uuid, negocio_id uuid, monto numeric,
    fecha date, tipo_cobro text
  );
`

const DATOS = `
  insert into workspaces values ('${WS}', '{"recaudo": {"topar_por_valor": true}}');
  insert into lineas_negocio values ('${LINEA}', '{}');
  insert into bloque_definitions values ('${BD}', 'datos');
  insert into bloque_configs values
    ('${BC_TARIFA}', 'tarifa_upme', null, '${BD}', '{"tarifa_confirmacion": {"enabled": true}}'),
    ('${BC_SERVICIO}', 'servicio_contratado', null, '${BD}', '{}');
  insert into negocios values
    ('${SOLO_IVA}', '${WS}', '${LINEA}', 459000, null),
    ('${COMPLETO}', '${WS}', '${LINEA}', 450000, null);
  -- Los dos tienen la tarifa confirmada: así estaban 35 de los 41 solo_iva de SOENA.
  insert into negocio_bloques (negocio_id, bloque_config_id, data) values
    ('${SOLO_IVA}', '${BC_TARIFA}', '{"tarifa_confirmada": "true", "tarifa_upme_confirmada": "701812"}'),
    ('${SOLO_IVA}', '${BC_SERVICIO}', '{"servicio": "solo_iva"}'),
    ('${COMPLETO}', '${BC_TARIFA}', '{"tarifa_confirmada": "true", "tarifa_upme_confirmada": "701812"}'),
    ('${COMPLETO}', '${BC_SERVICIO}', '{"servicio": "completo"}');
  insert into cobros values
    ('00000000-0000-4000-8000-0000000e0020', '${WS}', '${SOLO_IVA}', 459087, '2026-10-01', null),
    ('00000000-0000-4000-8000-0000000e0021', '${WS}', '${COMPLETO}', 1151812, '2026-10-01', null);
`

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(DATOS)
  await db.exec(leer(MIGRACION))
  await db.exec(vistaCobroValor())
})

afterAll(async () => {
  await db?.close()
})

const techo = async (negocio: string) =>
  (await db.query<{ techo_tarifa: string }>(
    'select techo_tarifa from v_negocio_valor where negocio_id = $1', [negocio],
  )).rows[0]?.techo_tarifa

const reparto = async (negocio: string) =>
  (await db.query<{ a_tramo1: string; a_tarifa: string; excedente: string }>(
    'select a_tramo1, a_tarifa, excedente from v_cobro_valor where negocio_id = $1', [negocio],
  )).rows[0]

describe('SOE-035: solo_iva sin techo de tarifa', () => {
  it('un negocio solo_iva no lleva techo de tarifa aunque el bloque esté confirmado', async () => {
    expect(Number(await techo(SOLO_IVA))).toBe(0)
  })

  it('V0610: el sobrepago del honorario ($87) ya no cae en a_tarifa', async () => {
    const r = await reparto(SOLO_IVA)
    expect(Number(r.a_tramo1)).toBe(459_000)
    expect(Number(r.a_tarifa)).toBe(0)
    expect(Number(r.excedente)).toBe(87)
  })

  it('un negocio completo conserva su techo y su reparto', async () => {
    expect(Number(await techo(COMPLETO))).toBe(701_812)
    const r = await reparto(COMPLETO)
    expect(Number(r.a_tramo1)).toBe(450_000)
    expect(Number(r.a_tarifa)).toBe(701_812)
    expect(Number(r.excedente)).toBe(0)
  })

  it('la vista sigue en security_invoker y sin grant a anon', async () => {
    const opts = (await db.query<{ reloptions: string[] | null }>(
      "select reloptions from pg_class where relname = 'v_negocio_valor'",
    )).rows[0].reloptions ?? []
    expect(opts.some(o => /^security_invoker=(on|true)$/.test(o))).toBe(true)
    const anon = (await db.query<{ ok: boolean }>(
      "select has_table_privilege('anon', 'public.v_negocio_valor', 'select') as ok",
    )).rows[0].ok
    expect(anon).toBe(false)
    const auth = (await db.query<{ ok: boolean }>(
      "select has_table_privilege('authenticated', 'public.v_negocio_valor', 'select') as ok",
    )).rows[0].ok
    expect(auth).toBe(true)
  })
})
