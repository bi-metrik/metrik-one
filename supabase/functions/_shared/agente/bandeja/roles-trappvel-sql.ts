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
// Un CAMBIO de fichas sobre los roles ya publicados (`--antes <json> --prefijo <p>`, p. ej. «plata» fuera del texto,
// 2026-10-30): el archivo cambia esas fichas en el borrador de la bandeja y publica una versión nueva (`bot_reglamentos`
// es inmutable), vuelve a publicar los dos roles y mueve su puntero; no toca quién habla con qué rol, ni los teléfonos,
// ni si el rol está prendido. Su reversa vuelve a las versiones de antes (la bandeja y los roles).
// La prueba `roles-trappvel-sql.test.ts` corre el SQL en Postgres en memoria (PGlite) con las migraciones reales y
// asignaciones inventadas. Cómo correrlo: `docs/asistentes/roles-trappvel.md`.
// Uso: deno run -A supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts --asignaciones <json> [--dir <carpeta>]
//        [--fichas-base <json>] [--antes <json> --prefijo <p>]
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
export const archivoBanco = (rol: ClaveRolTrappvel, prefijo = '') => `${prefijo}banco-${rol}.json`;

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
  /**
   * Un cambio sobre los roles ya publicados: la bandeja publicada HOY (antes del cambio). `base` es la bandeja como
   * queda. El archivo cambia esas fichas de la bandeja, publica los roles sobre ella y no toca asignaciones.
   */
  antes?: Ficha[];
}

/** Una ficha de la bandeja que cambia de texto (solo `cuando`, `hacer` y `valores`; lo demás no se toca). */
export interface CambioFicha { clave: string; antes: Ficha; despues: Ficha }

/**
 * Lo que cambia entre dos versiones de la bandeja. Solo textos de fichas que siguen ahí: una ficha que entra o sale, o
 * que cambia de tipo, carga, herramientas o prioridad, no es este caso (lanza: eso se publica desde el borrador). Pura.
 */
export function cambiosDeFichas(antes: Ficha[], despues: Ficha[]): CambioFicha[] {
  const porClave = (fs: Ficha[]) => new Map(fs.map((f) => [f.clave, f]));
  const a = porClave(antes);
  const d = porClave(despues);
  const claves = (m: Map<string, Ficha>) => [...m.keys()].sort().join(',');
  if (claves(a) !== claves(d)) throw new Error('cambio de fichas: entran o salen claves (solo se cambian textos)');
  const igual = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const out: CambioFicha[] = [];
  for (const [clave, fa] of a) {
    const fd = d.get(clave)!;
    for (const k of ['tipo', 'carga', 'herramientas', 'prioridad'] as const) {
      if (!igual(fa[k], fd[k])) throw new Error(`cambio de fichas: ${clave} cambia ${k} (solo se cambian textos)`);
    }
    if (fa.hacer !== fd.hacer || !igual(fa.cuando, fd.cuando) || !igual(fa.valores, fd.valores)) out.push({ clave, antes: fa, despues: fd });
  }
  return out;
}

/**
 * Cambia unas fichas en el borrador de la bandeja y publica una versión nueva: la publicada no se edita
 * (`bot_reglamentos_inmutable`). Frena si la publicada no es `desde` o si lo publicado no queda en `hasta` (el borrador
 * tenía algo más). Si ya está en `hasta`, no hace nada. Un puntero fijo (`agente_config.reglamento_id`) se mueve a la nueva.
 */
