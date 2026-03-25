// ============================================================
// Handler: Consulta — W14, W15, W16, W17, W19
// ============================================================

import type { HandlerContext } from '../types.ts';
import { PIPELINE_STAGE_LABELS, STREAK_MILESTONES } from '../types.ts';
import { formatCOP, formatCOPShort, formatPct, bold, formatAgo, daysSince, currentMonthName, currentYear, formatProject } from '../wa-format.ts';
import { findProjects, findContacts } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

export async function handleConsulta(ctx: HandlerContext): Promise<void> {
  const { parsed } = ctx;

  switch (parsed.intent) {
    case 'ESTADO_PROYECTO': await handleEstadoProyecto(ctx); break;
    case 'ESTADO_PIPELINE': await handleEstadoPipeline(ctx); break;
    case 'MIS_NUMEROS': await handleMisNumeros(ctx); break;
    case 'CARTERA': await handleCartera(ctx); break;
    case 'INFO_CONTACTO': await handleInfoContacto(ctx); break;
  }

  await completeSession(ctx.supabase, ctx.session.id);
}

// ============================================================
// W14 — Estado de Proyecto (§10)
// ============================================================

async function handleEstadoProyecto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint } = parsed.fields;

  if (!entity_hint) {
    // List active projects
    const { data: projects } = await supabase
      .from('v_proyecto_financiero')
      .select('*')
      .eq('workspace_id', user.workspace_id)
      .eq('estado', 'en_ejecucion')
      .order('updated_at', { ascending: false })
      .limit(5);

    if (!projects || projects.length === 0) {
      await ctx.sendMessage('No tienes proyectos activos.');
      return;
    }

    const list = projects.map((p: any, i: number) =>
      `${i + 1}️⃣ ${formatProject(p)} — ${formatPct(Number(p.avance_porcentaje))} avance`
    ).join('\n');

    await ctx.sendMessage(`📁 Tus proyectos activos:\n\n${list}\n\n¿Cuál quieres consultar? Responde con el número.`);
    return;
  }

  const projects = await findProjects(supabase, user.workspace_id, entity_hint);

  if (projects.length === 0) {
    await ctx.sendMessage(`❌ No encontré proyecto con "${entity_hint}".`);
    return;
  }

  const p = projects[0];
  const horasPct = Number(p.horas_estimadas) > 0
    ? (Number(p.horas_reales) / Number(p.horas_estimadas)) * 100
    : 0;

  let msg = `📁 ${bold(formatProject(p))}`;
  msg += `\n⏱️ ${Number(p.horas_reales) || 0}/${Number(p.horas_estimadas) || 0}h (${formatPct(horasPct)})`;
  msg += `\n💰 ${formatCOP(Number(p.costo_acumulado))}/${formatCOP(Number(p.presupuesto_total))} (${formatPct(Number(p.presupuesto_consumido_pct))})`;
  const facturado = Number(p.facturado);
  const cobrado = Number(p.cobrado);
  if (facturado > 0 || cobrado > 0) {
    msg += `\n📄 Fact: ${formatCOPShort(facturado)} · Cobr: ${formatCOPShort(cobrado)} · Cart: ${formatCOPShort(facturado - cobrado)}`;
  }

  // Warning if hours ahead of progress
  const { data: proyecto } = await supabase.from('proyectos').select('avance_porcentaje').eq('id', p.id).single();
  const avance = proyecto?.avance_porcentaje || 0;

  if (horasPct > avance + 20 && avance > 0) {
    msg += `\n⚠️ Horas (${formatPct(horasPct)}) > avance (${avance}%)`;
  }

  await ctx.sendMessage(msg);
}

// ============================================================
// W15 — Estado Pipeline (§10)
// ============================================================

