// ============================================================
// La semilla SQL del reglamento de PRUEBA (Anexo A) para un workspace de prueba
// ------------------------------------------------------------
// Genera `sql/trappvel/2026-10-06_reglamento-bandeja-PRUEBA.sql` desde `reglamento-anexo-a.ts` (una sola fuente). La
// prueba `semilla-sql.test.ts` exige que el archivo sea exactamente esta salida. El SQL se niega a correr sobre el
// workspace de Trappvel: el borrador no lo ha visto Edgar (Anexo A.9).
// Uso: deno run supabase/functions/_shared/agente/bandeja/semilla-sql.ts > sql/trappvel/2026-10-06_reglamento-bandeja-PRUEBA.sql
// ============================================================

import { REGLAMENTO_ANEXO_A } from './reglamento-anexo-a.ts';
import { BOT_BANDEJA } from './dominio.ts';
import type { Ficha } from '../tipos.ts';

const lit = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);
const arr = (v: string[] | null | undefined) => (v && v.length ? `array[${v.map(lit).join(', ')}]::text[]` : 'null');
const json = (v: unknown) => (v ? `${lit(JSON.stringify(v))}::jsonb` : 'null');

export function semillaSql(fichas: Ficha[] = REGLAMENTO_ANEXO_A): string {
  const filas = fichas.map((f) => `    (v_ws, ${lit(BOT_BANDEJA)}, ${lit(f.clave)}, ${lit(f.tipo)}, ${lit(f.carga)}, ${lit(f.cuando)}, ${lit(f.hacer)}, ${arr(f.herramientas)}, ${f.prioridad ?? 'null'}, ${lit(f.fuente || null)}, ${json(f.valores)})`);
  return `-- Reglamento de la bandeja de solicitudes, borrador v0.1 (Anexo A del diseño 2026-10-06) — SOLO PARA UN WORKSPACE DE PRUEBA.
--
-- GENERADO desde supabase/functions/_shared/agente/bandeja/reglamento-anexo-a.ts (semilla-sql.ts). No se edita a mano.
-- NO es una migración y NO se aplica en producción sobre Trappvel: Edgar no ha visto este borrador (Anexo A.9). El bloque
-- se niega a correr si el workspace es el de Trappvel.
--
-- Uso: reemplazar <WORKSPACE_DE_PRUEBA> por el id del workspace de prueba y correrlo con service_role. Deja las fichas
-- en bot_parametros (del workspace) y publica la versión 1 en bot_reglamentos. Para encender el agente en ese workspace:
--   update workspaces set config_extra = jsonb_set(coalesce(config_extra, '{}'), '{bot_conversacional,agente}', 'true')
--   where id = '<WORKSPACE_DE_PRUEBA>';

do $$
declare
  v_ws uuid := '<WORKSPACE_DE_PRUEBA>';
begin
  if (select slug from public.workspaces where id = v_ws) = 'trappvel' then
    raise exception 'este reglamento es un borrador de prueba: no se siembra en el workspace de Trappvel';
  end if;

  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${filas.join(',\n')}
  on conflict do nothing;

  perform public.bot_publicar_reglamento(v_ws, ${lit(BOT_BANDEJA)}, 'semilla de prueba (Anexo A v0.1)');
end;
$$;
`;
}

if (import.meta.main) console.log(semillaSql().trimEnd());