async function pasoBandeja(desde: Ficha[], hasta: Ficha[], que: string): Promise<string> {
  const cambios = cambiosDeFichas(desde, hasta);
  if (!cambios.length) return '';
  const huellaDesde = await huellaPublicable(desde);
  const huellaHasta = await huellaPublicable(hasta);
  const update = (c: CambioFicha) => `    update public.bot_parametros set hacer = ${lit(c.despues.hacer)}, cuando = ${lit(c.despues.cuando)}, valores = ${json(c.despues.valores)}, updated_at = now()
    where workspace_id = v_ws and bot = ${lit(BOT_BANDEJA)} and clave = ${lit(c.clave)} and activo
      and hacer = ${lit(c.antes.hacer)} and cuando is not distinct from ${lit(c.antes.cuando)};
    get diagnostics v_n = row_count;
    if v_n <> 1 then raise exception 'la ficha ${c.clave} de ${BOT_BANDEJA} no está en el borrador como se esperaba (% filas)', v_n; end if;`;
  return `
  -- B. ${que}: ${cambios.map((c) => c.clave).join(', ')}. La versión publicada no se edita: se cambia el
  --    borrador (bot_parametros) y se publica una versión nueva.
  select config_extra->'bot_conversacional'->'agente_config'->>'reglamento_id' into v_pin from public.workspaces where id = v_ws;
  select fichas into v_base from public.bot_reglamentos
  where workspace_id = v_ws and bot = ${lit(BOT_BANDEJA)} and (v_pin is null or id::text = v_pin)
  order by version desc limit 1;
  if v_base is null then raise exception 'Trappvel no tiene publicado el reglamento ${BOT_BANDEJA}'; end if;
  v_huella := public.asistente_huella_fichas(v_base);
  if v_huella = ${lit(huellaHasta)} then
    raise notice 'la bandeja ya está publicada con el cambio: no se vuelve a publicar';
  elsif v_huella <> ${lit(huellaDesde)} then
    raise exception 'las fichas publicadas de ${BOT_BANDEJA} (huella %) no son las de antes del cambio (${huellaDesde.slice(0, 12)}…): no se toca nada', left(v_huella, 12);
  else
${cambios.map(update).join('\n')}
    v_nueva := public.bot_publicar_reglamento(v_ws, ${lit(BOT_BANDEJA)}, 'max', null);
    if public.asistente_huella_fichas((select fichas from public.bot_reglamentos where id = v_nueva)) <> ${lit(huellaHasta)} then
      raise exception 'el borrador de ${BOT_BANDEJA} no era lo publicado: la versión nueva no queda como se probó (no se toca nada)';
    end if;
    if v_pin is not null then
      update public.workspaces set config_extra = jsonb_set(config_extra, '{bot_conversacional,agente_config,reglamento_id}', to_jsonb(v_nueva::text))
      where id = v_ws;
    end if;
  end if;
`;
}

/** Un texto libre (del JSON) dentro de un comentario SQL: una sola línea. */
const comentario = (t: string) => t.replace(/[\r\n]+/g, ' ').trim();

