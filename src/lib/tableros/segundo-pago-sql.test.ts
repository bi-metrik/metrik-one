/**
 * `20261008163000_segundo_pago_dos_cifras_soena.sql` corrida de verdad en Postgres en
 * memoria (PGlite). SOE-002: las dos cifras de segundo pago de los tableros de SOENA.
 *
 * Las dos vistas que lee la función (`v_venta_mes_comercial`, `v_cobro_valor`) se montan
 * como TABLAS con sus columnas: lo que se prueba es la regla de la función, no la
 * imputación por tramos, que esta migración no toca.
 *
 * Datos sintéticos, con la forma de los casos que motivaron el ticket:
 *   A  venta de junio, paga su segundo tramo el 7 de julio.
 *   B  venta de julio con un sobrante de $10 a tramo 2 el mismo día; paga el tramo de
 *      verdad el 1 de septiembre (el caso V0103).
 *   C  venta de septiembre cuyo ÚNICO tramo 2 es un sobrante de $29 (el caso V0294).
 *   D  venta de agosto: sobrante de $3 el 4-sep y pago real el 18-sep (el caso V0447).
 *   E  venta de septiembre que paga el segundo tramo el 20-sep.
 *   F  venta de septiembre en plan 2: sin tramo 2.
 *   X  otro workspace, con un segundo pago en septiembre: nunca aparece.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const NUEVA = '20261008163000_segundo_pago_dos_cifras_soena.sql'
const leer = (a: string) => readFileSync(join(process.cwd(), 'supabase/migrations', a), 'utf8')

const WS = '00000000-0000-4000-8000-0000000000a1'
const OTRO_WS = '00000000-0000-4000-8000-0000000000a2'
const VENDEDORA = '00000000-0000-4000-8000-0000000000c1'
const neg = (l: string) => `00000000-0000-4000-8000-0000000002${l.charCodeAt(0).toString(16)}`

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create table public.negocios (id uuid primary key, workspace_id uuid, codigo text, nombre text);
  create table public.staff (id uuid primary key, full_name text);
  create table public.v_venta_mes_comercial (
    workspace_id uuid, negocio_id uuid, codigo text, nombre text, fecha_venta date,
    segundo_pago numeric, responsable_id uuid
  );
  create table public.v_cobro_valor (
    cobro_id uuid primary key default gen_random_uuid(), workspace_id uuid, negocio_id uuid,
    fecha date, a_tramo2_base numeric
  );
  -- La sesión de prueba: el workspace activo sale de un setting.
  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;
`

type Caso = { l: string; ws?: string; venta: string; abonos: [string, number][]; vendedor?: string | null }

const CASOS: Caso[] = [
  { l: 'A', venta: '2026-06-10', abonos: [['2026-07-07', 357142.86]] },
  { l: 'B', venta: '2026-07-22', abonos: [['2026-07-22', 10.08], ['2026-09-01', 357132.77]] },
  { l: 'C', venta: '2026-09-16', abonos: [['2026-09-16', 28.57]] },
  { l: 'D', venta: '2026-08-12', abonos: [['2026-09-04', 3.36], ['2026-09-18', 357139.5]] },
  { l: 'E', venta: '2026-09-05', abonos: [['2026-09-20', 357142.86]], vendedor: null },
  { l: 'F', venta: '2026-09-08', abonos: [] },
  { l: 'X', ws: OTRO_WS, venta: '2026-09-02', abonos: [['2026-09-03', 357142.86]] },
]

let db: PGlite

/** La respuesta cruda de la RPC (los `numeric` pueden llegar como texto). */
type CasoCrudo = { codigo: string; fecha_venta: string; fecha_pago: string; valor: number | string; responsable: string | null }
type Bloque = { total: number | string; negocios: number; detalle: CasoCrudo[] }
type Respuesta = {
  umbral_migaja: number | string
  recibido: Bloque & { de_ventas_del_mes: number | string; de_ventas_anteriores: number | string }
  de_ventas_del_mes: Bloque
  anterior: { recibido: number | string; de_ventas_del_mes: number | string }
}

async function llamar(anio: number, mes: number, ws = WS) {
  await db.exec(`set prueba.ws = '${ws}'`)
  const r = await db.query<{ j: Respuesta | null }>(
    'select public.get_segundo_pago_mes_soena($1, $2, $3) as j', [WS, anio, mes])
  return r.rows[0].j
}

