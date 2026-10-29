// ============================================================
// La semilla SQL del reglamento del asistente de VENTAS de Dimpro (ensayo con conocidos, 29-oct)
// ------------------------------------------------------------
// Genera `sql/dimpro/2026-10-29_reglamento-asistente-ventas-ENSAYO.sql` desde `reglamento-dimpro.ts` (una sola fuente);
// la prueba exige que el archivo sea exactamente esta salida. NO es una migración: ESCRIBE DATOS en producción (las
// fichas en `bot_parametros` y la versión publicada en `bot_reglamentos`, solo del workspace dimpro). La corre la sesión
// principal con service_role, con el visto de Mauricio. Se niega a correr sobre otro workspace.
// Uso: deno run supabase/functions/_shared/agente/publico/ventas/semilla-sql-dimpro.ts > sql/dimpro/2026-10-29_reglamento-asistente-ventas-ENSAYO.sql
// ============================================================

import { BOT_PUBLICO } from '../dominio.ts';
import { filasFichas, lit } from '../semilla-sql.ts';
import type { Ficha } from '../../tipos.ts';
import { REGLAMENTO_DIMPRO } from './reglamento-dimpro.ts';

export const WORKSPACE_DIMPRO = '67f7af44-b5ac-4d5c-aa9e-44954368447c';

export function semillaSqlDimpro(fichas: Ficha[] = REGLAMENTO_DIMPRO): string {
  return `-- Reglamento del asistente de VENTAS de Dimpro (bot ${BOT_PUBLICO}, dominio ventas) — ENSAYO CON CONOCIDOS, 29-oct.
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts). No se
-- edita a mano. NO es una migración: escribe DATOS del workspace dimpro (bot_parametros + versión publicada en
-- bot_reglamentos). Las políticas de despacho, recoger, flete, garantía, cambios y factura son [ENSAYO 29-oct]
-- (inventadas; las cambia Mauricio). Los textos de aviso y autorización son borrador (falta el visto de Emilio).
-- El catálogo y los precios NO van aquí: se leen de Ferretería en cada turno.
--
-- Para encender el asistente hace falta además (no lo hace este archivo):
--   config_extra.bot_conversacional.chatwoot = { activo, dominio: 'ventas', cuenta_id, inboxes, terminos_url, ... },
--   los secretos CHATWOOT_WEBHOOK_SECRET_DIMPRO y CHATWOOT_API_TOKEN_DIMPRO, las llaves de Bold en la bóveda de dimpro y
--   la URL del webhook de Bold (/api/webhooks/bold/funciones/${WORKSPACE_DIMPRO}) en el panel de Bold.

do $$
declare
  v_ws uuid := ${lit(WORKSPACE_DIMPRO)};
begin
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'este reglamento es solo del workspace dimpro';
  end if;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filasFichas(fichas).join(',\n')}
  on conflict do nothing;

  perform public.bot_publicar_reglamento(v_ws, ${lit(BOT_PUBLICO)}, 'asistente de ventas Dimpro: ensayo con conocidos (29-oct)');
end;
$$;
`;
}

/** Las fichas que cambió la venta consultiva (Mauricio, 29-oct): `inv.tres` es nueva; las demás se reescriben. */
export const CLAVES_VENTA_CONSULTIVA = ['alc.producto', 'inv.urgencia', 'inv.tres', 'proc.compra', 'est.breve'];

/**
 * El SQL que pone al día el reglamento PUBLICADO de dimpro con unas fichas del código (por defecto, las de la venta
 * consultiva): actualiza las que cambiaron, inserta las que faltan y, solo si algo cambió, publica una versión nueva.
 * Idempotente: correrlo dos veces no publica dos veces. Archivo: `sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql`.
 * Uso: deno run supabase/functions/_shared/agente/publico/ventas/semilla-sql-dimpro.ts --consultiva > sql/dimpro/2026-10-29_reglamento-ventas-consultiva.sql
 */
export function actualizacionSqlDimpro(claves: string[] = CLAVES_VENTA_CONSULTIVA, fichas: Ficha[] = REGLAMENTO_DIMPRO): string {
  const elegidas = claves.map((c) => {
    const f = fichas.find((x) => x.clave === c);
    if (!f) throw new Error(`la ficha ${c} no está en el reglamento`);
    return f;
  });
  return `-- Venta consultiva del asistente de VENTAS de Dimpro (29-oct): una pregunta de uso, máximo 3 sugerencias con su razón y
-- las fotos que manda el código. Pone al día en bot_parametros las fichas ${claves.join(', ')}
-- y publica una versión nueva del reglamento SOLO si alguna cambió (idempotente).
--
-- GENERADO desde supabase/functions/_shared/agente/publico/ventas/reglamento-dimpro.ts (semilla-sql-dimpro.ts --consultiva).
-- No se edita a mano. NO es una migración: escribe DATOS del workspace dimpro. La corre la sesión principal con
-- service_role, DESPUÉS del deploy de chatwoot-agente con el código de este cambio (ver_catalogo con \`uso\` y las fotos).

do $$
declare
  v_ws uuid := ${lit(WORKSPACE_DIMPRO)};
  v_bot text := ${lit(BOT_PUBLICO)};
  v_cambios integer := 0;
  v_n integer;
begin
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'este reglamento es solo del workspace dimpro';
  end if;

  create temporary table _fichas_dimpro (workspace_id uuid, bot text, clave text, tipo text, carga text, cuando text, hacer text, herramientas text[], prioridad integer, fuente text, valores jsonb) on commit drop;
  insert into _fichas_dimpro (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filasFichas(elegidas).join(',\n')};

  update public.bot_parametros p
     set tipo = f.tipo, carga = f.carga, cuando = f.cuando, hacer = f.hacer, herramientas = f.herramientas,
         prioridad = f.prioridad, fuente = f.fuente, valores = f.valores, activo = true, updated_at = now()
    from _fichas_dimpro f
   where p.workspace_id = v_ws and p.bot = v_bot and p.clave = f.clave
     and (p.tipo, p.carga, p.cuando, p.hacer, p.herramientas, p.prioridad, p.fuente, p.valores, p.activo)
         is distinct from (f.tipo, f.carga, f.cuando, f.hacer, f.herramientas, f.prioridad, f.fuente, f.valores, true);
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  select f.workspace_id, f.bot, f.clave, f.tipo, f.carga, f.cuando, f.hacer, f.herramientas, f.prioridad, f.fuente, f.valores
    from _fichas_dimpro f
   where not exists (select 1 from public.bot_parametros p where p.workspace_id = v_ws and p.bot = v_bot and p.clave = f.clave);
  get diagnostics v_n = row_count;
  v_cambios := v_cambios + v_n;

  if v_cambios > 0 then
    perform public.bot_publicar_reglamento(v_ws, v_bot, 'asistente de ventas Dimpro: venta consultiva y fotos (29-oct)');
    raise notice 'fichas cambiadas: %; reglamento publicado', v_cambios;
  else
    raise notice 'sin cambios: no se publica';
  end if;
end;
$$;
`;
}

if (import.meta.main) console.log((Deno.args.includes('--consultiva') ? actualizacionSqlDimpro() : semillaSqlDimpro()).trimEnd());
