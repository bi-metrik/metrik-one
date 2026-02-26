// ============================================================
// Handler: Registro — W01, W02, W03, W04, W06, W32
// ============================================================

import type { HandlerContext } from '../types.ts';
import { AMBIGUOUS_CATEGORIES, CATEGORIA_LABELS, STREAK_MILESTONES } from '../types.ts';
import { formatCOP, formatCOPShort, formatPct, bold, formatAgo, daysSince, formatElapsed } from '../wa-format.ts';
import { findProjects, findProjectByCode, findActiveProjects, findContacts, matchCategory, findMatchingBorrador } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

export async function handleRegistro(ctx: HandlerContext): Promise<void> {
  const { parsed, session } = ctx;

  // If resuming a multi-step flow
  if (session.state !== 'started') {
    await handleResumeRegistro(ctx);
    return;
  }

  switch (parsed.intent) {
    case 'GASTO_DIRECTO': await handleGastoDirecto(ctx); break;
    case 'GASTO_OPERATIVO': await handleGastoOperativo(ctx); break;
    case 'HORAS': await handleHoras(ctx); break;
    case 'TIMER_INICIAR': await handleTimerIniciar(ctx); break;
    case 'TIMER_PARAR': await handleTimerParar(ctx); break;
    case 'TIMER_ESTADO': await handleTimerEstado(ctx); break;
    case 'COBRO': await handleCobro(ctx); break;
    case 'CONTACTO_NUEVO': await handleContactoNuevo(ctx); break;
    case 'SALDO_BANCARIO': await handleSaldoBancario(ctx); break;
  }
}

// ============================================================
// W01 — Gasto Directo (§4)
// ============================================================

async function handleGastoDirecto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, entity_hint, concept, category_hint, project_code } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto debe ser mayor a $0. ¿Cuánto fue el gasto?');
    return;
  }

  // Resolve category
  const categoria = matchCategory(category_hint || concept || '') || 'otros';

  // Fast path: project_code → exact match by código
  if (project_code) {
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept || '', categoria, amount);
      if (borrador) {
        await showBorradorMatch(ctx, borrador, project, amount, categoria);
      } else {
        await showGastoDirectoConfirmation(ctx, project, amount, categoria, concept);
      }
      return;
    }
    // Code not found — fall through to entity_hint or show all
    await ctx.sendMessage(`⚠️ No encontré proyecto activo con código P-${project_code}.`);
  }

  if (!entity_hint) {
    // No project hint — show list of active projects
    const projects = await findActiveProjects(supabase, user.workspace_id);
    if (projects.length === 0) {
      await ctx.sendMessage('No tienes proyectos activos. ¿Lo registro como gasto de empresa?');
      await ctx.updateSession('awaiting_selection', {
        intent: 'GASTO_DIRECTO',
        pending_action: 'W01',
        amount,
        categoria,
        parsed_fields: parsed.fields,
        options: [{ id: 'operativo', label: '🏢 Sí, gasto de empresa' }, { id: 'cancelar', label: 'Cancelar' }],
      });
      return;
    }

    const options = projects.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: `${p.nombre} — ${formatPct(Number(p.presupuesto_consumido_pct))} presupuesto usado`,
    }));
    options.push({ id: 'operativo', label: '🏢 Gasto de empresa' });

    await ctx.sendOptions(
      `💰 Gasto de ${formatCOP(amount)} en ${concept || categoria}. ¿Para cuál proyecto?`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO',
      pending_action: 'W01',
      amount,
      categoria,
      parsed_fields: parsed.fields,
      options,
    });
    return;
  }

  // Find matching projects
  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 0) {
    // No match — show active projects
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    if (allActive.length === 0) {
      await ctx.sendMessage(`❌ No encontré proyecto activo con "${entity_hint}" y no tienes otros proyectos. ¿Lo registro como gasto de empresa?`);
      await ctx.updateSession('awaiting_selection', {
        intent: 'GASTO_DIRECTO', pending_action: 'W01',
        amount, categoria, parsed_fields: parsed.fields,
        options: [{ id: 'operativo', label: '🏢 Sí, gasto de empresa' }, { id: 'cancelar', label: 'Cancelar' }],
      });
      return;
    }

    const options = allActive.slice(0, 4).map((p: any) => ({
      id: p.proyecto_id,
      label: bold(p.nombre),
    }));
    options.push({ id: 'operativo', label: '🏢 Gasto de empresa' });

    await ctx.sendOptions(
      `❌ No encontré proyecto activo con "${entity_hint}".\n\nTus proyectos activos son:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options,
    });
    return;
  }

  if (projects.length === 1) {
    // Single fuzzy match — always confirm which project (D-DISAMB)
    const p = projects[0];
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    const hasOtherProjects = allActive.length > 1;
    const disambigOptions: Array<{ id: string; label: string }> = [
      { id: p.id, label: bold(p.nombre) },
    ];
    if (hasOtherProjects) {
      disambigOptions.push({ id: 'otro_proyecto', label: 'Otro proyecto' });
    }
    disambigOptions.push({ id: 'operativo', label: '🏢 Gasto de empresa' });

    await ctx.sendOptions(
      `💰 ${formatCOP(amount)} en ${concept || categoria}. ¿Para ${bold(p.nombre)}?`,
      disambigOptions.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options: disambigOptions,
    });
    return;
  }

  // Multiple matches
  const options = projects.slice(0, 5).map((p: any) => ({
    id: p.id,
    label: `${bold(p.nombre)} — ${formatPct(Number(p.presupuesto_consumido_pct))} presupuesto usado`,
  }));

  await ctx.sendOptions(
    `💰 Gasto de ${formatCOP(amount)} en ${concept || categoria}. ¿Para cuál proyecto?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    amount, categoria, parsed_fields: parsed.fields, options,
  });
}

