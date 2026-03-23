// ============================================================
// W01 — Gasto Directo (§4)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import { formatCOP, formatPct, bold, formatProject } from '../../wa-format.ts';
import { findProjects, findProjectByCode, findActiveProjects, matchCategory, findMatchingBorrador } from '../../wa-lookup.ts';
import { executeRegistro } from './execute.ts';

export async function handleGastoDirecto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, entity_hint, concept, category_hint, project_code } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto debe ser mayor a $0. ¿Cuánto fue el gasto?');
    return;
  }

  // Resolve category — trust Gemini's category_hint first, matchCategory() as fallback
  const categoria = category_hint || matchCategory(concept || '') || 'otros';
  console.log(`[registro] W01 category_hint=${category_hint}, concept=${concept}, matchCategory=${matchCategory(concept || '')}, final=${categoria}`);

  const isHighConfidence = parsed.confidence >= 0.8;

  // Fast path: project_code → exact match by código
  if (project_code) {
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept || '', categoria, amount);
      if (borrador) {
        await showBorradorMatch(ctx, borrador, project, amount, categoria);
      } else if (isHighConfidence) {
        await autoRegisterGasto(ctx, project, amount, categoria, concept);
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
      label: formatProject(p),
    }));
    options.push({ id: 'operativo', label: '🏢 Gasto de empresa' });

    await ctx.sendOptions(
      `💰 ${formatCOP(amount)} en ${concept || categoria}. ¿Para cuál proyecto?`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options,
    });
    return;
  }

  // Find matching projects
  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 0) {
    // No match — show active projects
    const allActive = await findActiveProjects(supabase, user.workspace_id);
    if (allActive.length === 0) {
      await ctx.sendButtons(`❌ No encontré "${entity_hint}". ¿Registro como gasto de empresa?`, [
        { id: 'operativo', title: '✅ Sí, empresa' },
        { id: 'cancelar', title: '❌ Cancelar' },
      ]);
      await ctx.updateSession('awaiting_selection', {
        intent: 'GASTO_DIRECTO', pending_action: 'W01',
        amount, categoria, parsed_fields: parsed.fields,
        options: [{ id: 'operativo', label: 'Sí, gasto de empresa' }, { id: 'cancelar', label: 'Cancelar' }],
      });
      return;
    }

    const options = allActive.slice(0, 4).map((p: any) => ({
      id: p.proyecto_id,
      label: formatProject(p),
    }));
    options.push({ id: 'operativo', label: '🏢 Gasto de empresa' });

    await ctx.sendOptions(
      `❌ No encontré "${entity_hint}". Tus proyectos:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options,
    });
    return;
  }

  if (projects.length === 1) {
    // Single fuzzy match — go direct to confirmation (skip disambiguation)
    const p = projects[0];
    const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept || '', categoria, amount);
    if (borrador) {
      await showBorradorMatch(ctx, borrador, p, amount, categoria);
    } else if (isHighConfidence) {
      await autoRegisterGasto(ctx, p, amount, categoria, concept);
    } else {
      await showGastoDirectoConfirmation(ctx, p, amount, categoria, concept);
    }
    return;
  }

  // Multiple matches
  const options = projects.slice(0, 5).map((p: any) => ({
    id: p.id,
    label: formatProject(p),
  }));

  await ctx.sendOptions(
    `💰 ${formatCOP(amount)} en ${concept || categoria}. ¿Cuál proyecto?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    amount, categoria, parsed_fields: parsed.fields, options,
  });
}

export async function showGastoDirectoConfirmation(ctx: HandlerContext, project: any, amount: number, categoria: string, concept?: string): Promise<void> {
  const presupuesto = Number(project.presupuesto_total) || 0;
  const costoActual = Number(project.costo_acumulado) || 0;
  const costoNuevo = costoActual + amount;
  const pctNuevo = presupuesto > 0 ? (costoNuevo / presupuesto) * 100 : 0;

  let msg = `📂 ${bold(formatProject(project))}\n💰 ${formatCOP(amount)} — ${CATEGORIA_LABELS[categoria] || categoria}`;
  if (concept) msg += `\n📝 ${concept}`;

  if (presupuesto > 0) {
    msg += `\n📊 Presupuesto: ${formatCOP(costoNuevo)} / ${formatCOP(presupuesto)} (${formatPct(pctNuevo)})`;
  }

  if (amount > (presupuesto - costoActual) && presupuesto > 0) {
    msg += `\n⚠️ Supera presupuesto restante.`;
  }

  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  // project.proyecto_id from v_proyecto_financiero, project.id from RPC
  const proyectoId = project.proyecto_id || project.id;
  await ctx.updateSession('confirming', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: proyectoId, proyecto_nombre: project.nombre,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
  });
}

/** Auto-register gasto without confirmation (high confidence, single match) */
async function autoRegisterGasto(ctx: HandlerContext, project: any, amount: number, categoria: string, concept?: string): Promise<void> {
  const proyectoId = project.proyecto_id || project.id;
  // Set up session as if confirmed, then execute directly
  await ctx.updateSession('confirming', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: proyectoId, proyecto_nombre: project.nombre,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
  });
  await executeRegistro(ctx);
}

export async function showBorradorMatch(ctx: HandlerContext, borrador: any, project: any, amount: number, categoria: string): Promise<void> {
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
