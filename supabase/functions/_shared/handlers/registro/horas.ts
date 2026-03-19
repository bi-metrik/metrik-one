// ============================================================
// W03 — Horas (§6)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { formatCOP, formatPct, bold, formatProject } from '../../wa-format.ts';
import { findProjects, findProjectByCode, findActiveProjects } from '../../wa-lookup.ts';

export async function handleHoras(ctx: HandlerContext): Promise<void> {
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
      label: formatProject(p),
    }));

    await ctx.sendOptions(
      `⏱️ ${hours}h. ¿Para cuál proyecto?`,
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
    // Single fuzzy match — go direct to confirmation
    const p = projects[0];
    await showHorasConfirmation(ctx, p, hours, false);
    return;
  }

  if (projects.length === 0) {
    const options = activeProjects.slice(0, 5).map((p: any) => ({
      id: p.proyecto_id || p.id,
      label: formatProject(p),
    }));
    await ctx.sendOptions(
      `❌ No encontré "${entity_hint}". Tus proyectos:`,
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
    id: p.id, label: formatProject(p),
  }));
  await ctx.sendOptions(
    `⏱️ ${hours}h. ¿Cuál proyecto?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'HORAS', pending_action: 'W03',
    parsed_fields: parsed.fields, options,
  });
}

export async function showHorasConfirmation(ctx: HandlerContext, project: any, hours: number, isAutoAssign: boolean): Promise<void> {
  const horasReales = Number(project.horas_reales) || 0;
  const horasEstimadas = Number(project.horas_estimadas) || 0;
  const horasNuevo = horasReales + hours;
  const pct = horasEstimadas > 0 ? (horasNuevo / horasEstimadas) * 100 : 0;
  const excede = horasEstimadas > 0 && horasNuevo > horasEstimadas;

  let msg = '';
  if (isAutoAssign) {
    msg = `⏱️ ${hours}h para ${bold(formatProject(project))} (tu único proyecto activo).`;
  } else {
    msg = `📂 ${bold(formatProject(project))}\n🕐 ${hours}h (hoy)`;
  }

  if (horasEstimadas > 0) {
    msg += `\n📊 Acumulado: ${horasNuevo}h / ${horasEstimadas}h (${formatPct(pct)})`;
  }

  if (excede) {
    msg += `\n\n⚠️ Superaste el estimado de horas en ${Math.round(horasNuevo - horasEstimadas)}h. Esto reduce tu margen.`;
  }

  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'HORAS', pending_action: 'W03',
    proyecto_id: project.proyecto_id || project.id,
    proyecto_nombre: project.nombre,
    parsed_fields: { ...ctx.parsed.fields, hours },
  });
}
