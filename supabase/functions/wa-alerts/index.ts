// ============================================================
// wa-alerts — Proactive Alerts Cron (Spec 98F §12)
// W25: Factura vencida, W29: Resumen semanal, W33: Push saldo
// + Streak evaluation (domingo 23:59)
// ============================================================

import { getServiceClient } from '../_shared/supabase-client.ts';
import { sendTextMessage } from '../_shared/wa-respond.ts';
import { checkOutboundAlertLimit, logMessage } from '../_shared/wa-rate-limit.ts';
import {
  formatCOP, formatCOPShort, bold, formatDate, daysSince, formatAgo,
} from '../_shared/wa-format.ts';
import { PIPELINE_STAGE_LABELS, STREAK_MILESTONES } from '../_shared/types.ts';

Deno.serve(async (req) => {
  // This function is triggered by Supabase pg_cron or external cron
  // Accept POST with { action: 'w25' | 'w29' | 'w33' | 'streak_eval' }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { action } = await req.json();
    const supabase = getServiceClient();

    switch (action) {
      case 'w25':
        await runW25FacturaVencida(supabase);
        break;
      case 'w29':
        await runW29ResumenSemanal(supabase);
        break;
      case 'w33':
        await runW33PushSaldo(supabase);
        break;
      case 'streak_eval':
        await runStreakEvaluation(supabase);
        break;
      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400 });
    }

    return new Response(JSON.stringify({ ok: true, action }), { status: 200 });
  } catch (err) {
    console.error('[wa-alerts] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

// ============================================================
// W25 — Factura Vencida (>30 días, recordatorio cada 7 días)
// ============================================================

async function runW25FacturaVencida(supabase: ReturnType<typeof getServiceClient>): Promise<void> {
  console.log('[wa-alerts] Running W25 — Factura Vencida');

  // Find invoices with pending balance > 0 and emitted > 30 days ago
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: overdueInvoices } = await supabase
    .from('facturas')
    .select(`
      id, numero, fecha_emision, saldo_pendiente,
      proyecto:proyectos!inner(nombre, workspace_id),
      contacto:contactos(nombre, telefono)
    `)
    .gt('saldo_pendiente', 0)
    .lt('fecha_emision', thirtyDaysAgo);

  if (!overdueInvoices || overdueInvoices.length === 0) {
    console.log('[wa-alerts] W25: No overdue invoices found');
    return;
  }

  // Group by workspace
  const byWorkspace = new Map<string, typeof overdueInvoices>();
  for (const inv of overdueInvoices) {
    const wsId = (inv.proyecto as any)?.workspace_id;
    if (!wsId) continue;
    if (!byWorkspace.has(wsId)) byWorkspace.set(wsId, []);
    byWorkspace.get(wsId)!.push(inv);
  }

  for (const [workspaceId, invoices] of byWorkspace) {
    // Get owner phone
    const phone = await getOwnerPhone(supabase, workspaceId);
    if (!phone) continue;

    // Check outbound limit
    if (!(await checkOutboundAlertLimit(supabase, phone))) {
      console.log(`[wa-alerts] W25: Rate limit reached for ${phone}`);
      continue;
    }

    // Send one message per overdue invoice (max 3 per run)
    for (const inv of invoices.slice(0, 3)) {
      const dias = daysSince(inv.fecha_emision);
      const proyNombre = (inv.proyecto as any)?.nombre || 'Proyecto';
      const contactoNombre = (inv.contacto as any)?.nombre;

      let msg = `⚠️ Factura vencida:\n\n`;
      msg += `📄 Factura #${inv.numero} — ${bold(proyNombre)}\n`;
      msg += `💰 Saldo: ${formatCOP(Number(inv.saldo_pendiente))}\n`;
      msg += `📅 Emitida: ${formatDate(inv.fecha_emision)} (${formatAgo(dias)})`;

      if (contactoNombre) {
        msg += `\n\n¿Quieres que te recuerde el teléfono de ${contactoNombre} para cobrarle?`;
      }

      await sendTextMessage(phone, msg);
      await logMessage(supabase, phone, 'outbound', workspaceId, 'W25', `Factura #${inv.numero} vencida`);
    }
  }
}

// ============================================================
// W29 — Resumen Semanal (lunes 7am)
// ============================================================

async function runW29ResumenSemanal(supabase: ReturnType<typeof getServiceClient>): Promise<void> {
  console.log('[wa-alerts] Running W29 — Resumen Semanal');

  // Get all active workspaces with Pro+ subscription
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, subscription_status')
    .in('subscription_status', ['active_pro_plus', 'trial']);

  if (!workspaces || workspaces.length === 0) return;

  for (const ws of workspaces) {
    const phone = await getOwnerPhone(supabase, ws.id);
    if (!phone) continue;

    if (!(await checkOutboundAlertLimit(supabase, phone))) continue;

    try {
      const msg = await buildWeeklySummary(supabase, ws.id);
      await sendTextMessage(phone, msg);
      await logMessage(supabase, phone, 'outbound', ws.id, 'W29', 'Resumen semanal');
    } catch (err) {
      console.error(`[wa-alerts] W29 error for workspace ${ws.id}:`, err);
    }
  }
}

async function buildWeeklySummary(
  supabase: ReturnType<typeof getServiceClient>,
  workspaceId: string,
): Promise<string> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const weekAgoStr = weekAgo.toISOString();

  // Date range for header
  const startDate = formatDate(weekAgo);
  const endDate = formatDate(now);

  // --- Cobros this week ---
  const { data: cobrosWeek } = await supabase
    .from('cobros')
    .select('monto')
    .eq('workspace_id', workspaceId)
    .gte('fecha_cobro', weekAgoStr);
  const totalCobros = (cobrosWeek || []).reduce((s: number, c: any) => s + Number(c.monto), 0);

  // --- Gastos this week ---
  const { data: gastosWeek } = await supabase
    .from('gastos')
    .select('monto')
    .eq('workspace_id', workspaceId)
    .gte('fecha', weekAgoStr);
  const totalGastos = (gastosWeek || []).reduce((s: number, g: any) => s + Number(g.monto), 0);

  // --- Horas this week ---
  const { data: horasWeek } = await supabase
    .from('horas')
    .select('cantidad')
    .eq('workspace_id', workspaceId)
    .gte('fecha', weekAgoStr);
  const totalHoras = (horasWeek || []).reduce((s: number, h: any) => s + Number(h.cantidad), 0);

  // --- Bank status ---
  const { data: lastSaldo } = await supabase
    .from('saldos_banco')
    .select('saldo_reportado, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  let bancoLine = '';
  if (lastSaldo) {
    const diasSaldo = daysSince(lastSaldo.created_at);
    if (diasSaldo > 7) {
      bancoLine = `🏦 Banco: ⚠️ ${diasSaldo} días sin actualizar. Escríbeme tu saldo`;
    } else {
      bancoLine = `🏦 Banco: ${formatCOP(Number(lastSaldo.saldo_reportado))} (actualizado ${formatAgo(diasSaldo)})`;
    }
  } else {
    bancoLine = '🏦 Banco: Sin datos. Escríbeme tu saldo para empezar';
  }

  // --- Active projects ---
  const { data: projects } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'en_ejecucion')
    .order('updated_at', { ascending: false })
    .limit(5);

  let projectLines = '';
  if (projects && projects.length > 0) {
    const lines = projects.map((p: any, i: number) => {
      const pct = p.presupuesto_consumido_pct ? `${Math.round(p.presupuesto_consumido_pct)}% avance` : '';
      const prefix = i === projects.length - 1 ? '└' : '├';
      return `${prefix} ${bold(p.nombre)} — ${pct}`;
    });
    projectLines = `📂 Proyectos activos: ${projects.length}\n${lines.join('\n')}`;
  } else {
    projectLines = '📂 Sin proyectos activos';
  }

  // --- Pipeline ---
  const { data: opps } = await supabase
    .from('oportunidades')
    .select('etapa, valor_estimado, descripcion, updated_at')
    .eq('workspace_id', workspaceId)
    .not('etapa', 'in', '("ganada","perdida")');

  let pipelineLine = '';
  let staleLine = '';
  if (opps && opps.length > 0) {
    const totalPipeline = opps.reduce((s: number, o: any) => s + Number(o.valor_estimado || 0), 0);
    pipelineLine = `📋 Pipeline: ${opps.length} oportunidades (${formatCOPShort(totalPipeline)})`;

    // Check stale opps (>10 days without activity)
    const staleOpps = opps.filter((o: any) => daysSince(o.updated_at) > 10);
    if (staleOpps.length > 0) {
      const stale = staleOpps[0];
      staleLine = `⚠️ ${bold(stale.descripcion)} sin actividad ${formatAgo(daysSince(stale.updated_at))}`;
    }
  } else {
    pipelineLine = '📋 Pipeline: sin oportunidades activas';
  }

  // --- Cartera ---
  const { data: cartera } = await supabase
    .from('facturas')
    .select('saldo_pendiente, fecha_emision')
    .eq('workspace_id', workspaceId)
    .gt('saldo_pendiente', 0);

  let carteraLine = '';
  if (cartera && cartera.length > 0) {
    const totalCartera = cartera.reduce((s: number, f: any) => s + Number(f.saldo_pendiente), 0);
    const vencidas = cartera.filter((f: any) => daysSince(f.fecha_emision) > 30).length;
    carteraLine = `💵 Cartera: ${formatCOP(totalCartera)}`;
    if (vencidas > 0) carteraLine += ` (${vencidas} vencida${vencidas > 1 ? 's' : ''} ⚠️)`;
  } else {
    carteraLine = '💵 Cartera: $0';
  }

  // --- Runway (if we have bank + monthly gastos) ---
  let runwayLine = '';
  if (lastSaldo && totalGastos > 0) {
    const monthlyBurn = totalGastos * (30 / 7); // extrapolate weekly to monthly
    const runwayMonths = Number(lastSaldo.saldo_reportado) / monthlyBurn;
    if (runwayMonths > 0 && runwayMonths < 24) {
      runwayLine = `🏦 Runway: ${runwayMonths.toFixed(1)} meses`;
    }
  }

  // --- Streak ---
  const { data: streak } = await supabase
    .from('streaks')
    .select('semanas_actuales, semanas_record')
    .eq('workspace_id', workspaceId)
    .eq('tipo', 'conciliacion')
    .single();

  let streakLine = '';
  if (streak && streak.semanas_actuales > 0) {
    const medal = getStreakMedal(streak.semanas_actuales);
    streakLine = `🏃 Racha conciliación: ${streak.semanas_actuales} semanas ${medal}`;
  }

  // --- Build message ---
  let msg = `📊 Resumen semanal — ${startDate} - ${endDate}\n\n`;
  msg += `💰 Cobros recibidos: ${formatCOP(totalCobros)}\n`;
  msg += `💸 Gastos registrados: ${formatCOP(totalGastos)}\n`;
  msg += `⏱️ Horas trabajadas: ${totalHoras}h\n\n`;
  msg += `${bancoLine}\n\n`;
  msg += `${projectLines}\n\n`;
  msg += pipelineLine;
  if (staleLine) msg += `\n${staleLine}`;
  msg += `\n\n${carteraLine}`;
  if (runwayLine) msg += `\n${runwayLine}`;
  if (streakLine) msg += `\n\n${streakLine}`;
  msg += '\n\n¡Buena semana!';

  return msg;
}

