// ============================================================
// Handler: Followup — resuelve anáforas y continuaciones
// Usa session.context.last_context (cargado desde la sesión previa)
// ============================================================

import type { HandlerContext, LastContext, LastContextItem } from '../types.ts';
import { formatCOPShort, bold } from '../wa-format.ts';
import { completeSession } from '../wa-session.ts';

const STAGE_LABELS_PLURAL: Record<string, string> = {
  venta: 'En venta',
  ejecucion: 'En ejecución',
  cobro: 'En cobro',
  cierre: 'En cierre',
};

export async function handleFollowup(ctx: HandlerContext): Promise<void> {
  const { session, supabase } = ctx;
  const lc = session.context?.last_context as LastContext | undefined;

  if (!lc || !lc.items || lc.items.length === 0) {
    await ctx.sendMessage('No tengo contexto reciente para continuar. ¿Me puedes contar de nuevo?');
    await completeSession(supabase, session.id);
    return;
  }

  switch (lc.type) {
    case 'negocios_list':
      await showNegociosRest(ctx, lc);
      break;
    case 'contactos_list':
    case 'cartera_list':
      await showGenericRest(ctx, lc);
      break;
    default:
      await ctx.sendMessage('No tengo contexto reciente para continuar.');
  }

  await completeSession(supabase, session.id);
}

async function showNegociosRest(ctx: HandlerContext, lc: LastContext): Promise<void> {
  const remaining = lc.items.slice(lc.shown);

  if (remaining.length === 0) {
    await ctx.sendMessage('Ya te mostré todos. No hay más.');
    return;
  }

  const stageFilter = (lc.query_meta?.stage_filter as string) || 'all';
  const label = stageFilter !== 'all' && STAGE_LABELS_PLURAL[stageFilter]
    ? STAGE_LABELS_PLURAL[stageFilter]
    : 'Negocios';

  let msg = `📊 ${label} — los ${remaining.length} restantes:\n`;
  for (const n of remaining) {
    const precio = Number(n.precio || 0);
    const cod = n.codigo ? ` (${n.codigo})` : '';
    const stage = stageFilter === 'all' && n.stage ? ` · ${STAGE_LABELS_PLURAL[n.stage] || n.stage}` : '';
    msg += `\n• ${bold(n.nombre)}${cod} — ${formatCOPShort(precio)}${stage}`;
  }
  await ctx.sendMessage(msg);
}

async function showGenericRest(ctx: HandlerContext, lc: LastContext): Promise<void> {
  const remaining = lc.items.slice(lc.shown);
  if (remaining.length === 0) {
    await ctx.sendMessage('Ya te mostré todos.');
    return;
  }
  let msg = `Los ${remaining.length} restantes:\n`;
  for (const item of remaining) {
    msg += `\n• ${item.nombre}`;
  }
  await ctx.sendMessage(msg);
}