async function handleEstadoPipeline(ctx: HandlerContext): Promise<void> {
  const { user, supabase } = ctx;

  const { data: opps } = await supabase
    .from('oportunidades')
    .select('etapa, valor_estimado, probabilidad, descripcion, updated_at')
    .eq('workspace_id', user.workspace_id)
    .not('etapa', 'in', '(ganada,perdida)')
    .order('updated_at', { ascending: false });

  if (!opps || opps.length === 0) {
    await ctx.sendMessage('📊 Tu pipeline está vacío. ¿Quieres agregar una oportunidad desde la app?');
    return;
  }

  // Group by stage
  const stages: Record<string, { count: number; value: number }> = {};
  let totalValue = 0;
  let weightedValue = 0;

  for (const o of opps) {
    if (!stages[o.etapa]) stages[o.etapa] = { count: 0, value: 0 };
    stages[o.etapa].count++;
    stages[o.etapa].value += Number(o.valor_estimado || 0);
    totalValue += Number(o.valor_estimado || 0);
    weightedValue += Number(o.valor_estimado || 0) * (Number(o.probabilidad) / 100);
  }

  let msg = `📊 Pipeline: ${opps.length} oportunidades\n`;
  const stageOrder = ['lead_nuevo', 'contacto_inicial', 'discovery_hecha', 'propuesta_enviada', 'negociacion'];

  for (const stage of stageOrder) {
    const s = stages[stage];
    if (s) {
      msg += `\n${PIPELINE_STAGE_LABELS[stage]}: ${s.count} · ${formatCOPShort(s.value)}`;
    }
  }

  msg += `\n\n💰 Total: ${formatCOPShort(totalValue)} · Pond: ${formatCOPShort(weightedValue)}`;

  // Stale opportunities (>10 days without activity)
  const stale = opps.filter((o: any) => daysSince(o.updated_at) > 10);
  if (stale.length > 0) {
    msg += `\n⚠️ ${bold(stale[0].descripcion)} sin mov. ${daysSince(stale[0].updated_at)}d`;
  }

  await ctx.sendMessage(msg);
}

// ============================================================
// W16 — Mis Números (§10, v2.0 con conciliación)
// ============================================================

async function handleMisNumeros(ctx: HandlerContext): Promise<void> {
  const { user, supabase } = ctx;
  const mesInicio = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const mesFin = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString().slice(0, 10);

  // Cobros del mes
  const { data: cobros } = await supabase
    .from('cobros')
    .select('monto')
    .eq('workspace_id', user.workspace_id)
    .gte('fecha', mesInicio)
    .lt('fecha', mesFin);
  const totalCobros = (cobros || []).reduce((s: number, c: any) => s + Number(c.monto), 0);

  // Gastos del mes
  const { data: gastos } = await supabase
    .from('gastos')
    .select('monto')
    .eq('workspace_id', user.workspace_id)
    .gte('fecha', mesInicio)
    .lt('fecha', mesFin);
  const totalGastos = (gastos || []).reduce((s: number, g: any) => s + Number(g.monto), 0);

  const utilidad = totalCobros - totalGastos;
  const impuestos = utilidad * 0.2; // ~20% provision
  const disponible = utilidad - impuestos;

  // Saldo banco
  const { data: saldo } = await supabase
    .from('saldos_banco')
    .select('saldo_real, diferencia, fecha')
    .eq('workspace_id', user.workspace_id)
    .order('fecha', { ascending: false })
    .limit(1)
    .single();

  // Streak — graceful fallback if table missing or no record
  let streak: { semanas_actuales: number; semanas_record: number } | null = null;
  try {
    const { data: streakData } = await supabase
      .from('streaks')
      .select('semanas_actuales, semanas_record')
      .eq('workspace_id', user.workspace_id)
      .eq('tipo', 'conciliacion')
      .maybeSingle();
    streak = streakData;
  } catch {
    // Table may not exist yet — skip streak block silently
  }

  let msg = `📊 ${currentMonthName()} ${currentYear()}`;

  // Bank balance
  if (saldo) {
    const dias = daysSince(saldo.fecha);
    const diff = Number(saldo.diferencia);
    if (dias > 7) {
      msg += `\n🏦 ${formatCOPShort(Number(saldo.saldo_real))} (${formatAgo(dias)}) ⚠️ Actualiza`;
    } else {
      const diffIcon = Math.abs(diff) <= 50000 ? '✅' : `⚠️ Dif: ${formatCOPShort(diff)}`;
      msg += `\n🏦 ${formatCOP(Number(saldo.saldo_real))} ${diffIcon}`;
    }
  }

  msg += `\n💵 Ingresos: ${formatCOPShort(totalCobros)} · Gastos: ${formatCOPShort(totalGastos)}`;
  msg += `\n📈 Utilidad: ${formatCOPShort(utilidad)} · Disp: ~${formatCOPShort(disponible)}`;

  // Runway
  if (saldo && totalGastos > 0) {
    const runway = Number(saldo.saldo_real) / (totalGastos || 1);
    msg += `\n🏦 Runway: ${runway.toFixed(1)} meses`;
  }

  // Streak
  if (streak && streak.semanas_actuales > 0) {
    const medal = STREAK_MILESTONES[streak.semanas_actuales] || '';
    msg += `\n🏃 Racha: ${streak.semanas_actuales} sem ${medal}`;
  }

  await ctx.sendMessage(msg);
}

