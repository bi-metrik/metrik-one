// ============================================================
// W04 — Cobro (§7)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { formatCOP, bold, formatProject } from '../../wa-format.ts';
import { findProjects, findProjectByCode, findActiveProjects, findActiveDestinos, findDestinos, findNegocioByCode } from '../../wa-lookup.ts';

export async function handleCobro(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { amount, entity_hint, project_code } = parsed.fields;

  if (!amount || amount <= 0) {
    await ctx.sendMessage('❌ El monto del cobro debe ser mayor a $0.');
    return;
  }

  // Fast path: code → exact match (try negocio first, then project)
  if (project_code) {
    const negocio = await findNegocioByCode(supabase, user.workspace_id, project_code);
    if (negocio) {
      await ctx.updateSession('awaiting_selection', {
        intent: 'COBRO', pending_action: 'W04',
        amount, parsed_fields: parsed.fields,
      });
      await proceedCobroWithProject(ctx, negocio.id, negocio.nombre);
      return;
    }
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      await ctx.updateSession('awaiting_selection', {
        intent: 'COBRO', pending_action: 'W04',
        amount, parsed_fields: parsed.fields,
      });
      await proceedCobroWithProject(ctx, project.proyecto_id, project.nombre);
      return;
    }
    await ctx.sendMessage(`⚠️ No encontré negocio o proyecto activo con código ${project_code}.`);
  }

  if (!entity_hint) {
    await ctx.sendMessage('¿De cuál negocio o cliente recibiste el pago?');
    await ctx.updateSession('collecting', {
      intent: 'COBRO', pending_action: 'W04',
      amount, parsed_fields: parsed.fields,
    });
    return;
  }

  const destinos = await findDestinos(supabase, user.workspace_id, entity_hint);

  if (destinos.all.length === 0) {
    await ctx.sendMessage(`❌ No encontré "${entity_hint}". ¿Puedes escribir el nombre del negocio o cliente?`);
    await ctx.updateSession('collecting', {
      intent: 'COBRO', pending_action: 'W04',
      amount, parsed_fields: parsed.fields,
    });
    return;
  }

  if (destinos.all.length === 1) {
    const d = destinos.all[0];
    await ctx.updateSession('awaiting_selection', {
      intent: 'COBRO', pending_action: 'W04',
      amount, parsed_fields: parsed.fields,
    });
    await proceedCobroWithProject(ctx, d.proyecto_id || d.id, formatProject(d));
    return;
  }

  // Multiple matches
  const cobroOptions = destinos.all.slice(0, 5).map((d: any) => ({
    id: d.proyecto_id || d.id, label: formatProject(d),
  }));
  await ctx.sendOptions(
    `💰 Cobro de ${formatCOP(amount)}. ¿Cuál?`,
    cobroOptions.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'COBRO', pending_action: 'W04',
    amount, parsed_fields: parsed.fields, options: cobroOptions,
  });
}

/** After project is confirmed for cobro, look up invoices and proceed */
export async function proceedCobroWithProject(ctx: HandlerContext, projectId: string, projectName: string): Promise<void> {
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
    const msg = `💰 Cobro de ${formatCOP(amount)} para ${bold(projectName)}.\n\n⚠️ No hay facturas emitidas. Se registra como anticipo.`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
    await ctx.updateSession('confirming', {
      proyecto_id: projectId, proyecto_nombre: projectName,
    });
    return;
  }

  if (facturas.length === 1) {
    const f = facturas[0];
    const saldo = Number(f.saldo_pendiente);
    const isFullPayment = Math.abs(saldo - amount) < 100;
    const msg = `💰 Cobro recibido:\n\n📁 Proyecto: ${bold(projectName)}\n📄 Factura: ${f.numero_factura || '#' + f.factura_id.slice(0, 4)} — Saldo: ${formatCOP(saldo)}\n💵 Cobro: ${formatCOP(amount)} ${isFullPayment ? '✅ Pago completo' : ''}`;
    await ctx.sendButtons(msg, [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ]);
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
