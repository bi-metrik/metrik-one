// ============================================================
// Multi-step Resume Handler + Selection Sub-handlers
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import { formatCOP, formatPct, bold, formatElapsed, formatProject } from '../../wa-format.ts';
import { findActiveProjects, findActiveDestinos, findMatchingBorrador } from '../../wa-lookup.ts';
import { completeSession } from '../../wa-session.ts';
import { downloadAndStoreImage } from '../../wa-media.ts';
import { handleGastoDirecto, showGastoDirectoConfirmation, showBorradorMatch } from './gasto-directo.ts';
import { proceedGastoOperativo } from './gasto-operativo.ts';
import { showHorasConfirmation } from './horas.ts';
import { startTimer } from './timer.ts';
import { proceedCobroWithProject } from './cobro.ts';
import { executeRegistro, executeBorradorConfirmation } from './execute.ts';

const AWAITING_SELECTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export async function handleResumeRegistro(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase, user } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Handle timeout confirmation (sent after 10 min in awaiting_selection)
  if (session.state === 'awaiting_timeout_confirm') {
    const btnId = message.interactive_reply;
    if (btnId === 'btn_timeout_yes' || ['sí', 'si', 'yes', '1'].includes(text)) {
      // Restore awaiting_selection so user can continue
      await ctx.updateSession('awaiting_selection', {});
      const options = context.options || [];
      await ctx.sendOptions(
        'Perfecto, continuemos. ¿Cuál proyecto?',
        options.map((o: any) => o.label),
      );
    } else {
      await ctx.sendMessage('❌ Registro cancelado.');
      await completeSession(supabase, session.id);
    }
    return;
  }

  // Handle confirmation (buttons or text)
  if (session.state === 'confirming') {
    const btnId = message.interactive_reply;
    if (btnId === 'btn_confirm' || ['sí', 'si', 'yes', '1', '✅', 'confirmo', 'dale'].includes(text)) {
      await executeRegistro(ctx);
    } else if (btnId === 'btn_cancel' || ['no', 'cancelar', 'cancel', '❌', 'nel'].includes(text)) {
      await ctx.sendMessage('❌ Cancelado.');
      await completeSession(supabase, session.id);
    } else {
      await ctx.sendButtons('Presiona un botón para confirmar o cancelar.', [
        { id: 'btn_confirm', title: '✅ Confirmar' },
        { id: 'btn_cancel', title: '❌ Cancelar' },
      ]);
    }
    return;
  }

  // Handle selection (numbered options or button reply)
  if (session.state === 'awaiting_selection') {
    // Timeout check: if no awaiting_since, stamp it now and continue
    if (!context.awaiting_since) {
      await ctx.updateSession('awaiting_selection', { awaiting_since: new Date().toISOString() });
    } else {
      const elapsed = Date.now() - new Date(context.awaiting_since).getTime();
      if (elapsed > AWAITING_SELECTION_TIMEOUT_MS) {
        await ctx.sendButtons(
          '⏰ Tu registro quedó pendiente. ¿Quieres continuarlo?',
          [
            { id: 'btn_timeout_yes', title: '✅ Sí, continuar' },
            { id: 'btn_timeout_no', title: '❌ No, cancelar' },
          ],
        );
        await ctx.updateSession('awaiting_timeout_confirm', {});
        return;
      }
    }

    const options = context.options || [];

    // Check if response came from an interactive button matching an option ID
    const btnId = message.interactive_reply;
    const btnMatch = btnId ? options.find((o: any) => o.id === btnId) : null;

    const selection = parseInt(text);
    if (!btnMatch && (isNaN(selection) || selection < 1 || selection > options.length)) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    const selected = btnMatch || options[selection - 1];

    // Route based on pending action
    switch (context.pending_action) {
      case 'W01': await handleW01Selection(ctx, selected); break;
      case 'W02': await handleW02Selection(ctx, selected); break;
      case 'W03': await handleW03Selection(ctx, selected); break;
      case 'W03T': await handleW03TSelection(ctx, selected); break;
      case 'W04': await handleW04Selection(ctx, selected); break;
      case 'W06': await handleW06Selection(ctx, selected); break;
      case 'W32': await handleW32Selection(ctx, selected); break;
      default:
        await ctx.sendMessage('Algo salió mal. Escríbeme de nuevo.');
        await completeSession(supabase, session.id);
    }
    return;
  }

  // D119: Handle payment status (W01/W02 awaiting_payment_status)
  if (session.state === 'awaiting_payment_status') {
    const text = message.text?.toLowerCase().trim() || '';
    const isPendiente = text === '2' || text.includes('pendiente') || text.includes('crédito') || text.includes('credito');

    if (isPendiente && context.gasto_id) {
      await supabase.from('gastos')
        .update({ estado_pago: 'pendiente' })
        .eq('id', context.gasto_id);
    }
    // Default: 'pagado' (already set on insert)

    // Advance to soporte prompt
    await ctx.sendButtons('📷 Envía el soporte fotográfico. Si no lo tienes, lo puedes agregar después.', [
      { id: 'btn_despues', title: '⏰ Después' },
    ]);
    await ctx.updateSession('awaiting_image', {});
    return;
  }

  // Handle image for soporte (W01/W02 awaiting_image)
  if (session.state === 'awaiting_image') {
    if (message.type === 'image' && message.image_id) {
      if (context.gasto_id) {
        // Download from WhatsApp → upload to Supabase Storage
        const publicUrl = await downloadAndStoreImage(
          supabase, message.image_id, user.workspace_id, context.gasto_id,
        );
        if (publicUrl) {
          await supabase.from('gastos')
            .update({ soporte_url: publicUrl, soporte_pendiente: false })
            .eq('id', context.gasto_id);
          await ctx.sendMessage('📷 Guardé el soporte fotográfico.');
        } else {
          await ctx.sendMessage('⚠️ No pude guardar la foto. Puedes subirla después desde la app.');
        }
      }
    } else if (message.type === 'audio') {
      await ctx.sendMessage('📷 Necesito una foto del soporte, no un audio.');
      await ctx.sendButtons('📷 Envía la foto del soporte, no un audio. Si no lo tienes, lo puedes agregar después.', [
        { id: 'btn_despues', title: '⏰ Después' },
      ]);
      return; // Stay in awaiting_image
    } else if (message.interactive_reply === 'btn_despues' || ['después', 'despues', 'luego'].includes(text)) {
      await ctx.sendMessage('👍 Sin problema. Puedes enviarlo después.');
    } else if (['no', 'sin soporte'].includes(text)) {
      // Do nothing — soporte_pendiente stays true for tracking
    }
    await completeSession(supabase, session.id);
    return;
  }
}

