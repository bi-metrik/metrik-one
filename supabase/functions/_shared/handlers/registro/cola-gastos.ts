// ============================================================
// Gastos del intérprete conversacional: uno a la vez
// ------------------------------------------------------------
// Diseño del bot conversacional (§4): «almuerzo 25 mil, gasolina 90 mil y peaje 18.900» son tres
// gastos, y cada uno pasa por su propia confirmación con botones. Nada se guarda en lote. Los que
// esperan turno viven en `bot_sessions.context.gastos_en_cola`; el siguiente sale cuando el anterior
// termina (cancelado, o registrado y con su soporte resuelto).
//
// Cada gasto entra por `handleGasto` con su entrada canónica y CONFIANZA 0: con eso nunca toma el
// camino de `autoRegisterGasto` (registrar sin el sí). Con el interruptor apagado no hay cola y nada
// de esto corre.
// ============================================================

import type { GastoEnCola, HandlerContext, ParsedFields, SessionState, SessionContext } from '../../types.ts';
import { getOrCreateSession, updateSession } from '../../wa-session.ts';
import { categoriaDelGasto, handleGasto, proceedEmpresaGasto } from './gasto.ts';
import { textoGastoDeLaCola } from '../../wa-interprete-reglas.ts';


/** Los campos de hoy para un gasto validado por el intérprete. */
export function camposDelGasto(g: GastoEnCola): ParsedFields {
  const fields: ParsedFields = { mensaje_original: g.mensaje };
  if (g.monto) fields.amount = g.monto;
  if (g.descripcion) {
    fields.descripcion = g.descripcion;
    fields.concept = g.descripcion;
  }
  if (g.negocio && g.negocio !== 'empresa') {
    if (g.negocio.codigo) fields.project_code = g.negocio.codigo;
    else if (g.negocio.nombre) fields.entity_hint = g.negocio.nombre;
  }
  return fields;
}

/** Lleva un gasto validado a las funciones de hoy, siempre hasta la confirmación con botones. */
export async function despacharGasto(ctx: HandlerContext, g: GastoEnCola): Promise<void> {
  const fields = camposDelGasto(g);
  if (g.negocio === 'empresa' && g.monto) {
    await proceedEmpresaGasto(ctx, g.monto, fields, categoriaDelGasto(fields));
    return;
  }
  await handleGasto({ ...ctx, parsed: { intent: 'GASTO', confidence: 0, fields } });
}

/** El mismo contexto de handler, sobre otra sesión. */
export function conSesion(ctx: HandlerContext, session: HandlerContext['session']): HandlerContext {
  return {
    ...ctx,
    session,
    updateSession: async (state: SessionState, context?: Partial<SessionContext>) => {
      await updateSession(ctx.supabase, session.id, state, context);
      session.state = state;
      if (context) session.context = { ...session.context, ...context };
    },
  };
}

/**
 * Si quedan gastos en la cola de la sesión que terminó, muestra el siguiente. Sin cola, no hace nada
 * (ni una consulta). Se llama justo después de cerrar la sesión de un gasto.
 */
export async function seguirConLaCola(ctx: HandlerContext): Promise<void> {
  const cola = ctx.session?.context?.gastos_en_cola;
  if (!Array.isArray(cola) || cola.length === 0) return;
  const [siguiente, ...resto] = cola;
  const total = Number(ctx.session.context.gastos_total) || cola.length + 1;
  const session = await getOrCreateSession(ctx.supabase, ctx.message.phone, ctx.user.workspace_id);
  const nuevo = conSesion(ctx, session);
  await nuevo.updateSession(session.state, { gastos_en_cola: resto, gastos_total: total });
  await ctx.sendMessage(textoGastoDeLaCola(total - resto.length, total));
  await despacharGasto(nuevo, siguiente);
}
