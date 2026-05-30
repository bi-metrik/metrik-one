// ============================================================
// Execute — Persist to Database (MVP: W01 GASTO + W06 CONTACTO)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
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
      case 'W06': await executeW06(ctx); break;
    }
  } catch (err) {
    console.error(`[registro] Execute ${action} error:`, err);
    await ctx.sendMessage('❌ Ocurrió un error al registrar. Intenta de nuevo.');
  }

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
  const tipo = c.destino_tipo === 'empresa' ? 'empresa' : 'directo';

  const insertData: Record<string, unknown> = {
    workspace_id: user.workspace_id,
    monto: c.amount,
    categoria: c.categoria || 'otros',
    descripcion: titulo,
    mensaje_original: c.parsed_fields?.mensaje_original || null,
    tipo,
    canal_registro: 'whatsapp',
    created_by_wa_name: user.name,
    soporte_pendiente: true,
    created_by: user.user_id ?? null,
  };

  if (c.negocio_id) {
    insertData.negocio_id = c.negocio_id;
  } else if (c.proyecto_id) {
    insertData.proyecto_id = c.proyecto_id;
  }

  const { data: gasto, error } = await supabase.from('gastos').insert(insertData).select().single();
  if (error) throw error;

  let msg: string;
  if (c.destino_tipo === 'empresa') {
    msg = `✅ Gasto empresa: ${formatCOP(c.amount!)} — ${CATEGORIA_LABELS[c.categoria || 'otros'] || c.categoria}`;
  } else if (c.proyecto_id) {
    const { data: project } = await supabase
      .from('v_proyecto_financiero')
      .select('*')
      .eq('proyecto_id', c.proyecto_id)
      .single();

    if (project) {
      msg = `✅ ${formatCOP(c.amount!)} registrado en ${bold(formatProject(project))}.\n📊 Presupuesto: ${formatCOP(Number(project.costo_acumulado))} / ${formatCOP(Number(project.presupuesto_total))} (${formatPct(Number(project.presupuesto_consumido_pct))})`;
    } else {
      msg = `✅ ${formatCOP(c.amount!)} registrado en ${bold(c.proyecto_nombre || 'negocio')}.`;
    }
  } else {
    msg = `✅ ${formatCOP(c.amount!)} registrado en ${bold(c.proyecto_nombre || 'negocio')}.`;
  }

  await ctx.sendMessage(msg);
  await ctx.sendButtons('📷 ¿Tienes soporte fotográfico?', [
    { id: 'btn_despues', title: '⏰ Después' },
  ]);
  await ctx.updateSession('awaiting_image', { gasto_id: gasto?.id });
  return true;
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

// Re-export for resume handler
export { downloadAndStoreImage };
