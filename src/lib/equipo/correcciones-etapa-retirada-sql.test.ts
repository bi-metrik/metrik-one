/**
 * `20261010113000_correcciones_etapa_retirada.sql` corrida de verdad en Postgres en memoria
 * (PGlite). SOE-006: el 7-oct «Seguimiento» pasó a llamarse «Entrega a la DIAN» y el denominador
 * de Correcciones (salidas de Envío hacia adelante) cayó a cero en agosto y septiembre, porque
 * `activity_log` guarda el NOMBRE de la etapa y las RPC lo resolvían contra el nombre de hoy.
 *
 * Lo que se prueba:
 *   · una salida de Envío hacia una etapa RENOMBRADA (antes del trigger, por la semilla) cuenta;
 *   · un RETROCESO desde Envío no cuenta;
 *   · después de la migración, renombrar o borrar una etapa no tumba el conteo (trigger);
 *   · el resumen y el detalle cuentan lo mismo;
 *   · Dirección: «calificados» ya no atrapa «Validación de rechazo» y sobrevive al renombre de
 *     Validación.
 *
 * Las RPC del bono se cargan desde sus migraciones reales (20260901000006, 20260901000007 y el
 * parche 20261008223000), así que el reemplazo de texto se prueba contra el texto que lo recibe.
 * `get_directivo_soena` necesita media base del Comercial: se monta una función mínima con el
 * bloque `calificados` copiado del archivo de su migración (no a mano), que es lo único que la
 * migración le toca. `horas_habiles_jornada` se reemplaza por horas corridas: no decide nada de
 * Correcciones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const MIGRACION = '20261010113000_correcciones_etapa_retirada.sql'

const WS = '00000000-0000-4000-8000-00000000e001'
const LINEA = '00000000-0000-4000-8000-00000000e002'
const CAMILA = '00000000-0000-4000-8000-00000000e003'
const CAMILA_PERFIL = '00000000-0000-4000-8000-00000000e004'
const LIDER = '00000000-0000-4000-8000-00000000e005'
const LIDER_PERFIL = '00000000-0000-4000-8000-00000000e006'

// Etapas. La 19 lleva el id real de SOENA porque la semilla de la migración la busca por id.
const E_VALIDACION = '00000000-0000-4000-8000-0000000e0001'
const E_DOCUMENTACION = '00000000-0000-4000-8000-0000000e0006'
const E_CARGUE = '00000000-0000-4000-8000-0000000e0007'
const E_ENVIO = '00000000-0000-4000-8000-0000000e0014'
const E_FACTURACION = '00000000-0000-4000-8000-0000000e0015'
const E_ANEXOS = '00000000-0000-4000-8000-0000000e0018'
const E_19 = '3f2a9c6e-5d41-4b8a-9e13-7c0d2a84b501'
const E_RECHAZO = '00000000-0000-4000-8000-0000000e0022'

const negocio = (n: number) => `00000000-0000-4000-8000-0000000a${String(n).padStart(4, '0')}`

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  create table public.workspaces (id uuid primary key, slug text);
  create table public.profiles (id uuid primary key, workspace_id uuid, full_name text, role text);
  create table public.staff (
    id uuid primary key, workspace_id uuid, full_name text, position text, salary numeric,
    is_active boolean default true, profile_id uuid
  );
  create table public.staff_areas (staff_id uuid, area text);
  create table public.lineas_negocio (id uuid primary key, workspace_id uuid, nombre text, config_extra jsonb default '{}');
  create table public.etapas_negocio (
    id uuid primary key, linea_id uuid not null, stage text, nombre text not null, orden int not null,
    is_active boolean default true, numero int
  );
  create table public.negocios (
    id uuid primary key, workspace_id uuid, linea_id uuid, codigo text, nombre text,
    estado text default 'abierto', metadata jsonb default '{}', created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table public.negocio_responsables (negocio_id uuid, staff_id uuid, assigned_at timestamptz, assigned_by uuid, rol text);
  create table public.bloque_configs (
    id uuid primary key, etapa_id uuid, workspace_id uuid, slug text, nombre text, es_gate boolean,
    config_extra jsonb default '{}', estado text, orden int
  );
  create table public.negocio_bloques (
    id uuid primary key default gen_random_uuid(), negocio_id uuid, bloque_config_id uuid, estado text,
    completado_por uuid, completado_at timestamptz, data jsonb default '{}'
  );
  create table public.reproceso_eventos (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, negocio_id uuid, ciclo int,
    tipo text, causa text, detalle text, atribuido_a uuid, abierto_por uuid, abierto_at timestamptz,
    cerrado_at timestamptz, motivo text
  );
  create table public.festivos_colombia (fecha date, descripcion text);
  create table public.activity_log (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, entidad_tipo text,
    entidad_id uuid, tipo text, autor_id uuid, contenido text, campo_modificado text,
    valor_anterior text, valor_nuevo text, created_at timestamptz default now()
  );
  create table public.contactos (id uuid primary key, workspace_id uuid, created_at timestamptz);
  create table public.config_bono_operaciones (
    workspace_id uuid primary key, bono_max_pct numeric, calidad_base numeric, calidad_tramo numeric,
    calidad_frac_un_malo numeric, calidad_malos_pierde_todo integer, peso_radicacion numeric,
    peso_envio numeric, peso_correcciones numeric, piso_operativo numeric, techo_operativo numeric,
    horas_radicacion integer, horas_desde_certificado integer, horas_antes_cita integer,
    bono_max_pct_director numeric, piso_director numeric, techo_director numeric,
    updated_at timestamptz, correcciones_cobertura text, radicacion_reloj text,
    jornada_inicio_hora integer, jornada_fin_hora integer, jornada_sabado_habil boolean,
    etapa_radicacion_dian_orden integer
  );

  create function public.current_user_workspace_id() returns uuid language sql stable as
    $$ select nullif(current_setting('prueba.ws', true), '')::uuid $$;
  create function public.horas_habiles_jornada(
    p_desde timestamptz, p_hasta timestamptz, p_sabado_habil boolean, p_jornada_inicio integer, p_jornada_fin integer
  ) returns numeric language sql immutable as
    $$ select extract(epoch from (p_hasta - p_desde)) / 3600 $$;
`

/** El bloque `calificados` de Dirección tal como está en su migración, dentro de una función mínima. */
function directivoMinimo(): string {
  const sql = leer('20260831000003_rpc_directivo_soena.sql')
  const inicio = sql.indexOf('calificados as (')
  const fin = sql.indexOf('\n),', inicio)
  if (inicio < 0 || fin < 0) throw new Error('calificados no está en 20260831000003')
  const calificados = sql.slice(inicio, fin + 3)
  return `
CREATE OR REPLACE FUNCTION public.get_directivo_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with guard as (
  select p_workspace_id as id
  where p_workspace_id = current_user_workspace_id()
),
rango as (
  select make_date(p_anio, p_mes, 1) as desde,
         (make_date(p_anio, p_mes, 1) + interval '1 month')::date as hasta
),
${calificados}
dummy as (select 1)
select jsonb_build_object('comercial', jsonb_build_object('leads_calificados', (select n from calificados)))
$function$;`
}

