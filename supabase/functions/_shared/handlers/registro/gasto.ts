// ============================================================
// W01 — GASTO unificado (MVP)
//
// Antes existían GASTO_DIRECTO y GASTO_OPERATIVO. En el MVP los colapsamos
// a un único intent GASTO. La clasificación variable/fijo/no_operativo la
// decide el form de gasto + trigger DB; el bot solo registra el movimiento
// e intenta asociarlo a un negocio si hay pistas.
//
// Sin matching contra gastos_fijos_borradores (legacy desconectado).
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import { CONFIDENCE_THRESHOLD } from '../../wa-parse.ts';
import { formatCOP, formatPct, bold, formatProject } from '../../wa-format.ts';
import {
  findDestinos,
  findActiveDestinos,
  findProjectByCode,
  findNegocioByCode,
  matchCategory,
} from '../../wa-lookup.ts';
import { executeRegistro } from './execute.ts';
import { proponerCentroCostosWA, type PropuestaCC } from '../../centro-costos.ts';

export async function handleGasto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, entity_hint, concept, category_hint, project_code } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto debe ser mayor a $0. ¿Cuánto fue el gasto?');
    return;
  }

  // Resolve category — trust Gemini's category_hint first, matchCategory() as fallback
  const categoria = category_hint || matchCategory(concept || '') || 'otros';

  const isHighConfidence = parsed.confidence >= CONFIDENCE_THRESHOLD;

  // Fast path: project_code → exact match by código (try negocio first, then project)
  if (project_code) {
    const negocio = await findNegocioByCode(supabase, user.workspace_id, String(project_code));
    if (negocio) {
      if (isHighConfidence) {
        await autoRegisterGasto(ctx, negocio, amount, categoria, concept, 'negocio');
      } else {
        await showGastoConfirmation(ctx, negocio, amount, categoria, concept, 'negocio');
      }
      return;
    }

    const project = await findProjectByCode(supabase, user.workspace_id, String(project_code));
    if (project) {
      if (isHighConfidence) {
        await autoRegisterGasto(ctx, project, amount, categoria, concept, 'proyecto');
      } else {
        await showGastoConfirmation(ctx, project, amount, categoria, concept, 'proyecto');
      }
      return;
    }
    await ctx.sendMessage(`⚠️ No encontré ningún negocio activo con código ${project_code}.`);
  }

  if (!entity_hint) {
    // No hint — show list of active negocios + projects
    const destinos = await findActiveDestinos(supabase, user.workspace_id);
    if (destinos.all.length === 0) {
      // Sin negocios activos → registrar como gasto de empresa
      await proceedEmpresaGasto(ctx, amount, concept || '', categoria);
      return;
    }

    const options = destinos.all.slice(0, 5).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
      _tipo: d._tipo,
    }));
    options.push({ id: 'empresa', label: '🏢 Gasto de empresa', _tipo: 'empresa' as any });

    await ctx.sendOptions(
      `💰 ${formatCOP(amount)} en ${concept || categoria}. ¿Para cuál?`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO', pending_action: 'W01',
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
      await proceedEmpresaGasto(ctx, amount, concept || '', categoria);
      return;
    }

    const options = allActive.all.slice(0, 4).map((d: any) => ({
      id: d.proyecto_id || d.id,
      label: formatProject(d),
      _tipo: d._tipo,
    }));
    options.push({ id: 'empresa', label: '🏢 Gasto de empresa', _tipo: 'empresa' as any });

    await ctx.sendOptions(
      `❌ No encontré "${entity_hint}". Tus negocios:`,
      options.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'GASTO', pending_action: 'W01',
      amount, categoria, parsed_fields: parsed.fields, options,
    });
    return;
  }

  if (destinos.all.length === 1) {
    const d = destinos.all[0];
    const tipo = d._tipo;
    if (isHighConfidence) {
      await autoRegisterGasto(ctx, d, amount, categoria, concept, tipo);
    } else {
      await showGastoConfirmation(ctx, d, amount, categoria, concept, tipo);
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
    intent: 'GASTO', pending_action: 'W01',
    amount, categoria, parsed_fields: parsed.fields, options,
  });
}

/**
 * Resuelve la propuesta de centro de costos para un gasto del bot WA.
 * Si tipo='negocio' o el motor sugiere directa_negocio con el mismo negocio,
 * aplica directa_negocio. Si motor sugiere algo con confianza ≥0.7, aplica.
 * Sino retorna null (gasto entra sin centro_costos asignado, el usuario lo
 * completa después en la app).
 */
