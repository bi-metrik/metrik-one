// ============================================================
// Handler: Consulta — W14, W15, W16, W17, W19
// ============================================================

import type { HandlerContext } from '../types.ts';
import { STREAK_MILESTONES } from '../types.ts';
import { formatCOP, formatCOPShort, formatPct, bold, formatAgo, daysSince, currentMonthName, currentYear, formatProject } from '../wa-format.ts';
import { findContacts, findActiveDestinos, findDestinos, findNegocioByCode, findProjectByCode } from '../wa-lookup.ts';
import { completeSession, saveLastContext } from '../wa-session.ts';

export async function handleConsulta(ctx: HandlerContext): Promise<void> {
  const { parsed } = ctx;

  switch (parsed.intent) {
    case 'ESTADO_PROYECTO': await handleEstadoProyecto(ctx); break;
    case 'ESTADO_NEGOCIOS': await handleEstadoNegocios(ctx); break;
    case 'MIS_NUMEROS': await handleMisNumeros(ctx); break;
    case 'CARTERA': await handleCartera(ctx); break;
    case 'INFO_CONTACTO': await handleInfoContacto(ctx); break;
  }

  await completeSession(ctx.supabase, ctx.session.id);
}

// ============================================================
// W14 — Estado de Proyecto (§10)
// ============================================================

/** Render a single destino (negocio o proyecto) — shared by code-path and hint-path */
async function renderDestino(ctx: HandlerContext, d: any): Promise<void> {
  if (d._tipo === 'negocio') {
    const precio = Number(d.precio_aprobado || d.precio_estimado || 0);
    let msg = `📁 ${bold(formatProject(d))}`;
    msg += `\n📊 Etapa: ${d.stage_actual || 'venta'}`;
    if (precio > 0) msg += `\n💰 Precio: ${formatCOP(precio)}`;
    await ctx.sendMessage(msg);
    return;
  }

  // Project — full financial view
  const p = d;
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
  const { data: proyecto } = await ctx.supabase.from('proyectos').select('avance_porcentaje').eq('id', p.id).single();
  const avance = proyecto?.avance_porcentaje || 0;

  if (horasPct > avance + 20 && avance > 0) {
    msg += `\n⚠️ Horas (${formatPct(horasPct)}) > avance (${avance}%)`;
  }

  await ctx.sendMessage(msg);
}

async function handleEstadoProyecto(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { entity_hint, project_code } = parsed.fields;

  // 1. Fast path: resolve by exact code (negocio first, then project)
  if (project_code) {
    const negocio = await findNegocioByCode(supabase, user.workspace_id, String(project_code));
    if (negocio) {
      await renderDestino(ctx, { ...negocio, _tipo: 'negocio' });
      return;
    }
    const project = await findProjectByCode(supabase, user.workspace_id, project_code);
    if (project) {
      await renderDestino(ctx, { ...project, _tipo: 'proyecto' });
      return;
    }
    // Code not found — tell the user clearly instead of falling into the list
    await ctx.sendMessage(`No encontré ningún negocio o proyecto con código *${project_code}*.`);
    return;
  }

  if (!entity_hint) {
    // List active negocios + projects
    const destinos = await findActiveDestinos(supabase, user.workspace_id);

    if (destinos.all.length === 0) {
      await ctx.sendMessage('No tienes negocios ni proyectos activos.');
      return;
    }

    const list = destinos.all.slice(0, 5).map((d: any, i: number) => {
      const label = formatProject(d);
      const avance = d.avance_porcentaje ? ` — ${formatPct(Number(d.avance_porcentaje))} avance` : '';
      return `${i + 1}️⃣ ${label}${avance}`;
    }).join('\n');

    await ctx.sendMessage(`Tus negocios y proyectos activos:\n\n${list}\n\n¿Cuál quieres consultar? Responde con el número.`);
    return;
  }

  // Search both negocios and projects
  const destinos = await findDestinos(supabase, user.workspace_id, entity_hint);

  if (destinos.all.length === 0) {
    await ctx.sendMessage(`No encontré negocio ni proyecto con "${entity_hint}".`);
    return;
  }

  await renderDestino(ctx, destinos.all[0]);
}

// ============================================================
// W15 — Estado de Negocios (filtrable por stage_actual)
// Sin stage_filter o 'all' → muestra todos los abiertos agrupados por etapa
// Con stage_filter → muestra solo la etapa pedida
// ============================================================

const STAGE_LABELS_PLURAL: Record<string, string> = {
  venta: 'En venta',
  ejecucion: 'En ejecución',
  cobro: 'En cobro',
  cierre: 'En cierre',
};

const STAGE_EMPTY_MSG: Record<string, string> = {
  venta: '📊 No tienes negocios en venta. Escríbeme: "nuevo negocio con [cliente]"',
  ejecucion: '📊 No tienes negocios en ejecución.',
  cobro: '📊 No tienes negocios en cobro.',
  cierre: '📊 No tienes negocios en cierre.',
  all: '📊 No tienes negocios activos. Escríbeme: "nuevo negocio con [cliente]"',
};

