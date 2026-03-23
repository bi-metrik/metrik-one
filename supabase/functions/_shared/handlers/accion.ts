// ============================================================
// Handler: Acción — W22 (Opp Ganada), W23 (Opp Perdida), W24 (Ayuda)
// ============================================================

import type { HandlerContext } from '../types.ts';
import { PIPELINE_STAGE_LABELS, PIPELINE_STAGES } from '../types.ts';
import { formatCOP, formatCOPShort, bold, daysSince } from '../wa-format.ts';
import { findOpportunities, findContacts } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

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
// W22 — Oportunidad Ganada (D94 — Hard Gate Fiscal)
// ============================================================

async function handleOppGanada(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint } = parsed.fields;

  if (!entity_hint) {
    await ctx.sendMessage('¿Cuál oportunidad se ganó? Escríbeme el nombre del prospecto.');
    await ctx.updateSession('collecting', {
      intent: 'OPP_GANADA', pending_action: 'W22',
    });
    return;
  }

  const opps = await findOpportunities(supabase, user.workspace_id, entity_hint);

  if (opps.length === 0) {
    await ctx.sendMessage(`❌ No encontré oportunidad activa con "${entity_hint}". Verifica el nombre o revisa el pipeline en la app.`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  const opp = opps[0];

  // Hard gate fiscal check (D94)
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id, nombre, nit, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor')
    .eq('id', (await supabase.from('oportunidades').select('empresa_id').eq('id', opp.id).single()).data?.empresa_id)
    .single();

  const fiscalComplete = empresa &&
    empresa.nit && empresa.tipo_persona && empresa.regimen_tributario &&
    empresa.gran_contribuyente !== null && empresa.agente_retenedor !== null;

  if (!fiscalComplete) {
    const appUrl = Deno.env.get('APP_BASE_URL') || 'https://metrikone.co';
    const msg = `🎉 ¡Bien! Voy a mover ${bold(opp.descripcion)} a Ganada.\n\n⚠️ Para cerrar esta oportunidad necesito los datos fiscales de ${bold(opp.empresa_nombre || opp.contacto_nombre)}.\n\nComplétalo en la app: ${appUrl}/pipeline/${opp.id}`;
    await ctx.sendMessage(msg);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // Confirm
  const msg = `🎉 Voy a mover ${bold(opp.descripcion)} a Ganada.\n\n📋 ${bold(opp.descripcion)}\n💰 Valor: ${formatCOP(Number(opp.valor_estimado))}\n👤 ${opp.contacto_nombre} — ${opp.empresa_nombre}\n\nSe creará un proyecto automáticamente.`;
  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'OPP_GANADA', pending_action: 'W22',
    oportunidad_id: opp.id,
    parsed_fields: parsed.fields,
  });
}

// ============================================================
// W23 — Oportunidad Perdida
// ============================================================

