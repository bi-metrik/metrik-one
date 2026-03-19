// ============================================================
// W32 — Saldo Bancario (§9A)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { STREAK_MILESTONES } from '../../types.ts';
import { formatCOP, formatPct } from '../../wa-format.ts';

export async function handleSaldoBancario(ctx: HandlerContext): Promise<void> {
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
    const msg = `🏦 ¿Registro tu saldo inicial del banco en ${formatCOP(amount)}?\n\nEs tu primer registro de saldo. A partir de ahora, el sistema calculará la diferencia entre lo que registras y lo que debería haber según tus cobros y gastos.`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
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

  if (Math.abs(diferencia) <= 50000 || pctDiff <= 2) {
    toleranceLabel = '✅ Dentro de tolerancia';
  } else if (Math.abs(diferencia) <= 500000 || pctDiff <= 10) {
    toleranceLabel = '⚠️';
  } else {
    toleranceLabel = '⚠️ Importante';
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
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
    await ctx.updateSession('confirming', {
      intent: 'SALDO_BANCARIO', pending_action: 'W32',
      amount, parsed_fields: { ...parsed.fields, saldo_teorico: saldoTeorico, diferencia },
    });
  }
}
