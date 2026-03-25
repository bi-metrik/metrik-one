// ============================================================
// Execute — Persist to Database (W01, W02, W03, W04, W06, W32)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS, STREAK_MILESTONES } from '../../types.ts';
import { formatCOP, formatPct, bold, formatProject } from '../../wa-format.ts';
import { completeSession } from '../../wa-session.ts';
import { downloadAndStoreImage } from '../../wa-media.ts';

export async function executeRegistro(ctx: HandlerContext): Promise<void> {
  const { session, supabase } = ctx;
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

/** Build a clean title for a gasto: use NLP concept if short, else "[Categoria] — [Monto]" */
function buildGastoTitle(concept: string | undefined, categoria: string, amount: number): string {
  const categoriaLabel = CATEGORIA_LABELS[categoria] || categoria;
  if (concept && concept.length <= 40) return concept;
  const montoStr = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(amount);
  return `${categoriaLabel} — ${montoStr}`;
}

async function executeW01(ctx: HandlerContext): Promise<boolean> {
  const { supabase, user, session } = ctx;
  const c = session.context;
  const titulo = buildGastoTitle(c.parsed_fields?.concept, c.categoria || 'otros', c.amount!);

  const { data: gasto, error } = await supabase.from('gastos').insert({
    workspace_id: user.workspace_id,
    proyecto_id: c.proyecto_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: titulo,
    notas: c.parsed_fields?.mensaje_original || null,
    tipo: 'directo',
    canal_registro: 'whatsapp',
    created_by_wa_name: user.name,
    soporte_pendiente: true,
    created_by: user.user_id ?? null,
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
    msg = `✅ ${formatCOP(c.amount!)} registrado en ${bold(formatProject(project))}.\n📊 Presupuesto: ${formatCOP(Number(project.costo_acumulado))} / ${formatCOP(Number(project.presupuesto_total))} (${formatPct(Number(project.presupuesto_consumido_pct))})`;
  } else {
    msg = `✅ ${formatCOP(c.amount!)} registrado en ${bold(c.proyecto_nombre || 'proyecto')}.`;
  }

  await ctx.sendMessage(msg);
  await ctx.sendButtons('📷 ¿Tienes soporte fotográfico?', [
    { id: 'btn_despues', title: '⏰ Después' },
  ]);
  await ctx.updateSession('awaiting_image', { gasto_id: gasto?.id });
  return true;
}

async function executeW02(ctx: HandlerContext): Promise<boolean> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  if (c.borrador_id) {
    // Confirm borrador — no soporte needed for fixed expenses
    await executeBorradorConfirmation(ctx);
    return false;
  }

  const titulo = buildGastoTitle(c.parsed_fields?.concept, c.categoria || 'otros', c.amount!);
  const { data: gasto, error } = await supabase.from('gastos').insert({
    workspace_id: user.workspace_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: titulo,
    notas: c.parsed_fields?.mensaje_original || null,
    tipo: 'empresa',
    canal_registro: 'whatsapp',
    created_by_wa_name: user.name,
    soporte_pendiente: true,
    created_by: user.user_id ?? null,
  }).select().single();

  if (error) throw error;

  // D103: Enriched response with monthly accumulated
  const { data: acumulado } = await supabase
    .from('gastos')
    .select('monto')
    .eq('workspace_id', user.workspace_id)
    .is('proyecto_id', null)
    .gte('fecha', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));

  const totalMes = (acumulado || []).reduce((sum: number, g: any) => sum + Number(g.monto), 0);

  const msg = `✅ Gasto empresa: ${formatCOP(c.amount!)} — ${CATEGORIA_LABELS[c.categoria || 'otros'] || c.categoria}\n📊 Total empresa este mes: ${formatCOP(totalMes)}`;
  await ctx.sendMessage(msg);
  await ctx.sendButtons('📷 ¿Tienes soporte fotográfico?', [
    { id: 'btn_despues', title: '⏰ Después' },
  ]);
  await ctx.updateSession('awaiting_image', { gasto_id: gasto?.id });
  return true;
}

export async function executeBorradorConfirmation(ctx: HandlerContext): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  // Create gasto from borrador
  const titulo = buildGastoTitle(c.parsed_fields?.concept, c.categoria || 'otros', c.amount!);
  const { data: gasto, error } = await supabase.from('gastos').insert({
    workspace_id: user.workspace_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: titulo,
    notas: c.parsed_fields?.mensaje_original || null,
    tipo: 'fijo',
    canal_registro: 'whatsapp',
    created_by_wa_name: user.name,
    gasto_fijo_ref_id: c.borrador_id,
    created_by: user.user_id ?? null,
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
    descripcion: c.parsed_fields?.concept || CATEGORIA_LABELS[c.categoria || ''] || c.categoria || '',
    mensaje_original: c.parsed_fields?.mensaje_original || null,
    canal_registro: 'whatsapp',
    created_by_wa_name: user.name,
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
    const msg = `✅ ${c.parsed_fields?.hours}h en ${bold(formatProject(project))}.\n📊 Horas: ${Number(project.horas_reales)} / ${Number(project.horas_estimadas)}h (${formatPct(horasPct)})`;
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
    created_by_wa_name: user.name,
    mensaje_original: c.parsed_fields?.mensaje_original || null,
    created_by: user.user_id ?? null,
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

// Re-export for resume handler
export { downloadAndStoreImage };