async function handleOppPerdida(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint } = parsed.fields;

  if (!entity_hint) {
    await ctx.sendMessage('¿Cuál oportunidad se perdió? Escríbeme el nombre del prospecto.');
    await ctx.updateSession('collecting', {
      intent: 'OPP_PERDIDA', pending_action: 'W23',
    });
    return;
  }

  const opps = await findOpportunities(supabase, user.workspace_id, entity_hint);

  if (opps.length === 0) {
    await ctx.sendMessage(`❌ No encontré oportunidad activa con "${entity_hint}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  const opp = opps[0];
  const msg = `📋 Voy a marcar ${bold(opp.descripcion)} como perdida.\n\n💰 Valor: ${formatCOP(Number(opp.valor_estimado))}\n👤 ${opp.contacto_nombre}\n\n¿Cuál fue la razón?`;
  await ctx.sendMessage(msg);
  await ctx.updateSession('awaiting_reason', {
    intent: 'OPP_PERDIDA', pending_action: 'W23',
    oportunidad_id: opp.id,
    parsed_fields: parsed.fields,
  });
}

// ============================================================
// W24 — Ayuda (§11)
// ============================================================

async function handleAyuda(ctx: HandlerContext): Promise<void> {
  const msg = `👋 Soy tu asistente MéTRIK ONE. Escríbeme con naturalidad:

⏱️ *Timer:* "Iniciar en [proyecto]" · "Parar" · "¿Cuánto llevo?"

💰 *Registrar:* "Gasté 180K en materiales para Pérez" · "Me pagaron 3M de Torres" · "Mi saldo es 5M"

📋 *Consultar:* "¿Cómo va Pérez?" · "Mis números" · "¿Quién me debe?"

🎯 *Pipeline:* "Nueva oportunidad con García" · "Mandé propuesta a López" · "García aceptó"

📝 *Actividad:* "Llamé a Pérez" · "Reunión con Torres" · "Nota para proyecto: texto"

No necesitas comandos exactos.`;

  await ctx.sendMessage(msg);
  await completeSession(ctx.supabase, ctx.session.id);
}

// ============================================================
// W25 — Nueva Oportunidad
// ============================================================

async function handleOppNueva(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, amount, note } = parsed.fields;

  if (!entity_hint) {
    await ctx.sendMessage('¿Cómo se llama el prospecto o empresa?');
    await ctx.updateSession('collecting', {
      intent: 'OPP_NUEVA', pending_action: 'W25',
      parsed_fields: parsed.fields,
    });
    return;
  }

  // Check if contact exists
  const contacts = await findContacts(supabase, user.workspace_id, entity_hint);
  let contactId: string | null = null;
  let empresaId: string | null = null;
  let contactName = entity_hint;

  if (contacts.length > 0) {
    contactId = contacts[0].id;
    contactName = contacts[0].nombre;
    // Try to find linked empresa via oportunidades or proyectos
    const { data: existingOpp } = await supabase
      .from('oportunidades')
      .select('empresa_id')
      .eq('contacto_id', contactId)
      .eq('workspace_id', user.workspace_id)
      .limit(1)
      .single();
    empresaId = existingOpp?.empresa_id || null;

    if (!empresaId) {
      const { data: proj } = await supabase
        .from('proyectos')
        .select('empresa_id')
        .eq('contacto_id', contactId)
        .eq('workspace_id', user.workspace_id)
        .limit(1)
        .single();
      empresaId = proj?.empresa_id || null;
    }
  }

  // If no contact, create one automatically
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

  // If no empresa, create one automatically
  if (!empresaId) {
    const { data: newEmpresa, error: eErr } = await supabase.from('empresas').insert({
      workspace_id: user.workspace_id,
      nombre: entity_hint,
    }).select().single();
    if (eErr || !newEmpresa) {
      console.error('[accion] OPP_NUEVA empresa create error:', eErr);
      await ctx.sendMessage('❌ No pude crear la empresa. Intenta desde la app.');
      await completeSession(supabase, ctx.session.id);
      return;
    }
    empresaId = newEmpresa.id;
  }

  // Create opportunity
  const { data: opp, error } = await supabase.from('oportunidades').insert({
    workspace_id: user.workspace_id,
    descripcion: `Oportunidad ${contactName}`,
    contacto_id: contactId,
    empresa_id: empresaId,
    etapa: 'lead_nuevo',
    valor_estimado: amount || 0,
    probabilidad: 10,
  }).select().single();

  if (error) {
    console.error('[accion] OPP_NUEVA error:', error);
    await ctx.sendMessage('❌ No pude crear la oportunidad. Intenta desde la app.');
    await completeSession(supabase, ctx.session.id);
    return;
  }

  let msg = `🎯 Oportunidad creada: ${bold(opp.descripcion)}\n\n├ Etapa: Lead nuevo`;
  if (amount) msg += `\n├ Valor: ${formatCOP(amount)}`;
  msg += `\n└ Contacto: ${contactName}`;
  msg += `\n\n💡 Completa datos fiscales en la app para poder cotizar.`;

  await ctx.sendMessage(msg);
  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// W26 — Avanzar Oportunidad (mover etapa)
// ============================================================

async function handleOppAvanzar(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, stage_hint } = parsed.fields;

  if (!entity_hint) {
    await ctx.sendMessage('¿Cuál oportunidad quieres avanzar?');
    await ctx.updateSession('collecting', {
      intent: 'OPP_AVANZAR', pending_action: 'W26',
      parsed_fields: parsed.fields,
    });
    return;
  }

  const opps = await findOpportunities(supabase, user.workspace_id, entity_hint);
  if (opps.length === 0) {
    await ctx.sendMessage(`❌ No encontré oportunidad activa con "${entity_hint}".`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  const opp = opps[0];
  const currentIdx = PIPELINE_STAGES.indexOf(opp.etapa as typeof PIPELINE_STAGES[number]);

  // Determine target stage
  let targetStage = stage_hint;
  if (!targetStage) {
    // Auto-advance to next stage
    if (currentIdx >= 0 && currentIdx < PIPELINE_STAGES.length - 2) {
      targetStage = PIPELINE_STAGES[currentIdx + 1];
    } else {
      targetStage = opp.etapa;
    }
  }

  // Validate stage
  if (!PIPELINE_STAGE_LABELS[targetStage!]) {
    await ctx.sendMessage(`❌ Etapa "${targetStage}" no válida.`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // Update
  await supabase.from('oportunidades')
    .update({ etapa: targetStage })
    .eq('id', opp.id);

  const msg = `📋 ${bold(opp.descripcion)} movida a ${bold(PIPELINE_STAGE_LABELS[targetStage!])}\n\n├ Anterior: ${PIPELINE_STAGE_LABELS[opp.etapa] || opp.etapa}\n├ Valor: ${formatCOP(Number(opp.valor_estimado))}\n└ ${opp.contacto_nombre}`;
  await ctx.sendMessage(msg);
  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// W27 — Registrar Actividad Comercial
// ============================================================

async function handleActividad(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, activity_text } = parsed.fields;

  if (!entity_hint && !activity_text) {
    await ctx.sendMessage('¿Con quién fue la actividad? Ejemplo: "Llamé a Pérez para seguimiento"');
    await ctx.updateSession('collecting', {
      intent: 'ACTIVIDAD', pending_action: 'W27',
      parsed_fields: parsed.fields,
    });
    return;
  }

  // Try to find related opportunity or contact
  let oppId: string | null = null;
  let refName = entity_hint || 'Sin contacto';

  if (entity_hint) {
    const opps = await findOpportunities(supabase, user.workspace_id, entity_hint);
    if (opps.length > 0) {
      oppId = opps[0].id;
      refName = opps[0].descripcion;
    } else {
      // Try contacts → find their opp
      const contacts = await findContacts(supabase, user.workspace_id, entity_hint);
      if (contacts.length > 0) {
        refName = contacts[0].nombre;
        // Check if contact has active opportunity
        const { data: contactOpp } = await supabase
          .from('oportunidades')
          .select('id, descripcion')
          .eq('contacto_id', contacts[0].id)
          .eq('workspace_id', user.workspace_id)
          .not('etapa', 'in', '(ganada,perdida)')
          .limit(1)
          .single();
        if (contactOpp) {
          oppId = contactOpp.id;
          refName = contactOpp.descripcion;
        }
      }
    }
  }

  // Determine activity type label
  const text = (activity_text || parsed.fields.mensaje_original || '').toLowerCase();
  let tipoLabel = '📝 Actividad';
  if (/llam[eé]|llamada|telef/i.test(text)) tipoLabel = '📞 Llamada';
  else if (/reuni[oó]n|meeting|junta/i.test(text)) tipoLabel = '🤝 Reunión';
  else if (/correo|email|mail/i.test(text)) tipoLabel = '📧 Email';
  else if (/visit[eé]|visita|fu[ií]\s+a/i.test(text)) tipoLabel = '🚗 Visita';
  else if (/whatsapp|mensaje|chat/i.test(text)) tipoLabel = '💬 Mensaje';

  const contenido = (activity_text || parsed.fields.mensaje_original || 'Actividad comercial').slice(0, 280);

  // If we found an opportunity, log as activity_log comment on it
  if (oppId) {
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
      entidad_tipo: 'oportunidad',
      entidad_id: oppId,
      tipo: 'comentario',
      contenido: `${tipoLabel} ${contenido}`,
      autor_id: autorId,
    });

    if (error) {
      console.error('[accion] ACTIVIDAD error:', error);
      await ctx.sendMessage('❌ No pude registrar la actividad. Intenta desde la app.');
      await completeSession(supabase, ctx.session.id);
      return;
    }

    // Refresh opportunity updated_at so pipeline shows recent activity
    await supabase.from('oportunidades')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', oppId);

    const msg = `✅ ${tipoLabel} registrada en ${bold(refName)}\n\n${contenido}`;
    await ctx.sendMessage(msg);
  } else {
    // No opportunity found — just confirm the note
    await ctx.sendMessage(`✅ ${tipoLabel}: ${contenido}\n\n💡 No encontré oportunidad para "${entity_hint}". Créala con: "Nueva oportunidad con ${entity_hint}"`);
  }

  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// UNCLEAR — Smart AI Suggestions (D96 v2)
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

  // Use AI-suggested actions if available, otherwise fallback
  const suggestions = parsed.fields.suggested_actions;
  if (suggestions && suggestions.length > 0) {
    // Build buttons from AI suggestions (max 3)
    const buttons = suggestions.slice(0, 3).map((s: string, i: number) => ({
      id: `btn_suggest_${i}`,
      title: s.slice(0, 20),
    }));
    await ctx.sendButtons(
      `No estoy seguro de entender. ¿Quisiste decir algo como...?`,
      buttons,
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'UNCLEAR', pending_action: 'W24',
      unclear_count: unclearCount,
      options: suggestions.map((s: string, i: number) => ({
        id: `suggest_${i}`,
        label: s,
      })),
    });
  } else {
    // Fallback: generic suggestions with buttons
    await ctx.sendButtons(
      `No estoy seguro de entender. ¿Qué quieres hacer?`,
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
  const { session, message, supabase, user } = ctx;
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
      return; // Don't complete session
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

    // Match button ID or number
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
      // User typed something new — treat as a fresh message, complete this session
      await completeSession(supabase, session.id);
      return;
    }

    // Route based on selection
    if (selected.id === 'registro') {
      await ctx.sendMessage('Escríbeme qué quieres registrar. Ejemplo:\n• "Gasté 180 mil en transporte para Pérez"\n• "Trabajé 4 horas en lo de María"\n• "Me pagaron 3 millones de Torres"');
    } else if (selected.id === 'consulta') {
      await ctx.sendMessage('Escríbeme qué quieres consultar. Ejemplo:\n• "¿Cómo va lo de Pérez?"\n• "¿Cómo estoy este mes?"\n• "¿Quién me debe?"');
    } else if (selected.id === 'ayuda') {
      await completeSession(supabase, session.id);
      await handleAyuda(ctx);
      return;
    } else {
      // AI-suggested action — guide the user
      await ctx.sendMessage(`Escríbeme con más detalle. Por ejemplo si quieres "${selected.label}", escríbelo de forma natural.`);
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
  const { supabase, user, session } = ctx;
  const oppId = session.context.oportunidad_id;

  // Update opportunity stage
  await supabase.from('oportunidades')
    .update({ etapa: 'ganada' })
    .eq('id', oppId);

  // Get opp details to create project
  const { data: opp } = await supabase.from('oportunidades')
    .select('*, contactos!inner(nombre), empresas!inner(nombre)')
    .eq('id', oppId)
    .single();

  if (opp) {
    // Create project automatically
    const { error } = await supabase.from('proyectos').insert({
      workspace_id: user.workspace_id,
      oportunidad_id: opp.id,
      empresa_id: opp.empresa_id,
      contacto_id: opp.contacto_id,
      nombre: opp.descripcion,
      presupuesto_total: opp.valor_estimado || 0,
      canal_creacion: 'whatsapp',
    });

    if (error) console.error('[accion] Create project error:', error);

    const msg = `🎉 ¡Oportunidad ganada!\n\n📋 ${bold(opp.descripcion)}\n💰 Valor: ${formatCOP(Number(opp.valor_estimado))}\n📂 Proyecto creado automáticamente\n\nSiguiente paso: Registra la primera factura en la app.`;
    await ctx.sendMessage(msg);
  }
}

async function executeW23(ctx: HandlerContext, reason: string): Promise<void> {
  const { supabase, session } = ctx;
  const oppId = session.context.oportunidad_id;

  await supabase.from('oportunidades')
    .update({ etapa: 'perdida', razon_perdida: reason })
    .eq('id', oppId);

  // Get pipeline summary
  const { data: pipeline } = await supabase
    .from('oportunidades')
    .select('valor_estimado')
    .eq('workspace_id', ctx.user.workspace_id)
    .not('etapa', 'in', '(ganada,perdida)');

  const activeCount = pipeline?.length || 0;
  const totalValue = (pipeline || []).reduce((sum: number, o: any) => sum + Number(o.valor_estimado || 0), 0);

  const msg = `📋 Oportunidad marcada como perdida.\n\n📝 Razón: "${reason}"\n\nPipeline actualizado: ${activeCount} oportunidades activas (${formatCOP(totalValue)})`;
  await ctx.sendMessage(msg);
}
