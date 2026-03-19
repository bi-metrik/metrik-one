// ============================================================
// W02 — Gasto Operativo (§5, v2.1)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { AMBIGUOUS_CATEGORIES, CATEGORIA_LABELS } from '../../types.ts';
import { formatCOP, bold } from '../../wa-format.ts';
import { findActiveProjects, matchCategory, findMatchingBorrador } from '../../wa-lookup.ts';

export async function handleGastoOperativo(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, concept, category_hint } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto debe ser mayor a $0. ¿Cuánto fue el gasto?');
    return;
  }

  const categoria = category_hint || matchCategory(concept || '') || null;

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

export async function proceedGastoOperativo(ctx: HandlerContext, amount: number, concept: string, categoria: string): Promise<void> {
  const { user, supabase } = ctx;

  // Check borrador match
  const borrador = await findMatchingBorrador(supabase, user.workspace_id, concept, categoria, amount);

  if (borrador) {
    const diff = amount - Number(borrador.monto_esperado);
    const matchLabel = diff === 0 ? '✅ Coincide' : `diferencia: ${formatCOP(diff)}`;

    let msg = `🔄 Confirmo gasto fijo del mes:\n\n📋 ${bold(borrador.nombre)} — Esperado: ${formatCOP(Number(borrador.monto_esperado))}\n💰 Tu pago: ${formatCOP(amount)} ${matchLabel}`;

    if (diff === 0 || Math.abs(diff) / Number(borrador.monto_esperado) < 0.2) {
      await ctx.sendButtons(msg, [
        { id: 'btn_confirm', title: '✅ Confirmar' },
        { id: 'btn_cancel', title: '❌ Cancelar' },
      ]);
      await ctx.updateSession('confirming', {
        intent: 'GASTO_OPERATIVO', pending_action: 'W02',
        amount, categoria, borrador_id: borrador.id,
        parsed_fields: { concept, mensaje_original: ctx.parsed.fields.mensaje_original },
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
        parsed_fields: { concept, mensaje_original: ctx.parsed.fields.mensaje_original },
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
  const msg = `💰 Gasto de empresa:\n\n💵 ${formatCOP(amount)} — ${CATEGORIA_LABELS[categoria] || categoria}\n📅 Hoy`;
  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'GASTO_OPERATIVO', pending_action: 'W02',
    amount, categoria,
    parsed_fields: { concept, mensaje_original: ctx.parsed.fields.mensaje_original },
  });
}
