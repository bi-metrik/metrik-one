// ============================================================
// Handler: AYUDA + UNCLEAR (MVP)
// ============================================================

import type { HandlerContext } from '../types.ts';
import { completeSession } from '../wa-session.ts';

export async function handleAyuda(ctx: HandlerContext): Promise<void> {
  const msg = `👋 Soy tu asistente MéTRIK ONE. Escríbeme con naturalidad:

💰 *Gastos:* "Gasté 180 mil en materiales para Pérez" · "Pagué 50K en almuerzo"

📝 *Actividad:* "Llamé a Pérez" · "Reunión con Torres ayer" · "Nota: revisión pendiente"

👤 *Contactos:* "Nuevo contacto Juan Pérez 3001234567"

📊 *Consulta:* "Mis números" · "¿Quién me debe?" · "Qué negocios tengo"

Los cobros, cambios de etapa y horas se gestionan desde la app.`;

  await ctx.sendMessage(msg);
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