async function resolverCentroCostos(
  ctx: HandlerContext,
  args: {
    descripcion: string | undefined;
    negocio_id_destino?: string | null;
    tipo: string;
  },
): Promise<{ centro: PropuestaCC['centro']; origen: PropuestaCC['origen'] }> {
  const { supabase, user, session } = ctx;

  // Caso explícito: el gasto se ata a un negocio → directa_negocio
  if (args.tipo === 'negocio' && args.negocio_id_destino) {
    return { centro: 'directa_negocio', origen: 'sugerido' };
  }

  // Contexto bot: si last_context apuntaba a un negocio reciente
  let contextoBot;
  const lc = session.context.last_context;
  if (
    lc?.type === 'negocios_list' &&
    lc.items.length === 1 &&
    lc.items[0]?.id &&
    lc.created_at
  ) {
    contextoBot = { negocio_id: lc.items[0].id, timestamp: lc.created_at };
  }

  const propuesta = await proponerCentroCostosWA({
    supabase,
    workspaceId: user.workspace_id,
    descripcion: args.descripcion ?? null,
    userId: user.user_id ?? null,
    contextoBot,
  });

  if (propuesta.centro && propuesta.confianza >= 0.7) {
    return { centro: propuesta.centro, origen: propuesta.origen };
  }
  return { centro: null, origen: null };
}

export async function showGastoConfirmation(
  ctx: HandlerContext,
  entity: any,
  amount: number,
  categoria: string,
  concept?: string,
  tipo: string = 'proyecto',
): Promise<void> {
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

  const entityId = entity.proyecto_id || entity.id;
  const negIdForCC = tipo === 'negocio' ? entityId : null;
  const cc = await resolverCentroCostos(ctx, {
    descripcion: concept,
    negocio_id_destino: negIdForCC,
    tipo,
  });

  // Footer descriptivo del centro si aplica
  if (cc.centro) {
    const ccLabel =
      cc.centro === 'directa_negocio'
        ? 'Negocio'
        : cc.centro === 'distribuible_one'
        ? 'ONE'
        : cc.centro === 'distribuible_clarity'
        ? 'Clarity'
        : 'Mixto';
    msg += `\n🏷️ Centro: ${ccLabel}`;
  }

  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'GASTO', pending_action: 'W01',
    proyecto_id: tipo === 'proyecto' ? entityId : undefined,
    negocio_id: tipo === 'negocio' ? entityId : undefined,
    proyecto_nombre: entity.nombre,
    destino_tipo: tipo as any,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
    ...(cc.centro ? { centro_costos: cc.centro } : {}),
    ...(cc.origen ? { origen_asignacion: cc.origen } : {}),
  });
}

/** Auto-register gasto without confirmation (high confidence, single match) */
async function autoRegisterGasto(
  ctx: HandlerContext,
  entity: any,
  amount: number,
  categoria: string,
  concept?: string,
  tipo: string = 'proyecto',
): Promise<void> {
  const entityId = entity.proyecto_id || entity.id;
  const negIdForCC = tipo === 'negocio' ? entityId : null;
  const cc = await resolverCentroCostos(ctx, {
    descripcion: concept,
    negocio_id_destino: negIdForCC,
    tipo,
  });

  await ctx.updateSession('confirming', {
    intent: 'GASTO', pending_action: 'W01',
    proyecto_id: tipo === 'proyecto' ? entityId : undefined,
    negocio_id: tipo === 'negocio' ? entityId : undefined,
    proyecto_nombre: entity.nombre,
    destino_tipo: tipo as any,
    amount, categoria,
    parsed_fields: { ...ctx.parsed.fields, concept },
    ...(cc.centro ? { centro_costos: cc.centro } : {}),
    ...(cc.origen ? { origen_asignacion: cc.origen } : {}),
  });
  await executeRegistro(ctx);
}

/** Confirma un gasto de empresa (sin negocio asociado) */
export async function proceedEmpresaGasto(
  ctx: HandlerContext,
  amount: number,
  concept: string,
  categoria: string,
): Promise<void> {
  const cc = await resolverCentroCostos(ctx, {
    descripcion: concept,
    negocio_id_destino: null,
    tipo: 'empresa',
  });

  let msg = `💰 Gasto de empresa:\n\n💵 ${formatCOP(amount)} — ${CATEGORIA_LABELS[categoria] || categoria}\n📅 Hoy`;

  if (cc.centro) {
    const ccLabel =
      cc.centro === 'directa_negocio'
        ? 'Negocio'
        : cc.centro === 'distribuible_one'
        ? 'ONE'
        : cc.centro === 'distribuible_clarity'
        ? 'Clarity'
        : 'Mixto';
    msg += `\n🏷️ Centro: ${ccLabel}`;
  } else {
    msg += `\n🏷️ Centro: sin asignar (puedes asignarlo después en la app)`;
  }

  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'GASTO', pending_action: 'W01',
    amount, categoria,
    destino_tipo: 'empresa',
    parsed_fields: { concept, mensaje_original: ctx.parsed.fields.mensaje_original },
    ...(cc.centro ? { centro_costos: cc.centro } : {}),
    ...(cc.origen ? { origen_asignacion: cc.origen } : {}),
  });
}