async function handleEstadoNegocios(ctx: HandlerContext): Promise<void> {
  const { user, supabase, parsed } = ctx;
  const stageFilter = parsed.fields.stage_filter || 'all';

  let query = supabase
    .from('negocios')
    .select('id, nombre, codigo, precio_estimado, precio_aprobado, stage_actual, updated_at')
    .eq('workspace_id', user.workspace_id)
    .eq('estado', 'abierto')
    .order('updated_at', { ascending: false });

  if (stageFilter !== 'all') {
    query = query.eq('stage_actual', stageFilter);
  }

  const { data: negocios } = await query;

  if (!negocios || negocios.length === 0) {
    await ctx.sendMessage(STAGE_EMPTY_MSG[stageFilter] || STAGE_EMPTY_MSG.all);
    return;
  }

  // Map to LastContextItem format (preserve original order)
  const allItems = negocios.map((n: any) => ({
    id: n.id,
    nombre: n.nombre,
    codigo: n.codigo,
    precio: Number(n.precio_aprobado || n.precio_estimado || 0),
    stage: n.stage_actual,
  }));

  // Single-stage view
  if (stageFilter !== 'all') {
    const totalValue = allItems.reduce((s: number, n: any) => s + n.precio, 0);
    const label = STAGE_LABELS_PLURAL[stageFilter] || stageFilter;
    const shownCount = Math.min(5, allItems.length);
    let msg = `📊 ${label}: ${allItems.length} negocio${allItems.length > 1 ? 's' : ''}`;
    msg += `\n💰 Total: ${formatCOPShort(totalValue)}\n`;
    for (const n of allItems.slice(0, shownCount)) {
      const cod = n.codigo ? ` (${n.codigo})` : '';
      msg += `\n• ${bold(n.nombre)}${cod} — ${formatCOPShort(n.precio)}`;
    }
    if (allItems.length > shownCount) {
      msg += `\n… y ${allItems.length - shownCount} más. Escribe *los otros* para verlos.`;
    }
    // Stale warning only for venta
    if (stageFilter === 'venta') {
      const stale = negocios.filter((n: any) => daysSince(n.updated_at) > 10);
      if (stale.length > 0) {
        const s = stale[0];
        msg += `\n\n⚠️ ${bold(s.nombre)} sin movimiento ${daysSince(s.updated_at)}d`;
      }
    }
    await ctx.sendMessage(msg);
    await saveLastContext(supabase, ctx.session.id, {
      type: 'negocios_list',
      items: allItems,
      shown: shownCount,
      total: allItems.length,
      query_meta: { stage_filter: stageFilter },
    });
    return;
  }

  // Grouped view (stage_filter === 'all')
  // Maintain insertion order per stage for accurate "shown" tracking
  const orderedItems: any[] = [];
  const groups: Record<string, any[]> = { venta: [], ejecucion: [], cobro: [], cierre: [] };
  for (const stage of ['venta', 'ejecucion', 'cobro', 'cierre'] as const) {
    const stageItems = allItems.filter((n: any) => (n.stage || 'venta') === stage);
    groups[stage] = stageItems;
  }

  const totalValue = allItems.reduce((s: number, n: any) => s + n.precio, 0);

  let msg = `📊 ${allItems.length} negocio${allItems.length > 1 ? 's' : ''} activo${allItems.length > 1 ? 's' : ''}`;
  msg += `\n💰 Total: ${formatCOPShort(totalValue)}\n`;

  let shownCount = 0;
  for (const stage of ['venta', 'ejecucion', 'cobro', 'cierre'] as const) {
    const items = groups[stage];
    if (!items || items.length === 0) continue;
    const label = STAGE_LABELS_PLURAL[stage];
    msg += `\n*${label}* (${items.length}):`;
    const perStageShown = Math.min(3, items.length);
    for (const n of items.slice(0, perStageShown)) {
      const cod = n.codigo ? ` (${n.codigo})` : '';
      msg += `\n  • ${n.nombre}${cod} — ${formatCOPShort(n.precio)}`;
      orderedItems.push(n);
      shownCount++;
    }
    if (items.length > perStageShown) {
      msg += `\n  … y ${items.length - perStageShown} más`;
    }
    // Remaining items go to the tail of orderedItems so followup can show them
    for (const n of items.slice(perStageShown)) {
      orderedItems.push(n);
    }
  }

  if (shownCount < allItems.length) {
    msg += `\n\nEscribe *los otros* para ver los ${allItems.length - shownCount} restantes.`;
  }

  await ctx.sendMessage(msg);
  await saveLastContext(supabase, ctx.session.id, {
    type: 'negocios_list',
    items: orderedItems,
    shown: shownCount,
    total: allItems.length,
    query_meta: { stage_filter: 'all' },
  });
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
