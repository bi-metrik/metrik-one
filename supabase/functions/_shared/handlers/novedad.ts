// ============================================================
// Handler: Novedad — W09 (Nota Oportunidad), W11 (Nota Proyecto)
// D95: Texto libre — Gemini solo extrae entity_hint
// ============================================================

import type { HandlerContext } from '../types.ts';
import { PIPELINE_STAGE_LABELS } from '../types.ts';
import { formatCOP, bold, daysSince } from '../wa-format.ts';
import { findProjects, findOpportunities } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

export async function handleNovedad(ctx: HandlerContext): Promise<void> {
  const { parsed, session } = ctx;

  if (session.state !== 'started') {
    await handleResumeNovedad(ctx);
    return;
  }

  switch (parsed.intent) {
    case 'NOTA_OPORTUNIDAD': await handleNotaOportunidad(ctx); break;
    case 'NOTA_PROYECTO': await handleNotaProyecto(ctx); break;
  }
}

// ============================================================
// W09 — Nota sobre Oportunidad
// ============================================================

async function handleNotaOportunidad(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, note } = parsed.fields;
  const noteText = note || ctx.message.text;

  if (!entity_hint) {
    await ctx.sendMessage('¿Sobre cuál oportunidad es la nota?');
    await ctx.updateSession('collecting', {
      intent: 'NOTA_OPORTUNIDAD', pending_action: 'W09',
      parsed_fields: { note: noteText },
    });
    return;
  }

  const opps = await findOpportunities(supabase, user.workspace_id, entity_hint);

  if (opps.length === 0) {
    await ctx.sendMessage(`❌ No encontré oportunidad activa con "${entity_hint}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  if (opps.length === 1) {
    const opp = opps[0];
    const stageLabel = PIPELINE_STAGE_LABELS[opp.etapa] || opp.etapa;
    const diasSinActividad = daysSince(opp.updated_at);

    const msg = `📝 Voy a agregar esta nota a ${bold(opp.descripcion)} (${stageLabel}):\n\n"${noteText}"`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
    await ctx.updateSession('confirming', {
      intent: 'NOTA_OPORTUNIDAD', pending_action: 'W09',
      oportunidad_id: opp.id,
      parsed_fields: { ...parsed.fields, note: noteText },
    });
    return;
  }

  // Multiple matches
  const options = opps.slice(0, 5).map((o: any) => ({
    id: o.id,
    label: `${bold(o.descripcion)} — ${PIPELINE_STAGE_LABELS[o.etapa] || o.etapa}`,
  }));

  await ctx.sendOptions(
    `📝 Nota: "${noteText}"\n\n¿Para cuál oportunidad?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'NOTA_OPORTUNIDAD', pending_action: 'W09',
    parsed_fields: { ...parsed.fields, note: noteText },
    options,
  });
}

// ============================================================
// W11 — Nota sobre Proyecto
// ============================================================

async function handleNotaProyecto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, note } = parsed.fields;
  const noteText = note || ctx.message.text;

  if (!entity_hint) {
    await ctx.sendMessage('¿Sobre cuál proyecto es la nota?');
    await ctx.updateSession('collecting', {
      intent: 'NOTA_PROYECTO', pending_action: 'W11',
      parsed_fields: { note: noteText },
    });
    return;
  }

  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 0) {
    await ctx.sendMessage(`❌ No encontré proyecto activo con "${entity_hint}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  if (projects.length === 1) {
    const p = projects[0];
    const msg = `📝 Voy a agregar nota a ${bold(p.nombre)}:\n\n"${noteText}"`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
    await ctx.updateSession('confirming', {
      intent: 'NOTA_PROYECTO', pending_action: 'W11',
      proyecto_id: p.id, proyecto_nombre: p.nombre,
      parsed_fields: { ...parsed.fields, note: noteText },
    });
    return;
  }

  // Multiple matches
  const options = projects.slice(0, 5).map((p: any) => ({
    id: p.id,
    label: bold(p.nombre),
  }));

  await ctx.sendOptions(
    `📝 Nota: "${noteText}"\n\n¿Para cuál proyecto?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'NOTA_PROYECTO', pending_action: 'W11',
    parsed_fields: { ...parsed.fields, note: noteText },
    options,
  });
}

// ============================================================
// Resume multi-step
// ============================================================

