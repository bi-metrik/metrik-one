// ============================================================
// Handler: ACTIVIDAD — log a comentario contra activity_log de un negocio
//
// Resolución de negocio por cascada:
//   (a) detección por texto (project_code o entity_hint de empresa/negocio)
//   (b) last_context < 5 min con un solo negocio activo → vincular automáticamente
//   (c) top-3 negocios abiertos del usuario por updated_at + opción "Otro"
// ============================================================

import type { HandlerContext } from '../types.ts';
import { bold } from '../wa-format.ts';
import { findNegocios, findNegocioByCode, findActiveNegocios } from '../wa-lookup.ts';
import { completeSession } from '../wa-session.ts';

const LAST_CONTEXT_TTL_MS = 5 * 60 * 1000; // 5 min

export async function handleActividad(ctx: HandlerContext): Promise<void> {
  const { session } = ctx;

  // Resume multi-step flow
  if (session.state !== 'started') {
    await handleResume(ctx);
    return;
  }

  await routeActividad(ctx);
}

async function routeActividad(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase, session } = ctx;
  const { entity_hint, project_code, activity_text } = parsed.fields;
  const text = activity_text || parsed.fields.mensaje_original || ctx.message.text;

  // (a.1) Resolve by explicit code
  if (project_code) {
    const n = await findNegocioByCode(supabase, user.workspace_id, String(project_code));
    if (n) {
      await persistActividad(ctx, n.id, n.nombre, text);
      return;
    }
  }

  // (a.2) Resolve by name hint (negocio name or empresa name)
  if (entity_hint) {
    const negocios = await findNegocios(supabase, user.workspace_id, entity_hint);
    if (negocios.length === 1) {
      await persistActividad(ctx, negocios[0].id, negocios[0].nombre, text);
      return;
    }
    if (negocios.length > 1) {
      await askChoice(ctx, text, negocios.slice(0, 3).map((n: any) => ({ id: n.id, nombre: n.nombre, codigo: n.codigo })));
      return;
    }

    // Also try matching by empresa name (negocios.empresa_id → empresas.nombre)
    const { data: viaEmpresa } = await supabase
      .from('negocios')
      .select('id, nombre, codigo, empresa:empresas!inner(nombre)')
      .eq('workspace_id', user.workspace_id)
      .eq('estado', 'abierto')
      .ilike('empresa.nombre', `%${entity_hint}%`)
      .order('updated_at', { ascending: false })
      .limit(3);

    if (viaEmpresa && viaEmpresa.length === 1) {
      await persistActividad(ctx, viaEmpresa[0].id, viaEmpresa[0].nombre, text);
      return;
    }
    if (viaEmpresa && viaEmpresa.length > 1) {
      await askChoice(ctx, text, viaEmpresa.map((n: any) => ({ id: n.id, nombre: n.nombre, codigo: n.codigo })));
      return;
    }
  }

  // (b) last_context: si hay un único negocio reciente, vincular automáticamente
  const lc = session.context?.last_context;
  if (lc && lc.items && lc.items.length === 1) {
    const ageMs = Date.now() - new Date(lc.created_at).getTime();
    if (ageMs < LAST_CONTEXT_TTL_MS) {
      const item = lc.items[0];
      if (item.id) {
        await persistActividad(ctx, item.id, item.nombre, text);
        return;
      }
    }
  }

  // (c) Top-3 negocios abiertos + opción "Otro"
  const activos = await findActiveNegocios(supabase, user.workspace_id);
  if (activos.length === 0) {
    await ctx.sendMessage(
      'No tienes negocios abiertos. Crea uno desde la app y vuelve a registrar la actividad.',
    );
    await completeSession(supabase, session.id);
    return;
  }

  await askChoice(
    ctx,
    text,
    activos.slice(0, 3).map((n: any) => ({ id: n.id, nombre: n.nombre, codigo: n.codigo })),
  );
}

