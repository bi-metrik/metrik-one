/**
 * SOE-031 corrido de verdad en Postgres en memoria (PGlite): las dos migraciones
 *   · 20261028163000_avisos_cliente_confirman_entrega.sql (tipo, campana, trigger)
 *   · 20261028163100_soena_entrega_correo_del_certificado.sql (config de SOENA)
 * sobre un esquema mínimo con las columnas que tocan.
 *
 * Lo que la BASE garantiza sola cuando el acuse de Resend actualiza `avisos_cliente`:
 *   · entregado  → el gate se marca (checkbox, fecha en hora Bogotá, nota) y queda completo,
 *                  con huella en activity_log;
 *   · rebotado   → el gate NO se marca, el equipo recibe la campana una sola vez y queda huella;
 *   · ya marcado a mano → no se toca nada;
 *   · acuse repetido / segundo envío → no se marca dos veces ni duplica la huella;
 *   · entregado y luego rebotado → se deshace SOLO la marca automática;
 *   · avisos por documento, viejos o de etapas sin bloque → no hacen nada;
 *   · un fallo de la marca no tumba el acuse.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const leer = (f: string) => readFileSync(join(process.cwd(), 'supabase/migrations', f), 'utf8')
const MIGRACION = leer('20261028163000_avisos_cliente_confirman_entrega.sql')
const MIGRACION_SOENA = leer('20261028163100_soena_entrega_correo_del_certificado.sql')

// Los ids reales de SOENA: la migración de config los trae escritos.
const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const BLOQUE_VIEJO = '39474c2e-f1b9-4f10-a3af-c7490787490e'
const GATE = '298a7669-d332-424f-8ba0-0fa3d5f0896e'
const ETAPA = '00000000-0000-4000-8000-0000000e7a9a'
const OTRA_ETAPA = '00000000-0000-4000-8000-0000000e7a9b'
const NEG = '00000000-0000-4000-8000-00000000a001'
const STAFF_COM = '00000000-0000-4000-8000-000000050001'
const PERFIL_COM = '00000000-0000-4000-8000-0000000c0001'
const PERFIL_OPS = '00000000-0000-4000-8000-0000000c0002'
const PERFIL_SUP = '00000000-0000-4000-8000-0000000c0003'
const DEF_DATOS = '00000000-0000-4000-8000-0000000def01'

const ESQUEMA = `
  set time zone 'UTC';
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;

  create table public.bloque_definitions (
    id uuid primary key default gen_random_uuid(),
    codigo text unique,
    tipo text not null unique,
    nombre text not null,
    descripcion text,
    is_visualization boolean not null default false,
    can_be_gate boolean not null default false,
    supports_array_items boolean not null default false,
    default_estado text not null default 'editable',
    icon_name text
  );
  alter table public.bloque_definitions add constraint bloque_definitions_tipo_check
    check (tipo = any (array['datos', 'documento', 'historial', 'servicios']));
  insert into public.bloque_definitions (id, codigo, tipo, nombre) values
    ('${DEF_DATOS}', 'B01', 'datos', 'Datos'),
    (gen_random_uuid(), 'B33', 'documento', 'Documento');

  create table public.etapas_negocio (id uuid primary key, config_extra jsonb not null default '{}');
  insert into public.etapas_negocio values
    ('${ETAPA}', '{"avisar_al_cliente": {"email": true, "link_bloque_slug": "concepto_upme"}}'),
    ('${OTRA_ETAPA}', '{}');

  create table public.bloque_configs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    etapa_id uuid not null,
    bloque_definition_id uuid not null references public.bloque_definitions(id),
    nombre text,
    slug text,
    orden int not null default 0,
    es_gate boolean not null default false,
    estado text not null default 'editable',
    config_extra jsonb not null default '{}'
  );

  create table public.negocios (
    id uuid primary key, workspace_id uuid not null, codigo text, nombre text, stage_actual text
  );
  create table public.negocio_bloques (
    id uuid primary key default gen_random_uuid(),
    negocio_id uuid not null references public.negocios(id),
    bloque_config_id uuid not null references public.bloque_configs(id),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'completo')),
    completado_por uuid,
    completado_at timestamptz,
    data jsonb not null default '{}',
    updated_at timestamptz not null default now(),
    unique (negocio_id, bloque_config_id)
  );

  create table public.avisos_cliente (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null,
    negocio_id uuid not null,
    etapa_id uuid,
    etapa_nombre text,
    bloque_config_id uuid,
    canal text not null,
    estado text not null,
    destino text, copia_a text, motivo text, titulo text, proveedor_id text,
    huella text,
    entregado_at timestamptz,
    queja_at timestamptz,
    created_at timestamptz not null default now()
  );

  create table public.activity_log (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, entidad_tipo text not null, entidad_id uuid not null,
    tipo text not null check (tipo in ('comentario', 'cambio', 'sistema', 'cambio_sistema')),
    autor_id uuid, campo_modificado text, valor_anterior text, valor_nuevo text, contenido text,
    created_at timestamptz default now()
  );

  create table public.notificaciones (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null, destinatario_id uuid not null, tipo text not null,
    contenido text not null, entidad_tipo text, entidad_id uuid, deep_link text,
    metadata jsonb, estado text not null default 'pendiente', grupo_clave text
  );
  alter table public.notificaciones add constraint notificaciones_tipo_check
    check (tipo = any (array['mencion', 'factura_cargada']));

  create table public.staff (id uuid primary key, profile_id uuid);
  create table public.negocio_responsables (negocio_id uuid, staff_id uuid, rol text);
  create function public.destinatarios_negocio(p_negocio_id uuid)
  returns table (profile_id uuid, via text) language sql as $$
    select '${PERFIL_SUP}'::uuid, 'supervisor_operaciones'::text
  $$;

  insert into public.negocios values ('${NEG}', '${WS}', 'V0500', 'Cliente Prueba', 'cobro');
  insert into public.staff values ('${STAFF_COM}', '${PERFIL_COM}');
`

let db: PGlite

async function filas<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows
}

async function gate(): Promise<{ estado: string; data: Record<string, unknown>; completado_at: string | null } | null> {
  const r = await filas<{ estado: string; data: Record<string, unknown>; completado_at: string | null }>(
    `select estado, data, completado_at::text from public.negocio_bloques where negocio_id = $1 and bloque_config_id = $2`,
    [NEG, GATE],
  )
  return r[0] ?? null
}

async function nuevoAviso(opts: { etapa?: string; bloqueConfigId?: string | null; creado?: string; destino?: string } = {}): Promise<string> {
  const r = await filas<{ id: string }>(
    `insert into public.avisos_cliente (workspace_id, negocio_id, etapa_id, bloque_config_id, canal, estado, destino, copia_a, proveedor_id, created_at)
     values ($1, $2, $3, $4, 'email', 'enviado', $5, 'comercial@soena.co', 're_' || gen_random_uuid(), coalesce($6::timestamptz, now()))
     returning id`,
    [WS, NEG, opts.etapa ?? ETAPA, opts.bloqueConfigId ?? null, opts.destino ?? 'cliente@correo.co', opts.creado ?? null],
  )
  return r[0].id
}

// Lo que escribe `resend-webhook`, con sus guardas (ver `actualizacionDeAcuse`).
const entregar = (id: string, cuando = '2026-10-29T03:30:00Z') =>
  db.query(`update public.avisos_cliente set entregado_at = $2 where id = $1 and entregado_at is null`, [id, cuando])
const rebotar = (id: string, estado = 'rebotado') =>
  db.query(`update public.avisos_cliente set estado = $2, motivo = 'Permanent: mailbox not found' where id = $1 and estado = 'enviado'`, [id, estado])

const logs = (campo?: string) =>
  filas<{ tipo: string; contenido: string; campo_modificado: string }>(
    `select tipo, contenido, campo_modificado from public.activity_log where entidad_id = $1 ${campo ? 'and campo_modificado = $2' : ''} order by created_at`,
    campo ? [NEG, campo] : [NEG],
  )

beforeAll(async () => {
  db = new PGlite()
  await db.exec(ESQUEMA)
  await db.exec(MIGRACION)
}, 60_000)

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await db.exec(`
    delete from public.negocio_bloques;
    delete from public.avisos_cliente;
    delete from public.activity_log;
    delete from public.notificaciones;
    delete from public.negocio_responsables;
    delete from public.bloque_configs;
    insert into public.bloque_configs (id, workspace_id, etapa_id, bloque_definition_id, nombre, orden, es_gate, config_extra) values
      ('${BLOQUE_VIEJO}', '${WS}', '${ETAPA}', '${DEF_DATOS}', 'Correo de entrega al cliente', 2, false,
       '{"fields": [{"slug": "destinatario"}, {"slug": "plantilla", "tipo": "plantilla"}]}'),
      ('${GATE}', '${WS}', '${ETAPA}', '${DEF_DATOS}', 'Confirmación de entrega', 3, true,
       '{"fields": [{"slug": "certificado_entregado", "tipo": "checkbox", "required": true}, {"slug": "fecha_entrega", "tipo": "fecha"}, {"slug": "notas", "tipo": "texto"}]}');
    insert into public.negocio_bloques (negocio_id, bloque_config_id, data) values
      ('${NEG}', '${BLOQUE_VIEJO}', '{"destinatario": "viejo@correo.co"}'),
      ('${NEG}', '${GATE}', '{}');
    insert into public.negocio_responsables values ('${NEG}', '${STAFF_COM}', 'comercial');
  `)
  await db.exec(MIGRACION_SOENA)
})

describe('migración de tipo y campana', () => {
  it('registra el tipo avisos_cliente con el primer código libre y amplía la campana', async () => {
    const [def] = await filas<{ codigo: string; is_visualization: boolean; can_be_gate: boolean }>(
      `select codigo, is_visualization, can_be_gate from public.bloque_definitions where tipo = 'avisos_cliente'`,
    )
    expect(def).toEqual({ codigo: 'B34', is_visualization: true, can_be_gate: false })
    await expect(db.query(
      `insert into public.notificaciones (workspace_id, destinatario_id, tipo, contenido) values ($1, $2, 'aviso_cliente_rebotado', 'x')`,
      [WS, PERFIL_COM],
    )).resolves.toBeTruthy()
  })

  it('es idempotente', async () => {
    await db.exec(MIGRACION)
    const r = await filas<{ n: number }>(`select count(*)::int as n from public.bloque_definitions where tipo = 'avisos_cliente'`)
    expect(r[0].n).toBe(1)
  })
})

describe('config de SOENA', () => {
  it('cambia el tipo del bloque viejo, guarda su config y no toca la data de los negocios', async () => {
    const [bc] = await filas<{ tipo: string; nombre: string; es_gate: boolean; config_extra: Record<string, unknown> }>(
      `select bd.tipo, bc.nombre, bc.es_gate, bc.config_extra from public.bloque_configs bc
         join public.bloque_definitions bd on bd.id = bc.bloque_definition_id where bc.id = $1`,
      [BLOQUE_VIEJO],
    )
    expect(bc.tipo).toBe('avisos_cliente')
    expect(bc.nombre).toBe('Envío del certificado al cliente')
    expect(bc.es_gate).toBe(false)
    expect(bc.config_extra.confirmar).toEqual({
      bloque_config_id: GATE, campo: 'certificado_entregado', campo_fecha: 'fecha_entrega', campo_notas: 'notas',
    })
    expect((bc.config_extra._config_anterior as { fields: unknown[] }).fields).toHaveLength(2)

    const [nb] = await filas<{ data: Record<string, unknown> }>(
      `select data from public.negocio_bloques where bloque_config_id = $1`, [BLOQUE_VIEJO],
    )
    expect(nb.data).toEqual({ destinatario: 'viejo@correo.co' })

    const [g] = await filas<{ es_gate: boolean }>(`select es_gate from public.bloque_configs where id = $1`, [GATE])
    expect(g.es_gate).toBe(true)
  })

  it('correrla dos veces no cambia nada', async () => {
    const antes = await filas(`select config_extra from public.bloque_configs where id = $1`, [BLOQUE_VIEJO])
    await db.exec(MIGRACION_SOENA)
    const despues = await filas(`select config_extra from public.bloque_configs where id = $1`, [BLOQUE_VIEJO])
    expect(despues).toEqual(antes)
  })
})

describe('entregado', () => {
  it('marca la confirmación con la fecha en hora Bogotá, la nota y la huella', async () => {
    const id = await nuevoAviso()
    // 03:30 UTC del 29 = 22:30 del 28 en Bogotá.
    await entregar(id, '2026-10-29T03:30:00Z')

    const g = await gate()
    expect(g?.estado).toBe('completo')
    expect(g?.completado_at).not.toBeNull()
    expect(g?.data.certificado_entregado).toBe(true)
    expect(g?.data.fecha_entrega).toBe('2026-10-28')
    expect(g?.data.notas).toBe(
      'Marcado automáticamente: el correo con el certificado UPME a cliente@correo.co fue entregado el 2026-10-28.',
    )
    expect((g?.data._auto_entrega as { aviso_id: string }).aviso_id).toBe(id)

    const l = await logs('bloque_datos')
    expect(l).toHaveLength(1)
    expect(l[0].tipo).toBe('cambio_sistema')
    expect(l[0].contenido).toContain('«Confirmación de entrega» marcado automáticamente')
    // Una entrega no avisa a nadie.
    expect(await filas(`select 1 from public.notificaciones`)).toHaveLength(0)
  })

  it('funciona aunque el negocio no tenga todavía la fila del gate', async () => {
    await db.exec(`delete from public.negocio_bloques where bloque_config_id = '${GATE}'`)
    await entregar(await nuevoAviso())
    expect((await gate())?.data.certificado_entregado).toBe(true)
  })

  it('agrega la nota al final de las notas que escribió una persona y no pisa su fecha', async () => {
    await db.query(`update public.negocio_bloques set data = $3 where negocio_id = $1 and bloque_config_id = $2`,
      [NEG, GATE, { notas: 'Cliente pidió copia física', fecha_entrega: '2026-10-27' }])
    await entregar(await nuevoAviso())
    const g = await gate()
    expect(g?.data.fecha_entrega).toBe('2026-10-27')
    expect(g?.data.notas).toMatch(/^Cliente pidió copia física\nMarcado automáticamente/)
  })
})

describe('ya marcado a mano', () => {
  it('no toca nada ni deja huella', async () => {
    const manual = { certificado_entregado: true, fecha_entrega: '2026-10-20', notas: 'Entregado en oficina' }
    await db.query(`update public.negocio_bloques set data = $3, estado = 'completo', completado_por = $4
                     where negocio_id = $1 and bloque_config_id = $2`, [NEG, GATE, manual, PERFIL_OPS])
    await entregar(await nuevoAviso())
    const g = await gate()
    expect(g?.data).toEqual(manual)
    expect(await logs('bloque_datos')).toHaveLength(0)
  })
})

describe('acuse repetido', () => {
  it('el mismo acuse dos veces marca una sola vez', async () => {
    const id = await nuevoAviso()
    await entregar(id)
    await entregar(id) // la guarda del webhook ya no lo encuentra
    // Y aunque alguien reescriba la fila sin la guarda, el campo ya está en true.
    await db.query(`update public.avisos_cliente set entregado_at = entregado_at where id = $1`, [id])
    expect(await logs('bloque_datos')).toHaveLength(1)
  })

  it('un segundo envío entregado no vuelve a marcar', async () => {
    await entregar(await nuevoAviso())
    await entregar(await nuevoAviso({ destino: 'otro@correo.co' }))
    expect(await logs('bloque_datos')).toHaveLength(1)
    expect((await gate())?.data.notas).toContain('cliente@correo.co')
  })

  it('el rebote repetido avisa una sola vez', async () => {
    const id = await nuevoAviso()
    await rebotar(id)
    await rebotar(id)
    await db.query(`update public.avisos_cliente set estado = 'rebotado' where id = $1`, [id])
    // Una fila que alguien devolvió a `enviado` a mano y vuelve a rebotar (el backfill) tampoco
    // vuelve a sonar la campana por el mismo correo.
    await db.query(`update public.avisos_cliente set estado = 'enviado' where id = $1`, [id])
    await rebotar(id)
    expect(await filas(`select 1 from public.notificaciones`)).toHaveLength(1)
  })
})

describe('rebotado', () => {
  it('no marca la confirmación, avisa a los responsables y deja huella', async () => {
    const id = await nuevoAviso()
    await rebotar(id)

    const g = await gate()
    expect(g?.estado).toBe('pendiente')
    expect(g?.data.certificado_entregado).toBeUndefined()

    const n = await filas<{ destinatario_id: string; tipo: string; contenido: string; deep_link: string; metadata: { aviso_id: string } }>(
      `select destinatario_id, tipo, contenido, deep_link, metadata from public.notificaciones`,
    )
    expect(n).toHaveLength(1)
    expect(n[0].destinatario_id).toBe(PERFIL_COM)
    expect(n[0].tipo).toBe('aviso_cliente_rebotado')
    expect(n[0].contenido).toBe(
      'V0500 — Cliente Prueba: El correo con el certificado UPME a cliente@correo.co rebotó. Corrijan el correo del cliente y vuelvan a enviárselo.',
    )
    expect(n[0].deep_link).toBe(`/negocios/${NEG}`)
    expect(n[0].metadata.aviso_id).toBe(id)

    const l = await logs('aviso_cliente')
    expect(l).toHaveLength(1)
    expect(l[0].tipo).toBe('sistema')
    expect(l[0].contenido).toContain('Motivo: Permanent: mailbox not found.')
  })

  it('sin responsables cae a la regla del sistema (destinatarios_negocio)', async () => {
    await db.exec(`delete from public.negocio_responsables`)
    await rebotar(await nuevoAviso())
    const n = await filas<{ destinatario_id: string }>(`select destinatario_id from public.notificaciones`)
    expect(n.map(x => x.destinatario_id)).toEqual([PERFIL_SUP])
  })

  it('suprimido avisa con su propio texto', async () => {
    await rebotar(await nuevoAviso(), 'suprimido')
    const [n] = await filas<{ contenido: string }>(`select contenido from public.notificaciones`)
    expect(n.contenido).toContain('no se envió: esa dirección ya había rebotado antes')
  })

  it('un entregado que llega después del rebote no marca nada', async () => {
    const id = await nuevoAviso()
    await rebotar(id)
    await entregar(id)
    expect((await gate())?.data.certificado_entregado).toBeUndefined()
  })

  it('entregado y luego rebotado: deshace solo la marca automática', async () => {
    await db.query(`update public.negocio_bloques set data = $3 where negocio_id = $1 and bloque_config_id = $2`,
      [NEG, GATE, { notas: 'Nota del equipo' }])
    const id = await nuevoAviso()
    await entregar(id)
    expect((await gate())?.estado).toBe('completo')
    await rebotar(id)

    const g = await gate()
    expect(g?.estado).toBe('pendiente')
    expect(g?.completado_at).toBeNull()
    expect(g?.data.certificado_entregado).toBe(false)
    expect(g?.data.fecha_entrega).toBeUndefined()
    expect(g?.data.notas).toBe('Nota del equipo')
    expect((g?.data._auto_entrega as { revertido_at?: string }).revertido_at).toBeTruthy()
    expect((await logs('bloque_datos')).map(l => l.contenido)).toEqual([
      expect.stringContaining('marcado automáticamente'),
      expect.stringContaining('Se deshizo la confirmación automática'),
    ])
  })

  it('el rebote de otro envío no deshace una marca manual', async () => {
    const manual = { certificado_entregado: true, fecha_entrega: '2026-10-20' }
    await db.query(`update public.negocio_bloques set data = $3, estado = 'completo', completado_por = $4
                     where negocio_id = $1 and bloque_config_id = $2`, [NEG, GATE, manual, PERFIL_OPS])
    await rebotar(await nuevoAviso())
    const g = await gate()
    expect(g?.data).toEqual(manual)
    expect(g?.estado).toBe('completo')
  })
})

describe('lo que no aplica', () => {
  it('un aviso por documento (la factura) no marca el certificado', async () => {
    const id = await nuevoAviso({ bloqueConfigId: GATE })
    await entregar(id)
    await rebotar(id)
    expect((await gate())?.data).toEqual({})
    expect(await filas(`select 1 from public.notificaciones`)).toHaveLength(0)
  })

  it('un aviso de hace más de 7 días (backfill) no hace nada', async () => {
    const id = await nuevoAviso({ creado: '2026-09-01T12:00:00Z' })
    await entregar(id)
    expect((await gate())?.data).toEqual({})
  })

  it('una etapa sin bloque avisos_cliente no hace nada', async () => {
    const id = await nuevoAviso({ etapa: OTRA_ETAPA })
    await entregar(id)
    await db.query(`update public.avisos_cliente set estado = 'enviado', entregado_at = null where id = $1`, [id])
    await rebotar(id)
    expect((await gate())?.data).toEqual({})
    expect(await filas(`select 1 from public.notificaciones`)).toHaveLength(0)
    expect(await logs()).toHaveLength(0)
  })

  it('si la marca falla, el acuse queda igual y la marca a medias se deshace', async () => {
    // Sin activity_log la marca revienta DESPUÉS de escribir el gate: el savepoint lo deshace.
    await db.exec(`alter table public.activity_log rename to activity_log_fuera`)
    try {
      const id = await nuevoAviso()
      await entregar(id)
      const [a] = await filas<{ entregado_at: string | null }>(`select entregado_at::text from public.avisos_cliente where id = $1`, [id])
      expect(a.entregado_at).not.toBeNull()
      expect((await gate())?.data).toEqual({})
    } finally {
      await db.exec(`alter table public.activity_log_fuera rename to activity_log`)
    }
  })

  it('una config con un id de gate inválido no hace nada', async () => {
    await db.exec(`update public.bloque_configs set config_extra = jsonb_set(config_extra, '{confirmar,bloque_config_id}', '"no-es-uuid"') where id = '${BLOQUE_VIEJO}'`)
    await entregar(await nuevoAviso())
    expect((await gate())?.data).toEqual({})
  })
})
