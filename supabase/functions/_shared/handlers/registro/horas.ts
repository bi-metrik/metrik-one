// ============================================================
// W03 — Horas (§6)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { formatCOP, formatPct, bold, formatProject } from '../../wa-format.ts';
import { findProjects, findProjectByCode, findActiveProjects, findActiveDestinos, findDestinos, findNegocioByCode } from '../../wa-lookup.ts';

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

  // Fast path: project_code → exact match (try negocio first, then project)
  if (project_code) {
    const negocio = await findNegocioByCode(supabase, user.workspace_id, project_code);
    if (negocio) {
      await showHorasConfirmation(ctx, negocio, hours, false);
      return;
    }
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      await showHorasConfirmation(ctx, project, hours, false);
      return;
    }
    await ctx.sendMessage(`⚠️ No encontré ningún negocio activo con código ${project_code}.`);
  }

  const destinos = await findActiveDestinos(supabase, user.workspace_id);

  if (destinos.all.length === 0) {
    await ctx.sendMessage('❌ No tienes negocios activos para registrar horas.');
    return;
  }

  // If only 1 active destino and no entity_hint, auto-assign
  if (destinos.all.length === 1 && !entity_hint) {
    const d = destinos.all[0];
    await showHorasConfirmation(ctx, d, hours, true);
    return;
  }

  if (!entity_hint) {
    // Multiple destinos, no hint
    const options = destinos.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
    }));

    await ctx.sendOptions(
      `⏱️ ${hours}h. ¿Para cuál?`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'HORAS', pending_action: 'W03',
      parsed_fields: parsed.fields, options,
    });
    return;
  }

  // Find matching destinos
  const matchedDestinos = await findDestinos(supabase, user.workspace_id, entity_hint);

  if (matchedDestinos.all.length === 1) {
    const d = matchedDestinos.all[0];
    await showHorasConfirmation(ctx, d, hours, false);
    return;
  }

  if (matchedDestinos.all.length === 0) {
    const options = destinos.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
    }));
    await ctx.sendOptions(
      `❌ No encontré "${entity_hint}". Tus negocios:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'HORAS', pending_action: 'W03',
      parsed_fields: parsed.fields, options,
    });
    return;
  }

  // Multiple matches
  const options = matchedDestinos.all.slice(0, 5).map((d: any) => ({
    id: d.proyecto_id || d.id, label: formatProject(d),
  }));
  await ctx.sendOptions(
    `⏱️ ${hours}h. ¿Cuál?`,
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
    msg = `⏱️ ${hours}h para ${bold(formatProject(project))} (tu único negocio activo).`;
  } else {
    msg = `📁 ${bold(formatProject(project))}\n🕐 ${hours}h (hoy)`;
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