// --- Selection sub-handlers ---

async function handleW01Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;

  if (selected.id === 'cancelar') {
    await ctx.sendMessage('❌ Cancelado.');
    await completeSession(supabase, session.id);
    return;
  }

  if (selected.id === 'operativo') {
    // Redirect to W02 flow
    await proceedGastoOperativo(ctx, context.amount!, context.parsed_fields?.concept || '', context.categoria || 'otros');
    return;
  }

  if (selected.id === 'borrador') {
    // Confirm borrador
    await executeBorradorConfirmation(ctx);
    return;
  }

  if (selected.id === 'nuevo') {
    // Create as new gasto directo (not borrador)
    const project = { id: context.proyecto_id, nombre: context.proyecto_nombre };
    await showGastoDirectoConfirmation(ctx, project, context.amount!, context.categoria || 'otros', context.parsed_fields?.concept);
    return;
  }

  if (selected.id === 'otro_proyecto') {
    // Show all active destinos
    const allActive = await findActiveDestinos(supabase, user.workspace_id);
    const newOptions = allActive.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
      _tipo: d._tipo,
    }));
    newOptions.push({ id: 'operativo', label: '🏢 Gasto de empresa', _tipo: 'empresa' as any });
    await ctx.sendOptions('Tus negocios/proyectos:', newOptions.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', { options: newOptions });
    return;
  }

  // Selected a specific destino — try negocio first, then project
  const { data: negocio } = await supabase
    .from('negocios')
    .select('id, nombre, codigo, estado')
    .eq('id', selected.id)
    .eq('estado', 'abierto')
    .single();

  if (negocio) {
    const entity = { ...negocio, proyecto_id: negocio.id, codigo: negocio.codigo ?? '' };
    const borrador = await findMatchingBorrador(supabase, user.workspace_id, context.parsed_fields?.concept || '', context.categoria || 'otros', context.amount!);
    if (borrador) {
      await showBorradorMatch(ctx, borrador, entity, context.amount!, context.categoria || 'otros');
      return;
    }
    await showGastoDirectoConfirmation(ctx, entity, context.amount!, context.categoria || 'otros', context.parsed_fields?.concept, 'negocio');
    return;
  }

  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', selected.id)
    .single();

  if (!project) {
    await ctx.sendMessage('❌ No encontré ese negocio/proyecto. Intenta de nuevo.');
    await completeSession(supabase, session.id);
    return;
  }

  const borrador = await findMatchingBorrador(supabase, user.workspace_id, context.parsed_fields?.concept || '', context.categoria || 'otros', context.amount!);
  if (borrador) {
    await showBorradorMatch(ctx, borrador, project, context.amount!, context.categoria || 'otros');
    return;
  }

  await showGastoDirectoConfirmation(ctx, project, context.amount!, context.categoria || 'otros', context.parsed_fields?.concept);
}