/** El cuerpo plpgsql que publica y prende (lo comparten el archivo de aplicar y el ensayo). */
export async function cuerpoPublicar(e: EntradaSql): Promise<string> {
  const huellaBase = await huellaPublicable(e.base);
  const { asignaciones, telefonos_agente: telefonos, telefono_prueba: prueba } = e.asignaciones;
  const cambio = !!e.antes;
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
  v_av uuid;${cambio ? `
  v_n integer;
  v_nueva uuid;` : ''}
begin
  if (select slug from public.workspaces where id = v_ws) is distinct from 'trappvel' then
    raise exception 'el workspace % no es el de Trappvel', v_ws;
  end if;
${cambio ? `
  -- A. Es un cambio sobre los roles ya publicados: tienen que estar los dos (si no, se aplica primero la publicación).
  if (select count(*) from public.asistente_roles where workspace_id = v_ws and clave in (${ROLES_TRAPPVEL.map(lit).join(', ')}) and reglamento_id is not null) <> ${ROLES_TRAPPVEL.length} then
    raise exception 'los roles de Trappvel no están publicados: este archivo solo cambia fichas de roles que ya existen';
  end if;
${await pasoBandeja(e.antes!, e.base, 'La bandeja')}` : ''}
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

${cambio ? `  -- 5. Mover el puntero (prendido o apagado, cada rol se queda como está; quién habla con qué rol no cambia).
  update public.asistente_roles set reglamento_id = v_md where workspace_id = v_ws and clave = 'mano_derecha';
  update public.asistente_roles set reglamento_id = v_av where workspace_id = v_ws and clave = 'asesor_viajes';
` : `  -- 5. Mover el puntero y prender.
  update public.asistente_roles set reglamento_id = v_md, activo = true where workspace_id = v_ws and clave = 'mano_derecha';
  update public.asistente_roles set reglamento_id = v_av, activo = true where workspace_id = v_ws and clave = 'asesor_viajes';

  -- 6. Quién habla con qué rol.
${asignaciones.map(asignacion).join('\n')}
${pasoPrueba}${pasoTelefonos}`}`;
}

/**
 * La reversa de un cambio de fichas: la bandeja vuelve a sus textos de antes (versión nueva con ellos) y cada rol vuelve
 * a la última versión publicada cuya huella es la de su banco de antes (`huellasAntes`, del `banco-<rol>.json` con que se
 * publicó). No se recalcula con el código: el código de hoy puede armar otras fichas del rol sobre la misma bandeja. El
 * borrador del rol se rehace con las fichas de esa versión.
 */
export async function sqlReversaCambio(e: Pick<EntradaSql, 'base' | 'antes'>, que: string, huellasAntes: Record<ClaveRolTrappvel, string>): Promise<string> {
  if (!e.antes) throw new Error('la reversa de un cambio necesita las fichas de antes');
  for (const r of ROLES_TRAPPVEL) if (!/^[0-9a-f]{64}$/.test(huellasAntes[r] ?? '')) throw new Error(`la reversa necesita la huella del banco de antes de ${r}`);
  const rol = (r: ClaveRolTrappvel) => `  select id, fichas into v_id, v_fichas from public.bot_reglamentos
  where workspace_id = v_ws and bot = ${lit(`rol:${r}`)} and public.asistente_huella_fichas(fichas) = ${lit(huellasAntes[r])}
  order by version desc limit 1;
  if v_id is null then raise exception 'no hay una versión publicada de ${r} con la huella de su banco de antes'; end if;
  update public.asistente_roles set reglamento_id = v_id where workspace_id = v_ws and clave = ${lit(r)};
  delete from public.bot_parametros where workspace_id = v_ws and bot = ${lit(`rol:${r}`)};
  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  select v_ws, ${lit(`rol:${r}`)}, f->>'clave', f->>'tipo', f->>'carga', f->>'cuando', f->>'hacer',
    case when f ? 'herramientas' then array(select jsonb_array_elements_text(f->'herramientas')) end,
    (f->>'prioridad')::integer, f->>'fuente', f->'valores'
  from jsonb_array_elements(v_fichas) f;`;
  return `-- Roles de Trappvel — REVERSA de ${que}
--
-- GENERADO desde supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts. La bandeja vuelve a sus textos de
-- antes (se publica una versión nueva con ellos: las publicadas no se editan) y cada rol vuelve a su versión de antes
-- (la de la huella de su banco anterior; el borrador, igual a ella). No toca asignaciones, teléfonos ni si el rol está prendido.

do $reversa$
declare
  v_ws uuid := ${lit(WS_TRAPPVEL)};
  v_pin text;
  v_base jsonb;
  v_huella text;
  v_n integer;
  v_nueva uuid;
  v_id uuid;
  v_fichas jsonb;
begin
  if (select slug from public.workspaces where id = v_ws) is distinct from 'trappvel' then
    raise exception 'el workspace % no es el de Trappvel', v_ws;
  end if;
${await pasoBandeja(e.base, e.antes, 'La bandeja vuelve a como estaba')}
  -- Los roles, a su versión de antes.
${ROLES_TRAPPVEL.map(rol).join('\n')}
end
$reversa$;
`;
}

const CABECERA_CAMBIO = (que: string, e: EntradaSql) => `-- Roles de Trappvel — CAMBIO de fichas sobre los roles ya publicados — ${que}
--
-- GENERADO desde supabase/functions/_shared/agente/bandeja/roles-trappvel-sql.ts (--antes). No se edita a mano: se regenera.
-- Cambian en la bandeja (${BOT_BANDEJA}): ${cambiosDeFichas(e.antes!, e.base).map((c) => c.clave).join(', ') || 'nada'}; los dos roles se
-- vuelven a publicar sobre ella con su banco del arnés (k = 3) y con sus fichas del código del PR.
-- No toca quién habla con qué rol, ni los teléfonos del agente, ni si un rol está prendido.
-- No pide deploy: wa-webhook lee las fichas de la base.
`;

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
  return `${e.antes ? CABECERA_CAMBIO('APLICAR (NO aplicado)', e) : CABECERA('APLICAR (NO aplicado)', e.asignaciones)}
do $aplicar$
${await cuerpoPublicar(e)}end
$aplicar$;
`;
}

export async function sqlEnsayo(e: EntradaSql): Promise<string> {
  return `${e.antes ? CABECERA_CAMBIO('ENSAYO: corre todo y lo revierte', e) : CABECERA('ENSAYO: corre todo y lo revierte', e.asignaciones)}
do $dry$
${await cuerpoPublicar(e)}
  raise exception '${e.antes ? 'dry-run ok: la bandeja y los dos roles se publican con el cambio (revertido)' : 'dry-run ok: los dos roles se publican, prenden y asignan (revertido)'}';
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
export async function leerBancos(dir: string, leer: (ruta: string) => Promise<string>, prefijo = ''): Promise<Record<ClaveRolTrappvel, unknown>> {
  const out = {} as Record<ClaveRolTrappvel, unknown>;
  for (const r of ROLES_TRAPPVEL) out[r] = JSON.parse(await leer(`${dir}/${archivoBanco(r, prefijo)}`));
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
  const leerFichas = async (ruta: string) => (JSON.parse(await Deno.readTextFile(ruta)) as unknown[]).map(fichaValida).filter((f): f is Ficha => !!f);
  const rutaBase = arg('--fichas-base');
  const base = rutaBase ? await leerFichas(rutaBase) : fichasBaseBandeja();
  const rutaAntes = arg('--antes');
  const prefijo = arg('--prefijo');
  if (!!rutaAntes !== !!prefijo) {
    console.error('un cambio de fichas va con --antes <json> (la bandeja publicada hoy) y --prefijo <p> (nombre de los archivos)');
    Deno.exit(2);
  }
  const antes = rutaAntes ? await leerFichas(rutaAntes) : undefined;
  const asignaciones = leerAsignaciones(JSON.parse(await Deno.readTextFile(rutaAsignaciones)));
  const bancos = await leerBancos(dir, (r) => Deno.readTextFile(r), prefijo ?? '');
  const e = { base, bancos, asignaciones, antes };
  const nombre = (fijo: string, sufijo: string) => (prefijo ? `${prefijo}${sufijo}.sql` : fijo);
  await Deno.writeTextFile(`${dir}/${nombre(ARCHIVO_PENDIENTE, 'PENDIENTE')}`, await sqlPendiente(e));
  await Deno.writeTextFile(`${dir}/${nombre(ARCHIVO_ENSAYO, 'ENSAYO')}`, await sqlEnsayo(e));
  // La reversa de un cambio vuelve a lo publicado con los bancos de antes (los de la carpeta sin prefijo).
  const huellasAntes = async () => {
    const b = await leerBancos(dir, (r) => Deno.readTextFile(r));
    return Object.fromEntries(ROLES_TRAPPVEL.map((r) => [r, String((b[r] as { huella_fichas?: unknown }).huella_fichas ?? '')])) as Record<ClaveRolTrappvel, string>;
  };
  await Deno.writeTextFile(`${dir}/${nombre(ARCHIVO_REVERSA, 'REVERSA')}`, antes ? await sqlReversaCambio(e, prefijo!, await huellasAntes()) : sqlReversa(asignaciones));
  console.log(`listo: ${dir}`);
}