async function askChoice(
  ctx: HandlerContext,
  text: string,
  candidates: Array<{ id: string; nombre: string; codigo?: string | null }>,
): Promise<void> {
  // WhatsApp interactive buttons admiten máximo 3 botones y title <= 20 chars
  const buttons = candidates.slice(0, 3).map((c, i) => {
    const labelBase = c.codigo ? c.codigo : c.nombre;
    const title = labelBase.length > 20 ? `${labelBase.slice(0, 19)}…` : labelBase;
    return { id: `act_pick_${i}`, title };
  });

  // No incluimos botón "Otro" porque consumiría un slot de los 3 y los activos
  // están ya en orden de últimos tocados. Si el usuario quería otro, puede
  // responder con el código del negocio (ej. "R1 26 2").
  await ctx.sendButtons(
    `📝 ¿En cuál negocio registro esta actividad?\n\n"${text.slice(0, 200)}"\n\nResponde con un botón o escribe el código.`,
    buttons,
  );

  await ctx.updateSession('awaiting_selection', {
    intent: 'ACTIVIDAD',
    pending_action: 'WAC',
    activity_text: text,
    options: candidates.map((c, i) => ({
      id: `pick_${i}`,
      label: c.nombre,
      extra: { negocio_id: c.id, codigo: c.codigo ?? null },
    })),
  });
}

async function handleResume(ctx: HandlerContext): Promise<void> {
  const { session, message, supabase, user } = ctx;
  const context = session.context;
  const text = message.text.trim();

  if (session.state === 'awaiting_selection' && context.pending_action === 'WAC') {
    const btnId = message.interactive_reply;

    // Botón pulsado
    if (btnId?.startsWith('act_pick_')) {
      const idx = parseInt(btnId.replace('act_pick_', ''), 10);
      const picked = context.options?.[idx];
      if (picked) {
        const negocioId = String((picked.extra as any)?.negocio_id || '');
        await persistActividad(ctx, negocioId, picked.label, context.activity_text || text);
        return;
      }
    }

    // Texto: posiblemente un código de negocio
    const n = await findNegocioByCode(supabase, user.workspace_id, text);
    if (n) {
      await persistActividad(ctx, n.id, n.nombre, context.activity_text || text);
      return;
    }

    await ctx.sendMessage('No reconocí esa opción. Toca uno de los botones o escribe el código del negocio (ej. R1 26 1).');
    return;
  }
}

async function persistActividad(
  ctx: HandlerContext,
  negocioId: string,
  negocioNombre: string,
  text: string,
): Promise<void> {
  const { supabase, user, session } = ctx;

  // Resolver autor_id en staff si el usuario tiene profile
  let autorId: string | null = null;
  if (user.user_id) {
    const { data: staff } = await supabase
      .from('staff')
      .select('id')
      .eq('workspace_id', user.workspace_id)
      .eq('profile_id', user.user_id)
      .single();
    autorId = staff?.id || null;
  }

  // Clasificar emoji por tipo (heurística simple)
  const lower = text.toLowerCase();
  let tipoLabel = '📝';
  if (/llam[eé]|llamada|telef/i.test(lower)) tipoLabel = '📞';
  else if (/reuni[oó]n|meeting|junta/i.test(lower)) tipoLabel = '🤝';
  else if (/correo|email|mail/i.test(lower)) tipoLabel = '📧';
  else if (/visit[eé]|visita|fu[ií]\s+a/i.test(lower)) tipoLabel = '🚗';
  else if (/whatsapp|mensaje|chat/i.test(lower)) tipoLabel = '💬';

  const contenido = `${tipoLabel} ${text}`.slice(0, 280);

  // Si no hay autor_id (colaborador WA sin profile), antepone el nombre al texto
  // para preservar la autoría visible en el timeline.
  const contenidoFinal = autorId
    ? contenido
    : `${tipoLabel} [${user.name}] ${text}`.slice(0, 280);

  const { error } = await supabase.from('activity_log').insert({
    workspace_id: user.workspace_id,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'comentario',
    contenido: contenidoFinal,
    autor_id: autorId,
  });

  if (error) {
    console.error('[actividad] insert error:', error);
    await ctx.sendMessage('❌ No pude registrar la actividad. Intenta desde la app.');
    await completeSession(supabase, session.id);
    return;
  }

  await supabase.from('negocios')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', negocioId);

  await ctx.sendMessage(`✅ ${tipoLabel} registrado en ${bold(negocioNombre)}`);
  await completeSession(supabase, session.id);
}
