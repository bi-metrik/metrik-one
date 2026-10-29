// ============================================================
// El SQL de publicación de los dos roles de Trappvel (2026-10-29) — generado desde el código, NO aplicado
// ------------------------------------------------------------
// Una sola fuente para las fichas: `roles-trappvel.ts` (las mismas con que corrió el arnés). Quién tiene qué rol (ids de
// staff y de colaborador, teléfonos) NO vive en el repo: llega en un JSON de asignaciones (`--asignaciones <json>`) que
// vive en la carpeta del proyecto del cliente, fuera de metrik-one. En esa misma carpeta están los bancos del arnés
// (`banco-<rol>.json`, lo que dejó `arnes/correr.ts --rol <clave> --k 3`) y ahí se escriben los tres archivos:
//   · `2026-10-29_roles-agus-PENDIENTE.sql`  publicar y prender (una transacción: si algo falla, no queda nada);
//   · `2026-10-29_roles-agus-ENSAYO.sql`     lo mismo dentro de `DO $dry$ … RAISE EXCEPTION 'dry-run ok'` (revierte);
//   · `2026-10-29_roles-agus-REVERSA.sql`    vuelve al camino de hoy (sin roles en `wa_one`).
// La prueba `roles-trappvel-sql.test.ts` corre el SQL en Postgres en memoria (PGlite) con las migraciones reales y
// asignaciones inventadas. Cómo correrlo: `docs/asistentes/roles-trappvel.md`.
// Uso: deno run -A supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts --asignaciones <json> [--dir <carpeta>]
//        [--fichas-base <json>]
// ============================================================

import { fichaValida, huellaPublicable } from '../reglamento.ts';
import type { Ficha } from '../tipos.ts';
import { ESCALAMIENTO_METRIK } from '../persona.ts';
import { BOT_BANDEJA } from './dominio.ts';
import { FUNCIONES_PRENDER, ROLES_TRAPPVEL, WS_TRAPPVEL, fichasBaseBandeja, fichasDelRol } from './roles-trappvel.ts';
import type { ClaveRolTrappvel } from './roles-trappvel.ts';

export const ARCHIVO_PENDIENTE = '2026-10-29_roles-agus-PENDIENTE.sql';
export const ARCHIVO_ENSAYO = '2026-10-29_roles-agus-ENSAYO.sql';
export const ARCHIVO_REVERSA = '2026-10-29_roles-agus-REVERSA.sql';
export const archivoBanco = (rol: ClaveRolTrappvel) => `banco-${rol}.json`;

/** Una persona (por su staff o por su colaborador de WhatsApp) con su rol. `quien` solo va en un comentario del SQL. */
export interface Asignacion { quien: string; rol: ClaveRolTrappvel; staff?: string; colaborador?: string }

/** Un staff sin `phone_whatsapp`: la cabecera trae, comentado, el UPDATE que se lo pone (no se aplica solo). */
export interface StaffSinTelefono { quien: string; staff: string; telefono: string }

