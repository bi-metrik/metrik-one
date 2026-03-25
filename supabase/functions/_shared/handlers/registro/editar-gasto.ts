// ============================================================
// W33 — Editar Gasto (§4 — EDITAR_GASTO)
// Permite corregir monto, categoría o proyecto de los últimos 5 gastos del día.
// Roles permitidos: owner, admin, operator, supervisor (no read_only, no contador)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { CATEGORIA_LABELS } from '../../types.ts';
import { formatCOP, bold } from '../../wa-format.ts';
import { completeSession } from '../../wa-session.ts';

const EDITAR_CAMPO_OPTIONS = [
  { id: 'monto', label: '💵 Monto' },
  { id: 'categoria', label: '🏷️ Categoría' },
  { id: 'proyecto', label: '📁 Proyecto' },
  { id: 'cancelar', label: '❌ Cancelar' },
];

export async function handleEditarGasto(ctx: HandlerContext): Promise<void> {
  const { user, supabase, session } = ctx;

  // Permission check: only owner, admin, operator, supervisor
  const rolesPermitidos = ['owner', 'admin', 'operator', 'supervisor'];
  if (!rolesPermitidos.includes(user.role)) {
    await ctx.sendMessage('❌ No tienes permiso para editar gastos.');
    return;
  }

  // If resuming mid-flow
  if (session.state !== 'started') {
    await handleResumeEditarGasto(ctx);
    return;
  }

  // Fetch last 5 gastos of today for this workspace
  const today = new Date().toISOString().slice(0, 10);
  const { data: gastos, error } = await supabase
    .from('gastos')
    .select('id, descripcion, monto, categoria, proyecto_id, proyectos(nombre)')
    .eq('workspace_id', user.workspace_id)
    .gte('fecha', today)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error || !gastos || gastos.length === 0) {
    await ctx.sendMessage('❌ No encontré gastos registrados hoy. Usa la app para editar gastos de otros días.');
    return;
  }

  const options = gastos.map((g: any) => {
    const cat = CATEGORIA_LABELS[g.categoria] || g.categoria;
    const proj = g.proyectos?.nombre ? ` (${g.proyectos.nombre})` : '';
    return {
      id: g.id,
      label: `${g.descripcion || cat} — ${formatCOP(Number(g.monto))}${proj}`,
    };
  });

  await ctx.sendOptions(
    '✏️ ¿Cuál gasto quieres corregir?',
    options.map((o) => o.label),
  );
  await ctx.updateSession('awaiting_selection', {
    intent: 'EDITAR_GASTO',
    pending_action: 'W33',
    options,
    awaiting_since: new Date().toISOString(),
  });
}

// ============================================================
// Resume handler
// ============================================================

async function handleResumeEditarGasto(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase } = ctx;
  const context = session.context;
  const text = message.text.trim().toLowerCase();

  // Step 1: User selects which gasto to edit
  if (session.state === 'awaiting_selection' && context.pending_action === 'W33' && !context.gasto_id) {
    const options = context.options || [];
    const btnId = message.interactive_reply;
    const btnMatch = btnId ? options.find((o: any) => o.id === btnId) : null;
    const num = parseInt(text);
    const selected = btnMatch || (!isNaN(num) && num >= 1 && num <= options.length ? options[num - 1] : null);

    if (!selected) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    if (selected.id === 'cancelar') {
      await ctx.sendMessage('❌ Cancelado.');
      await completeSession(supabase, session.id);
      return;
    }

    // Show what to change
    await ctx.sendOptions(
      `✏️ Gasto: ${bold(selected.label)}\n¿Qué quieres cambiar?`,
      EDITAR_CAMPO_OPTIONS.map((o) => o.label),
    );
    await ctx.updateSession('awaiting_selection', {
      gasto_id: selected.id,
      gasto_label: selected.label,
      options: EDITAR_CAMPO_OPTIONS,
      awaiting_since: new Date().toISOString(),
    });
    return;
  }

  // Step 2: User selects which field to change
  if (session.state === 'awaiting_selection' && context.pending_action === 'W33' && context.gasto_id && !context.campo_editar) {
    const options = context.options || EDITAR_CAMPO_OPTIONS;
    const btnId = message.interactive_reply;
    const btnMatch = btnId ? options.find((o: any) => o.id === btnId) : null;
    const num = parseInt(text);
    const selected = btnMatch || (!isNaN(num) && num >= 1 && num <= options.length ? options[num - 1] : null);

    if (!selected) {
      await ctx.sendMessage(`Responde con un número del 1 al ${options.length}.`);
      return;
    }

    if (selected.id === 'cancelar') {
      await ctx.sendMessage('❌ Cancelado.');
      await completeSession(supabase, session.id);
      return;
    }

    // Ask for new value
    const prompts: Record<string, string> = {
      monto: '💵 ¿Cuál es el nuevo monto? (ej: 250000 o 250K)',
      categoria: `🏷️ ¿Cuál categoría?\n${Object.entries(CATEGORIA_LABELS).map(([k, v], i) => `${i + 1}. ${v}`).join('\n')}`,
      proyecto: '📁 Escribe el nombre del proyecto al que pertenece este gasto.',
    };

    await ctx.sendMessage(prompts[selected.id] || '¿Cuál es el nuevo valor?');
    await ctx.updateSession('collecting', {
      campo_editar: selected.id,
      options: undefined,
    });
    return;
  }

  // Step 3: User provides new value
  if (session.state === 'collecting' && context.pending_action === 'W33' && context.campo_editar) {
    await applyEdit(ctx, message.text.trim());
    return;
  }
}

