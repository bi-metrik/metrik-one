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

if (import.meta.main) console.log(semillaSqlDimpro().trimEnd());