const DATOS = `
  insert into public.workspaces values ('${WS}', 'soena');
  insert into public.profiles values
    ('${CAMILA_PERFIL}', '${WS}', 'Operativa', 'operator'),
    ('${LIDER_PERFIL}', '${WS}', 'Lider', 'admin');
  insert into public.staff (id, workspace_id, full_name, position, salary, profile_id) values
    ('${CAMILA}', '${WS}', 'Operativa', 'Analista', 1000000, '${CAMILA_PERFIL}'),
    ('${LIDER}', '${WS}', 'Lider', 'Supervisora', 2000000, '${LIDER_PERFIL}');
  insert into public.staff_areas values ('${CAMILA}', 'operaciones'), ('${LIDER}', 'operaciones');
  insert into public.lineas_negocio (id, workspace_id, nombre) values ('${LINEA}', '${WS}', 'Linea');
  -- Como estaban las etapas en producción al aplicar la migración: la 19 ya renombrada.
  insert into public.etapas_negocio (id, linea_id, nombre, orden) values
    ('${E_VALIDACION}', '${LINEA}', 'Validación', 1),
    ('${E_DOCUMENTACION}', '${LINEA}', 'Documentación', 6),
    ('${E_CARGUE}', '${LINEA}', 'Cargue', 7),
    ('${E_ENVIO}', '${LINEA}', 'Envío', 14),
    ('${E_FACTURACION}', '${LINEA}', 'Facturación', 15),
    ('${E_ANEXOS}', '${LINEA}', 'Anexos', 18),
    ('${E_19}', '${LINEA}', 'Entrega a la DIAN', 19),
    ('${E_RECHAZO}', '${LINEA}', 'Validación de rechazo', 22);
  insert into public.config_bono_operaciones values (
    '${WS}', 0.30, 0.30, 0.10, 1.00, 2, 0.20, 0.20, 0.20, 0.95, 1.00, 72, 48, 36,
    0.15, 0.90, 1.00, now(), 'devolucion_dian', 'habil', 0, 24, false, 14
  );
  insert into public.negocios (id, workspace_id, linea_id, codigo, nombre)
    select ('00000000-0000-4000-8000-0000000a' || lpad(g::text, 4, '0'))::uuid, '${WS}', '${LINEA}', 'V' || g, 'Caso ' || g
    from generate_series(1, 9) g;

  -- Septiembre de 2026, hora de Bogotá dentro del mes.
  insert into public.activity_log (workspace_id, entidad_tipo, entidad_id, tipo, autor_id, valor_anterior, valor_nuevo, created_at) values
    -- 1. Hacia la 19 cuando todavía se llamaba «Seguimiento» (lo que tumbó el indicador).
    ('${WS}', 'negocio', '${negocio(1)}', 'cambio_etapa', '${CAMILA}', 'Envío', 'Seguimiento', '2026-09-10 15:00:00+00'),
    -- 2. Retroceso a Cargue: no es una radicación.
    ('${WS}', 'negocio', '${negocio(2)}', 'cambio_etapa', '${CAMILA}', 'Envío', 'Cargue', '2026-09-11 15:00:00+00'),
    -- 3. Hacia adelante, con el nombre de hoy.
    ('${WS}', 'negocio', '${negocio(3)}', 'cambio_etapa', '${CAMILA}', 'Envío', 'Facturación', '2026-09-12 15:00:00+00'),
    -- 4. Hacia Anexos: la prueba la borra después y tiene que seguir contando.
    ('${WS}', 'negocio', '${negocio(4)}', 'cambio_etapa', '${CAMILA}', 'Envío', 'Anexos', '2026-09-13 15:00:00+00'),
    -- 9. Retroceso a Documentación: la prueba la borra después y tiene que seguir sin contar.
    ('${WS}', 'negocio', '${negocio(9)}', 'cambio_etapa', '${CAMILA}', 'Envío', 'Documentación', '2026-09-13 16:00:00+00'),
    -- Dirección: dos salidas de Validación y una de «Validación de rechazo».
    ('${WS}', 'negocio', '${negocio(5)}', 'cambio_etapa', '${CAMILA}', 'Validación', 'Cargue', '2026-09-14 15:00:00+00'),
    ('${WS}', 'negocio', '${negocio(6)}', 'cambio_etapa', '${CAMILA}', 'Validación', 'Cargue', '2026-09-15 15:00:00+00'),
    ('${WS}', 'negocio', '${negocio(7)}', 'cambio_etapa', '${CAMILA}', 'Validación de rechazo', 'Entrega a la DIAN', '2026-09-16 15:00:00+00');

  -- Una devolución propia en el mes: sin ella Correcciones no se mide (cobertura).
  insert into public.reproceso_eventos (workspace_id, negocio_id, ciclo, tipo, causa, atribuido_a, abierto_at)
    values ('${WS}', '${negocio(1)}', 1, 'devolucion_dian', 'error_propio', '${CAMILA}', '2026-09-20 15:00:00+00');
`