// ============================================================
// Apply the edit to Supabase
// ============================================================

async function applyEdit(ctx: HandlerContext, rawInput: string): Promise<void> {
  const { supabase, user, session } = ctx;
  const { gasto_id, campo_editar, gasto_label } = session.context as any;

  const updateData: Record<string, unknown> = {};
  let confirmMsg = '';

  if (campo_editar === 'monto') {
    // Parse monto — accept "250K", "250.000", "250000"
    const cleaned = rawInput.replace(/[.\s]/g, '').replace(/k$/i, '000');
    const monto = parseFloat(cleaned);
    if (isNaN(monto) || monto <= 0) {
      await ctx.sendMessage('❌ Monto inválido. Escríbelo así: 250000 o 250K');
      return;
    }
    updateData.monto = monto;
    confirmMsg = `💵 Monto actualizado a ${formatCOP(monto)}`;
  } else if (campo_editar === 'categoria') {
    // Accept number (1-N) or category key/label
    const categorias = Object.keys(CATEGORIA_LABELS);
    const num = parseInt(rawInput);
    let categoria: string | null = null;
    if (!isNaN(num) && num >= 1 && num <= categorias.length) {
      categoria = categorias[num - 1];
    } else {
      // Try fuzzy match on label or key
      const lower = rawInput.toLowerCase();
      categoria = categorias.find((k) =>
        k.includes(lower) || CATEGORIA_LABELS[k].toLowerCase().includes(lower)
      ) || null;
    }
    if (!categoria) {
      await ctx.sendMessage('❌ Categoría no reconocida. Responde con un número del 1 al ' + categorias.length + '.');
      return;
    }
    updateData.categoria = categoria;
    confirmMsg = `🏷️ Categoría actualizada a ${CATEGORIA_LABELS[categoria]}`;
  } else if (campo_editar === 'proyecto') {
    // Find project by name in this workspace
    const { data: proyectos } = await supabase
      .from('proyectos')
      .select('id, nombre')
      .eq('workspace_id', user.workspace_id)
      .ilike('nombre', `%${rawInput}%`)
      .limit(3);

    if (!proyectos || proyectos.length === 0) {
      await ctx.sendMessage(`❌ No encontré proyecto con "${rawInput}". Verifica el nombre.`);
      return;
    }

    const proyecto = proyectos[0];
    updateData.proyecto_id = proyecto.id;
    confirmMsg = `📁 Proyecto actualizado a ${bold(proyecto.nombre)}`;
  }

  if (Object.keys(updateData).length === 0) {
    await ctx.sendMessage('❌ No se pudo aplicar el cambio.');
    await completeSession(supabase, session.id);
    return;
  }

  const { error } = await supabase
    .from('gastos')
    .update(updateData)
    .eq('id', gasto_id)
    .eq('workspace_id', user.workspace_id);

  if (error) {
    console.error('[editar-gasto] Update error:', error);
    await ctx.sendMessage('❌ No pude guardar el cambio. Intenta desde la app.');
  } else {
    await ctx.sendMessage(`✅ ${confirmMsg}\n\nGasto: ${gasto_label}`);
  }

  await completeSession(supabase, session.id);
}
