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
import type { ParsedFields } from '../../types.ts';
import { showGastoConfirmation, proceedEmpresaGasto, handleGasto, categoriaDelGasto } from './gasto.ts';
import { decidirConfirmacionGasto, decidirMontoPendiente } from './monto-pendiente.ts';
import { executeRegistro } from './execute.ts';
import { BOTONES_SOPORTE, decidirSoporte } from './soporte-foto.ts';

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

  // Flujo guiado del gasto: el primer mensaje no traia monto y se pidio. La decision
  // (monto, cancelar, otra orden, repreguntar) vive en `monto-pendiente.ts`, pura y probada.
  if (session.state === 'collecting' && context.pending_action === 'W01') {
    const decision = decidirMontoPendiente(
      message.text ?? '',
      context.parsed_fields ?? {},
      Number(context.monto_reintentos) || 0,
    );
    if (decision.accion === 'cerrar') {
      await ctx.sendMessage(decision.mensaje);
      await completeSession(supabase, session.id);
      return;
    }
    if (decision.accion === 'repreguntar') {
      await ctx.sendMessage(decision.mensaje);
      await ctx.updateSession('collecting', {
        monto_reintentos: decision.reintentos,
        parsed_fields: decision.fields,
      });
      return;
    }
    // Con el monto, el gasto sigue EXACTAMENTE el camino de un mensaje completo, con los
    // campos de los dos mensajes y la confianza del primero (que es el que traia el
    // codigo del negocio, si lo traia).
    await handleGasto({
      ...ctx,
      parsed: {
        intent: 'GASTO',
        confidence: Number(context.confianza_gasto) || 0,
        fields: decision.fields,
      },
    });
    return;
  }

  // Confirmacion de un gasto: el texto libre es la descripcion, no un error.
  if (session.state === 'confirming' && context.pending_action === 'W01') {
    const decision = decidirConfirmacionGasto(
      { texto: message.text ?? '', botonId: message.interactive_reply },
      context.parsed_fields ?? {},
      context.amount,
    );
    switch (decision.accion) {
      case 'confirmar':
        await executeRegistro(ctx);
        return;
      case 'cancelar':
        await ctx.sendMessage('❌ Cancelado.');
        await completeSession(supabase, session.id);
        return;
      case 'describir':
        await reconfirmarGasto(ctx, decision.fields);
        return;
      case 'botones':
        await ctx.sendButtons('Presiona un botón para confirmar o cancelar.', [
          { id: 'btn_confirm', title: '✅ Confirmar' },
          { id: 'btn_cancel', title: '❌ Cancelar' },
        ]);
        return;
    }
  }

  // Confirmation (W06)
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

  // Soporte fotografico del gasto (W01 awaiting_image).
  //
  // La decision de que hacer con cada mensaje vive en `soporte-foto.ts`, puro y probado.
  // Aqui solo se ejecuta. Lo que NO puede volver a pasar: que un mensaje que no encaja en
  // ninguna rama caiga hasta `completeSession` y expulse a quien iba a mandar la foto.
  if (session.state === 'awaiting_image') {
    const decision = decidirSoporte(
      {
        tipo: message.type,
        tieneImagen: Boolean(message.image_id),
        botonId: message.interactive_reply,
        texto: message.text,
      },
      Number(context.soporte_reintentos) || 0,
    );

    if (decision.accion === 'permanecer') {
      if (decision.conBotones) {
        await ctx.sendButtons(decision.mensaje, [...BOTONES_SOPORTE]);
      } else {
        await ctx.sendMessage(decision.mensaje);
      }
      // El contador se persiste aunque no cambie: la sesion sigue viva y el estado es el mismo.
      await ctx.updateSession('awaiting_image', { soporte_reintentos: decision.reintentos });
      return;
    }

    if (decision.accion === 'guardar_foto') {
      if (context.gasto_id && message.image_id) {
        // Lo que vuelve es una REFERENCIA (`one://gastos-soportes/…`), no una URL
        // publica: el bucket deja de serlo. La pantalla la abre por `/api/archivos/abrir`.
        const referencia = await downloadAndStoreImage(
          supabase, message.image_id, user.workspace_id, context.gasto_id,
        );
        if (referencia) {
          await supabase.from('gastos')
            .update({ soporte_url: referencia, soporte_pendiente: false })
            .eq('id', context.gasto_id);
          await ctx.sendMessage('📷 Guardé el soporte fotográfico.');
        } else {
          await ctx.sendMessage('⚠️ No pude guardar la foto. Puedes subirla después desde la app.');
        }
      }
    } else {
      await ctx.sendMessage(decision.mensaje);
    }

    await completeSession(supabase, session.id);
    return;
  }
}

/**
 * Vuelve a mostrar la confirmacion del gasto con la descripcion que el usuario acaba de
 * escribir. Mismo destino, mismo monto; la categoria se recalcula porque la descripcion
 * nueva puede decirla ("Peaje" -> transporte).
 */
async function reconfirmarGasto(ctx: HandlerContext, fields: ParsedFields): Promise<void> {
  const { session, supabase } = ctx;
  const c = session.context;
  // Si la descripcion nueva no dice categoria ("autopista norte"), se queda la que habia.
  const deLaDescripcion = categoriaDelGasto(fields);
  const categoria = deLaDescripcion !== 'otros' ? deLaDescripcion : c.categoria || 'otros';

  if (c.destino_tipo === 'empresa') {
    await proceedEmpresaGasto(ctx, c.amount!, fields, categoria);
    return;
  }

  if (c.negocio_id) {
    const { data: negocio } = await supabase
      .from('negocios')
      .select('id, nombre, codigo, estado')
      .eq('id', c.negocio_id)
      .single();
    const entity = negocio
      ? { ...negocio, proyecto_id: negocio.id, codigo: negocio.codigo ?? '' }
      : { id: c.negocio_id, nombre: c.proyecto_nombre || 'negocio' };
    await showGastoConfirmation(ctx, entity, c.amount!, categoria, fields, 'negocio');
    return;
  }

  const { data: project } = c.proyecto_id
    ? await supabase.from('v_proyecto_financiero').select('*').eq('proyecto_id', c.proyecto_id).single()
    : { data: null };
  const entity = project ?? { proyecto_id: c.proyecto_id, nombre: c.proyecto_nombre || 'negocio' };
  await showGastoConfirmation(ctx, entity, c.amount!, categoria, fields, 'proyecto');
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
    // Los campos del gasto salen de la SESION: en este camino `ctx.parsed.fields`
    // es el del mensaje de seleccion ("5"), no el del gasto, y leerlo de ahi
    // borraba la descripcion y el mensaje original.
    await proceedEmpresaGasto(
      ctx,
      context.amount!,
      context.parsed_fields ?? {},
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
      ctx, entity, context.amount!, context.categoria || 'otros', context.parsed_fields ?? {}, 'negocio',
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
    ctx, project, context.amount!, context.categoria || 'otros', context.parsed_fields ?? {}, 'proyecto',
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