async function showGastoDirectoConfirmation(ctx: HandlerContext, project: any, amount: number, categoria: string, concept?: string): Promise<void> {
  const presupuesto = Number(project.presupuesto_total) || 0;
  const costoActual = Number(project.costo_acumulado) || 0;
  const costoNuevo = costoActual + amount;
  const pctActual = presupuesto > 0 ? (costoActual / presupuesto) * 100 : 0;
  const pctNuevo = presupuesto > 0 ? (costoNuevo / presupuesto) * 100 : 0;

  let msg = `✅ Registro gasto directo:\n\n📂 Proyecto: ${bold(project.nombre)}\n💰 Monto: ${formatCOP(amount)}\n📋 Categoría: ${CATEGORIA_LABELS[categoria] || categoria}\n📅 Fecha: Hoy`;

  if (presupuesto > 0) {
    msg += `\n\nPresupuesto: ${formatCOP(costoActual)} de ${formatCOP(presupuesto)} (${formatPct(pctActual)})`;
    msg += `\nCon este gasto: ${formatCOP(costoNuevo)} (${formatPct(pctNuevo)})`;
  }

  if (amount > (presupuesto - costoActual) && presupuesto > 0) {
    msg += `\n\n⚠️ Este gasto supera el presupuesto restante.`;
  }

  msg += '\n\n¿Confirmo? (Sí/No)';

  await ctx.sendMessage(msg);
  // project.proyecto_id from v_proyecto_financiero, project.id from RPC
  const proyectoId = project.proyecto_id || project.id;
  await ctx.updateSession('confirming', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: proyectoId, proyecto_nombre: project.nombre,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
  });
}

async function showBorradorMatch(ctx: HandlerContext, borrador: any, project: any, amount: number, categoria: string): Promise<void> {
  const diff = amount - Number(borrador.monto_esperado);
  const msg = `🔄 Encontré un gasto fijo pendiente similar:\n\nBorrador: ${bold(borrador.nombre)} — ${formatCOP(Number(borrador.monto_esperado))} esperado\nTu gasto: ${formatCOP(amount)}${diff !== 0 ? ` (diferencia: ${formatCOP(diff)})` : ' ✅ Coincide'}`;

  const options = [
    `Es el mismo gasto fijo (confirmar con ${formatCOP(amount)})`,
    `Es un gasto aparte del proyecto ${bold(project.nombre)}`,
    'Cancelar',
  ];

  await ctx.sendOptions(msg, options);
  await ctx.updateSession('awaiting_selection', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: project.proyecto_id || project.id, proyecto_nombre: project.nombre,
    amount, categoria, borrador_id: borrador.id,
    options: [
      { id: 'borrador', label: 'Confirmar borrador' },
      { id: 'nuevo', label: 'Gasto aparte' },
      { id: 'cancelar', label: 'Cancelar' },
    ],
  });
}

// ============================================================
// W02 — Gasto Operativo (§5, v2.1)
// ============================================================

async function handleGastoOperativo(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, concept, category_hint } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto debe ser mayor a $0. ¿Cuánto fue el gasto?');
    return;
  }

  const categoria = matchCategory(category_hint || concept || '');

  // D104: Disambiguation — if category is ambiguous (1-5) or low confidence
  if (
    (categoria && AMBIGUOUS_CATEGORIES.includes(categoria)) ||
    parsed.confidence < 0.75
  ) {
    // Check if there are active projects first
    const activeProjects = await findActiveProjects(supabase, user.workspace_id);
    if (activeProjects.length > 0) {
      await ctx.sendMessage(
        `💰 ${formatCOP(amount)} en ${concept || 'gasto'}.\n\n¿Este gasto es de...?\n1️⃣ 📂 Un proyecto\n2️⃣ 🏢 Mi empresa\n\nResponde con el número.`
      );
      await ctx.updateSession('awaiting_selection', {
        intent: 'GASTO_OPERATIVO', pending_action: 'W02',
        amount, categoria: categoria || 'otros',
        parsed_fields: parsed.fields,
        disambiguation: undefined,
        options: [
          { id: 'proyecto', label: '📂 Un proyecto' },
          { id: 'empresa', label: '🏢 Mi empresa' },
        ],
      });
      return;
    }
    // No active projects — skip disambiguation, go straight to empresa
  }

  // Proceed as empresa expense
  await proceedGastoOperativo(ctx, amount, concept || '', categoria || 'otros');
}

async function proceedGastoOperativo(ctx: HandlerContext, amount: number, concept: string, categoria: string): Promise<void> {
  const { user, supabase } = ctx;

  // Check borrador match
  const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept, categoria, amount);

  if (borrador) {
    const diff = amount - Number(borrador.monto_esperado);
    const matchLabel = diff === 0 ? '✅ Coincide' : `diferencia: ${formatCOP(diff)}`;

    let msg = `🔄 Confirmo gasto fijo del mes:\n\n📋 ${bold(borrador.nombre)} — Esperado: ${formatCOP(Number(borrador.monto_esperado))}\n💰 Tu pago: ${formatCOP(amount)} ${matchLabel}`;

    if (diff === 0 || Math.abs(diff) / Number(borrador.monto_esperado) < 0.2) {
      msg += '\n\n¿Confirmo? (Sí/No)';
      await ctx.sendMessage(msg);
      await ctx.updateSession('confirming', {
        intent: 'GASTO_OPERATIVO', pending_action: 'W02',
        amount, categoria, borrador_id: borrador.id,
        parsed_fields: { concept },
      });
    } else {
      await ctx.sendOptions(msg, [
        `Confirmar con ${formatCOP(amount)} (actualizar monto real)`,
        `Es un gasto diferente, no es ${borrador.nombre}`,
        'Cancelar',
      ]);
      await ctx.updateSession('awaiting_selection', {
        intent: 'GASTO_OPERATIVO', pending_action: 'W02',
        amount, categoria, borrador_id: borrador.id,
        parsed_fields: { concept },
        options: [
          { id: 'confirmar_borrador', label: 'Confirmar borrador' },
          { id: 'nuevo', label: 'Gasto diferente' },
          { id: 'cancelar', label: 'Cancelar' },
        ],
      });
    }
    return;
  }

  // No borrador match — direct confirmation
  const msg = `💰 Gasto de empresa:\n\n💵 ${formatCOP(amount)} — ${CATEGORIA_LABELS[categoria] || categoria}\n📅 Hoy\n\n¿Confirmo? (Sí/No)`;
  await ctx.sendMessage(msg);
  await ctx.updateSession('confirming', {
    intent: 'GASTO_OPERATIVO', pending_action: 'W02',
    amount, categoria,
    parsed_fields: { concept },
  });
}

// ============================================================
// W03 — Horas (§6)
// ============================================================

