// ============================================================
// El SQL de las fichas del perfil para el reglamento de Trappvel (`bot_parametros`)
// ------------------------------------------------------------
// Genera `sql/trappvel/2026-10-12_reglamento-perfil-contacto.sql` desde `reglamento-perfil.ts` (una sola fuente). La
// prueba `perfil-sql.test.ts` exige que el archivo sea exactamente esta salida.
// El SQL deja las fichas en `bot_parametros` (borrador) y NO publica: la publicación (`bot_publicar_reglamento`) la
// hace la sesión principal, después de aplicar la migración `20261012234500_contacto_perfil_hechos.sql` y desplegar
// `wa-webhook` (sin la tabla, el bot ofrece guardar y dice que no pudo revisar el perfil).
// Uso: deno run supabase/functions/_shared/agente/bandeja/perfil-sql.ts > sql/trappvel/2026-10-12_reglamento-perfil-contacto.sql
// ============================================================

import { FICHAS_PERFIL } from './reglamento-perfil.ts';
import { BOT_BANDEJA } from './dominio.ts';
import type { Ficha } from '../tipos.ts';

export const WS_TRAPPVEL = 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc';

const lit = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);
const arr = (v: string[] | null | undefined) => (v && v.length ? `array[${v.map(lit).join(', ')}]::text[]` : 'null');
const json = (v: unknown) => (v ? `${lit(JSON.stringify(v))}::jsonb` : 'null');

export function perfilSql(fichas: Ficha[] = FICHAS_PERFIL): string {
  const filas = fichas.map((f) => `    (v_ws, ${lit(BOT_BANDEJA)}, ${lit(f.clave)}, ${lit(f.tipo)}, ${lit(f.carga)}, ${lit(f.cuando)}, ${lit(f.hacer)}, ${arr(f.herramientas)}, ${f.prioridad ?? 'null'}, ${lit(f.fuente || null)}, ${json(f.valores)})`);
  return `-- Reglamento de la bandeja de Trappvel: las fichas del PERFIL DEL CONTACTO (brief a Max del 2026-10-12).
--
-- GENERADO desde supabase/functions/_shared/agente/bandeja/reglamento-perfil.ts (perfil-sql.ts). No se edita a mano.
-- NO es una migración. Escribe en bot_parametros (el borrador del reglamento) y NO publica.
--
-- Orden (sesión principal, con OK de Mauricio):
--   1. aplicar supabase/migrations/20261012234500_contacto_perfil_hechos.sql;
--   2. desplegar wa-webhook (lleva perfil_contacto y la extracción con perfil);
--   3. correr este archivo con service_role;
--   4. publicar: select public.bot_publicar_reglamento('${WS_TRAPPVEL}', '${BOT_BANDEJA}', '<quien>');
-- Volver atrás: el puntero agente_config.reglamento_id a la versión anterior (hoy la 2), o publicar sin estas fichas.
--
-- ${fichas.length} fichas: ${fichas.map((f) => f.clave).join(', ')}.
-- Las de clave existente (perfil, alc.temas, alc.no_temas, g.relato_del_cliente, g.sin_juicios) se REEMPLAZAN con el
-- texto de hoy más lo del perfil; las demás son nuevas.

do $$
declare
  v_ws uuid := '${WS_TRAPPVEL}';
begin
  if (select slug from public.workspaces where id = v_ws) is distinct from 'trappvel' then
    raise exception 'este archivo es para el workspace de Trappvel';
  end if;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filas.join(',\n')}
  on conflict (bot, coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid), clave) do update set
    tipo = excluded.tipo, carga = excluded.carga, cuando = excluded.cuando, hacer = excluded.hacer,
    herramientas = excluded.herramientas, prioridad = excluded.prioridad, fuente = excluded.fuente,
    valores = excluded.valores, activo = true, updated_at = now();
end;
$$;
`;
}

if (import.meta.main) console.log(perfilSql().trimEnd());
