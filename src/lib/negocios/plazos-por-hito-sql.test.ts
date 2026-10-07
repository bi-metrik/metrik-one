/**
 * `20261007184500_plazos_por_hito_y_motivo_reproceso.sql` corrida de verdad en Postgres en
 * memoria (PGlite), encima de `20260901000004_alertas_por_plazo.sql`, que es la que está
 * en producción (con CURRENT_DATE ya cambiado por `hoy_bogota()`).
 *
 * Lo que se prueba es lo que decide quién recibe un correo de plazo (SOE-001):
 *   · cada hito con su alcance por etapa y su ancla, o los de la línea si no declara;
 *   · el aviso sale una vez por hito y POR CICLO de reproceso: un rechazo de la DIAN abre
 *     un reloj nuevo y el caso vuelve a recibir los avisos;
 *   · las filas viejas del log (sin ciclo) siguen contando si salieron en el ciclo actual,
 *     para que el primer cron no repita los 63 avisos que ya se mandaron;
 *   · una config vieja se lee exactamente igual.
 *
 * `hoy_bogota()` se reemplaza por un reloj de prueba (`prueba.hoy`).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const MOTOR = '20260901000004_alertas_por_plazo.sql'
const NUEVA = '20261007184500_plazos_por_hito_y_motivo_reproceso.sql'

const WS = '00000000-0000-4000-8000-0000000000a1'
const LINEA = '00000000-0000-4000-8000-0000000000b1'
const etapaId = (orden: number) => `00000000-0000-4000-8000-0000000001${String(orden).padStart(2, '0')}`
const negId = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`

const ESQUEMA_BASE = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;

  create table public.workspaces (id uuid primary key);
  create table public.lineas_negocio (id uuid primary key, workspace_id uuid, config_extra jsonb);
  create table public.etapas_negocio (id uuid primary key, linea_id uuid, nombre text, orden int);
  create table public.negocios (
    id uuid primary key, workspace_id uuid, codigo text, nombre text,
    estado text default 'abierto', etapa_actual_id uuid, metadata jsonb default '{}'::jsonb
  );
  create table public.negocio_bloques (id uuid primary key default gen_random_uuid(), negocio_id uuid, data jsonb);
  create table public.festivos_colombia (fecha date primary key);
  create table public.reproceso_eventos (id uuid primary key default gen_random_uuid(), tipo text, detalle text);
  insert into public.festivos_colombia values ('2026-10-12'), ('2026-11-02'), ('2026-11-16');

  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select null::uuid $$;
  -- Reloj de prueba. En producción es el día civil de Bogotá.
  create function public.hoy_bogota() returns date language sql stable as
    $$ select coalesce(nullif(current_setting('prueba.hoy', true), '')::date, current_date) $$;
`

// Lo que va a quedar en SOENA (SQL de proyecto de SOE-001), reducido a lo que decide.
const CONFIG = {
  areas: ['operaciones'],
  etapas_orden: [19, 21, 22, 23],
  ancla: { campo: 'fecha_entrega_dian', fallback_campo: 'fecha_cita_dian', fallback_dias_habiles: 0 },
  cerrar_si: { campo: 'fecha_devolucion_dian' },
  hitos: [
    { slug: 'radicado_5', dias_habiles: 5, titulo: 'r5', etapas_orden: [19, 21] },
    { slug: 'rechazo_15', dias_habiles: 15, titulo: 'r15', etapas_orden: [19, 21, 22] },
    { slug: 'acto_30', dias_habiles: 30, titulo: 'a30' },
    { slug: 'acto_45', dias_habiles: 45, titulo: 'a45' },
    { slug: 'dinero_5', dias_habiles: 5, titulo: 'd5', etapas_orden: [24], ancla: { campo: 'fecha_acto_administrativo' } },
  ],
}

let db: PGlite

async function pendientes(hoy: string): Promise<Array<{ codigo: string; hito: string; fecha_ancla: string; ancla_origen: string; dias_transcurridos: number }>> {
  await db.exec(`set prueba.hoy = '${hoy}'`)
  const r = await db.query<{ codigo: string; hito: string; fecha_ancla: string; ancla_origen: string; dias_transcurridos: number }>(
    `select codigo, hito, fecha_ancla::text, ancla_origen, dias_transcurridos from public.plazos_pendientes($1)`,
    [LINEA],
  )
  return r.rows
}
const pares = (rows: Array<{ codigo: string; hito: string }>) => rows.map((r) => `${r.codigo}:${r.hito}`).sort()

async function caso(n: number, orden: number, datos: Record<string, unknown>[], metadata: Record<string, unknown> = {}) {
  await db.query(`insert into public.negocios (id, workspace_id, codigo, nombre, etapa_actual_id, metadata) values ($1, $2, $3, $3, $4, $5)`,
    [negId(n), WS, `V${n}`, etapaId(orden), JSON.stringify(metadata)])
  for (const d of datos) {
    await db.query(`insert into public.negocio_bloques (negocio_id, data) values ($1, $2)`, [negId(n), JSON.stringify(d)])
  }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA_BASE)
  await db.exec(leer(MOTOR))
  await db.exec(leer(NUEVA))
  await db.query(`insert into public.workspaces values ($1)`, [WS])
  await db.query(`insert into public.lineas_negocio values ($1, $2, '{}'::jsonb)`, [LINEA, WS])
  for (const [orden, nombre] of [[19, 'Entrega a la DIAN'], [21, 'Confirmación del radicado'], [22, 'Validación de rechazo'], [23, 'Acto administrativo'], [24, 'Dinero en cuenta'], [15, 'Facturación']] as const) {
    await db.query(`insert into public.etapas_negocio values ($1, $2, $3, $4)`, [etapaId(orden), LINEA, nombre, orden])
  }
})

beforeEach(async () => {
  await db.exec(`delete from public.alertas_plazo_log; delete from public.negocio_bloques; delete from public.negocios;`)
  await db.query(`update public.lineas_negocio set config_extra = jsonb_build_object('alertas_plazo', $1::jsonb)`, [JSON.stringify(CONFIG)])
})

describe('alcance por hito', () => {
  it('un caso en Acto administrativo con T0 viejo NO recibe los hitos de etapas que ya pasó', async () => {
    // T0 = 2026-08-03; al 2026-10-07 lleva 46 días hábiles.
    await caso(1, 23, [{ fecha_entrega_dian: '2026-08-03' }])
    expect(pares(await pendientes('2026-10-07'))).toEqual(['V1:acto_30', 'V1:acto_45'])
  })

  it('un caso todavía en Entrega a la DIAN recibe todos los que le alcanzan por días', async () => {
    await caso(2, 19, [{ fecha_entrega_dian: '2026-09-09' }]) // 20 días hábiles al 2026-10-07
    expect(pares(await pendientes('2026-10-07'))).toEqual(['V2:radicado_5', 'V2:rechazo_15'])
  })

  it('el hito sin `etapas_orden` hereda las de la línea (acto_30 no le llega a quien está en Dinero en cuenta)', async () => {
    await caso(3, 24, [{ fecha_entrega_dian: '2026-07-01' }])
    expect(pares(await pendientes('2026-10-07'))).toEqual([])
  })

  it('ancla propia: Dinero en cuenta cuenta desde el acto administrativo, no desde T0', async () => {
    await caso(4, 24, [{ fecha_entrega_dian: '2026-07-01' }, { fecha_acto_administrativo: '2026-09-30' }])
    const r = await pendientes('2026-10-07') // 5 días hábiles desde el 30-sep
    expect(pares(r)).toEqual(['V4:dinero_5'])
    expect(r[0]).toMatchObject({ fecha_ancla: '2026-09-30', ancla_origen: 'declarada', dias_transcurridos: 5 })
    expect(pares(await pendientes('2026-10-06'))).toEqual([])
  })

  it('sin T0 cae a la fecha de la cita con 0 días de más, marcada como estimada', async () => {
    await caso(5, 21, [{ fecha_cita_dian: '2026-09-29T07:00' }])
    const r = await pendientes('2026-10-07')
    expect(pares(r)).toEqual(['V5:radicado_5'])
    expect(r[0]).toMatchObject({ fecha_ancla: '2026-09-29', ancla_origen: 'estimada', dias_transcurridos: 6 })
  })

  it('con la devolución registrada el caso sale de todos los relojes', async () => {
    await caso(6, 23, [{ fecha_entrega_dian: '2026-08-03' }, { fecha_devolucion_dian: '2026-10-01' }])
    expect(await pendientes('2026-10-07')).toEqual([])
  })

  it('un caso cerrado no entra', async () => {
    await caso(7, 23, [{ fecha_entrega_dian: '2026-08-03' }])
    await db.query(`update public.negocios set estado = 'completado' where id = $1`, [negId(7)])
    expect(await pendientes('2026-10-07')).toEqual([])
  })

  it('una config vieja (alcance y ancla solo de línea) se lee como antes', async () => {
    await db.query(`update public.lineas_negocio set config_extra = jsonb_build_object('alertas_plazo', $1::jsonb)`, [JSON.stringify({
      areas: ['comercial'],
      etapas_orden: [19],
      ancla: { campo: 'fecha_radicacion_dian', fallback_campo: 'fecha_cita_dian', fallback_dias_habiles: 5 },
      cerrar_si: { campo: 'fecha_devolucion_dian' },
      hitos: [{ slug: 'inadmisorio_15', dias_habiles: 15, titulo: 'i15' }, { slug: 'devolucion_50', dias_habiles: 50, titulo: 'd50' }],
    })])
    await caso(8, 19, [{ fecha_cita_dian: '2026-09-01' }])
    await caso(9, 21, [{ fecha_cita_dian: '2026-09-01' }])
    const r = await pendientes('2026-10-07')
    // 2026-09-01 + 5 hábiles = 2026-09-08; al 2026-10-07 van 21.
    expect(pares(r)).toEqual(['V8:inadmisorio_15'])
    expect(r[0]).toMatchObject({ fecha_ancla: '2026-09-08', ancla_origen: 'estimada', dias_transcurridos: 21 })
  })
})

describe('un aviso por hito y por ciclo de reproceso', () => {
  const avisar = (n: number, hito: string, enviado: string) => db.query(
    `insert into public.alertas_plazo_log (negocio_id, workspace_id, hito, fecha_ancla, ancla_origen, dias_habiles, enviado_at)
     values ($1, $2, $3, '2026-09-01', 'declarada', 5, $4)`, [negId(n), WS, hito, enviado])

  it('ya avisado en este ciclo: no se repite', async () => {
    await caso(10, 21, [{ fecha_entrega_dian: '2026-09-01' }])
    await avisar(10, 'radicado_5', '2026-09-09T13:00:00Z')
    // El de 5 no se repite; el de 15 (26 días hábiles, sigue en una etapa de su alcance) sí sale.
    expect(pares(await pendientes('2026-10-07'))).toEqual(['V10:rechazo_15'])
  })

  it('tras un reproceso (rechazo de la DIAN) el reloj es nuevo y el aviso vuelve a salir', async () => {
    await caso(11, 21, [{ fecha_entrega_dian: '2026-09-25' }], { reproceso: { ciclo: 1, abierto_at: '2026-09-20T15:00:00Z', activo: true } })
    await avisar(11, 'radicado_5', '2026-09-09T13:00:00Z') // del ciclo anterior
    expect(pares(await pendientes('2026-10-07'))).toEqual(['V11:radicado_5'])
  })

  it('el trigger pone el ciclo del negocio: el segundo aviso entra sin chocar con el del ciclo anterior', async () => {
    await caso(12, 21, [{ fecha_entrega_dian: '2026-09-01' }])
    await avisar(12, 'radicado_5', '2026-09-09T13:00:00Z')
    await db.query(`update public.negocios set metadata = '{"reproceso":{"ciclo":2,"abierto_at":"2026-09-20T15:00:00Z"}}' where id = $1`, [negId(12)])
    await avisar(12, 'radicado_5', '2026-09-30T13:00:00Z')
    const r = await db.query<{ ciclo: number }>(`select ciclo from public.alertas_plazo_log where negocio_id = $1 order by enviado_at`, [negId(12)])
    expect(r.rows.map((x) => x.ciclo)).toEqual([0, 2])
    // …y dentro del mismo ciclo la UNIQUE sigue ganando la carrera.
    await expect(avisar(12, 'radicado_5', '2026-10-01T13:00:00Z')).rejects.toThrow(/alertas_plazo_log_unico/)
  })

  it('el ciclo que mande quien inserta se ignora', async () => {
    await caso(13, 21, [{ fecha_entrega_dian: '2026-09-01' }])
    await db.query(`insert into public.alertas_plazo_log (negocio_id, workspace_id, hito, fecha_ancla, ancla_origen, dias_habiles, ciclo)
                    values ($1, $2, 'x', '2026-09-01', 'declarada', 5, 7)`, [negId(13), WS])
    const r = await db.query<{ ciclo: number }>(`select ciclo from public.alertas_plazo_log where negocio_id = $1`, [negId(13)])
    expect(r.rows[0].ciclo).toBe(0)
  })

  it('una fila VIEJA (ciclo 0) enviada DESPUÉS del último reproceso sigue contando: el primer cron no la repite', async () => {
    await caso(14, 21, [{ fecha_entrega_dian: '2026-09-01' }])
    await avisar(14, 'radicado_5', '2026-09-30T13:00:00Z') // nace con ciclo 0
    await db.query(`update public.negocios set metadata = '{"reproceso":{"ciclo":1,"abierto_at":"2026-09-20T15:00:00Z"}}' where id = $1`, [negId(14)])
    expect(pares(await pendientes('2026-10-07'))).toEqual(['V14:rechazo_15'])
  })

  it('una fecha de reproceso ilegible no tumba la consulta de la línea', async () => {
    await caso(15, 21, [{ fecha_entrega_dian: '2026-09-25' }], { reproceso: { ciclo: 1, abierto_at: 'ayer' } })
    expect(pares(await pendientes('2026-10-07'))).toEqual(['V15:radicado_5'])
  })
})

describe('permisos', () => {
  it('plazos_pendientes y la función del trigger no son alcanzables desde el cliente', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean; trg_auth: boolean }>(`
      select has_function_privilege('anon', 'public.plazos_pendientes(uuid)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.plazos_pendientes(uuid)', 'execute') as auth,
             has_function_privilege('authenticated', 'public.alertas_plazo_log_ciclo()', 'execute') as trg_auth`)
    expect(r.rows[0]).toEqual({ anon: false, auth: false, trg_auth: false })
  })

  it('reproceso_eventos gana la columna motivo, nullable', async () => {
    const r = await db.query<{ is_nullable: string }>(`select is_nullable from information_schema.columns where table_name = 'reproceso_eventos' and column_name = 'motivo'`)
    expect(r.rows).toEqual([{ is_nullable: 'YES' }])
  })
})
