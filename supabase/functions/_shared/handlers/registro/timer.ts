// ============================================================
// W03T — Timer: Iniciar / Parar / Estado
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { formatPct, bold, formatElapsed, formatProject, formatCOP } from '../../wa-format.ts';
import { findProjects, findProjectByCode, findActiveProjects, findActiveDestinos, findDestinos, findNegocioByCode } from '../../wa-lookup.ts';
import { completeSession } from '../../wa-session.ts';

export async function handleTimerIniciar(ctx: HandlerContext): Promise<void> {
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

  // No active timer — find destino (negocios + projects)
  if (!entity_hint) {
    const destinos = await findActiveDestinos(supabase, user.workspace_id);
    if (destinos.all.length === 0) {
      await ctx.sendMessage('❌ No tienes negocios ni proyectos activos para iniciar timer.');
      await completeSession(supabase, ctx.session.id);
      return;
    }

    if (destinos.all.length === 1) {
      const d = destinos.all[0];
      await startTimer(ctx, d.proyecto_id || d.id, d.nombre);
      return;
    }

    const options = destinos.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
    }));
    await ctx.sendOptions('⏱️ ¿En cuál?', options.map((o) => o.label));
    await ctx.updateSession('awaiting_selection', {
      intent: 'TIMER_INICIAR', pending_action: 'W03T',
      options,
    });
    return;
  }

  // Find destino by entity_hint
  const matchedDestinos = await findDestinos(supabase, user.workspace_id, entity_hint);

  if (matchedDestinos.all.length === 1) {
    const d = matchedDestinos.all[0];
    await startTimer(ctx, d.proyecto_id || d.id, formatProject(d));
    return;
  }

  if (matchedDestinos.all.length === 0) {
    const allActive = await findActiveDestinos(supabase, user.workspace_id);
    if (allActive.all.length === 0) {
      await ctx.sendMessage(`❌ No encontré "${entity_hint}" y no tienes negocios/proyectos activos.`);
      await completeSession(supabase, ctx.session.id);
      return;
    }
    const options = allActive.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
    }));
    await ctx.sendOptions(
      `❌ No encontré "${entity_hint}". Tus negocios/proyectos:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'TIMER_INICIAR', pending_action: 'W03T',
      options,
    });
    return;
  }

  // Multiple matches
  const timerOptions = matchedDestinos.all.slice(0, 5).map((d: any) => ({
    id: d.proyecto_id || d.id,
    label: formatProject(d),
  }));
  await ctx.sendOptions('⏱️ ¿En cuál?', timerOptions.map((o) => o.label));
  await ctx.updateSession('awaiting_selection', {
    intent: 'TIMER_INICIAR', pending_action: 'W03T',
    options: timerOptions,
  });
}

export async function startTimer(ctx: HandlerContext, proyectoId: string, proyectoNombre: string): Promise<void> {
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

export async function handleTimerParar(ctx: HandlerContext): Promise<void> {
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
    created_by_wa_name: user.name,
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
    const msg = `✅ ${elapsed.label} registradas en ${bold(project.nombre)}.\n\n📁 ${bold(project.nombre)}\n├ Horas: ${Number(project.horas_reales)} / ${Number(project.horas_estimadas)}h (${formatPct(horasPct)})\n├ Presupuesto usado: ${formatPct(Number(project.presupuesto_consumido_pct))}\n└ Cartera: ${formatCOP(Number(project.cartera))}`;
    await ctx.sendMessage(msg);
  } else {
    await ctx.sendMessage(`✅ ${elapsed.label} registradas.`);
  }

  await completeSession(supabase, ctx.session.id);
}

export async function handleTimerEstado(ctx: HandlerContext): Promise<void> {
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