// ============================================================
// W33 — Push Saldo (martes/viernes, si >7 días sin actualizar)
// ============================================================

async function runW33PushSaldo(supabase: ReturnType<typeof getServiceClient>): Promise<void> {
  console.log('[wa-alerts] Running W33 — Push Saldo');

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, subscription_status')
    .in('subscription_status', ['active_pro_plus', 'trial']);

  if (!workspaces || workspaces.length === 0) return;

  for (const ws of workspaces) {
    // Check if saldo was updated in the last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { count } = await supabase
      .from('saldos_banco')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', ws.id)
      .gte('created_at', sevenDaysAgo);

    if ((count ?? 0) > 0) continue; // Updated recently — skip

    // Get last saldo for context
    const { data: lastSaldo } = await supabase
      .from('saldos_banco')
      .select('created_at')
      .eq('workspace_id', ws.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const phone = await getOwnerPhone(supabase, ws.id);
    if (!phone) continue;

    if (!(await checkOutboundAlertLimit(supabase, phone))) continue;

    // Get user name
    const { data: staff } = await supabase
      .from('staff')
      .select('name')
      .eq('workspace_id', ws.id)
      .eq('es_principal', true)
      .limit(1)
      .single();

    const nombre = staff?.name || '';
    const dias = lastSaldo ? daysSince(lastSaldo.created_at) : 0;

    const msg = dias > 0
      ? `Hola ${nombre}, tu saldo del banco tiene ${dias} días sin actualizar. ¿Cuál es tu saldo hoy?\n\nResponde con el monto y lo registro.`
      : `Hola ${nombre}, aún no has registrado tu saldo bancario. ¿Cuál es tu saldo hoy?\n\nResponde con el monto y lo registro.`;

    await sendTextMessage(phone, msg);
    await logMessage(supabase, phone, 'outbound', ws.id, 'W33', `Push saldo (${dias} días)`);
  }
}

// ============================================================
// Streak Evaluation (domingo 23:59)
// ============================================================

async function runStreakEvaluation(supabase: ReturnType<typeof getServiceClient>): Promise<void> {
  console.log('[wa-alerts] Running Streak Evaluation');

  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id')
    .in('subscription_status', ['active_pro_plus', 'trial']);

  if (!workspaces || workspaces.length === 0) return;

  for (const ws of workspaces) {
    // Check if there was at least 1 saldo update this week
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { count } = await supabase
      .from('saldos_banco')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', ws.id)
      .gte('created_at', sevenDaysAgo);

    const hadUpdate = (count ?? 0) > 0;

    // Get current streak
    const { data: streak } = await supabase
      .from('streaks')
      .select('*')
      .eq('workspace_id', ws.id)
      .eq('tipo', 'conciliacion')
      .single();

    if (!streak) {
      // Create streak record
      await supabase.from('streaks').insert({
        workspace_id: ws.id,
        tipo: 'conciliacion',
        semanas_actuales: hadUpdate ? 1 : 0,
        semanas_record: hadUpdate ? 1 : 0,
      });
      continue;
    }

    if (hadUpdate) {
      // Increment streak
      const newCount = streak.semanas_actuales + 1;
      const newRecord = Math.max(newCount, streak.semanas_record);
      await supabase.from('streaks').update({
        semanas_actuales: newCount,
        semanas_record: newRecord,
      }).eq('id', streak.id);
    } else {
      // Break streak
      if (streak.semanas_actuales > 0) {
        await supabase.from('streaks').update({
          semanas_actuales: 0,
        }).eq('id', streak.id);
      }
    }
  }
}

// ============================================================
// Helpers
// ============================================================

/** Get owner's WhatsApp phone for a workspace */
async function getOwnerPhone(
  supabase: ReturnType<typeof getServiceClient>,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('staff')
    .select('phone_whatsapp')
    .eq('workspace_id', workspaceId)
    .eq('es_principal', true)
    .eq('is_active', true)
    .limit(1)
    .single();

  return data?.phone_whatsapp || null;
}

/** Get streak medal emoji for current count */
function getStreakMedal(weeks: number): string {
  let medal = '';
  for (const [threshold, emoji] of Object.entries(STREAK_MILESTONES)) {
    if (weeks >= Number(threshold)) medal = emoji;
  }
  return medal;
}
