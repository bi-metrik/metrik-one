// ============================================================
// Handler: AYUDA + UNCLEAR (MVP)
// ============================================================

import type { HandlerContext, SupabaseClient } from '../types.ts';
import { completeSession } from '../wa-session.ts';
import { bandejaActiva, leerConfigBandeja, textoGuiaBandeja } from '../wa-bandeja-reglas.ts';
import type { ConfigBandeja } from '../wa-bandeja-reglas.ts';

/** La ayuda de siempre, tal cual (bandeja apagada). */
export const TEXTO_AYUDA_BOT = `👋 Soy tu asistente MéTRIK ONE. Escríbeme con naturalidad:

💰 *Gastos:* "Gasté 180 mil en materiales para Pérez" · "Pagué 50K en almuerzo"

📝 *Actividad:* "Llamé a Pérez" · "Reunión con Torres ayer" · "Nota: revisión pendiente"

👤 *Contactos:* "Nuevo contacto Juan Pérez 3001234567"

📊 *Consulta:* "Mis números" · "¿Quién me debe?" · "Qué negocios tengo"

Los cobros, cambios de etapa y horas se gestionan desde la app.`;

/**
 * La ayuda de siempre con la bandeja encendida: los mismos ejemplos, pero con el prefijo que los
 * lleva al bot. Sin él, «Gasté 180 mil…» o «Mis números» caen en la bandeja (`decidirRuta`).
 */
export function textoAyudaBotConBandeja(config: Pick<ConfigBandeja, 'prefijosBot' | 'prefijosConsulta'>): string {
  const b = config.prefijosConsulta[0] ?? 'bot';
  const g = config.prefijosBot.find(p => !config.prefijosConsulta.includes(p)) ?? 'gasto';
  return `*Lo de siempre*, empezando con «${g}» o «${b}»:

💰 *Gastos:* "${g} 180 mil en materiales para Pérez" · "${g} 50K en almuerzo"

📝 *Actividad:* "${b} llamé a Pérez" · "${b} reunión con Torres ayer" · "${b} nota: revisión pendiente"

👤 *Contactos:* "${b} nuevo contacto Juan Pérez 3001234567"

📊 *Consulta:* "${b} mis números" · "${b} ¿quién me debe?" · "${b} qué negocios tengo"

Los cobros, cambios de etapa y horas se gestionan desde la app.`;
}

/** `config_extra` del workspace; si no se puede leer, la config por defecto (la guía sale igual). */
async function configBandeja(supabase: SupabaseClient, workspaceId: string): Promise<ConfigBandeja> {
  const { data, error } = await supabase.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle();
  if (error) console.error('[ayuda] no se pudo leer config_extra, uso la config por defecto:', error.message);
  return leerConfigBandeja(data?.config_extra ?? null);
}

/** Con la bandeja encendida: la guía de la bandeja arriba y la ayuda de siempre abajo. Apagada: como siempre. */
export async function textoAyuda(ctx: Pick<HandlerContext, 'user' | 'supabase'>): Promise<string> {
  const modules = (ctx.user.modulos?.modules ?? null) as Record<string, unknown> | null;
  if (!bandejaActiva(modules)) return TEXTO_AYUDA_BOT;
  const config = await configBandeja(ctx.supabase, ctx.user.workspace_id);
  return `${textoGuiaBandeja(config)}\n\n${textoAyudaBotConBandeja(config)}`;
}

export async function handleAyuda(ctx: HandlerContext): Promise<void> {
  await ctx.sendMessage(await textoAyuda(ctx));
  await completeSession(ctx.supabase, ctx.session.id);
}

export async function handleUnclear(ctx: HandlerContext): Promise<void> {
  const { session, supabase, parsed } = ctx;
  const unclearCount = (session.context.unclear_count || 0) + 1;

  if (unclearCount >= 3) {
    const appUrl = Deno.env.get('APP_BASE_URL') || 'https://metrikone.co';
    await ctx.sendMessage(
      `Parece que no estoy entendiendo bien. Te recomiendo usar la app: ${appUrl}\n\nEscríbeme "ayuda" para ver qué puedo hacer.`,
    );
    await completeSession(supabase, session.id);
    return;
  }

  const rawSuggestions = parsed.fields.suggested_actions || [];
  const shortSuggestions = rawSuggestions.filter((s: string) => s && s.length <= 20).slice(0, 3);

  if (shortSuggestions.length >= 2) {
    const buttons = shortSuggestions.map((s: string, i: number) => ({
      id: `btn_suggest_${i}`,
      title: s,
    }));
    await ctx.sendButtons(`No entendí. ¿Qué quieres hacer?`, buttons);
    await ctx.updateSession('awaiting_selection', {
      intent: 'UNCLEAR', pending_action: 'WUC',
      unclear_count: unclearCount,
      options: shortSuggestions.map((s: string, i: number) => ({ id: `suggest_${i}`, label: s })),
    });
  } else {
    await ctx.sendButtons(
      `No entendí. ¿Qué quieres hacer?`,
      [
        { id: 'btn_suggest_0', title: 'Registrar gasto' },
        { id: 'btn_suggest_1', title: 'Consultar números' },
        { id: 'btn_suggest_2', title: 'Ver ayuda' },
      ],
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'UNCLEAR', pending_action: 'WUC',
      unclear_count: unclearCount,
      options: [
        { id: 'gasto', label: 'Registrar gasto' },
        { id: 'consulta', label: 'Consultar números' },
        { id: 'ayuda', label: 'Ver ayuda' },
      ],
    });
  }
}

export async function handleUnclearResume(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();
  const btnId = message.interactive_reply;
  const options = context.options || [];

  let selected: { id: string; label: string } | undefined;
  if (btnId) {
    const idx = btnId.match(/btn_suggest_(\d)/)?.[1];
    if (idx !== undefined) selected = options[parseInt(idx)];
  }
  if (!selected) {
    const num = parseInt(text);
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      selected = options[num - 1];
    }
  }

  if (!selected) {
    await completeSession(supabase, session.id);
    return;
  }

  if (selected.id === 'gasto' || /gast|pag|compr/.test(selected.label.toLowerCase())) {
    await ctx.sendMessage('Dime el gasto. Ejemplo: "Gasté 180 mil en transporte para Pérez"');
  } else if (selected.id === 'consulta' || /n[uú]meros|mes|resumen|cartera|debe/.test(selected.label.toLowerCase())) {
    await ctx.sendMessage('Escribe "mis números" o "cartera" para ver tu resumen.');
  } else if (selected.id === 'ayuda') {
    await completeSession(supabase, session.id);
    await handleAyuda(ctx);
    return;
  } else {
    await ctx.sendMessage('Escríbeme con más detalle lo que necesitas.');
  }
  await completeSession(supabase, session.id);
}
