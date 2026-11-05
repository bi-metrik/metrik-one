/**
 * `20261105153000_soe040_envio_dia_habil_anterior.sql` corrida de verdad en Postgres en memoria
 * (PGlite). SOE-040: SOENA mide Envío como «enviado al cliente el día hábil anterior a la cita,
 * antes de las 5:00 p. m.». Con horas antes de la cita no se puede: una cita en lunes o tras un
 * festivo necesita el viernes.
 *
 * Lo que se prueba:
 *   · `dia_habil_anterior` salta fines de semana y festivos (y el sábado si la jornada lo incluye);
 *   · con `envio_modo` por defecto, resumen y detalle dan EXACTAMENTE lo mismo que antes;
 *   · en el modo nuevo: cita en lunes, cita el día después de un festivo, 16:59 cumple y 17:01 no,
 *     sin la condición de las 48 h del certificado, y el caso sin cita sigue fuera del universo;
 *   · resumen y detalle cuentan lo mismo en los dos modos (paridad);
 *   · congelar un mes copia el modo y la hora de corte.
 *
 * Las RPC se cargan desde sus migraciones reales (20260901000006, 20260901000007 y los parches
 * 20261008223000 y 20261010113000), así que los reemplazos de texto se prueban contra el texto que
 * los recibe. `horas_habiles_jornada` se reemplaza por horas corridas: no decide nada de Envío.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { festivosColombia } from '@/lib/dates/festivos-colombia'

const MIGRACIONES = join(process.cwd(), 'supabase/migrations')
const leer = (a: string) => readFileSync(join(MIGRACIONES, a), 'utf8')
const MIGRACION = '20261105153000_soe040_envio_dia_habil_anterior.sql'

const WS = '00000000-0000-4000-8000-00000000f001'
const LINEA = '00000000-0000-4000-8000-00000000f002'
const ANA = '00000000-0000-4000-8000-00000000f003'
const ANA_PERFIL = '00000000-0000-4000-8000-00000000f004'
const ETAPA = '00000000-0000-4000-8000-00000000f005'
const BC_CERT = '00000000-0000-4000-8000-00000000f011'
const BC_CITA = '00000000-0000-4000-8000-00000000f012'
const BC_ENVIO = '00000000-0000-4000-8000-00000000f013'

const negocio = (n: number) => `00000000-0000-4000-8000-0000000b${String(n).padStart(4, '0')}`

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
  create table public.festivos_colombia (fecha date primary key, descripcion text);
  create table public.activity_log (
    id uuid primary key default gen_random_uuid(), workspace_id uuid, entidad_tipo text,
    entidad_id uuid, tipo text, autor_id uuid, contenido text, campo_modificado text,
    valor_anterior text, valor_nuevo text, created_at timestamptz default now()
  );
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

/**
 * Envíos de octubre de 2026 (horas de Bogotá, UTC-5). Festivos del mes: lunes 12 (Día de la Raza).
 * El certificado bancario va el 1-oct en todos: en el modo de horas ninguno cumple las 48 h, así
 * que todo lo que cumpla en el modo nuevo prueba que esa condición ya no aplica.
 */
const ENVIOS: Array<{ n: number; cita: string | null; envio: string; cumpleNuevo: boolean | null }> = [
  // Cita martes 13 tras el festivo del lunes 12: el día hábil anterior es el viernes 9.
  { n: 1, cita: '2026-10-13', envio: '2026-10-09 16:59', cumpleNuevo: true },
  { n: 2, cita: '2026-10-13', envio: '2026-10-09 17:01', cumpleNuevo: false },
  // Enviado el lunes festivo: ya es tarde (el límite fue el viernes).
  { n: 3, cita: '2026-10-13', envio: '2026-10-12 09:00', cumpleNuevo: false },
  // Cita en lunes 26: el día hábil anterior es el viernes 23.
  { n: 4, cita: '2026-10-26', envio: '2026-10-23 16:59', cumpleNuevo: true },
  { n: 5, cita: '2026-10-26', envio: '2026-10-23 17:01', cumpleNuevo: false },
  // Cita en miércoles 21: el martes 20.
  { n: 6, cita: '2026-10-21', envio: '2026-10-20 16:59', cumpleNuevo: true },
  // Enviado con días de sobra: cumple.
  { n: 7, cita: '2026-10-30', envio: '2026-10-22 10:00', cumpleNuevo: true },
  // Sin cita: fuera del universo (cuenta en eventos, no en medibles).
  { n: 8, cita: null, envio: '2026-10-15 10:00', cumpleNuevo: null },
]

