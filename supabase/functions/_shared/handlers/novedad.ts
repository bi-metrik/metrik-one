// ============================================================
// Handler: Novedad — Notas sobre Negocios
// NOTA_NEGOCIO escribe en activity_log del negocio.
// ============================================================

import type { HandlerContext } from '../types.ts';
import { formatCOP, bold } from '../wa-format.ts';
import { findNegocios, findNegocioByCode } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

const STAGE_LABELS: Record<string, string> = {
  venta: 'En venta',
  ejecucion: 'En ejecución',
  cobro: 'En cobro',
  cierre: 'Cerrado',
};

export async function handleNovedad(ctx: HandlerContext): Promise<void> {
  const { session } = ctx;

  if (session.state !== 'started') {
    await handleResumeNovedad(ctx);
    return;
  }

  // Both intents route to the same unified handler
  await handleNotaNegocio(ctx);
}

// ============================================================
// Nota sobre Negocio (unificado)
// ============================================================

async function handleNotaNegocio(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, note, project_code } = parsed.fields;
  const noteText = note || ctx.message.text;

  // 1. Fast path: negocio code
  if (project_code) {
    const n = await findNegocioByCode(supabase, user.workspace_id, String(project_code));
    if (n) {
      await confirmNote(ctx, n, noteText);
      return;
    }
    await ctx.sendMessage(`No encontré ningún negocio con código *${project_code}*.`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  if (!entity_hint) {
    await ctx.sendMessage('¿Sobre cuál negocio es la nota? Dime el nombre del cliente o el código del negocio.');
    await ctx.updateSession('collecting', {
      intent: 'NOTA_NEGOCIO', pending_action: 'W09',
      parsed_fields: { note: noteText },
    });
    return;
  }

  const negocios = await findNegocios(supabase, user.workspace_id, entity_hint);

  if (negocios.length === 0) {
    await ctx.sendMessage(`No encontré ningún negocio con "${entity_hint}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  if (negocios.length === 1) {
    await confirmNote(ctx, negocios[0], noteText);
    return;
  }

  // Multiple matches — present options
  const options = negocios.slice(0, 5).map((n: any) => ({
    id: n.id,
    label: `${n.nombre} (${n.codigo || 'sin código'})`,
  }));

  await ctx.sendOptions(
    `📝 Nota: "${noteText}"\n\n¿A cuál negocio?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'NOTA_NEGOCIO', pending_action: 'W09',
    parsed_fields: { ...parsed.fields, note: noteText },
    options,
  });
}

async function confirmNote(ctx: HandlerContext, negocio: any, noteText: string): Promise<void> {
  const stageLabel = STAGE_LABELS[negocio.stage_actual] || negocio.stage_actual || '';
  const suffix = stageLabel ? ` · ${stageLabel}` : '';
  const msg = `📝 Voy a agregar esta nota a ${bold(negocio.nombre)}${suffix}:\n\n"${noteText}"`;
  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'NOTA_NEGOCIO', pending_action: 'W09',
    proyecto_id: negocio.id,           // reuse session slot as negocio_id
    proyecto_nombre: negocio.nombre,
    parsed_fields: { note: noteText },
  });
}

// ============================================================
// Resume multi-step
// ============================================================

async function handleResumeNovedad(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Confirmation (buttons or text)
  if (session.state === 'confirming') {
    const btnId = message.interactive_reply;
    if (btnId === 'btn_confirm' || ['sí', 'si', 'yes', '1', '✅', 'confirmo', 'dale'].includes(text)) {
      await executeNotaNegocio(ctx);
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
    await ctx.updateSession('confirming', {
      proyecto_id: selected.id,
      proyecto_nombre: selected.label,
    });
    await ctx.sendButtons(`📝 Agregar nota a ${bold(selected.label)}.`, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
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
    await handleNotaNegocio(newCtx);
  }
}

// ============================================================
// Execute — escribe en activity_log del negocio
// ============================================================

async function executeNotaNegocio(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;
  const noteText = (c.parsed_fields?.note || ctx.message.text).slice(0, 280);
  const negocioId = c.proyecto_id;

  if (!negocioId) {
    await ctx.sendMessage('❌ Perdí la referencia al negocio. Intenta de nuevo.');
    return;
  }

  // Find staff id for the author
  let autorId: string | null = null;
  if (user.user_id) {
    const { data: staff } = await supabase
      .from('staff')
      .select('id')
      .eq('workspace_id', user.workspace_id)
      .eq('profile_id', user.user_id)
      .single();
    autorId = staff?.id || null;
  }

  const { error } = await supabase.from('activity_log').insert({
    workspace_id: user.workspace_id,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'comentario',
    contenido: noteText,
    autor_id: autorId,
  });

  if (error) {
    console.error('[novedad] activity_log insert error:', error);
    await ctx.sendMessage('❌ Error al guardar la nota. Intenta de nuevo.');
    return;
  }

  // Refresh updated_at so listings show recent activity
  await supabase.from('negocios')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', negocioId);

  // Get negocio info for confirmation
  const { data: negocio } = await supabase
    .from('negocios')
    .select('nombre, codigo, stage_actual, precio_estimado, precio_aprobado')
    .eq('id', negocioId)
    .single();

  if (negocio) {
    const stageLabel = STAGE_LABELS[negocio.stage_actual] || negocio.stage_actual;
    const precio = Number(negocio.precio_aprobado || negocio.precio_estimado || 0);
    let msg = `✅ Nota agregada a ${bold(negocio.nombre)}.\n\n📋 Estado: ${stageLabel}`;
    if (precio > 0) msg += `\n💰 Valor: ${formatCOP(precio)}`;
    msg += `\n\nÚltima nota: "${noteText}"`;
    await ctx.sendMessage(msg);
  } else {
    await ctx.sendMessage(`✅ Nota guardada: "${noteText}"`);
  }
}