/** El JSON de asignaciones (fuera del repo). */
export interface Asignaciones {
  asignaciones: Asignacion[];
  /** Los teléfonos que se suman a `agente_telefonos` (los que hoy no llegan al agente). Solo dígitos. */
  telefonos_agente: string[];
  /** Los últimos dígitos de un teléfono de prueba: si también es de un staff (el staff gana al identificar), ese staff va a la mano derecha. */
  telefono_prueba?: string | null;
  staff_sin_telefono?: StaffSinTelefono[];
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_DIGITOS = /^\d{7,15}$/;

/** Valida el JSON de asignaciones: lanza con el motivo si algo no cuadra. Pura. */
export function leerAsignaciones(crudo: unknown): Asignaciones {
  const o = (crudo ?? {}) as Record<string, unknown>;
  const lista = o.asignaciones;
  if (!Array.isArray(lista) || !lista.length) throw new Error('asignaciones: falta la lista `asignaciones`');
  const asignaciones = lista.map((x, i) => {
    const a = (x ?? {}) as Record<string, unknown>;
    const quien = String(a.quien ?? '').trim();
    if (!quien) throw new Error(`asignaciones[${i}]: falta \`quien\``);
    if (!ROLES_TRAPPVEL.includes(a.rol as ClaveRolTrappvel)) throw new Error(`asignaciones[${i}]: rol «${String(a.rol)}» (uno de ${ROLES_TRAPPVEL.join(', ')})`);
    const staff = a.staff === undefined || a.staff === null ? undefined : String(a.staff);
    const colaborador = a.colaborador === undefined || a.colaborador === null ? undefined : String(a.colaborador);
    if (!!staff === !!colaborador) throw new Error(`asignaciones[${i}]: va \`staff\` o \`colaborador\`, uno solo`);
    const id = (staff ?? colaborador)!;
    if (!RE_UUID.test(id)) throw new Error(`asignaciones[${i}]: «${id}» no es un uuid`);
    return { quien, rol: a.rol as ClaveRolTrappvel, ...(staff ? { staff } : { colaborador }) };
  });
  const telefonos = Array.isArray(o.telefonos_agente) ? o.telefonos_agente.map(String) : [];
  for (const t of telefonos) if (!RE_DIGITOS.test(t)) throw new Error(`telefonos_agente: «${t}» no son solo dígitos (7 a 15)`);
  const prueba = o.telefono_prueba === undefined || o.telefono_prueba === null || o.telefono_prueba === '' ? null : String(o.telefono_prueba);
  if (prueba !== null && !RE_DIGITOS.test(prueba)) throw new Error(`telefono_prueba: «${prueba}» no son solo dígitos (7 a 15)`);
  const sinTel = Array.isArray(o.staff_sin_telefono) ? o.staff_sin_telefono.map((x, i) => {
    const s = (x ?? {}) as Record<string, unknown>;
    const r = { quien: String(s.quien ?? ''), staff: String(s.staff ?? ''), telefono: String(s.telefono ?? '') };
    if (!RE_UUID.test(r.staff)) throw new Error(`staff_sin_telefono[${i}]: «${r.staff}» no es un uuid`);
    if (!RE_DIGITOS.test(r.telefono.replace(/^\+/, ''))) throw new Error(`staff_sin_telefono[${i}]: teléfono raro`);
    return r;
  }) : [];
  return { asignaciones, telefonos_agente: telefonos, telefono_prueba: prueba, staff_sin_telefono: sinTel };
}

const lit = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);
// Un arreglo vacío se guarda vacío (no null): la huella del rol cuenta `herramientas: []` (huellaPublicable no lo quita).
const arr = (v: string[] | null | undefined) => (!v ? 'null' : v.length ? `array[${v.map(lit).join(', ')}]::text[]` : `'{}'::text[]`);
const json = (v: unknown) => (v ? `${lit(JSON.stringify(v))}::jsonb` : 'null');

export interface EntradaSql {
  base: Ficha[];
  bancos: Record<ClaveRolTrappvel, unknown>;
  asignaciones: Asignaciones;
}

/** Un texto libre (del JSON) dentro de un comentario SQL: una sola línea. */
const comentario = (t: string) => t.replace(/[\r\n]+/g, ' ').trim();