/** En el modo de horas (48 h desde el certificado del 1-oct): solo el que se envió a tiempo del certificado. */
const N_CERT_A_TIEMPO = 9
const ENVIO_CERT_A_TIEMPO = { n: N_CERT_A_TIEMPO, cita: '2026-10-08', envio: '2026-10-02 10:00', cumpleNuevo: true }
const TODOS = [...ENVIOS, ENVIO_CERT_A_TIEMPO]

const bogota = (local: string) => `${local}:00-05`

function datos(): string {
  const festivos = [2026, 2027].flatMap((a) => festivosColombia(a))
  const filas: string[] = []
  for (const e of TODOS) {
    filas.push(`('${negocio(e.n)}', '${BC_CERT}', 'completado', '${ANA_PERFIL}', '${bogota('2026-10-01 08:00')}', '{}')`)
    if (e.cita) filas.push(`('${negocio(e.n)}', '${BC_CITA}', 'completado', '${ANA_PERFIL}', '${bogota('2026-10-01 08:00')}', '{"fecha":"${e.cita}"}')`)
    filas.push(`('${negocio(e.n)}', '${BC_ENVIO}', 'completado', '${ANA_PERFIL}', '${bogota(e.envio)}', '{}')`)
  }
  return `
    insert into public.festivos_colombia (fecha, descripcion)
      select distinct on (f) f::date, d from (values ${festivos.map((f) => `('${f.fecha}', '${f.descripcion.replace(/'/g, "''")}')`).join(',')}) v(f, d);
    insert into public.workspaces values ('${WS}', 'soena');
    insert into public.profiles values ('${ANA_PERFIL}', '${WS}', 'Ana', 'operator');
    insert into public.staff (id, workspace_id, full_name, position, salary, profile_id)
      values ('${ANA}', '${WS}', 'Ana', 'Analista', 1000000, '${ANA_PERFIL}');
    insert into public.staff_areas values ('${ANA}', 'operaciones');
    insert into public.lineas_negocio (id, workspace_id, nombre) values ('${LINEA}', '${WS}', 'Linea');
    insert into public.etapas_negocio (id, linea_id, nombre, orden) values ('${ETAPA}', '${LINEA}', 'Envío', 14);
    insert into public.bloque_configs (id, etapa_id, workspace_id, slug, nombre) values
      ('${BC_CERT}', '${ETAPA}', '${WS}', 'certificado_bancario', 'Certificado bancario'),
      ('${BC_CITA}', '${ETAPA}', '${WS}', 'fecha_cita_dian', 'Fecha cita DIAN'),
      ('${BC_ENVIO}', '${ETAPA}', '${WS}', 'confirmacion_envio_de_correo', 'Envío de correo');
    insert into public.config_bono_operaciones values (
      '${WS}', 0.30, 0.30, 0.10, 1.00, 2, 0.20, 0.20, 0.20, 0.95, 1.00, 72, 48, 36,
      0.15, 0.90, 1.00, now(), 'devolucion_dian', 'habil', 0, 24, false, 14
    );
    insert into public.negocios (id, workspace_id, linea_id, codigo, nombre)
      select ('00000000-0000-4000-8000-0000000b' || lpad(g::text, 4, '0'))::uuid, '${WS}', '${LINEA}', 'E' || g, 'Caso ' || g
      from generate_series(1, ${TODOS.length}) g;
    insert into public.negocio_bloques (negocio_id, bloque_config_id, estado, completado_por, completado_at, data)
      values ${filas.join(',\n      ')};
  `
}

type EnvioResumen = { pct: number | null; a_tiempo: number; medibles: number; eventos: number }
type EnvioDet = { codigo: string; a_tiempo: boolean | null; motivo: string | null; limite_envio?: string | null }

let db: PGlite

async function resumen(mes = 10): Promise<{ personas: unknown[]; envio: EnvioResumen; parametros: Record<string, unknown> }> {
  const r = await db.query<{ r: { personas: Array<{ staff_id: string; envio: EnvioResumen }>; parametros: Record<string, unknown> } }>(
    `select public.get_operaciones_bono_resumen($1, 2026, $2) as r`, [WS, mes],
  )
  const p = r.rows[0].r.personas.find((x) => x.staff_id === ANA)
  if (!p) throw new Error('Ana no está en el resumen')
  return { personas: r.rows[0].r.personas, envio: p.envio, parametros: r.rows[0].r.parametros }
}

async function detalle(mes = 10): Promise<EnvioDet[]> {
  const r = await db.query<{ r: { envios: EnvioDet[] } }>(
    `select public.get_operaciones_bono_detalle($1, 2026, $2) as r`, [ANA, mes],
  )
  return [...r.rows[0].r.envios].sort((a, b) => a.codigo.localeCompare(b.codigo))
}

const soloJuicio = (d: EnvioDet[]) => d.map((e) => ({ codigo: e.codigo, a_tiempo: e.a_tiempo, motivo: e.motivo }))

let antes: { personas: unknown[]; detalle: ReturnType<typeof soloJuicio> }

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(leer('20260901000006_config_bono_por_mes.sql'))
  await db.exec(leer('20260901000007_detalle_bono_por_indicador.sql'))
  await db.exec(leer('20261008223000_bono_operaciones_historico_inactivos.sql'))
  // La sección 6 parcha la RPC de Dirección, que esta base no tiene.
  const correcciones = leer('20261010113000_correcciones_etapa_retirada.sql')
  const corte = correcciones.indexOf('-- ── 6. Dirección')
  if (corte < 0) throw new Error('20261010113000 cambió de forma: no encuentro la sección 6')
  await db.exec(correcciones.slice(0, corte))
  // Como está en producción (ensayo de SOE-040): en el RESUMEN la línea de `horas_antes_cita` de
  // `cfg` lleva UN espacio antes de AS; en el DETALLE sigue alineada con varios. La migración tiene
  // que encontrar el ancla en las dos formas.
  await db.exec(`
    do $$
    declare v_def text := pg_get_functiondef('public.get_operaciones_bono_resumen(uuid,integer,integer)'::regprocedure);
    begin
      if position('d.horas_antes_cita)            AS horas_antes_cita,' in v_def) = 0 then
        raise exception 'el resumen del repo cambió de forma';
      end if;
      execute replace(v_def, 'd.horas_antes_cita)            AS horas_antes_cita,', 'd.horas_antes_cita) AS horas_antes_cita,');
    end $$;`)
  await db.exec(datos())
  await db.exec(`set prueba.ws = '${WS}'`)

  const r = await resumen()
  antes = { personas: r.personas, detalle: soloJuicio(await detalle()) }

  await db.exec(leer(MIGRACION))
}, 60_000)

afterAll(async () => {
  await db?.close()
})

describe('dia_habil_anterior', () => {
  const casos: Array<[string, boolean, string]> = [
    ['2026-10-21', false, '2026-10-20'], // miércoles → martes
    ['2026-10-26', false, '2026-10-23'], // lunes → viernes
    ['2026-10-13', false, '2026-10-09'], // martes tras el festivo del lunes 12 → viernes 9
    ['2026-11-03', false, '2026-10-30'], // martes tras el festivo del lunes 2-nov → viernes 30-oct
    ['2026-10-26', true, '2026-10-24'],  // con sábado hábil, el lunes cae al sábado
    ['2026-10-13', true, '2026-10-10'],  // con sábado hábil, el festivo igual se salta
    ['2027-01-01', false, '2026-12-31'], // cruza el año
  ]
  it.each(casos)('%s (sábado hábil: %s) → %s', async (fecha, sabado, esperado) => {
    const r = await db.query<{ d: string }>(
      `select public.dia_habil_anterior($1::date, $2)::text as d`, [fecha, sabado],
    )
    expect(r.rows[0].d).toBe(esperado)
  })

  it('el límite es la hora de corte de ese día en Bogotá', async () => {
    const r = await db.query<{ l: string }>(
      `select (public.limite_envio_cita('2026-10-26', 17, false) at time zone 'UTC')::text as l`,
    )
    expect(r.rows[0].l).toBe('2026-10-23 22:00:00') // 17:00 Bogotá = 22:00 UTC
  })

  it('un cliente sin sesión no las ejecuta', async () => {
    const r = await db.query<{ a: boolean; b: boolean }>(`
      select has_function_privilege('anon', 'public.dia_habil_anterior(date,boolean)', 'execute') as a,
             has_function_privilege('anon', 'public.limite_envio_cita(date,integer,boolean)', 'execute') as b`)
    expect(r.rows[0]).toEqual({ a: false, b: false })
  })
})

describe('con envio_modo por defecto nada cambia', () => {
  it('la configuración nueva nace en el modo de horas, corte 17', async () => {
    const r = await resumen()
    expect(r.parametros.envio_modo).toBe('horas_antes_cita')
    expect(r.parametros.envio_hora_corte).toBe(17)
  })

  it('el resumen da exactamente lo mismo que antes de la migración', async () => {
    expect((await resumen()).personas).toEqual(antes.personas)
  })

  it('el detalle juzga y explica igual que antes', async () => {
    expect(soloJuicio(await detalle())).toEqual(antes.detalle)
  })

  it('antes y ahora, en el modo de horas solo cumple el enviado dentro de las 48 h del certificado', async () => {
    const r = await resumen()
    expect(r.envio).toMatchObject({ a_tiempo: 1, medibles: TODOS.length - 1, eventos: TODOS.length })
  })
})

describe('modo «día hábil anterior» (SOE-040)', () => {
  beforeAll(async () => {
    await db.exec(`
      insert into public.config_bono_operaciones_mes (workspace_id, anio, mes, envio_modo, envio_hora_corte)
      values ('${WS}', 2026, 10, 'dia_habil_anterior', 17)
      on conflict (workspace_id, anio, mes) do update set envio_modo = excluded.envio_modo,
        envio_hora_corte = excluded.envio_hora_corte`)
  })

  it('cada caso se juzga contra las 17:00 del día hábil anterior, sin las 48 h del certificado', async () => {
    const d = await detalle()
    for (const e of TODOS) {
      const caso = d.find((x) => x.codigo === `E${e.n}`)
      expect(caso?.a_tiempo, `E${e.n} (cita ${e.cita}, envío ${e.envio})`).toBe(e.cumpleNuevo)
    }
  })

  it('el caso tarde dice por qué y trae su límite', async () => {
    const d = await detalle()
    const tarde = d.find((x) => x.codigo === 'E2')
    expect(tarde?.motivo).toBe('enviado después de las 17:00 del día hábil anterior a la cita')
    expect(new Date(String(tarde?.limite_envio)).toISOString()).toBe('2026-10-09T22:00:00.000Z')
    expect(d.find((x) => x.codigo === 'E1')?.motivo).toBeNull()
  })

  it('el caso sin cita queda fuera, como hoy', async () => {
    const d = await detalle()
    expect(d.find((x) => x.codigo === 'E8')).toMatchObject({ a_tiempo: null, motivo: 'sin fecha de cita' })
  })

  it('resumen y detalle cuentan lo mismo', async () => {
    const r = await resumen()
    const d = await detalle()
    const cumplen = TODOS.filter((e) => e.cumpleNuevo === true).length
    expect(r.envio.a_tiempo).toBe(cumplen)
    expect(r.envio.medibles).toBe(TODOS.length - 1)
    expect(d.filter((x) => x.a_tiempo === true).length).toBe(r.envio.a_tiempo)
    expect(d.filter((x) => x.a_tiempo !== null).length).toBe(r.envio.medibles)
  })

  it('la hora de corte es configurable: a las 18 el de las 17:01 ya cumple', async () => {
    await db.exec(`update public.config_bono_operaciones_mes set envio_hora_corte = 18
                   where workspace_id = '${WS}' and anio = 2026 and mes = 10`)
    const d = await detalle()
    expect(d.find((x) => x.codigo === 'E2')?.a_tiempo).toBe(true)
    expect(d.find((x) => x.codigo === 'E5')?.a_tiempo).toBe(true)
    const r = await resumen()
    expect(r.envio.a_tiempo).toBe(d.filter((x) => x.a_tiempo === true).length)
    await db.exec(`update public.config_bono_operaciones_mes set envio_hora_corte = 17
                   where workspace_id = '${WS}' and anio = 2026 and mes = 10`)
  })

  it('la base rechaza un modo que no existe', async () => {
    await expect(db.exec(`update public.config_bono_operaciones set envio_modo = 'otro' where workspace_id = '${WS}'`))
      .rejects.toThrow()
  })
})

describe('congelar meses pasados', () => {
  it('copia el modo y la hora de corte que regían', async () => {
    await db.exec(`
      delete from public.config_bono_operaciones_mes where workspace_id = '${WS}';
      update public.config_bono_operaciones set envio_modo = 'dia_habil_anterior', envio_hora_corte = 16
        where workspace_id = '${WS}';
      select public.congelar_config_bono_meses_pasados('${WS}');`)
    const r = await db.query<{ envio_modo: string; envio_hora_corte: number }>(
      `select envio_modo, envio_hora_corte from public.config_bono_operaciones_mes
       where workspace_id = $1 and anio = 2026 and mes = 10`, [WS],
    )
    expect(r.rows).toEqual([{ envio_modo: 'dia_habil_anterior', envio_hora_corte: 16 }])
  })
})

describe('ancla de cfg', () => {
  it('parcha el resumen con un espacio y el detalle alineado, una sola vez cada uno', async () => {
    for (const f of ['get_operaciones_bono_resumen', 'get_operaciones_bono_detalle']) {
      const r = await db.query<{ n: number }>(
        `select count(*)::int as n from regexp_matches(
           pg_get_functiondef('public.${f}(uuid,integer,integer)'::regprocedure),
           'COALESCE\\(m\\.envio_hora_corte, d\\.envio_hora_corte\\)', 'g')`,
      )
      expect(r.rows[0].n, f).toBe(1)
    }
  })

  it('aborta si el ancla no está', async () => {
    const otra = new PGlite()
    try {
      await otra.exec(ESQUEMA)
      await otra.exec(leer('20260901000006_config_bono_por_mes.sql'))
      await otra.exec(leer('20260901000007_detalle_bono_por_indicador.sql'))
      await otra.exec(`
        do $$
        declare v_def text := pg_get_functiondef('public.get_operaciones_bono_resumen(uuid,integer,integer)'::regprocedure);
        begin
          -- Una forma que el ancla no reconoce (los argumentos al revés): tiene que abortar, no adivinar.
          execute replace(v_def, 'COALESCE(m.horas_antes_cita, d.horas_antes_cita)            AS horas_antes_cita,',
                                 'COALESCE(d.horas_antes_cita, m.horas_antes_cita) AS horas_antes_cita,');
        end $$;`)
      await expect(otra.exec(leer(MIGRACION))).rejects.toThrow(/ancla de cfg aparece 0 veces/)
    } finally {
      await otra.close()
    }
  }, 60_000)
})

describe('idempotencia', () => {
  it('correr la migración otra vez no rompe ni duplica nada', async () => {
    await db.exec(leer(MIGRACION))
    const r = await db.query<{ n: number }>(
      `select (length(pg_get_functiondef('public.get_operaciones_bono_detalle(uuid,integer,integer)'::regprocedure))
              - length(replace(pg_get_functiondef('public.get_operaciones_bono_detalle(uuid,integer,integer)'::regprocedure), 'limite_envio_cita(', '')))
              / length('limite_envio_cita(') as n`,
    )
    expect(r.rows[0].n).toBe(1)
  })
})
