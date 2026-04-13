// ============================================================
// Handler: Acción — operaciones sobre negocios
// OPP_NUEVA  → INSERT negocios (stage_actual='venta', estado='abierto')
// OPP_GANADA → UPDATE negocios SET stage_actual='ejecucion'
// OPP_PERDIDA→ UPDATE negocios SET estado='perdido', razon_cierre
// OPP_AVANZAR→ registra actividad en activity_log (no hay sub-stages)
// ACTIVIDAD  → inserta en activity_log con entidad_tipo='negocio'
// AYUDA      → texto de ayuda en lenguaje "negocios"
// UNCLEAR    → smart suggestions
// ============================================================

import type { HandlerContext } from '../types.ts';
import { formatCOP, bold } from '../wa-format.ts';
import { findNegocios, findNegocioByCode, findContacts } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

const STAGE_LABELS: Record<string, string> = {
  venta: 'En venta',
  ejecucion: 'En ejecución',
  cobro: 'En cobro',
  cierre: 'Cerrado',
};

// Stage progression for OPP_AVANZAR (macro stages of a negocio)
const STAGE_ORDER = ['venta', 'ejecucion', 'cobro', 'cierre'] as const;

export async function handleAccion(ctx: HandlerContext): Promise<void> {
  const { parsed, session } = ctx;

  // If resuming multi-step
  if (session.state !== 'started') {
    await handleResumeAccion(ctx);
    return;
  }

  switch (parsed.intent) {
    case 'OPP_GANADA': await handleOppGanada(ctx); break;
    case 'OPP_PERDIDA': await handleOppPerdida(ctx); break;
    case 'OPP_NUEVA': await handleOppNueva(ctx); break;
    case 'OPP_AVANZAR': await handleOppAvanzar(ctx); break;
    case 'ACTIVIDAD': await handleActividad(ctx); break;
    case 'AYUDA': await handleAyuda(ctx); break;
    case 'UNCLEAR': await handleUnclear(ctx); break;
  }
}

// ============================================================
// Helper: resolver negocio (por código o por hint)
// ============================================================

async function resolveNegocio(ctx: HandlerContext, hint?: string, code?: string | number) {
  const { user, supabase } = ctx;
  if (code) {
    const n = await findNegocioByCode(supabase, user.workspace_id, String(code));
    if (n) return { negocio: n, source: 'code' as const };
  }
  if (hint) {
    const negocios = await findNegocios(supabase, user.workspace_id, hint);
    if (negocios.length > 0) return { negocio: negocios[0], source: 'hint' as const };
  }
  return { negocio: null, source: null };
}

// ============================================================
// OPP_GANADA — negocio pasa de venta → ejecución
// ============================================================