async function handleHoras(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { hours, entity_hint, project_code } = parsed.fields;

  if (!hours || hours <= 0) {
    await ctx.sendMessage('❌ El registro debe ser mayor a 0 horas.');
    return;
  }
  if (hours > 16) {
    await ctx.sendMessage(`⚠️ ¿Seguro? ${hours} horas es mucho. Confirma el número.`);
    return;
  }

  // Fast path: project_code → exact match by código
  if (project_code) {
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      await showHorasConfirmation(ctx, project, hours, false);
      return;
    }
    await ctx.sendMessage(`⚠️ No encontré proyecto activo con código P-${project_code}.`);
  }

  const activeProjects = await findActiveProjects(supabase, user.workspace_id);

  if (activeProjects.length === 0) {
    await ctx.sendMessage('❌ No tienes proyectos activos para registrar horas.');
    return;
  }

  // D88: If only 1 active project and no entity_hint, auto-assign
  if (activeProjects.length === 1 && !entity_hint) {
    const p = activeProjects[0];
    await showHorasConfirmation(ctx, p, hours, true);
    return;
  }

  if (!entity_hint) {
    // Multiple projects, no hint
    const options = activeProjects.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: `${bold(p.nombre)} — ${formatPct(Number(p.horas_reales || 0) / Number(p.horas_estimadas || 1) * 100)} horas`,
    }));

    await ctx.sendOptions(
      `⏱️ ${hours} horas. ¿Para cuál proyecto?`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'HORAS', pending_action: 'W03',
      parsed_fields: parsed.fields, options,
    });
    return;
  }

  // Find matching project
  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 1) {
    // Single fuzzy match — confirm which project (D-DISAMB)
    const p = projects[0];
    const disambigOptions: Array<{ id: string; label: string }> = [
      { id: p.id, label: bold(p.nombre) },
      { id: 'otro_proyecto', label: 'Otro proyecto' },
    ];
    await ctx.sendOptions(
      `⏱️ ${hours} horas. ¿Para ${bold(p.nombre)}?`,
      disambigOptions.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'HORAS', pending_action: 'W03',
      parsed_fields: parsed.fields, options: disambigOptions,
    });
    return;
  }

  if (projects.length === 0) {
    const options = activeProjects.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id || p.id,
      label: bold(p.nombre),
    }));
    await ctx.sendOptions(
      `❌ No encontré proyecto con "${entity_hint}". Tus proyectos activos:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'HORAS', pending_action: 'W03',
      parsed_fields: parsed.fields, options,
    });
    return;
  }

  // Multiple matches
  const options = projects.slice(0, 5).map((p: any) => ({
    id: p.id, label: bold(p.nombre),
  }));
  await ctx.sendOptions(
    `⏱️ ${hours} horas. ¿Para cuál proyecto?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'HORAS', pending_action: 'W03',
    parsed_fields: parsed.fields, options,
  });
}

async function showHorasConfirmation(ctx: HandlerContext, project: any, hours: number, isAutoAssign: boolean): Promise<void> {
  const horasReales = Number(project.horas_reales) || 0;
  const horasEstimadas = Number(project.horas_estimadas) || 0;
  const horasNuevo = horasReales + hours;
  const pct = horasEstimadas > 0 ? (horasNuevo / horasEstimadas) * 100 : 0;
  const excede = horasEstimadas > 0 && horasNuevo > horasEstimadas;

  let msg = '';
  if (isAutoAssign) {
    msg = `⏱️ ${hours} horas para ${bold(project.nombre)} (tu único proyecto activo).`;
  } else {
    msg = `⏱️ Registro de horas:\n\n📂 Proyecto: ${bold(project.nombre)}\n🕐 Horas: ${hours}h (hoy)`;
  }

  if (horasEstimadas > 0) {
    msg += `\n📊 Acumulado: ${horasNuevo}h / ${horasEstimadas}h (${formatPct(pct)})`;
  }

  if (excede) {
    msg += `\n\n⚠️ Superaste el estimado de horas en ${Math.round(horasNuevo - horasEstimadas)}h. Esto reduce tu margen.`;
    msg += '\n\n¿Confirmo de todas formas? (Sí/No)';
  } else {
    msg += '\n\n¿Confirmo? (Sí/No)';
  }

  await ctx.sendMessage(msg);
  await ctx.updateSession('confirming', {
    intent: 'HORAS', pending_action: 'W03',
    proyecto_id: project.proyecto_id || project.id,
    proyecto_nombre: project.nombre,
    parsed_fields: { ...ctx.parsed.fields, hours },
  });
}

// ============================================================
// W03T — Timer: Iniciar / Parar / Estado
// ============================================================

