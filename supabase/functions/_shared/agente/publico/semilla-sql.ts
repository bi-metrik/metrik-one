// ============================================================
// La semilla SQL del reglamento de PRUEBA del asistente de Sabor para un workspace de prueba
// ------------------------------------------------------------
// Genera `sql/sabor/2026-10-21_reglamento-asistente-PRUEBA.sql` desde `reglamento-sabor.ts` (una sola fuente). La
// prueba `semilla-sql.test.ts` exige que el archivo sea exactamente esta salida. El SQL se niega a correr sobre un
// workspace que no esté marcado `espacio_de_pruebas = true`: el catálogo es inventado ([EJEMPLO]) y los textos legales
// son borrador (falta el visto de Emilio). NO es una migración y NO se aplica en producción sobre Sabor.
// Uso: deno run supabase/functions/_shared/agente/publico/semilla-sql.ts > sql/sabor/2026-10-21_reglamento-asistente-PRUEBA.sql
// ============================================================

import { REGLAMENTO_SABOR } from './reglamento-sabor.ts';
import { BOT_PUBLICO } from './dominio.ts';
import type { Ficha } from '../tipos.ts';

const lit = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);
const arr = (v: string[] | null | undefined) => (v === null || v === undefined ? 'null' : v.length ? `array[${v.map(lit).join(', ')}]::text[]` : `'{}'::text[]`);
const json = (v: unknown) => (v ? `${lit(JSON.stringify(v))}::jsonb` : 'null');

export function semillaSqlSabor(fichas: Ficha[] = REGLAMENTO_SABOR): string {
  const filas = fichas.map((f) => `    (v_ws, ${lit(BOT_PUBLICO)}, ${lit(f.clave)}, ${lit(f.tipo)}, ${lit(f.carga)}, ${lit(f.cuando)}, ${lit(f.hacer)}, ${arr(f.herramientas)}, ${f.prioridad ?? 'null'}, ${lit(f.fuente || null)}, ${json(f.valores)})`);
  return `-- Reglamento del asistente público de Sabor & Experiencias, borrador etapa 1 — SOLO PARA UN WORKSPACE DE PRUEBA.
--
-- GENERADO desde supabase/functions/_shared/agente/publico/reglamento-sabor.ts (semilla-sql.ts). No se edita a mano.
-- NO es una migración y NO se aplica en producción sobre Sabor: el catálogo es [EJEMPLO] inventado, los textos de
-- aviso y autorización son borrador (falta el visto de Emilio) y hay HUECOS de Sabor (nombre, tono, horario, políticas).
-- El bloque se niega a correr si el workspace no está marcado config_extra.espacio_de_pruebas = true.
--
-- Uso: reemplazar <WORKSPACE_DE_PRUEBA> por el id del workspace de prueba y correrlo con service_role. Deja las fichas
-- en bot_parametros (del workspace) y publica la versión 1 en bot_reglamentos (bot ${BOT_PUBLICO}). Para encender el
-- asistente en ese workspace hace falta además config_extra.bot_conversacional.chatwoot (activo, cuenta_id, inboxes…)
-- y los secretos CHATWOOT_WEBHOOK_SECRET_<SLUG> y CHATWOOT_API_TOKEN_<SLUG>.

do $$
declare
  v_ws uuid := '<WORKSPACE_DE_PRUEBA>';
begin
  if coalesce((select (config_extra->>'espacio_de_pruebas')::boolean from public.workspaces where id = v_ws), false) is not true then
    raise exception 'este reglamento es un borrador de prueba: solo se siembra en un workspace con espacio_de_pruebas = true';
  end if;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filas.join(',\n')}
  on conflict do nothing;

  perform public.bot_publicar_reglamento(v_ws, ${lit(BOT_PUBLICO)}, 'semilla de prueba (asistente Sabor, borrador etapa 1)');
end;
$$;
`;
}

if (import.meta.main) console.log(semillaSqlSabor().trimEnd());