/** El cuerpo plpgsql que publica y prende (lo comparten el archivo de aplicar y el ensayo). */
export async function cuerpoPublicar(e: EntradaSql): Promise<string> {
  const huellaBase = await huellaPublicable(e.base);
  const { asignaciones, telefonos_agente: telefonos, telefono_prueba: prueba } = e.asignaciones;
  const fichas = (rol: ClaveRolTrappvel) => fichasDelRol(rol, e.base).map((f) =>
    `    (v_ws, ${lit(`rol:${rol}`)}, ${lit(f.clave)}, ${lit(f.tipo)}, ${lit(f.carga)}, ${lit(f.cuando)}, ${lit(f.hacer)}, ${arr(f.herramientas)}, ${f.prioridad ?? 'null'}, ${lit(f.fuente || null)}, ${json(f.valores)})`);
  const asignacion = (a: Asignacion) => a.staff
    ? `  insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, staff_id, asignado_por)\n  select v_ws, id, 'staff', ${lit(a.staff)}, 'max' from public.asistente_roles where workspace_id = v_ws and clave = ${lit(a.rol)}; -- ${comentario(a.quien)}`
    : `  insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, collaborator_id, asignado_por)\n  select v_ws, id, 'colaborador', ${lit(a.colaborador!)}, 'max' from public.asistente_roles where workspace_id = v_ws and clave = ${lit(a.rol)}; -- ${comentario(a.quien)}`;
  const pasoPrueba = prueba ? `
  -- El teléfono de prueba: si también es de un staff (al identificar, el staff gana), ese staff va a la mano derecha.
  insert into public.asistente_asignaciones (workspace_id, rol_id, sujeto_tipo, staff_id, asignado_por)
  select v_ws, r.id, 'staff', s.id, 'max'
  from public.staff s join public.asistente_roles r on r.workspace_id = v_ws and r.clave = 'mano_derecha'
  where s.workspace_id = v_ws and regexp_replace(coalesce(s.phone_whatsapp, ''), '\\D', '', 'g') like '%${prueba}'
    and not exists (select 1 from public.asistente_asignaciones a where a.workspace_id = v_ws and a.staff_id = s.id);
` : '';
  const pasoTelefonos = telefonos.length ? `
  -- 7. Los teléfonos que hoy no llegan al agente (no están en agente_telefonos: siguen por el bot de antes).
  update public.workspaces w set config_extra = jsonb_set(
    w.config_extra, '{bot_conversacional,agente_telefonos}',
    coalesce(w.config_extra->'bot_conversacional'->'agente_telefonos', '[]'::jsonb) || coalesce((
      select jsonb_agg(t order by t) from unnest(array[${telefonos.map(lit).join(', ')}]) t
      where not exists (
        select 1 from jsonb_array_elements_text(coalesce(w.config_extra->'bot_conversacional'->'agente_telefonos', '[]'::jsonb)) x
        where regexp_replace(x, '\\D', '', 'g') = t
      )
    ), '[]'::jsonb)
  )
  where w.id = v_ws;
` : '';
  return `declare
  v_ws uuid := ${lit(WS_TRAPPVEL)};
  v_pin text;
  v_base jsonb;
  v_huella text;
  v_md uuid;
  v_av uuid;
begin
  if (select slug from public.workspaces where id = v_ws) is distinct from 'trappvel' then
    raise exception 'el workspace % no es el de Trappvel', v_ws;
  end if;

  -- 0. Las fichas de la bandeja que hoy atiende (la versión publicada de ${BOT_BANDEJA}, o la fijada en agente_config)
  --    tienen que ser la base con que corrió el arnés. Si la agencia ajustó algo, no se publica un rol que se lo cambie.
  select config_extra->'bot_conversacional'->'agente_config'->>'reglamento_id' into v_pin from public.workspaces where id = v_ws;
  select fichas into v_base from public.bot_reglamentos
  where workspace_id = v_ws and bot = ${lit(BOT_BANDEJA)} and (v_pin is null or id::text = v_pin)
  order by version desc limit 1;
  if v_base is null then raise exception 'Trappvel no tiene publicado el reglamento ${BOT_BANDEJA}'; end if;
  v_huella := public.asistente_huella_fichas(v_base);
  if v_huella <> ${lit(huellaBase)} then
    raise exception 'las fichas publicadas de ${BOT_BANDEJA} (huella %) no son la base del arnés (${huellaBase.slice(0, 12)}…): exportarlas (SELECT de la cabecera), correr el arnés con --fichas-base y regenerar este archivo', left(v_huella, 12);
  end if;

  -- 1. Las funciones de los dos roles, prendidas en la empresa.
  insert into public.asistente_funciones_empresa (workspace_id, funcion, activa, parametros, prendida_por) values
${FUNCIONES_PRENDER.map((f) => `    (v_ws, ${lit(f)}, true, '{}'::jsonb, 'max')`).join(',\n')}
  on conflict (workspace_id, funcion) do update set activa = true, updated_at = now();

  -- 2. Los dos roles (nacen apagados y sin puntero).
  insert into public.asistente_roles (workspace_id, clave, familia, canal) values
${ROLES_TRAPPVEL.map((r) => `    (v_ws, ${lit(r)}, 'equipo', 'wa_one')`).join(',\n')}
  on conflict (workspace_id, clave) do nothing;

  -- 3. Las fichas de cada rol (las del arnés, tal cual).
  delete from public.bot_parametros where workspace_id = v_ws and bot in (${ROLES_TRAPPVEL.map((r) => lit(`rol:${r}`)).join(', ')});
${ROLES_TRAPPVEL.map((r) => `  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores) values\n${fichas(r).join(',\n')};`).join('\n')}

  -- 4. Publicar con el banco del arnés (k = 3; la huella de las fichas tiene que ser la probada).
  v_md := public.asistente_publicar_rol(v_ws, 'mano_derecha', 'max', ${json(e.bancos.mano_derecha)});
  v_av := public.asistente_publicar_rol(v_ws, 'asesor_viajes', 'max', ${json(e.bancos.asesor_viajes)});

  -- 5. Mover el puntero y prender.
  update public.asistente_roles set reglamento_id = v_md, activo = true where workspace_id = v_ws and clave = 'mano_derecha';
  update public.asistente_roles set reglamento_id = v_av, activo = true where workspace_id = v_ws and clave = 'asesor_viajes';

  -- 6. Quién habla con qué rol.
${asignaciones.map(asignacion).join('\n')}
${pasoPrueba}${pasoTelefonos}`;
}

