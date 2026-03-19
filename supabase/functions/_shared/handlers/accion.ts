// ============================================================
// Handler: Acción — W22 (Opp Ganada), W23 (Opp Perdida), W24 (Ayuda)
// ============================================================

import type { HandlerContext } from '../types.ts';
import { PIPELINE_STAGE_LABELS } from '../types.ts';
import { formatCOP, bold, daysSince } from '../wa-format.ts';
import { findOpportunities } from '../wa-lookup.ts';
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
  const msg = `👋 ¡Hola! Soy tu asistente MéTRIK ONE. Puedo ayudarte con:

⏱️ *Timer de horas:*
• "Iniciar en [proyecto]"
• "Parar"
• "¿Cuánto llevo?"

💰 *Registrar:*
• "Gasté [monto] en [concepto] para [proyecto]"
• "Me pagaron [monto] de [proyecto]"
• "Mi saldo es [monto]"

📋 *Consultar:*
• "¿Cómo va [proyecto]?"
• "¿Cómo estoy este mes?"
• "¿Quién me debe?"

🎯 *Actualizar:*
• "[Prospecto] aceptó" / "no se dio"
• "Nota para [proyecto]: [texto]"

Escríbeme con naturalidad, no necesitas comandos exactos.`;

  await ctx.sendMessage(msg);
  await completeSession(ctx.supabase, ctx.session.id);
}

// ============================================================
// UNCLEAR — Fallback (D96)
// ============================================================

async function handleUnclear(ctx: HandlerContext): Promise<void> {
  const { session, supabase } = ctx;
  const unclearCount = (session.context.unclear_count || 0) + 1;

  if (unclearCount >= 3) {
    const appUrl = Deno.env.get('APP_BASE_URL') || 'https://metrikone.co';
    await ctx.sendMessage(
      `Parece que no estoy entendiendo bien. Te recomiendo usar la app para esto: ${appUrl}\n\nSi crees que debería entender tu mensaje, escríbeme 'ayuda' para ver qué puedo hacer.`
    );
    await completeSession(supabase, session.id);
    return;
  }

  await ctx.sendMessage(
    `No estoy seguro de entender. ¿Qué quieres hacer?\n\n1️⃣ Registrar un gasto\n2️⃣ Registrar horas\n3️⃣ Registrar un cobro\n4️⃣ Consultar un proyecto\n5️⃣ Ver mis números\n6️⃣ Otra cosa\n\nResponde con el número.`
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'UNCLEAR', pending_action: 'W24',
    unclear_count: unclearCount,
    options: [
      { id: 'GASTO_DIRECTO', label: 'Registrar un gasto' },
      { id: 'HORAS', label: 'Registrar horas' },
      { id: 'COBRO', label: 'Registrar un cobro' },
      { id: 'ESTADO_PROYECTO', label: 'Consultar un proyecto' },
      { id: 'MIS_NUMEROS', label: 'Ver mis números' },
      { id: 'OTHER', label: 'Otra cosa' },
    ],
  });
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

  // Selection (UNCLEAR fallback)
  if (session.state === 'awaiting_selection') {
    const options = context.options || [];
    const selection = parseInt(text);

    if (isNaN(selection) || selection < 1 || selection > options.length) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    const selected = options[selection - 1];

    if (selected.id === 'OTHER') {
      const appUrl = Deno.env.get('APP_BASE_URL') || 'https://metrikone.co';
      await ctx.sendMessage(
        `Escríbeme con más detalle qué necesitas y lo intento de nuevo. Si prefieres, entra a la app: ${appUrl}`
      );
      await completeSession(supabase, session.id);
      return;
    }

    // User selected a specific intent — guide them
    const intentGuide: Record<string, string> = {
      GASTO_DIRECTO: 'Escríbeme algo como: "Gasté 180 mil en transporte para Pérez"',
      HORAS: 'Escríbeme algo como: "Trabajé 4 horas en lo de María"',
      COBRO: 'Escríbeme algo como: "Me pagaron 3 millones de Torres"',
      ESTADO_PROYECTO: 'Escríbeme algo como: "¿Cómo va lo de Pérez?"',
      MIS_NUMEROS: 'Escríbeme algo como: "¿Cómo estoy este mes?"',
    };

    await ctx.sendMessage(intentGuide[selected.id] || 'Escríbeme qué necesitas.');
    await completeSession(supabase, session.id);
    return;
  }

  // Collecting (entity_hint for W22/W23)
  if (session.state === 'collecting') {
    const newCtx = {
      ...ctx,
      parsed: {
        ...ctx.parsed,
        intent: context.intent!,
        confidence: 1,
        fields: { entity_hint: message.text.trim() },
      },
    };
    await completeSession(supabase, session.id);
    if (context.pending_action === 'W22') await handleOppGanada(newCtx);
    else if (context.pending_action === 'W23') await handleOppPerdida(newCtx);
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