async function handleW02Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase } = ctx;
  const context = session.context;

  if (selected.id === 'cancelar') {
    await ctx.sendMessage('❌ Cancelado.');
    await completeSession(supabase, session.id);
    return;
  }

  if (selected.id === 'proyecto') {
    // Redirect to W01 — gasto directo
    const newCtx = {
      ...ctx,
      parsed: {
        intent: 'GASTO_DIRECTO' as const,
        confidence: 1,
        fields: { ...context.parsed_fields, amount: context.amount },
      },
    };
    await completeSession(supabase, session.id);
    await handleGastoDirecto(newCtx);
    return;
  }

  if (selected.id === 'empresa' || selected.id === 'confirmar_borrador') {
    await proceedGastoOperativo(ctx, context.amount!, context.parsed_fields?.concept || '', context.categoria || 'otros');
    return;
  }

  if (selected.id === 'nuevo') {
    // Not the borrador — create as new empresa expense
    await ctx.updateSession('confirming', { borrador_id: undefined });
    const msg = `💰 Gasto de empresa:\n\n💵 ${formatCOP(context.amount!)} — ${CATEGORIA_LABELS[context.categoria || 'otros'] || context.categoria}\n📅 Hoy`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
    return;
  }
}

async function handleW03Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;
  const hours = context.parsed_fields?.hours || 0;

  if (selected.id === 'otro_proyecto') {
    const allActive = await findActiveDestinos(supabase, user.workspace_id);
    const newOptions = allActive.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: bold(d.nombre),
    }));
    await ctx.sendOptions('¿Para cuál?', newOptions.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', { options: newOptions });
    return;
  }

  // Try negocio first, then project
  const { data: negocio } = await supabase
    .from('negocios')
    .select('id, nombre, codigo, estado')
    .eq('id', selected.id)
    .eq('estado', 'abierto')
    .single();

  if (negocio) {
    await showHorasConfirmation(ctx, { ...negocio, proyecto_id: negocio.id, codigo: negocio.codigo ?? '' }, hours, false);
    return;
  }

  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', selected.id)
    .single();

  if (project) {
    await showHorasConfirmation(ctx, project, hours, false);
  } else {
    await ctx.sendMessage('❌ No encontré ese negocio/proyecto. Intenta de nuevo.');
    await completeSession(supabase, session.id);
  }
}