async function handleOppGanada(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, project_code } = parsed.fields;

  if (!entity_hint && !project_code) {
    await ctx.sendMessage('¿Cuál negocio se ganó? Dime el nombre del cliente o el código del negocio.');
    await ctx.updateSession('collecting', {
      intent: 'OPP_GANADA', pending_action: 'W22',
    });
    return;
  }

  const { negocio } = await resolveNegocio(ctx, entity_hint, project_code);

  if (!negocio) {
    const ref = project_code || entity_hint;
    await ctx.sendMessage(`No encontré ningún negocio activo con "${ref}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  if (negocio.stage_actual !== 'venta') {
    await ctx.sendMessage(`ℹ️ ${bold(negocio.nombre)} ya está en ${STAGE_LABELS[negocio.stage_actual] || negocio.stage_actual}. No hay nada que ganar.`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  const precio = Number(negocio.precio_aprobado || negocio.precio_estimado || 0);
  const precioLine = precio > 0 ? `\n💰 Valor: ${formatCOP(precio)}` : '';

  const msg = `🎯 Voy a pasar a ejecución:\n\n📋 ${bold(negocio.nombre)}${precioLine}`;
  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'OPP_GANADA', pending_action: 'W22',
    proyecto_id: negocio.id,
    proyecto_nombre: negocio.nombre,
  });
}

// ============================================================
// OPP_PERDIDA — negocio pasa a estado='perdido'
// ============================================================

async function handleOppPerdida(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, project_code } = parsed.fields;

  if (!entity_hint && !project_code) {
    await ctx.sendMessage('¿Cuál negocio se perdió? Dime el nombre del cliente o el código del negocio.');
    await ctx.updateSession('collecting', {
      intent: 'OPP_PERDIDA', pending_action: 'W23',
    });
    return;
  }

  const { negocio } = await resolveNegocio(ctx, entity_hint, project_code);

  if (!negocio) {
    const ref = project_code || entity_hint;
    await ctx.sendMessage(`No encontré ningún negocio activo con "${ref}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  const precio = Number(negocio.precio_aprobado || negocio.precio_estimado || 0);
  const precioLine = precio > 0 ? `\n💰 Valor: ${formatCOP(precio)}` : '';
  const msg = `📋 Voy a marcar ${bold(negocio.nombre)} como perdido.${precioLine}\n\n¿Cuál fue la razón?`;
  await ctx.sendMessage(msg);
  await ctx.updateSession('awaiting_reason', {
    intent: 'OPP_PERDIDA', pending_action: 'W23',
    proyecto_id: negocio.id,
    proyecto_nombre: negocio.nombre,
  });
}

// ============================================================
// AYUDA
// ============================================================

async function handleAyuda(ctx: HandlerContext): Promise<void> {
  const msg = `👋 Soy tu asistente MéTRIK ONE. Escríbeme con naturalidad:

⏱️ *Timer:* "Iniciar en [negocio]" · "Parar" · "¿Cuánto llevo?"

💰 *Registrar:* "Gasté 180K en materiales para Pérez" · "Me pagaron 3M de Torres" · "Mi saldo es 5M"

📋 *Consultar:* "¿Cómo va Pérez?" · "Mis números" · "¿Quién me debe?"

🎯 *Negocios:* "Nuevo negocio con García" · "García aceptó" · "Se cayó lo de López"

📝 *Actividad:* "Llamé a Pérez" · "Reunión con Torres" · "Nota para R1 26 1: texto"

No necesitas comandos exactos.`;

  await ctx.sendMessage(msg);
  await completeSession(ctx.supabase, ctx.session.id);
}

// ============================================================
// OPP_NUEVA — crea negocio en stage='venta', estado='abierto'
// ============================================================

async function handleOppNueva(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, amount } = parsed.fields;

  if (!entity_hint) {
    await ctx.sendMessage('¿Cómo se llama el cliente o la empresa del negocio?');
    await ctx.updateSession('collecting', {
      intent: 'OPP_NUEVA', pending_action: 'W25',
      parsed_fields: parsed.fields,
    });
    return;
  }

  // Buscar contacto existente
  const contacts = await findContacts(supabase, user.workspace_id, entity_hint);
  let contactId: string | null = null;
  let contactName = entity_hint;
  let empresaId: string | null = null;

  if (contacts.length > 0) {
    contactId = contacts[0].id;
    contactName = contacts[0].nombre;

    // Si el contacto tiene un negocio previo, reutilizar la empresa
    const { data: prev } = await supabase
      .from('negocios')
      .select('empresa_id')
      .eq('contacto_id', contactId)
      .eq('workspace_id', user.workspace_id)
      .not('empresa_id', 'is', null)
      .limit(1)
      .maybeSingle();
    empresaId = prev?.empresa_id || null;
  }

  // Crear contacto si no existe
  if (!contactId) {
    const { data: newContact, error: cErr } = await supabase.from('contactos').insert({
      workspace_id: user.workspace_id,
      nombre: entity_hint,
    }).select().single();
    if (cErr || !newContact) {
      console.error('[accion] OPP_NUEVA contact create error:', cErr);
      await ctx.sendMessage('❌ No pude crear el contacto. Intenta desde la app.');
      await completeSession(supabase, ctx.session.id);
      return;
    }
    contactId = newContact.id;
    contactName = newContact.nombre;
  }

  // Crear empresa si no existe (persona natural = su propia empresa)
  if (!empresaId) {
    const { data: newEmpresa, error: eErr } = await supabase.from('empresas').insert({
      workspace_id: user.workspace_id,
      nombre: contactName,
    }).select().single();
    if (eErr || !newEmpresa) {
      console.error('[accion] OPP_NUEVA empresa create error:', eErr);
      await ctx.sendMessage('❌ No pude crear la empresa. Intenta desde la app.');
      await completeSession(supabase, ctx.session.id);
      return;
    }
    empresaId = newEmpresa.id;
  }

  // Crear negocio — el trigger DB asigna código automático ({empresa} {YY} {N})
  const { data: negocio, error } = await supabase.from('negocios').insert({
    workspace_id: user.workspace_id,
    nombre: `Negocio ${contactName}`,
    contacto_id: contactId,
    empresa_id: empresaId,
    stage_actual: 'venta',
    estado: 'abierto',
    precio_estimado: amount || 0,
  }).select().single();

  if (error || !negocio) {
    console.error('[accion] OPP_NUEVA insert error:', error);
    await ctx.sendMessage('❌ No pude crear el negocio. Intenta desde la app.');
    await completeSession(supabase, ctx.session.id);
    return;
  }

  let msg = `🎯 Negocio creado: ${bold(negocio.nombre)}`;
  if (negocio.codigo) msg += ` (${negocio.codigo})`;
  msg += `\n├ Etapa: En venta`;
  if (amount) msg += `\n├ Valor estimado: ${formatCOP(amount)}`;
  msg += `\n└ Cliente: ${contactName}`;

  await ctx.sendMessage(msg);
  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// OPP_AVANZAR — registra actividad de avance (sin mover etapa)
// En el modelo de negocios, las etapas macro (venta/ejecución/cobro/cierre)
// se mueven por gates, no por comandos de WhatsApp.
// OPP_AVANZAR queda como registro de avance comercial dentro de venta.
// ============================================================

async function handleOppAvanzar(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, project_code, stage_hint } = parsed.fields;

  if (!entity_hint && !project_code) {
    await ctx.sendMessage('¿De cuál negocio quieres registrar el avance?');
    await ctx.updateSession('collecting', {
      intent: 'OPP_AVANZAR', pending_action: 'W26',
      parsed_fields: parsed.fields,
    });
    return;
  }

  const { negocio } = await resolveNegocio(ctx, entity_hint, project_code);
  if (!negocio) {
    const ref = project_code || entity_hint;
    await ctx.sendMessage(`No encontré ningún negocio activo con "${ref}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // Registrar como actividad en activity_log
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

  const stageMsg: Record<string, string> = {
    contacto_inicial: 'Primer contacto',
    discovery_hecha: 'Discovery hecho',
    propuesta_enviada: 'Propuesta enviada',
    negociacion: 'En negociación',
  };
  const avanceLabel = stageMsg[stage_hint || ''] || 'Avance comercial';
  const raw = parsed.fields.mensaje_original || ctx.message.text;
  const contenido = `🎯 ${avanceLabel}: ${raw}`.slice(0, 280);

  await supabase.from('activity_log').insert({
    workspace_id: user.workspace_id,
    entidad_tipo: 'negocio',
    entidad_id: negocio.id,
    tipo: 'comentario',
    contenido,
    autor_id: autorId,
  });

  await supabase.from('negocios')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', negocio.id);

  const msg = `✅ ${avanceLabel} registrado en ${bold(negocio.nombre)}`;
  await ctx.sendMessage(msg);
  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// ACTIVIDAD — log de llamada/reunión/visita/correo
// ============================================================

async function handleActividad(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, project_code, activity_text } = parsed.fields;

  if (!entity_hint && !activity_text && !project_code) {
    await ctx.sendMessage('¿Con quién fue la actividad? Ejemplo: "Llamé a Pérez para seguimiento"');
    await ctx.updateSession('collecting', {
      intent: 'ACTIVIDAD', pending_action: 'W27',
      parsed_fields: parsed.fields,
    });
    return;
  }

  // Intentar encontrar un negocio asociado (código primero, luego nombre, luego contacto)
  let negocioId: string | null = null;
  let refName = entity_hint || 'Sin cliente';

  if (project_code) {
    const n = await findNegocioByCode(supabase, user.workspace_id, String(project_code));
    if (n) { negocioId = n.id; refName = n.nombre; }
  }

  if (!negocioId && entity_hint) {
    const negocios = await findNegocios(supabase, user.workspace_id, entity_hint);
    if (negocios.length > 0) {
      negocioId = negocios[0].id;
      refName = negocios[0].nombre;
    } else {
      // Buscar por contacto → negocio activo del contacto
      const contacts = await findContacts(supabase, user.workspace_id, entity_hint);
      if (contacts.length > 0) {
        refName = contacts[0].nombre;
        const { data: contactNeg } = await supabase
          .from('negocios')
          .select('id, nombre')
          .eq('contacto_id', contacts[0].id)
          .eq('workspace_id', user.workspace_id)
          .eq('estado', 'abierto')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (contactNeg) {
          negocioId = contactNeg.id;
          refName = contactNeg.nombre;
        }
      }
    }
  }

  // Clasificar tipo de actividad
  const text = (activity_text || parsed.fields.mensaje_original || '').toLowerCase();
  let tipoLabel = '📝 Actividad';
  if (/llam[eé]|llamada|telef/i.test(text)) tipoLabel = '📞 Llamada';
  else if (/reuni[oó]n|meeting|junta/i.test(text)) tipoLabel = '🤝 Reunión';
  else if (/correo|email|mail/i.test(text)) tipoLabel = '📧 Email';
  else if (/visit[eé]|visita|fu[ií]\s+a/i.test(text)) tipoLabel = '🚗 Visita';
  else if (/whatsapp|mensaje|chat/i.test(text)) tipoLabel = '💬 Mensaje';

  const contenido = `${tipoLabel} ${(activity_text || parsed.fields.mensaje_original || 'Actividad comercial').slice(0, 260)}`;

  if (negocioId) {
    // Find staff record for this user
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
      contenido: contenido.slice(0, 280),
      autor_id: autorId,
    });

    if (error) {
      console.error('[accion] ACTIVIDAD error:', error);
      await ctx.sendMessage('❌ No pude registrar la actividad. Intenta desde la app.');
      await completeSession(supabase, ctx.session.id);
      return;
    }

    await supabase.from('negocios')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', negocioId);

    await ctx.sendMessage(`✅ ${tipoLabel} registrada en ${bold(refName)}`);
  } else {
    // Sin negocio asociado — solo eco al usuario
    const sugRef = entity_hint || 'el cliente';
    await ctx.sendMessage(`✅ ${tipoLabel} registrada.\n\n💡 No encontré negocio asociado a "${sugRef}". Créalo con: "Nuevo negocio con ${sugRef}"`);
  }

  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// UNCLEAR — Smart AI Suggestions
// ============================================================

async function handleUnclear(ctx: HandlerContext): Promise<void> {
  const { session, supabase, parsed } = ctx;
  const unclearCount = (session.context.unclear_count || 0) + 1;

  if (unclearCount >= 3) {
    const appUrl = Deno.env.get('APP_BASE_URL') || 'https://metrikone.co';
    await ctx.sendMessage(
      `Parece que no estoy entendiendo bien. Te recomiendo usar la app: ${appUrl}\n\nEscríbeme "ayuda" para ver qué puedo hacer.`
    );
    await completeSession(supabase, session.id);
    return;
  }

  // Use AI-suggested actions only if they fit WhatsApp's 20-char button limit.
  const rawSuggestions = parsed.fields.suggested_actions || [];
  const shortSuggestions = rawSuggestions.filter((s: string) => s && s.length <= 20).slice(0, 3);

  if (shortSuggestions.length >= 2) {
    const buttons = shortSuggestions.map((s: string, i: number) => ({
      id: `btn_suggest_${i}`,
      title: s,
    }));
    await ctx.sendButtons(
      `No entendí. ¿Qué quieres hacer?`,
      buttons,
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'UNCLEAR', pending_action: 'W24',
      unclear_count: unclearCount,
      options: shortSuggestions.map((s: string, i: number) => ({
        id: `suggest_${i}`,
        label: s,
      })),
    });
  } else {
    // Fallback: generic suggestions with buttons
    await ctx.sendButtons(
      `No entendí. ¿Qué quieres hacer?`,
      [
        { id: 'btn_suggest_0', title: 'Registrar algo' },
        { id: 'btn_suggest_1', title: 'Consultar algo' },
        { id: 'btn_suggest_2', title: 'Ver ayuda' },
      ],
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'UNCLEAR', pending_action: 'W24',
      unclear_count: unclearCount,
      options: [
        { id: 'registro', label: 'Registrar algo' },
        { id: 'consulta', label: 'Consultar algo' },
        { id: 'ayuda', label: 'Ver ayuda' },
      ],
    });
  }
}

// ============================================================
// Resume multi-step
// ============================================================

async function handleResumeAccion(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Confirmation (buttons or text)
  if (session.state === 'confirming') {
    const btnId = message.interactive_reply;
    if (btnId === 'btn_confirm' || ['sí', 'si', 'yes', '1', '✅', 'confirmo', 'dale'].includes(text)) {
      if (context.pending_action === 'W22') {
        await executeW22(ctx);
      }
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

  // Awaiting reason (W23)
  if (session.state === 'awaiting_reason') {
    await executeW23(ctx, message.text);
    await completeSession(supabase, session.id);
    return;
  }

  // Selection (UNCLEAR smart suggestions)
  if (session.state === 'awaiting_selection') {
    const options = context.options || [];
    const btnId = message.interactive_reply;

    let selected: typeof options[0] | undefined;
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

    if (selected.id === 'registro') {
      await ctx.sendMessage('Dime qué quieres registrar. Por ejemplo:\n• "Gasté 180 mil en transporte para Pérez"\n• "Trabajé 4 horas en lo de María"\n• "Me pagaron 3 millones de Torres"');
    } else if (selected.id === 'consulta') {
      await ctx.sendMessage('Dime qué quieres consultar. Por ejemplo:\n• "¿Cómo va lo de Pérez?"\n• "¿Cómo estoy este mes?"\n• "¿Quién me debe?"');
    } else if (selected.id === 'ayuda') {
      await completeSession(supabase, session.id);
      await handleAyuda(ctx);
      return;
    } else {
      // AI-suggested action — route by keyword in the short label
      const label = (selected.label || '').toLowerCase();
      if (/gast|pag|compr/.test(label)) {
        await ctx.sendMessage('Dime el gasto. Ejemplo: "Gasté 180 mil en transporte para Pérez"');
      } else if (/hora|trabaj/.test(label)) {
        await ctx.sendMessage('Dime las horas. Ejemplo: "Trabajé 4 horas en lo de María"');
      } else if (/cobro|pagaron|ingreso/.test(label)) {
        await ctx.sendMessage('Dime el cobro. Ejemplo: "Me pagaron 3 millones de Torres"');
      } else if (/cartera|debe/.test(label)) {
        await ctx.sendMessage('Escribe "cartera" para ver lo pendiente por cobrar.');
      } else if (/n[uú]meros|mes|resumen/.test(label)) {
        await ctx.sendMessage('Escribe "mis números" para ver el resumen del mes.');
      } else if (/negocio|estado|venta/.test(label)) {
        await ctx.sendMessage('Escribe "cómo va [nombre del negocio]" o el código (ej. R1 26 1).');
      } else {
        await ctx.sendMessage('Escríbeme con más detalle lo que necesitas.');
      }
    }
    await completeSession(supabase, session.id);
    return;
  }

  // Collecting (entity_hint for W22/W23/W25/W26/W27)
  if (session.state === 'collecting') {
    const newCtx = {
      ...ctx,
      parsed: {
        ...ctx.parsed,
        intent: context.intent!,
        confidence: 1,
        fields: { ...context.parsed_fields, entity_hint: message.text.trim() },
      },
    };
    await completeSession(supabase, session.id);
    if (context.pending_action === 'W22') await handleOppGanada(newCtx);
    else if (context.pending_action === 'W23') await handleOppPerdida(newCtx);
    else if (context.pending_action === 'W25') await handleOppNueva(newCtx);
    else if (context.pending_action === 'W26') await handleOppAvanzar(newCtx);
    else if (context.pending_action === 'W27') await handleActividad(newCtx);
    return;
  }
}

// ============================================================
// Execute Actions
// ============================================================

async function executeW22(ctx: HandlerContext): Promise<void> {
  const { supabase, session } = ctx;
  const negocioId = session.context.proyecto_id;
  const nombre = session.context.proyecto_nombre || 'el negocio';

  if (!negocioId) {
    await ctx.sendMessage('❌ Perdí la referencia al negocio. Intenta de nuevo.');
    return;
  }

  // Mover a ejecución
  const { error } = await supabase.from('negocios')
    .update({ stage_actual: 'ejecucion' })
    .eq('id', negocioId);

  if (error) {
    console.error('[accion] W22 update error:', error);
    await ctx.sendMessage('❌ No pude actualizar el negocio. Intenta desde la app.');
    return;
  }

  // Obtener info para confirmación
  const { data: negocio } = await supabase
    .from('negocios')
    .select('nombre, codigo, precio_aprobado, precio_estimado')
    .eq('id', negocioId)
    .single();

  const precio = negocio ? Number(negocio.precio_aprobado || negocio.precio_estimado || 0) : 0;
  const precioLine = precio > 0 ? `\n💰 Valor: ${formatCOP(precio)}` : '';

  const msg = `🎉 ¡Negocio ganado!\n\n📋 ${bold(negocio?.nombre || nombre)}${precioLine}\n📊 Etapa: En ejecución\n\nYa puedes registrar horas, gastos y cobros.`;
  await ctx.sendMessage(msg);
}

async function executeW23(ctx: HandlerContext, reason: string): Promise<void> {
  const { supabase, session, user } = ctx;
  const negocioId = session.context.proyecto_id;
  const nombre = session.context.proyecto_nombre || 'el negocio';

  if (!negocioId) {
    await ctx.sendMessage('❌ Perdí la referencia al negocio. Intenta de nuevo.');
    return;
  }

  const { error } = await supabase.from('negocios')
    .update({
      estado: 'perdido',
      razon_cierre: reason.slice(0, 500),
      closed_at: new Date().toISOString(),
    })
    .eq('id', negocioId);

  if (error) {
    console.error('[accion] W23 update error:', error);
    await ctx.sendMessage('❌ No pude actualizar el negocio. Intenta desde la app.');
    return;
  }

  // Resumen de negocios en venta para contextualizar
  const { data: enVenta } = await supabase
    .from('negocios')
    .select('precio_estimado, precio_aprobado')
    .eq('workspace_id', user.workspace_id)
    .eq('estado', 'abierto')
    .eq('stage_actual', 'venta');

  const activeCount = enVenta?.length || 0;
  const totalValue = (enVenta || []).reduce(
    (sum: number, n: any) => sum + Number(n.precio_aprobado || n.precio_estimado || 0),
    0,
  );

  const msg = `📋 ${bold(nombre)} marcado como perdido.\n\n📝 Razón: "${reason}"\n\nEn venta: ${activeCount} negocios (${formatCOP(totalValue)})`;
  await ctx.sendMessage(msg);
}