const CABECERA = (que: string, a: Asignaciones) => `-- Roles de Trappvel por el número de Agus (canal wa_one), aprobados por Mauricio el 2026-10-29 — ${que}
--
-- GENERADO desde supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts con el JSON de asignaciones de la
-- carpeta del proyecto. No se edita a mano: se regenera.
--   · mano_derecha (el dueño): viajes + gastos con soporte, pagos recibidos, actividades, consulta de negocios y de gastos, cifras.
--   · asesor_viajes (las asesoras): viajes.
--   · Paso a una persona de los dos: el WhatsApp de MeTRIK (${ESCALAMIENTO_METRIK.numero}, «alguien de MeTRIK»).
-- Prerrequisito: desplegar wa-webhook con el código de este PR ANTES de aplicar (sin el código, la base diría «usa roles»
-- y el código viejo de la bandeja no lo lee: todo seguiría como hoy; con el código y sin este SQL, también como hoy).
--
-- Si el paso 0 falla (las fichas publicadas de la bandeja no son las del arnés), exportar las publicadas:
--   select fichas from public.bot_reglamentos where workspace_id = '${WS_TRAPPVEL}' and bot = '${BOT_BANDEJA}'
--   order by version desc limit 1;
-- guardarlas en un .json, correr el arnés de cada rol con --fichas-base <json> --k 3, dejar los banco.json en esta
-- carpeta y regenerar: deno run -A …/roles-trappvel-sql.ts --asignaciones <json> --fichas-base <json>.
${a.staff_sin_telefono?.length ? `--
-- Nota (no se aplica aquí): estas personas no tienen staff.phone_whatsapp, así que entran como colaboradoras y la
-- bandeja no sabe que son del equipo comercial: «la llevo yo» no las puede elegir (el bot pregunta quién lo lleva).
-- Ponerles el teléfono en su staff lo arregla (entran como staff; su asignación por staff, si está abajo, ya rige):
${a.staff_sin_telefono.map((x) => `--   update public.staff set phone_whatsapp = '+${x.telefono.replace(/^\+/, '')}' where id = '${x.staff}'; -- ${comentario(x.quien)}`).join('\n')}
` : ''}`;

export async function sqlPendiente(e: EntradaSql): Promise<string> {
  return `${CABECERA('APLICAR (NO aplicado)', e.asignaciones)}
do $aplicar$
${await cuerpoPublicar(e)}end
$aplicar$;
`;
}

export async function sqlEnsayo(e: EntradaSql): Promise<string> {
  return `${CABECERA('ENSAYO: corre todo y lo revierte', e.asignaciones)}
do $dry$
${await cuerpoPublicar(e)}
  raise exception 'dry-run ok: los dos roles se publican, prenden y asignan (revertido)';
end
$dry$;
`;
}