async function handleW03TSelection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;

  if (selected.id === 'keep') {
    await ctx.sendMessage('👍 Seguimos con el timer actual.');
    await completeSession(supabase, session.id);
    return;
  }

  if (selected.id === 'switch') {
    // Stop current timer + save hours, then start new one
    const { data: timer } = await supabase
      .from('timer_activo')
      .select('id, proyecto_id, inicio')
      .eq('workspace_id', user.workspace_id)
      .single();

    if (timer) {
      const elapsed = formatElapsed(timer.inicio);
      if (elapsed.hours >= 0.02) {
        // Save hours from old timer
        const { data: oldProj } = await supabase
          .from('proyectos').select('nombre').eq('id', timer.proyecto_id).single();
        const now = new Date();
        await supabase.from('horas').insert({
          workspace_id: user.workspace_id,
          proyecto_id: timer.proyecto_id,
          fecha: now.toISOString().slice(0, 10),
          horas: elapsed.hours,
          inicio: timer.inicio,
          fin: now.toISOString(),
          timer_activo: true,
          canal_registro: 'whatsapp',
          created_by_wa_name: user.name,
        });
        await supabase.from('timer_activo').delete().eq('id', timer.id);
        await ctx.sendMessage(`✅ ${elapsed.label} registradas en ${bold(oldProj?.nombre || '?')}.`);
      } else {
        await supabase.from('timer_activo').delete().eq('id', timer.id);
      }
    }

    // Start new timer
    await completeSession(supabase, session.id);
    await startTimer(ctx, context.proyecto_id!, context.proyecto_nombre!);
    return;
  }

  if (selected.id === 'otro_proyecto') {
    const allActive = await findActiveDestinos(supabase, user.workspace_id);
    const newOptions = allActive.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: d.nombre,
    }));
    await ctx.sendOptions('⏱️ ¿En cuál?', newOptions.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', { options: newOptions });
    return;
  }

  // Selected a project from list — check for active timer first
  const { data: activeTimer } = await supabase
    .from('timer_activo')
    .select('id, proyecto_id, inicio')
    .eq('workspace_id', user.workspace_id)
    .single();

  if (activeTimer) {
    // Stop current timer, save hours, then start new
    const elapsed = formatElapsed(activeTimer.inicio);
    if (elapsed.hours >= 0.02) {
      const { data: oldProj } = await supabase
        .from('proyectos').select('nombre').eq('id', activeTimer.proyecto_id).single();
      const now = new Date();
      await supabase.from('horas').insert({
        workspace_id: user.workspace_id,
        proyecto_id: activeTimer.proyecto_id,
        fecha: now.toISOString().slice(0, 10),
        horas: elapsed.hours,
        inicio: activeTimer.inicio,
        fin: now.toISOString(),
        timer_activo: true,
        canal_registro: 'whatsapp',
        created_by_wa_name: user.name,
      });
      await supabase.from('timer_activo').delete().eq('id', activeTimer.id);
      await ctx.sendMessage(`✅ ${elapsed.label} registradas en ${bold(oldProj?.nombre || '?')}.`);
    } else {
      await supabase.from('timer_activo').delete().eq('id', activeTimer.id);
    }
  }

  await completeSession(supabase, session.id);
  await startTimer(ctx, selected.id, selected.label.replace(/\*/g, ''));
}

async function handleW04Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;

  // Phase 1: Destino selection (no proyecto_id yet)
  if (!context.proyecto_id) {
    if (selected.id === 'otro_proyecto') {
      const allActive = await findActiveDestinos(supabase, user.workspace_id);
      const newOptions = allActive.all.slice(0, 5).map((d: any) => ({
        id: d.proyecto_id || d.id,
        label: bold(d.nombre),
      }));
      await ctx.sendOptions('¿De cuál?', newOptions.map((o) => o.label));
      await ctx.updateSession('awaiting_selection', { options: newOptions });
      return;
    }
    // User picked a destino — proceed to invoice lookup
    await proceedCobroWithProject(ctx, selected.id, selected.label.replace(/\*/g, ''));
    return;
  }

  // Phase 2: Invoice selection (proyecto_id already set)
  if (selected.id === 'general') {
    // Register without specific invoice
    await ctx.updateSession('confirming', { factura_id: undefined });
    const msg = `💰 Cobro de ${formatCOP(context.amount!)} para ${bold(context.proyecto_nombre!)}.\n\nSe registra como abono general.`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
    return;
  }

  // Selected a specific invoice
  await ctx.updateSession('confirming', { factura_id: selected.id });
  const msg = `💰 Cobro de ${formatCOP(context.amount!)} para ${bold(context.proyecto_nombre!)}.\n📄 Factura: ${selected.label.split(' — ')[0]}`;
  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
}

async function handleW06Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase } = ctx;

  if (selected.id === 'same' || selected.id === 'cancelar') {
    await ctx.sendMessage(selected.id === 'same' ? '👍 Entendido, no creo duplicado.' : '❌ Cancelado.');
    await completeSession(supabase, session.id);
    return;
  }

  // Create: confirm creation
  const fields = session.context.parsed_fields || {};
  let msg = `👤 Crear contacto: ${bold(fields.name || 'Sin nombre')}`;
  if (fields.phone) msg += ` — ${fields.phone}`;
  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {});
}

async function handleW32Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase } = ctx;

  if (selected.id === 'cancelar') {
    await ctx.sendMessage('👍 Revisa en la app y vuelve a escribirme tu saldo.');
    await completeSession(supabase, session.id);
    return;
  }

  // Confirm
  await ctx.updateSession('confirming', {});
  await executeRegistro(ctx);
}