let db: PGlite

async function resumenCamila(): Promise<{ radicaciones: number; correcciones: number; pct: number | null }> {
  const r = await db.query<{ r: { personas: Array<{ staff_id: string; correcciones: Record<string, unknown> }> } }>(
    `select public.get_operaciones_bono_resumen($1, 2026, 9) as r`,
    [WS],
  )
  const p = r.rows[0].r.personas.find((x) => x.staff_id === CAMILA)
  if (!p) throw new Error('Camila no está en el resumen')
  return {
    radicaciones: Number(p.correcciones.radicaciones),
    correcciones: Number(p.correcciones.correcciones),
    pct: p.correcciones.pct == null ? null : Number(p.correcciones.pct),
  }
}

async function detalleCamila(): Promise<string[]> {
  const r = await db.query<{ r: { radicaciones_dian: Array<{ codigo: string }> } }>(
    `select public.get_operaciones_bono_detalle($1, 2026, 9) as r`,
    [CAMILA],
  )
  return r.rows[0].r.radicaciones_dian.map((x) => x.codigo).sort()
}

async function calificados(): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select (public.get_directivo_soena($1, 2026, 9)->'comercial'->>'leads_calificados')::int as n`,
    [WS],
  )
  return r.rows[0].n
}

let antes: { resumen: Awaited<ReturnType<typeof resumenCamila>>; detalle: string[]; calificados: number }

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(leer('20260901000006_config_bono_por_mes.sql'))
  await db.exec(leer('20260901000007_detalle_bono_por_indicador.sql'))
  await db.exec(leer('20261008223000_bono_operaciones_historico_inactivos.sql'))
  await db.exec(directivoMinimo())
  await db.exec(DATOS)
  await db.exec(`set prueba.ws = '${WS}'`)

  antes = { resumen: await resumenCamila(), detalle: await detalleCamila(), calificados: await calificados() }

  await db.exec(leer(MIGRACION))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('antes de la migración (lo que vio Deisy)', () => {
  it('la salida hacia «Seguimiento» no contaba: solo Facturación y Anexos', () => {
    expect(antes.resumen.radicaciones).toBe(2)
    expect(antes.detalle).toEqual(['V3', 'V4'])
  })

  it('«calificados» atrapaba «Validación de rechazo»', () => {
    expect(antes.calificados).toBe(3)
  })
})

describe('Correcciones con etapas renombradas o retiradas', () => {
  it('siembra el renombre de Seguimiento contra la etapa 19', async () => {
    const r = await db.query<{ nombre: string; origen: string }>(
      `select nombre, origen from public.etapas_nombres_anteriores where etapa_id = $1`,
      [E_19],
    )
    expect(r.rows).toEqual([{ nombre: 'Seguimiento', origen: 'semilla' }])
  })

  it('una salida de Envío hacia una etapa retirada cuenta; un retroceso no', async () => {
    const r = await resumenCamila()
    // Seguimiento (19), Facturación (15) y Anexos (18). Cargue (7) es retroceso.
    expect(r.radicaciones).toBe(3)
    expect(r.correcciones).toBe(1)
    expect(r.pct).toBeCloseTo(2 / 3, 6)
  })

  it('el detalle lista los mismos casos que cuenta el resumen', async () => {
    expect(await detalleCamila()).toEqual(['V1', 'V3', 'V4'])
  })

  it('un nombre que ninguna etapa tuvo nunca no tumba el conteo', async () => {
    const r = await db.query<{ o: number | null }>(
      `select public.etapa_orden_registrada($1, 'Etapa que nunca existió', now()) as o`,
      [LINEA],
    )
    expect(r.rows[0].o).toBeNull()
  })

  it('renombrar una etapa después de la migración no cambia nada (trigger)', async () => {
    await db.exec(`update public.etapas_negocio set nombre = 'Facturación DIAN' where id = '${E_FACTURACION}'`)
    expect((await resumenCamila()).radicaciones).toBe(3)
    // Y el nombre nuevo también se resuelve, para lo que se registre de aquí en adelante.
    const r = await db.query<{ o: number }>(
      `select public.etapa_orden_registrada($1, 'Facturación DIAN', now()) as o`,
      [LINEA],
    )
    expect(r.rows[0].o).toBe(15)
  })

  it('borrar una etapa no tumba el conteo: queda su orden', async () => {
    await db.exec(`delete from public.etapas_negocio where id = '${E_ANEXOS}'`)
    expect((await resumenCamila()).radicaciones).toBe(3)
    expect(await detalleCamila()).toEqual(['V1', 'V3', 'V4'])
  })

  it('un retroceso hacia una etapa que después se borra sigue sin contar', async () => {
    await db.exec(`delete from public.etapas_negocio where id = '${E_DOCUMENTACION}'`)
    expect((await resumenCamila()).radicaciones).toBe(3)
    expect(await detalleCamila()).toEqual(['V1', 'V3', 'V4'])
  })

  it('renombrar Envío tampoco rompe el origen', async () => {
    await db.exec(`update public.etapas_negocio set nombre = 'Envío al cliente' where id = '${E_ENVIO}'`)
    expect((await resumenCamila()).radicaciones).toBe(3)
  })

  it('un retroceso hacia una etapa renombrada sigue sin contar', async () => {
    await db.exec(`update public.etapas_negocio set nombre = 'Cargue UPME' where id = '${E_CARGUE}'`)
    // El retroceso de septiembre quedó escrito como «Cargue»: se resuelve a la 7 y no cuenta.
    expect((await resumenCamila()).radicaciones).toBe(3)
    const r = await db.query<{ o: number }>(
      `select public.etapa_orden_registrada($1, 'Cargue', '2026-09-11 15:00:00+00') as o`,
      [LINEA],
    )
    expect(r.rows[0].o).toBe(7)
  })

  it('las funciones nuevas no las ejecuta un cliente', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(`
      select has_function_privilege('anon', 'public.etapa_orden_registrada(uuid,text,timestamptz)', 'execute') as anon,
             has_function_privilege('authenticated', 'public.etapa_orden_registrada(uuid,text,timestamptz)', 'execute') as auth`)
    expect(r.rows[0]).toEqual({ anon: false, auth: false })
  })
})

describe('Dirección: calificados', () => {
  it('ya no cuenta salidas de «Validación de rechazo»', async () => {
    expect(await calificados()).toBe(2)
  })

  it('sobrevive al renombre de Validación', async () => {
    await db.exec(`update public.etapas_negocio set nombre = 'Filtro inicial' where id = '${E_VALIDACION}'`)
    expect(await calificados()).toBe(2)
  })
})