async function handleResumeNovedad(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase, user } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Confirmation (buttons or text)
  if (session.state === 'confirming') {
    const btnId = message.interactive_reply;
    if (btnId === 'btn_confirm' || ['sí', 'si', 'yes', '1', '✅', 'confirmo', 'dale'].includes(text)) {
      if (context.pending_action === 'W09') await executeW09(ctx);
      else if (context.pending_action === 'W11') await executeW11(ctx);
    } else if (btnId === 'btn_cancel' || ['no', 'cancelar', 'cancel', '❌'].includes(text)) {
      await ctx.sendMessage('❌ Cancelado.');
    } else {
      await ctx.sendButtons('Presiona un botón para confirmar o cancelar.', [
        { id: 'btn_confirm', title: '✅ Confirmar' },
        { id: 'btn_cancel', title: '❌ Cancelar' },
      ]);
      return;
    }
    await completeSession(supabase, session.id);
    return;
  }

  // Selection
  if (session.state === 'awaiting_selection') {
    const options = context.options || [];
    const selection = parseInt(text);

    if (isNaN(selection) || selection < 1 || selection > options.length) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    const selected = options[selection - 1];

    if (context.pending_action === 'W09') {
      await ctx.updateSession('confirming', { oportunidad_id: selected.id });
      await ctx.sendButtons(`📝 Agregar nota a ${selected.label}.`, [
        { id: 'btn_confirm', title: '✅ Confirmar' },
        { id: 'btn_cancel', title: '❌ Cancelar' },
      ]);
    } else if (context.pending_action === 'W11') {
      await ctx.updateSession('confirming', { proyecto_id: selected.id, proyecto_nombre: selected.label });
      await ctx.sendButtons(`📝 Agregar nota a ${selected.label}.`, [
        { id: 'btn_confirm', title: '✅ Confirmar' },
        { id: 'btn_cancel', title: '❌ Cancelar' },
      ]);
    }
    return;
  }

  // Collecting (entity hint)
  if (session.state === 'collecting') {
    const newCtx = {
      ...ctx,
      parsed: {
        ...ctx.parsed,
        fields: { ...context.parsed_fields, entity_hint: message.text.trim() },
      },
    };
    await completeSession(supabase, session.id);
    if (context.pending_action === 'W09') await handleNotaOportunidad(newCtx);
    else if (context.pending_action === 'W11') await handleNotaProyecto(newCtx);
  }
}

// ============================================================
// Execute
// ============================================================

async function executeW09(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;
  const noteText = c.parsed_fields?.note || ctx.message.text;

  const { error } = await supabase.from('oportunidad_notas').insert({
    workspace_id: user.workspace_id,
    oportunidad_id: c.oportunidad_id,
    contenido: noteText,
    canal_registro: 'whatsapp',
  });

  if (error) {
    console.error('[novedad] W09 error:', error);
    await ctx.sendMessage('❌ Error al guardar la nota. Intenta de nuevo.');
    return;
  }

  // Also update ultima_accion on oportunidad
  await supabase.from('oportunidades').update({
    ultima_accion: noteText.slice(0, 100),
    ultima_accion_fecha: new Date().toISOString(),
  }).eq('id', c.oportunidad_id);

  // Get opp info for response
  const { data: opp } = await supabase
    .from('oportunidades')
    .select('descripcion, etapa, valor_estimado')
    .eq('id', c.oportunidad_id)
    .single();

  if (opp) {
    const stageLabel = PIPELINE_STAGE_LABELS[opp.etapa] || opp.etapa;
    const msg = `✅ Nota agregada a ${bold(opp.descripcion)}.\n\n📋 Estado: ${stageLabel}\n💰 Valor: ${formatCOP(Number(opp.valor_estimado))}\n\nÚltima nota: "${noteText}"`;
    await ctx.sendMessage(msg);
  } else {
    await ctx.sendMessage('✅ Nota guardada.');
  }
}

async function executeW11(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;
  const noteText = c.parsed_fields?.note || ctx.message.text;

  const { error } = await supabase.from('proyecto_notas').insert({
    workspace_id: user.workspace_id,
    proyecto_id: c.proyecto_id,
    contenido: noteText,
    canal_registro: 'whatsapp',
  });

  if (error) {
    console.error('[novedad] W11 error:', error);
    await ctx.sendMessage('❌ Error al guardar la nota. Intenta de nuevo.');
    return;
  }

  await ctx.sendMessage(`✅ Nota agregada a ${bold(c.proyecto_nombre || 'proyecto')}.\n\nÚltima nota: "${noteText}"`);
}