const codigos = (detalle: { codigo: string }[]) => detalle.map(d => d.codigo).sort()

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.query('insert into staff values ($1, $2)', [VENDEDORA, 'Vendedora Uno'])
  for (const c of CASOS) {
    const ws = c.ws ?? WS
    const id = neg(c.l)
    const acumulado = c.abonos.reduce((s, [, v]) => s + v, 0)
    await db.query('insert into negocios values ($1, $2, $3, $4)', [id, ws, `T${c.l}`, `Caso ${c.l}`])
    await db.query('insert into v_venta_mes_comercial values ($1, $2, $3, $4, $5, $6, $7)',
      [ws, id, `T${c.l}`, `Caso ${c.l}`, c.venta, acumulado, c.vendedor === null ? null : VENDEDORA])
    for (const [fecha, valor] of c.abonos) {
      await db.query(
        'insert into v_cobro_valor (workspace_id, negocio_id, fecha, a_tramo2_base) values ($1, $2, $3, $4)',
        [ws, id, fecha, valor])
    }
  }
  await db.exec(leer(NUEVA))
})

describe('get_segundo_pago_mes_soena', () => {
  it('declara el umbral de migajas en la respuesta', async () => {
    const j = await llamar(2026, 9)
    expect(Number(j!.umbral_migaja)).toBe(1000)
  })

  it('recibido en septiembre: por fecha de pago, sin los sobrantes y partido por mes de venta', async () => {
    const j = await llamar(2026, 9)
    const r = j!.recibido
    // B (venta de julio) y D (venta de agosto) son de meses anteriores; E es de este mes.
    // C no entra: su único abono a tramo 2 es un sobrante. El $3 de D tampoco.
    expect(codigos(r.detalle)).toEqual(['TB', 'TD', 'TE'])
    expect(r.negocios).toBe(3)
    expect(Number(r.total)).toBeCloseTo(357132.77 + 357139.5 + 357142.86, 2)
    expect(Number(r.de_ventas_del_mes)).toBeCloseTo(357142.86, 2)
    expect(Number(r.de_ventas_anteriores)).toBeCloseTo(357132.77 + 357139.5, 2)
    const d = r.detalle.find((x) => x.codigo === 'TD')!
    expect(d.fecha_pago).toBe('2026-09-18')
    expect(Number(d.valor)).toBeCloseTo(357139.5, 2)
    expect(d.fecha_venta).toBe('2026-08-12')
    expect(d.responsable).toBe('Vendedora Uno')
    expect(r.detalle.find((x) => x.codigo === 'TE')!.responsable).toBeNull()
  })

  it('de las ventas de septiembre: el sobrante de C no la vuelve un segundo pago', async () => {
    const j = await llamar(2026, 9)
    expect(codigos(j!.de_ventas_del_mes.detalle)).toEqual(['TE'])
    expect(Number(j!.de_ventas_del_mes.total)).toBeCloseTo(357142.86, 2)
  })

  it('una venta de julio que paga en septiembre suma en JULIO por mes de venta, y en septiembre por caja', async () => {
    const julio = await llamar(2026, 7)
    // Por caja, julio solo tiene a A: el sobrante de $10 de B no cuenta.
    expect(codigos(julio!.recibido.detalle)).toEqual(['TA'])
    // Por mes de venta, B está en julio con su acumulado (incluido el sobrante, porque el
    // umbral de la cohorte es por negocio).
    expect(codigos(julio!.de_ventas_del_mes.detalle)).toEqual(['TB'])
    expect(Number(julio!.de_ventas_del_mes.total)).toBeCloseTo(357142.85, 2)
    expect(julio!.de_ventas_del_mes.detalle[0].fecha_pago).toBe('2026-09-01')
  })

  it('agosto: nada recibido, y D cuenta por su mes de venta con la fecha de su pago real', async () => {
    const agosto = await llamar(2026, 8)
    expect(agosto!.recibido.negocios).toBe(0)
    expect(Number(agosto!.recibido.total)).toBe(0)
    expect(agosto!.recibido.detalle).toEqual([])
    expect(codigos(agosto!.de_ventas_del_mes.detalle)).toEqual(['TD'])
    expect(agosto!.de_ventas_del_mes.detalle[0].fecha_pago).toBe('2026-09-18')
  })

  it('trae los totales del mes anterior con el mismo criterio', async () => {
    const j = await llamar(2026, 9)
    expect(Number(j!.anterior.recibido)).toBe(0)
    expect(Number(j!.anterior.de_ventas_del_mes)).toBeCloseTo(357142.86, 2)
    const agosto = await llamar(2026, 8)
    expect(Number(agosto!.anterior.recibido)).toBeCloseTo(357142.86, 2)
    expect(Number(agosto!.anterior.de_ventas_del_mes)).toBeCloseTo(357142.85, 2)
  })

  it('con la sesión en otro workspace no devuelve nada', async () => {
    expect(await llamar(2026, 9, OTRO_WS)).toBeNull()
  })

  it('anon no la puede ejecutar', async () => {
    const r = await db.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.get_segundo_pago_mes_soena(uuid, integer, integer)', 'execute') as ok`)
    expect(r.rows[0].ok).toBe(false)
  })
})
