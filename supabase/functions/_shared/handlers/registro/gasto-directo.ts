// ============================================================
// W01 — Gasto Directo (§4) — Unified: negocios + projects
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import { CONFIDENCE_THRESHOLD } from '../../wa-parse.ts';
import { formatCOP, formatPct, bold, formatProject } from '../../wa-format.ts';
import { findDestinos, findActiveDestinos, findProjectByCode, findNegocioByCode, matchCategory, findMatchingBorrador } from '../../wa-lookup.ts';
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

  // Unified threshold (Sprint 1, Yuto) — same cutoff used by parser
  const isHighConfidence = parsed.confidence >= CONFIDENCE_THRESHOLD;

  // Fast path: project_code → exact match by código (try negocio first, then project)
  if (project_code) {
    const negocio = await findNegocioByCode(supabase, user.workspace_id, project_code);
    if (negocio) {
      const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept || '', categoria, amount);
      if (borrador) {
        await showBorradorMatch(ctx, borrador, negocio, amount, categoria);
      } else if (isHighConfidence) {
        await autoRegisterGasto(ctx, negocio, amount, categoria, concept, 'negocio');
      } else {
        await showGastoDirectoConfirmation(ctx, negocio, amount, categoria, concept, 'negocio');
      }
      return;
    }

    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept || '', categoria, amount);
      if (borrador) {
        await showBorradorMatch(ctx, borrador, project, amount, categoria);
      } else if (isHighConfidence) {
        await autoRegisterGasto(ctx, project, amount, categoria, concept, 'proyecto');
      } else {
        await showGastoDirectoConfirmation(ctx, project, amount, categoria, concept, 'proyecto');
      }
      return;
    }
    // Code not found — fall through to entity_hint or show all
    await ctx.sendMessage(`⚠️ No encontré ningún negocio activo con código ${project_code}.`);
  }

  if (!entity_hint) {
    // No hint — show list of active negocios + projects
    const destinos = await findActiveDestinos(supabase, user.workspace_id);
    if (destinos.all.length === 0) {
      await ctx.sendMessage('No tienes negocios activos. ¿Lo registro como gasto de empresa?');
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

    const options = destinos.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
      _tipo: d._tipo,
    }));
    options.push({ id: 'operativo', label: '🏢 Gasto de empresa', _tipo: 'empresa' as any });

    await ctx.sendOptions(
      `💰 ${formatCOP(amount)} en ${concept || categoria}. ¿Para cuál?`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options,
    });
    return;
  }

  // Find matching destinos (negocios + projects)
  const destinos = await findDestinos(supabase, user.workspace_id, entity_hint);

  if (destinos.all.length === 0) {
    // No match — show active destinos
    const allActive = await findActiveDestinos(supabase, user.workspace_id);
    if (allActive.all.length === 0) {
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

    const options = allActive.all.slice(0, 4).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
      _tipo: d._tipo,
    }));
    options.push({ id: 'operativo', label: '🏢 Gasto de empresa', _tipo: 'empresa' as any });

    await ctx.sendOptions(
      `❌ No encontré "${entity_hint}". Tus negocios:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO_DIRECTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options,
    });
    return;
  }

  if (destinos.all.length === 1) {
    // Single match — go direct to confirmation
    const d = destinos.all[0];
    const tipo = d._tipo;
    const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept || '', categoria, amount);
    if (borrador) {
      await showBorradorMatch(ctx, borrador, d, amount, categoria);
    } else if (isHighConfidence) {
      await autoRegisterGasto(ctx, d, amount, categoria, concept, tipo);
    } else {
      await showGastoDirectoConfirmation(ctx, d, amount, categoria, concept, tipo);
    }
    return;
  }

  // Multiple matches
  const options = destinos.all.slice(0, 5).map((d: any) => ({
    id: d.proyecto_id || d.id,
    label: formatProject(d),
    _tipo: d._tipo,
  }));

  await ctx.sendOptions(
    `💰 ${formatCOP(amount)} en ${concept || categoria}. ¿Cuál?`,
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    amount, categoria, parsed_fields: parsed.fields, options,
  });
}

export async function showGastoDirectoConfirmation(ctx: HandlerContext, entity: any, amount: number, categoria: string, concept?: string, tipo: string = 'proyecto'): Promise<void> {
  const presupuesto = Number(entity.presupuesto_total) || 0;
  const costoActual = Number(entity.costo_acumulado) || 0;
  const costoNuevo = costoActual + amount;
  const pctNuevo = presupuesto > 0 ? (costoNuevo / presupuesto) * 100 : 0;

  let msg = `📁 ${bold(formatProject(entity))}\n💰 ${formatCOP(amount)} — ${CATEGORIA_LABELS[categoria] || categoria}`;
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
  const entityId = entity.proyecto_id || entity.id;
  await ctx.updateSession('confirming', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: tipo === 'proyecto' ? entityId : undefined,
    negocio_id: tipo === 'negocio' ? entityId : undefined,
    proyecto_nombre: entity.nombre,
    destino_tipo: tipo,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
  });
}

/** Auto-register gasto without confirmation (high confidence, single match) */
async function autoRegisterGasto(ctx: HandlerContext, entity: any, amount: number, categoria: string, concept?: string, tipo: string = 'proyecto'): Promise<void> {
  const entityId = entity.proyecto_id || entity.id;
  await ctx.updateSession('confirming', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: tipo === 'proyecto' ? entityId : undefined,
    negocio_id: tipo === 'negocio' ? entityId : undefined,
    proyecto_nombre: entity.nombre,
    destino_tipo: tipo,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
  });
  await executeRegistro(ctx);
}

export async function showBorradorMatch(ctx: HandlerContext, borrador: any, entity: any, amount: number, categoria: string): Promise<void> {
  const diff = amount - Number(borrador.monto_esperado);
  const msg = `🔄 Encontré un gasto fijo pendiente similar:\n\nBorrador: ${bold(borrador.nombre)} — ${formatCOP(Number(borrador.monto_esperado))} esperado\nTu gasto: ${formatCOP(amount)}${diff !== 0 ? ` (diferencia: ${formatCOP(diff)})` : ' ✅ Coincide'}`;

  const options = [
    `Es el mismo gasto fijo (confirmar con ${formatCOP(amount)})`,
    `Es un gasto aparte de ${bold(entity.nombre)}`,
    'Cancelar',
  ];

  await ctx.sendOptions(msg, options);
  await ctx.updateSession('awaiting_selection', {
    intent: 'GASTO_DIRECTO', pending_action: 'W01',
    proyecto_id: entity.proyecto_id || entity.id, proyecto_nombre: entity.nombre,
    amount, categoria, borrador_id: borrador.id,
    options: [
      { id: 'borrador', label: 'Confirmar borrador' },
      { id: 'nuevo', label: 'Gasto aparte' },
      { id: 'cancelar', label: 'Cancelar' },
    ],
  });
}