async function handleTimerIniciar(ctx: HandlerContext): Promise<void> {
  const { user, supabase, parsed } = ctx;
  const { entity_hint, project_code } = parsed.fields;

  // Fast path: project_code → exact match by código (only when no active timer)
  if (project_code) {
    const { data: existingTimer } = await supabase
      .from('timer_activo')
      .select('id')
      .eq('workspace_id', user.workspace_id)
      .single();

    if (!existingTimer) {
      const project = await findProjectByCode(supabase, user.workspace_id, project_code);
      if (project) {
        await startTimer(ctx, project.proyecto_id, project.nombre);
        return;
      }
      await ctx.sendMessage(`⚠️ No encontré proyecto activo con código P-${project_code}.`);
      // Fall through to normal flow
    }
    // If timer exists, fall through to normal flow which handles the switch logic
  }

  // Check if there's already an active timer
  const { data: existing } = await supabase
    .from('timer_activo')
    .select('id, proyecto_id, inicio, descripcion')
    .eq('workspace_id', user.workspace_id)
    .single();

  if (existing) {
    // Fetch project name for active timer
    const { data: proj } = await supabase
      .from('proyectos')
      .select('nombre')
      .eq('id', existing.proyecto_id)
      .single();

    const elapsed = formatElapsed(existing.inicio);

    // If entity_hint differs from current project, offer to switch
    if (entity_hint) {
      const newProjects = await findProjects(supabase, user.workspace_id, entity_hint);
      const filteredProjects = newProjects.filter((p: any) => p.id !== existing.proyecto_id);

      if (filteredProjects.length === 1) {
        const newProj = filteredProjects[0];
        await ctx.sendOptions(
          `⏱️ Ya tienes timer en ${bold(proj?.nombre || '?')} (${elapsed.label}). ¿Cambiar a ${bold(newProj.nombre)}?`,
          [
            `Parar ${proj?.nombre} e iniciar ${newProj.nombre}`,
            `Seguir con ${proj?.nombre}`,
          ],
        );
        await ctx.updateSession('awaiting_selection', {
          intent: 'TIMER_INICIAR', pending_action: 'W03T',
          proyecto_id: newProj.id, proyecto_nombre: newProj.nombre,
          parsed_fields: { entity_hint },
          options: [
            { id: 'switch', label: `Parar e iniciar ${newProj.nombre}` },
            { id: 'keep', label: `Seguir con ${proj?.nombre}` },
          ],
        });
        return;
      }

      if (filteredProjects.length > 1) {
        // Multiple matches — let user pick (D-DISAMB)
        const switchOptions = filteredProjects.slice(0, 4).map((p: any) => ({
          id: p.id, label: p.nombre,
        }));
        switchOptions.push({ id: 'keep', label: `Seguir con ${proj?.nombre}` });
        await ctx.sendOptions(
          `⏱️ Ya tienes timer en ${bold(proj?.nombre || '?')} (${elapsed.label}). ¿Cambiar a cuál?`,
          switchOptions.map((o) => o.label),
        );
        await ctx.updateSession('awaiting_selection', {
          intent: 'TIMER_INICIAR', pending_action: 'W03T',
          parsed_fields: { entity_hint },
          options: switchOptions,
        });
        return;
      }
    }

    // Same project or no entity_hint — just inform
    await ctx.sendMessage(`⏱️ Ya tienes timer activo en ${bold(proj?.nombre || '?')} (${elapsed.label}).\n\nEscribe *parar* cuando termines.`);
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // No active timer — find project
  if (!entity_hint) {
    const projects = await findActiveProjects(supabase, user.workspace_id);
    if (projects.length === 0) {
      await ctx.sendMessage('❌ No tienes proyectos activos para iniciar timer.');
      await completeSession(supabase, ctx.session.id);
      return;
    }

    if (projects.length === 1) {
      // Auto-assign only project
      await startTimer(ctx, projects[0].proyecto_id, projects[0].nombre);
      return;
    }

    const options = projects.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: `${p.nombre}`,
    }));
    await ctx.sendOptions('⏱️ ¿En cuál proyecto?', options.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', {
      intent: 'TIMER_INICIAR', pending_action: 'W03T',
      options,
    });
    return;
  }

  // Find project by entity_hint
  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 0) {
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    if (allActive.length === 0) {
      await ctx.sendMessage(`❌ No encontré proyecto con "${entity_hint}" y no tienes proyectos activos.`);
      await completeSession(supabase, ctx.session.id);
      return;
    }
    const options = allActive.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: p.nombre,
    }));
    await ctx.sendOptions(
      `❌ No encontré proyecto con "${entity_hint}". Tus proyectos activos:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'TIMER_INICIAR', pending_action: 'W03T',
      options,
    });
    return;
  }

  // Single or multiple fuzzy matches — always let user confirm (D-DISAMB)
  const timerOptions = projects.slice(0, 5).map((p: any) => ({
    id: p.id,
    label: p.nombre,
  }));
  if (projects.length === 1) {
    timerOptions.push({ id: 'otro_proyecto', label: 'Otro proyecto' });
  }
  await ctx.sendOptions(
    projects.length === 1
      ? `⏱️ ¿Iniciar timer en ${bold(projects[0].nombre)}?`
      : '⏱️ ¿En cuál proyecto?',
    timerOptions.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'TIMER_INICIAR', pending_action: 'W03T',
    options: timerOptions,
  });
}

async function startTimer(ctx: HandlerContext, proyectoId: string, proyectoNombre: string): Promise<void> {
  const { supabase, user } = ctx;

  const { error } = await supabase.from('timer_activo').insert({
    workspace_id: user.workspace_id,
    proyecto_id: proyectoId,
    inicio: new Date().toISOString(),
  });

  if (error) {
    console.error('[timer] Start error:', error);
    await ctx.sendMessage('❌ Error al iniciar timer. Intenta de nuevo.');
  } else {
    await ctx.sendMessage(`⏱️ Timer iniciado en ${bold(proyectoNombre)}.\n\nCuando termines escribe *parar*.`);
  }

  await completeSession(supabase, ctx.session.id);
}

async function handleTimerParar(ctx: HandlerContext): Promise<void> {
  const { user, supabase } = ctx;

  // Find active timer
  const { data: timer } = await supabase
    .from('timer_activo')
    .select('id, proyecto_id, inicio')
    .eq('workspace_id', user.workspace_id)
    .single();

  if (!timer) {
    await ctx.sendMessage("⏱️ No tienes timer activo.\n\nEscribe *iniciar en [proyecto]* para empezar.");
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // Calculate elapsed
  const elapsed = formatElapsed(timer.inicio);

  if (elapsed.hours < 0.02) { // Less than ~1 min
    // Delete timer without saving — too short
    await supabase.from('timer_activo').delete().eq('id', timer.id);
    await ctx.sendMessage('⏱️ Timer cancelado (menos de 1 minuto).');
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // Insert into horas
  const now = new Date();
  const { error } = await supabase.from('horas').insert({
    workspace_id: user.workspace_id,
    proyecto_id: timer.proyecto_id,
    fecha: now.toISOString().slice(0, 10),
    horas: elapsed.hours,
    inicio: timer.inicio,
    fin: now.toISOString(),
    timer_activo: true,
    canal_registro: 'whatsapp',
  });

  if (error) {
    console.error('[timer] Save horas error:', error);
    await ctx.sendMessage('❌ Error al guardar horas. El timer sigue activo.');
    await completeSession(supabase, ctx.session.id);
    return;
  }

  // Delete timer
  await supabase.from('timer_activo').delete().eq('id', timer.id);

  // Fetch updated project metrics
  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', timer.proyecto_id)
    .single();

  if (project) {
    const horasPct = Number(project.horas_estimadas) > 0
      ? (Number(project.horas_reales) / Number(project.horas_estimadas)) * 100
      : 0;
    const msg = `✅ ${elapsed.label} registradas en ${bold(project.nombre)}.\n\n📂 ${bold(project.nombre)}\n├ Horas: ${Number(project.horas_reales)} / ${Number(project.horas_estimadas)}h (${formatPct(horasPct)})\n├ Presupuesto usado: ${formatPct(Number(project.presupuesto_consumido_pct))}\n└ Cartera: ${formatCOP(Number(project.cartera))}`;
    await ctx.sendMessage(msg);
  } else {
    await ctx.sendMessage(`✅ ${elapsed.label} registradas.`);
  }

  await completeSession(supabase, ctx.session.id);
}

async function handleTimerEstado(ctx: HandlerContext): Promise<void> {
  const { user, supabase } = ctx;

  const { data: timer } = await supabase
    .from('timer_activo')
    .select('id, proyecto_id, inicio')
    .eq('workspace_id', user.workspace_id)
    .single();

  if (!timer) {
    await ctx.sendMessage("⏱️ No tienes timer activo.\n\nEscribe *iniciar en [proyecto]* para empezar.");
    await completeSession(supabase, ctx.session.id);
    return;
  }

  const { data: proj } = await supabase
    .from('proyectos')
    .select('nombre')
    .eq('id', timer.proyecto_id)
    .single();

  const elapsed = formatElapsed(timer.inicio);
  await ctx.sendMessage(`⏱️ Llevas ${bold(elapsed.label)} en ${bold(proj?.nombre || '?')}.\n\nEscribe *parar* para registrar.`);
  await completeSession(supabase, ctx.session.id);
}

// ============================================================
// W04 — Cobro (§7)
// ============================================================

async function handleCobro(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, entity_hint, project_code } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto del cobro debe ser mayor a $0.');
    return;
  }

  // Fast path: project_code → exact match by código
  if (project_code) {
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      await ctx.updateSession('awaiting_selection', {
        intent: 'COBRO', pending_action: 'W04',
        amount, parsed_fields: parsed.fields,
      });
      await proceedCobroWithProject(ctx, project.proyecto_id, project.nombre);
      return;
    }
    await ctx.sendMessage(`⚠️ No encontré proyecto activo con código P-${project_code}.`);
  }

  if (!entity_hint) {
    await ctx.sendMessage('¿De cuál proyecto o cliente recibiste el pago?');
    await ctx.updateSession('collecting', {
      intent: 'COBRO', pending_action: 'W04',
      amount, parsed_fields: parsed.fields,
    });
    return;
  }

  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 0) {
    await ctx.sendMessage(`❌ No encontré proyecto activo con "${entity_hint}". ¿Puedes escribir el nombre del proyecto o cliente?`);
    await ctx.updateSession('collecting', {
      intent: 'COBRO', pending_action: 'W04',
      amount, parsed_fields: parsed.fields,
    });
    return;
  }

  // Always let user confirm which project (D-DISAMB)
  const cobroOptions = projects.slice(0, 5).map((p: any) => ({
    id: p.id, label: bold(p.nombre),
  }));
  if (projects.length === 1) {
    cobroOptions.push({ id: 'otro_proyecto', label: 'Otro proyecto' });
  }
  await ctx.sendOptions(
    projects.length === 1
      ? `💰 Cobro de ${formatCOP(amount)}. ¿De ${bold(projects[0].nombre)}?`
      : `💰 Cobro de ${formatCOP(amount)}. ¿De cuál proyecto?`,
    cobroOptions.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'COBRO', pending_action: 'W04',
    amount, parsed_fields: parsed.fields, options: cobroOptions,
  });
}

/** After project is confirmed for cobro, look up invoices and proceed */
async function proceedCobroWithProject(ctx: HandlerContext, projectId: string, projectName: string): Promise<void> {
  const { supabase } = ctx;
  const context = ctx.session.context;
  const amount = context.amount!;

  const { data: facturas } = await supabase
    .from('v_facturas_estado')
    .select('*')
    .eq('proyecto_id', projectId)
    .gt('saldo_pendiente', 0)
    .order('fecha_emision', { ascending: true });

  if (!facturas || facturas.length === 0) {
    const msg = `💰 Cobro de ${formatCOP(amount)} para ${bold(projectName)}.\n\n⚠️ No hay facturas emitidas. Se registra como anticipo.\n\n¿Confirmo? (Sí/No)`;
    await ctx.sendMessage(msg);
    await ctx.updateSession('confirming', {
      proyecto_id: projectId, proyecto_nombre: projectName,
    });
    return;
  }

  if (facturas.length === 1) {
    const f = facturas[0];
    const saldo = Number(f.saldo_pendiente);
    const isFullPayment = Math.abs(saldo - amount) < 100;
    const msg = `💰 Cobro recibido:\n\n📂 Proyecto: ${bold(projectName)}\n📄 Factura: ${f.numero_factura || '#' + f.factura_id.slice(0, 4)} — Saldo: ${formatCOP(saldo)}\n💵 Cobro: ${formatCOP(amount)} ${isFullPayment ? '✅ Pago completo' : ''}\n\n¿Confirmo? (Sí/No)`;
    await ctx.sendMessage(msg);
    await ctx.updateSession('confirming', {
      proyecto_id: projectId, proyecto_nombre: projectName,
      factura_id: f.factura_id,
    });
    return;
  }

  // Multiple invoices
  const facturaOptions = facturas.slice(0, 4).map((f: any) => ({
    id: f.factura_id,
    label: `Factura ${f.numero_factura || '#' + f.factura_id.slice(0, 4)} — Saldo: ${formatCOP(Number(f.saldo_pendiente))} (${f.dias_antiguedad} días)`,
  }));
  facturaOptions.push({ id: 'general', label: 'Abono general (sin asociar a factura)' });

  await ctx.sendOptions(
    `💰 Cobro de ${formatCOP(amount)} para ${bold(projectName)}. ¿A cuál factura?`,
    facturaOptions.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    proyecto_id: projectId, proyecto_nombre: projectName, options: facturaOptions,
  });
}

// ============================================================
// W06 — Contacto Nuevo (§8)
// ============================================================

async function handleContactoNuevo(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { name, phone, role } = parsed.fields;

  if (!name) {
    await ctx.sendMessage('¿Cómo se llama el contacto?');
    await ctx.updateSession('collecting', {
      intent: 'CONTACTO_NUEVO', pending_action: 'W06',
      parsed_fields: parsed.fields,
    });
    return;
  }

  // Check for duplicates
  const duplicates = await findContacts(supabase, user.workspace_id, name, 3);
  const exactPhoneMatch = phone ? duplicates.find((d: any) => d.telefono === phone) : null;

  if (exactPhoneMatch) {
    await ctx.sendMessage(
      `⚠️ Ya existe un contacto con ese teléfono:\n\n👤 ${bold(exactPhoneMatch.nombre)} — ${exactPhoneMatch.telefono}\n\n1️⃣ Es la misma persona (no crear nuevo)\n2️⃣ Es diferente, crear contacto nuevo\n3️⃣ Cancelar`
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'CONTACTO_NUEVO', pending_action: 'W06',
      parsed_fields: parsed.fields,
      options: [
        { id: 'same', label: 'Es la misma persona' },
        { id: 'create', label: 'Crear nuevo' },
        { id: 'cancelar', label: 'Cancelar' },
      ],
    });
    return;
  }

  const similarName = duplicates.find((d: any) => d.nombre.toLowerCase().includes(name.toLowerCase().slice(0, 4)));
  if (similarName) {
    await ctx.sendMessage(
      `⚠️ Ya existe un contacto similar:\n\n👤 ${bold(similarName.nombre)} — ${similarName.telefono || 'sin teléfono'}\n\n1️⃣ Es la misma persona (no crear nuevo)\n2️⃣ Es diferente, crear contacto nuevo\n3️⃣ Cancelar`
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'CONTACTO_NUEVO', pending_action: 'W06',
      parsed_fields: parsed.fields,
      options: [
        { id: 'same', label: 'Es la misma persona' },
        { id: 'create', label: 'Crear nuevo' },
        { id: 'cancelar', label: 'Cancelar' },
      ],
    });
    return;
  }

  // No duplicates — confirm creation
  let msg = `👤 Nuevo contacto:\n\n📛 Nombre: ${bold(name)}`;
  if (phone) msg += `\n📱 Teléfono: ${phone}`;
  if (role) msg += `\n💼 Rol: ${role}`;
  if (!phone && !role) msg += '\n\nNo tengo teléfono ni email.';
  msg += '\n\n¿Confirmo? (Sí/No)';

  await ctx.sendMessage(msg);
  await ctx.updateSession('confirming', {
    intent: 'CONTACTO_NUEVO', pending_action: 'W06',
    parsed_fields: parsed.fields,
  });
}

// ============================================================
// W32 — Saldo Bancario (§9A)
// ============================================================

async function handleSaldoBancario(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount } = parsed.fields;

  if (amount === undefined || amount === null) {
    await ctx.sendMessage('¿Cuál es tu saldo actual en el banco?');
    return;
  }

  if (amount < 0) {
    await ctx.sendMessage('❌ El saldo del banco no puede ser negativo. ¿Cuánto tienes?');
    return;
  }

  // Get last balance + calculate theoretical
  const { data: lastSaldo } = await supabase
    .from('saldos_banco')
    .select('saldo_real, fecha')
    .eq('workspace_id', user.workspace_id)
    .order('fecha', { ascending: false })
    .limit(1)
    .single();

  if (!lastSaldo) {
    // First balance ever
    const msg = `🏦 ¿Registro tu saldo inicial del banco en ${formatCOP(amount)}?\n\nEs tu primer registro de saldo. A partir de ahora, el sistema calculará la diferencia entre lo que registras y lo que debería haber según tus cobros y gastos.\n\n¿Confirmo? (Sí/No)`;
    await ctx.sendMessage(msg);
    await ctx.updateSession('confirming', {
      intent: 'SALDO_BANCARIO', pending_action: 'W32',
      amount, parsed_fields: parsed.fields,
    });
    return;
  }

  // Calculate theoretical balance
  const lastDate = lastSaldo.fecha;
  const lastReal = Number(lastSaldo.saldo_real);

  const { data: cobrosData } = await supabase
    .from('cobros')
    .select('monto')
    .eq('workspace_id', user.workspace_id)
    .gt('created_at', lastDate);
  const totalCobros = (cobrosData || []).reduce((sum: number, c: any) => sum + Number(c.monto), 0);

  const { data: gastosData } = await supabase
    .from('gastos')
    .select('monto')
    .eq('workspace_id', user.workspace_id)
    .gt('created_at', lastDate);
  const totalGastos = (gastosData || []).reduce((sum: number, g: any) => sum + Number(g.monto), 0);

  const saldoTeorico = lastReal + totalCobros - totalGastos;
  const diferencia = amount - saldoTeorico;
  const pctDiff = saldoTeorico !== 0 ? Math.abs(diferencia / saldoTeorico) * 100 : 0;

  // D111: Tolerance levels
  let toleranceLabel = '';
  let toleranceEmoji = '';

  if (Math.abs(diferencia) <= 50000 || pctDiff <= 2) {
    toleranceLabel = '✅ Dentro de tolerancia';
    toleranceEmoji = '✅';
  } else if (Math.abs(diferencia) <= 500000 || pctDiff <= 10) {
    toleranceLabel = '⚠️';
    toleranceEmoji = '⚠️';
  } else {
    toleranceLabel = '⚠️ Importante';
    toleranceEmoji = '⚠️';
  }

  let msg = `🏦 ¿Actualizo tu saldo del banco a ${formatCOP(amount)}?\n\nSaldo teórico calculado: ${formatCOP(saldoTeorico)}\nDiferencia: ${diferencia >= 0 ? '+' : ''}${formatCOP(diferencia)} (${formatPct(pctDiff)}) ${toleranceLabel}`;

  if (Math.abs(diferencia) > 500000 || pctDiff > 10) {
    msg += '\n\nHay movimientos sin registrar. Te recomiendo revisar en la app → Números antes de continuar.';
    msg += '\n\n1️⃣ Confirmar de todas formas\n2️⃣ Cancelar y revisar primero';
    await ctx.sendMessage(msg);
    await ctx.updateSession('awaiting_selection', {
      intent: 'SALDO_BANCARIO', pending_action: 'W32',
      amount, parsed_fields: { ...parsed.fields, saldo_teorico: saldoTeorico, diferencia },
      options: [
        { id: 'confirmar', label: 'Confirmar de todas formas' },
        { id: 'cancelar', label: 'Cancelar y revisar primero' },
      ],
    });
  } else {
    msg += '\n\n¿Confirmo? (Sí/No)';
    await ctx.sendMessage(msg);
    await ctx.updateSession('confirming', {
      intent: 'SALDO_BANCARIO', pending_action: 'W32',
      amount, parsed_fields: { ...parsed.fields, saldo_teorico: saldoTeorico, diferencia },
    });
  }
}

// ============================================================
// Multi-step Resume Handler
// ============================================================

async function handleResumeRegistro(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase, user } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Handle confirmation (Sí/No)
  if (session.state === 'confirming') {
    if (['sí', 'si', 'yes', '1', '✅', 'confirmo', 'dale'].includes(text)) {
      await executeRegistro(ctx);
    } else if (['no', 'cancelar', 'cancel', '❌', 'nel'].includes(text)) {
      await ctx.sendMessage('❌ Cancelado.');
      await completeSession(supabase, session.id);
    } else {
      await ctx.sendMessage('Responde *Sí* para confirmar o *No* para cancelar.');
    }
    return;
  }

  // Handle selection (numbered options)
  if (session.state === 'awaiting_selection') {
    const options = context.options || [];
    const selection = parseInt(text);

    if (isNaN(selection) || selection < 1 || selection > options.length) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    const selected = options[selection - 1];

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

  // Handle image for soporte (W01/W02 awaiting_image)
  if (session.state === 'awaiting_image') {
    if (message.type === 'image' && message.image_id) {
      // Store image reference
      if (context.gasto_id) {
        await supabase
          .from('gastos')
          .update({ soporte_url: message.image_id, soporte_pendiente: false })
          .eq('id', context.gasto_id);
        await ctx.sendMessage('📷 Guardé el soporte fotográfico.');
      }
    } else if (message.type === 'audio') {
      await ctx.sendMessage('📷 Necesito una foto del soporte, no un audio. Envía la imagen o escribe *después*.');
      return; // Stay in awaiting_image
    } else if (['después', 'despues', 'luego'].includes(text)) {
      await ctx.sendMessage('👍 Sin problema. Puedes enviarlo después.');
    } else if (['no', 'sin soporte'].includes(text)) {
      // Do nothing
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
    // Show all active projects
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    const newOptions = allActive.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: bold(p.nombre),
    }));
    newOptions.push({ id: 'operativo', label: '🏢 Gasto de empresa' });
    await ctx.sendOptions('Tus proyectos activos:', newOptions.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', { options: newOptions });
    return;
  }

  // Selected a specific project — fetch details + check borrador
  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', selected.id)
    .single();

  if (!project) {
    await ctx.sendMessage('❌ No encontré ese proyecto. Intenta de nuevo.');
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
    const msg = `💰 Gasto de empresa:\n\n💵 ${formatCOP(context.amount!)} — ${CATEGORIA_LABELS[context.categoria || 'otros'] || context.categoria}\n📅 Hoy\n\n¿Confirmo? (Sí/No)`;
    await ctx.sendMessage(msg);
    return;
  }
}

async function handleW03Selection(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;
  const hours = context.parsed_fields?.hours || 0;

  if (selected.id === 'otro_proyecto') {
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    const newOptions = allActive.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: bold(p.nombre),
    }));
    await ctx.sendOptions('¿Para cuál proyecto?', newOptions.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', { options: newOptions });
    return;
  }

  // Fetch project details
  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', selected.id)
    .single();

  if (project) {
    await showHorasConfirmation(ctx, project, hours, false);
  } else {
    await ctx.sendMessage('❌ No encontré ese proyecto. Intenta de nuevo.');
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
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    const newOptions = allActive.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id,
      label: p.nombre,
    }));
    await ctx.sendOptions('⏱️ ¿En cuál proyecto?', newOptions.map((o) => o.label));
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

  // Phase 1: Project selection (no proyecto_id yet)
  if (!context.proyecto_id) {
    if (selected.id === 'otro_proyecto') {
      const allActive = await findActiveProjects(supabase, user.workspace_id);
      const newOptions = allActive.slice(0, 5).map((p: any) => ({
        id: p.proyecto_id,
        label: bold(p.nombre),
      }));
      await ctx.sendOptions('¿De cuál proyecto?', newOptions.map((o) => o.label));
      await ctx.updateSession('awaiting_selection', { options: newOptions });
      return;
    }
    // User picked a project — proceed to invoice lookup
    await proceedCobroWithProject(ctx, selected.id, selected.label.replace(/\*/g, ''));
    return;
  }

  // Phase 2: Invoice selection (proyecto_id already set)
  if (selected.id === 'general') {
    // Register without specific invoice
    await ctx.updateSession('confirming', { factura_id: undefined });
    const msg = `💰 Cobro de ${formatCOP(context.amount!)} para ${bold(context.proyecto_nombre!)}.\n\nSe registra como abono general.\n\n¿Confirmo? (Sí/No)`;
    await ctx.sendMessage(msg);
    return;
  }

  // Selected a specific invoice
  await ctx.updateSession('confirming', { factura_id: selected.id });
  const msg = `💰 Cobro de ${formatCOP(context.amount!)} para ${bold(context.proyecto_nombre!)}.\n📄 Factura: ${selected.label.split(' — ')[0]}\n\n¿Confirmo? (Sí/No)`;
  await ctx.sendMessage(msg);
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
  msg += '\n\n¿Confirmo? (Sí/No)';
  await ctx.sendMessage(msg);
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

// ============================================================
// Execute — Persist to Database
// ============================================================

async function executeRegistro(ctx: HandlerContext): Promise<void> {
  const { session, supabase, user } = ctx;
  const context = session.context;
  const action = context.pending_action;
  let awaitingImage = false;

  try {
    switch (action) {
      case 'W01': awaitingImage = await executeW01(ctx); break;
      case 'W02': awaitingImage = await executeW02(ctx); break;
      case 'W03': await executeW03(ctx); break;
      case 'W04': await executeW04(ctx); break;
      case 'W06': await executeW06(ctx); break;
      case 'W32': await executeW32(ctx); break;
    }
  } catch (err) {
    console.error(`[registro] Execute ${action} error:`, err);
    await ctx.sendMessage('❌ Ocurrió un error al registrar. Intenta de nuevo.');
  }

  // Don't complete if handler is awaiting soporte image
  if (!awaitingImage) {
    await completeSession(supabase, session.id);
  }
}

async function executeW01(ctx: HandlerContext): Promise<boolean> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  const { data: gasto, error } = await supabase.from('gastos').insert({
    workspace_id: user.workspace_id,
    proyecto_id: c.proyecto_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: c.parsed_fields?.concept || '',
    tipo: 'directo',
    canal_registro: 'whatsapp',
    soporte_pendiente: true,
  }).select().single();

  if (error) throw error;

  // Fetch updated project info
  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', c.proyecto_id)
    .single();

  let msg: string;
  if (project) {
    msg = `✅ Gasto registrado.\n\n📂 ${bold(project.nombre)}\n├ Presupuesto usado: ${formatCOP(Number(project.costo_acumulado))} / ${formatCOP(Number(project.presupuesto_total))} (${formatPct(Number(project.presupuesto_consumido_pct))})\n├ Horas: ${Number(project.horas_reales) || 0} / ${Number(project.horas_estimadas) || 0}h\n└ Cartera: ${formatCOP(Number(project.cartera))}`;
  } else {
    msg = `✅ Gasto de ${formatCOP(c.amount!)} registrado en ${bold(c.proyecto_nombre || 'proyecto')}.`;
  }

  msg += '\n\n📎 ¿Tienes soporte? 📷 Ahora / ⏰ Después / ❌ No';
  await ctx.sendMessage(msg);
  await ctx.updateSession('awaiting_image', { gasto_id: gasto?.id });
  return true; // Skip completeSession — awaiting soporte image
}

async function executeW02(ctx: HandlerContext): Promise<boolean> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  if (c.borrador_id) {
    // Confirm borrador — no soporte needed for fixed expenses
    await executeBorradorConfirmation(ctx);
    return false;
  }

  const { data: gasto, error } = await supabase.from('gastos').insert({
    workspace_id: user.workspace_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: c.parsed_fields?.concept || '',
    tipo: 'empresa',
    canal_registro: 'whatsapp',
    soporte_pendiente: true,
  }).select().single();

  if (error) throw error;

  // D103: Enriched response with monthly accumulated
  const { data: acumulado } = await supabase
    .from('gastos')
    .select('monto, descripcion')
    .eq('workspace_id', user.workspace_id)
    .is('proyecto_id', null)
    .gte('fecha', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10))
    .order('created_at', { ascending: false })
    .limit(4);

  const totalMes = (acumulado || []).reduce((sum: number, g: any) => sum + Number(g.monto), 0);
  const detalle = (acumulado || []).slice(0, 3).map((g: any) =>
    `${g.descripcion || 'Sin desc.'} ${formatCOPShort(Number(g.monto))}`
  ).join(' · ');

  let msg = `✅ Gasto de empresa registrado:\n💰 ${formatCOP(c.amount!)} — ${CATEGORIA_LABELS[c.categoria || 'otros'] || c.categoria}\n📊 Gastos empresa este mes: ${formatCOP(totalMes)}`;
  if (detalle) msg += `\n   (${detalle})`;
  msg += '\n\n📎 ¿Tienes soporte? 📷 Ahora / ⏰ Después / ❌ No';

  await ctx.sendMessage(msg);
  await ctx.updateSession('awaiting_image', { gasto_id: gasto?.id });
  return true; // Skip completeSession — awaiting soporte image
}

async function executeBorradorConfirmation(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  // Create gasto from borrador
  const { data: gasto, error } = await supabase.from('gastos').insert({
    workspace_id: user.workspace_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: c.parsed_fields?.concept || '',
    tipo: 'fijo',
    canal_registro: 'whatsapp',
    gasto_fijo_ref_id: c.borrador_id,
  }).select().single();

  if (error) throw error;

  // Update borrador
  await supabase.from('gastos_fijos_borradores').update({
    confirmado: true,
    gasto_id: gasto?.id,
    fecha_confirmacion: new Date().toISOString(),
  }).eq('id', c.borrador_id);

  await ctx.sendMessage(`✅ Gasto fijo confirmado: ${formatCOP(c.amount!)} — ${c.parsed_fields?.concept || c.categoria}`);
}

async function executeW03(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  const { error } = await supabase.from('horas').insert({
    workspace_id: user.workspace_id,
    proyecto_id: c.proyecto_id,
    fecha: new Date().toISOString().slice(0, 10),
    horas: c.parsed_fields?.hours || 0,
    descripcion: c.parsed_fields?.concept || '',
    canal_registro: 'whatsapp',
  });

  if (error) throw error;

  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', c.proyecto_id)
    .single();

  if (project) {
    const horasPct = Number(project.horas_estimadas) > 0
      ? (Number(project.horas_reales) / Number(project.horas_estimadas)) * 100
      : 0;
    const msg = `✅ ${c.parsed_fields?.hours}h registradas en ${bold(project.nombre)}.\n\n📂 ${bold(project.nombre)}\n├ Horas: ${Number(project.horas_reales)} / ${Number(project.horas_estimadas)}h (${formatPct(horasPct)})\n├ Presupuesto usado: ${formatPct(Number(project.presupuesto_consumido_pct))}\n└ Cartera: ${formatCOP(Number(project.cartera))}`;
    await ctx.sendMessage(msg);
  } else {
    await ctx.sendMessage(`✅ ${c.parsed_fields?.hours}h registradas.`);
  }
}

async function executeW04(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  // Insert cobro
  const insertData: Record<string, unknown> = {
    workspace_id: user.workspace_id,
    proyecto_id: c.proyecto_id,
    monto: c.amount,
    fecha: new Date().toISOString().slice(0, 10),
    canal_registro: 'whatsapp',
  };
  if (c.factura_id) insertData.factura_id = c.factura_id;

  const { error } = await supabase.from('cobros').insert(insertData);
  if (error) throw error;

  // Get updated project data
  const { data: project } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', c.proyecto_id)
    .single();

  if (project) {
    const msg = `✅ Cobro registrado.\n\n📂 ${bold(project.nombre)}\n├ Facturado: ${formatCOP(Number(project.facturado))}\n├ Cobrado: ${formatCOP(Number(project.cobrado))}\n└ Cartera: ${formatCOP(Number(project.cartera))}`;
    await ctx.sendMessage(msg);
  } else {
    await ctx.sendMessage(`✅ Cobro de ${formatCOP(c.amount!)} registrado.`);
  }
}

async function executeW06(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const fields = session.context.parsed_fields || {};

  const { error } = await supabase.from('contactos').insert({
    workspace_id: user.workspace_id,
    nombre: fields.name,
    telefono: fields.phone || null,
    rol: fields.role === 'arquitecta' || fields.role === 'arquitecto' ? 'decisor' : 'operativo',
  });

  if (error) throw error;

  let msg = `✅ Contacto creado: ${bold(fields.name || '')}`;
  if (fields.role) msg += ` (${fields.role})`;
  msg += '\n\nCompleta sus datos fiscales en la app para poder facturarle.';
  await ctx.sendMessage(msg);
}

async function executeW32(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;
  const amount = c.amount!;
  const saldoTeorico = Number(c.parsed_fields?.saldo_teorico ?? 0);
  const diferencia = amount - saldoTeorico;

  const { error } = await supabase.from('saldos_banco').insert({
    workspace_id: user.workspace_id,
    saldo_real: amount,
    saldo_teorico: saldoTeorico,
    diferencia: diferencia,
    registrado_via: 'whatsapp',
  });

  if (error) throw error;

  // Check streak
  const { data: streak } = await supabase
    .from('streaks')
    .select('semanas_actuales, semanas_record')
    .eq('workspace_id', user.workspace_id)
    .eq('tipo', 'conciliacion')
    .single();

  const weeks = (streak?.semanas_actuales || 0) + 1; // approximate
  const milestone = STREAK_MILESTONES[weeks];

  let msg = `✅ Saldo actualizado a ${formatCOP(amount)}.`;
  if (saldoTeorico > 0) {
    const toleranceEmoji = Math.abs(diferencia) <= 50000 ? '✅' : '⚠️';
    msg += `\n\nSaldo teórico era: ${formatCOP(saldoTeorico)}\nDiferencia: ${diferencia >= 0 ? '+' : ''}${formatCOP(diferencia)} ${toleranceEmoji}`;
  }

  if (milestone) {
    msg += `\n\n🏆 ¡Llevas ${weeks} semanas seguidas actualizando! ${milestone}`;
  } else if (streak) {
    msg += `\n\n🏃 Racha: ${streak.semanas_actuales} semanas`;
  }

  await ctx.sendMessage(msg);
}
