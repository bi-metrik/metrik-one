// ============================================================
// El reglamento del modo obras de UN workspace, como SQL para publicarlo (gestión: bot `one`; operarios: `one_operario`)
// ------------------------------------------------------------
// Sin publicar nada, un workspace con `bot_conversacional.obras = true` ya usa el reglamento del código
// (`reglamento-obras.ts`). Publicar sirve para que el workspace tenga su versión fijada (y editable sin desplegar).
// Lo corre la sesión principal con service_role, no un subagente. No es una migración.
// Uso: deno run supabase/functions/_shared/agente/one/semilla-obras-sql.ts "<Nombre del workspace>" > reglamento.sql
//      y reemplazar <WORKSPACE_ID> por el id del workspace.
// ============================================================

import type { Ficha } from '../tipos.ts';
import { BOT_ONE } from './reglamento.ts';
import { BOT_OPERARIO } from './operario.ts';
import { fichasObras, fichasOperario } from './reglamento-obras.ts';

const lit = (v: string | null | undefined) => (v === null || v === undefined ? 'null' : `'${v.replace(/'/g, "''")}'`);
const arr = (v: string[] | null | undefined) => (v && v.length ? `array[${v.map(lit).join(', ')}]::text[]` : 'null');
const json = (v: unknown) => (v ? `${lit(JSON.stringify(v))}::jsonb` : 'null');

const filas = (bot: string, fichas: Ficha[]) => fichas.map((f) => `    (v_ws, ${lit(bot)}, ${lit(f.clave)}, ${lit(f.tipo)}, ${lit(f.carga)}, ${lit(f.cuando)}, ${lit(f.hacer)}, ${arr(f.herramientas)}, ${f.prioridad ?? 'null'}, ${lit(f.fuente || null)}, ${json(f.valores)})`);

export function semillaObrasSql(nombre: string): string {
  return `-- Reglamento del modo obras de «${nombre}» (gestión y operarios). GENERADO por semilla-obras-sql.ts: no se edita a mano.
-- Reemplazar <WORKSPACE_ID>. Deja las fichas en bot_parametros y publica una versión de cada bot en bot_reglamentos.

do $$
declare
  v_ws uuid := '<WORKSPACE_ID>';
begin
  insert into public.bot_parametros (workspace_id, bot, clave, tipo, carga, cuando, hacer, herramientas, prioridad, fuente, valores)
  values
${[...filas(BOT_ONE, fichasObras(nombre)), ...filas(BOT_OPERARIO, fichasOperario(nombre))].join(',\n')}
  on conflict do nothing;

  perform public.bot_publicar_reglamento(v_ws, ${lit(BOT_ONE)}, 'modo obras v1');
  perform public.bot_publicar_reglamento(v_ws, ${lit(BOT_OPERARIO)}, 'modo obras v1 (operarios)');
end;
$$;
`;
}

if (import.meta.main) console.log(semillaObrasSql(Deno.args[0] ?? 'la empresa').trimEnd());