// ============================================================
// W17 — Cartera Pendiente (§10)
// ============================================================

async function handleCartera(ctx: HandlerContext): Promise<void> {
  const { user, supabase } = ctx;

  const { data: facturas } = await supabase
    .from('v_facturas_estado')
    .select('*, proyectos!inner(nombre)')
    .eq('workspace_id', user.workspace_id)
    .gt('saldo_pendiente', 0)
    .order('dias_antiguedad', { ascending: false });

  if (!facturas || facturas.length === 0) {
    await ctx.sendMessage('✅ No tienes cartera pendiente. ¡Todo cobrado!');
    return;
  }

  const totalCartera = facturas.reduce((s: number, f: any) => s + Number(f.saldo_pendiente), 0);
  const vencidas = facturas.filter((f: any) => Number(f.dias_antiguedad) > 30);

  let msg = '💵 Cartera pendiente:\n';

  for (const [i, f] of facturas.slice(0, 5).entries()) {
    const dias = Number(f.dias_antiguedad);
    const vencida = dias > 30 ? ' ⚠️' : '';
    // Get project name
    const { data: proj } = await supabase.from('proyectos').select('nombre').eq('id', f.proyecto_id).single();
    const projName = proj?.nombre || 'Proyecto';
    msg += `\n${i + 1}️⃣ ${bold(projName)} — ${formatCOP(Number(f.saldo_pendiente))} (${f.numero_factura || 'S/N'}, ${dias} días)${vencida}`;
  }

  msg += `\n\n💰 Total cartera: ${formatCOP(totalCartera)}`;
  if (vencidas.length > 0) {
    msg += `\n⚠️ ${vencidas.length} factura${vencidas.length > 1 ? 's' : ''} con más de 30 días.`;
  }

  await ctx.sendMessage(msg);
}

// ============================================================
// W19 — Info de Contacto (§10)
// ============================================================

async function handleInfoContacto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint } = parsed.fields;

  if (!entity_hint) {
    await ctx.sendMessage('¿De quién necesitas la información?');
    return;
  }

  const contacts = await findContacts(supabase, user.workspace_id, entity_hint);

  if (contacts.length === 0) {
    await ctx.sendMessage(`❌ No encontré contacto con "${entity_hint}".`);
    return;
  }

  const c = contacts[0];
  let msg = `👤 ${bold(c.nombre)}\n`;
  if (c.telefono) msg += `\n📱 ${c.telefono}`;
  if (c.email) msg += `\n📧 ${c.email}`;
  if (c.rol) msg += `\n💼 ${c.rol}`;

  // Check for related projects
  const { data: projects } = await supabase
    .from('proyectos')
    .select('nombre, estado')
    .eq('contacto_id', c.id)
    .eq('workspace_id', user.workspace_id)
    .limit(3);

  if (projects && projects.length > 0) {
    msg += '\n\n📁 Proyectos:';
    for (const p of projects) {
      msg += ` ${p.nombre} (${p.estado === 'en_ejecucion' ? 'activo' : p.estado})`;
    }
  }

  // Check for related opportunities
  const { data: opps } = await supabase
    .from('oportunidades')
    .select('descripcion, etapa, valor_estimado')
    .eq('contacto_id', c.id)
    .eq('workspace_id', user.workspace_id)
    .not('etapa', 'in', '(ganada,perdida)')
    .limit(3);

  if (opps && opps.length > 0) {
    msg += '\n📋 Pipeline:';
    for (const o of opps) {
      msg += ` ${o.descripcion} (${formatCOPShort(Number(o.valor_estimado))}, ${PIPELINE_STAGE_LABELS[o.etapa] || o.etapa})`;
    }
  }

  await ctx.sendMessage(msg);
}
