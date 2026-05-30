// ============================================================
// Multi-step Resume Handler + Selection Sub-handlers (MVP)
// W01 GASTO + W06 CONTACTO únicamente
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import { formatCOP, bold, formatProject } from '../../wa-format.ts';
import { findActiveDestinos } from '../../wa-lookup.ts';
import { completeSession } from '../../wa-session.ts';
import { downloadAndStoreImage } from '../../wa-media.ts';
import { showGastoConfirmation, proceedEmpresaGasto } from './gasto.ts';
import { executeRegistro } from './execute.ts';

const AWAITING_SELECTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 min

export async function handleResumeRegistro(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase, user } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Timeout confirmation (after 10 min in awaiting_selection)
  if (session.state === 'awaiting_timeout_confirm') {
    const btnId = message.interactive_reply;
    if (btnId === 'btn_timeout_yes' || ['sí', 'si', 'yes', '1'].includes(text)) {
      await ctx.updateSession('awaiting_selection', {});
      const options = context.options || [];
      await ctx.sendOptions(
        'Perfecto, continuemos. ¿Cuál negocio?',
        options.map((o: any) => o.label),
      );
    } else {
      await ctx.sendMessage('❌ Registro cancelado.');
      await completeSession(supabase, session.id);
    }
    return;
  }

  // Confirmation
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

  // Selection (numbered options or button reply)
  if (session.state === 'awaiting_selection') {
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
    const btnId = message.interactive_reply;
    const btnMatch = btnId ? options.find((o: any) => o.id === btnId) : null;
    const selection = parseInt(text);

    if (!btnMatch && (isNaN(selection) || selection < 1 || selection > options.length)) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    const selected = btnMatch || options[selection - 1];

    switch (context.pending_action) {
      case 'W01': await handleW01Selection(ctx, selected); break;
      case 'W06': await handleW06Selection(ctx, selected); break;
      default:
        await ctx.sendMessage('Algo salió mal. Escríbeme de nuevo.');
        await completeSession(supabase, session.id);
    }
    return;
  }

  // Image for soporte (W01 awaiting_image)
  if (session.state === 'awaiting_image') {
    if (message.type === 'image' && message.image_id) {
      if (context.gasto_id) {
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
      return;
    } else if (message.interactive_reply === 'btn_despues' || ['después', 'despues', 'luego'].includes(text)) {
      await ctx.sendMessage('👍 Sin problema. Puedes enviarlo después.');
    }
    await completeSession(supabase, session.id);
    return;
  }
}

// --- Selection sub-handlers ---

async function handleW01Selection(ctx: HandlerContext, selected: { id: string; label: string; _tipo?: string }): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;

  if (selected.id === 'cancelar') {
    await ctx.sendMessage('❌ Cancelado.');
    await completeSession(supabase, session.id);
    return;
  }

  if (selected.id === 'empresa') {
    await proceedEmpresaGasto(
      ctx,
      context.amount!,
      context.parsed_fields?.concept || '',
      context.categoria || 'otros',
    );
    return;
  }

  if (selected.id === 'otro_destino') {
    const allActive = await findActiveDestinos(supabase, user.workspace_id);
    const newOptions = allActive.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
      _tipo: d._tipo,
    }));
    newOptions.push({ id: 'empresa', label: '🏢 Gasto de empresa', _tipo: 'empresa' as any });
    await ctx.sendOptions('Tus negocios:', newOptions.map((o) => o.label));
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
    await showGastoConfirmation(
      ctx, entity, context.amount!, context.categoria || 'otros', context.parsed_fields?.concept, 'negocio',
    );
    return;
  }

  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', selected.id)
    .single();

  if (!project) {
    await ctx.sendMessage('❌ No encontré ese negocio. Intenta de nuevo.');
    await completeSession(supabase, session.id);
    return;
  }

  await showGastoConfirmation(
    ctx, project, context.amount!, context.categoria || 'otros', context.parsed_fields?.concept, 'proyecto',
  );
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

// formatCOP/CATEGORIA_LABELS exported for the rare case a downstream module needs them
export { formatCOP, CATEGORIA_LABELS };