export function sqlReversa(a: Pick<Asignaciones, 'telefonos_agente'>): string {
  const telefonos = a.telefonos_agente;
  return `-- Roles de Trappvel (2026-10-29) — REVERSA: vuelve al camino de hoy (la bandeja sin roles en wa_one).
--
-- GENERADO desde supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts. Sin roles en el canal, la RPC
-- asistente_resolver_rol dice usa_roles = false y la bandeja atiende como antes. Las versiones publicadas en
-- bot_reglamentos (rol:*) y las fichas en bot_parametros quedan de historia: sin rol, nadie las lee.

do $reversa$
declare
  v_ws uuid := ${lit(WS_TRAPPVEL)};
begin
  delete from public.asistente_asignaciones where workspace_id = v_ws
    and rol_id in (select id from public.asistente_roles where workspace_id = v_ws and clave in (${ROLES_TRAPPVEL.map(lit).join(', ')}));
  delete from public.asistente_roles where workspace_id = v_ws and clave in (${ROLES_TRAPPVEL.map(lit).join(', ')});
  delete from public.asistente_funciones_empresa where workspace_id = v_ws and funcion in (${FUNCIONES_PRENDER.map(lit).join(', ')});
${telefonos.length ? `  -- Los teléfonos que sumó el archivo de aplicar vuelven a quedar fuera del agente, como hoy.
  update public.workspaces w set config_extra = jsonb_set(
    w.config_extra, '{bot_conversacional,agente_telefonos}',
    coalesce((
      select jsonb_agg(x) from jsonb_array_elements(w.config_extra->'bot_conversacional'->'agente_telefonos') x
      where regexp_replace(x #>> '{}', '\\D', '', 'g') not in (${telefonos.map(lit).join(', ')})
    ), '[]'::jsonb)
  )
  where w.id = v_ws and w.config_extra->'bot_conversacional' ? 'agente_telefonos';
` : ''}end
$reversa$;
`;
}

/** Lee los bancos de la carpeta (los del arnés). */
export async function leerBancos(dir: string, leer: (ruta: string) => Promise<string>): Promise<Record<ClaveRolTrappvel, unknown>> {
  const out = {} as Record<ClaveRolTrappvel, unknown>;
  for (const r of ROLES_TRAPPVEL) out[r] = JSON.parse(await leer(`${dir}/${archivoBanco(r)}`));
  return out;
}

/** La carpeta de un archivo (sin `node:path`, para Deno y Node). Pura. */
export const carpetaDe = (ruta: string) => (ruta.includes('/') ? ruta.slice(0, ruta.lastIndexOf('/')) || '/' : '.');

if (import.meta.main) {
  const arg = (k: string) => { const i = Deno.args.indexOf(k); return i >= 0 ? Deno.args[i + 1] : undefined; };
  const rutaAsignaciones = arg('--asignaciones');
  if (!rutaAsignaciones) {
    console.error('falta --asignaciones <json> (vive fuera del repo, en la carpeta del proyecto del cliente)');
    Deno.exit(2);
  }
  const dir = arg('--dir') ?? carpetaDe(rutaAsignaciones);
  const rutaBase = arg('--fichas-base');
  const base = rutaBase
    ? (JSON.parse(await Deno.readTextFile(rutaBase)) as unknown[]).map(fichaValida).filter((f): f is Ficha => !!f)
    : fichasBaseBandeja();
  const asignaciones = leerAsignaciones(JSON.parse(await Deno.readTextFile(rutaAsignaciones)));
  const bancos = await leerBancos(dir, (r) => Deno.readTextFile(r));
  const e = { base, bancos, asignaciones };
  await Deno.writeTextFile(`${dir}/${ARCHIVO_PENDIENTE}`, await sqlPendiente(e));
  await Deno.writeTextFile(`${dir}/${ARCHIVO_ENSAYO}`, await sqlEnsayo(e));
  await Deno.writeTextFile(`${dir}/${ARCHIVO_REVERSA}`, sqlReversa(asignaciones));
  console.log(`listo: ${dir}`);
}
