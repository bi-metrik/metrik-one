// ============================================================
// Pago a un proveedor del viaje por el bot (F3) — la parte que habla con la base.
//
// Segunda puerta de la fila de servicio (Noor §3.6, Vera C12): tras escoger el negocio, si la línea
// tiene `servicios_viaje.activo`, «¿De qué servicio?» + medio de pago + foto. Con la línea
// apagada, nada cambia: el gasto sigue su camino de siempre.
//
// Reglas: `../../reglas-pago.ts` (copia exacta de `src/lib/viaje/reglas-pago.ts`). Las
// aprobaciones las escribe este cliente (service_role) igual que el servidor de la app.
// ============================================================

import type { HandlerContext, ParsedFields } from '../../types.ts';
import { completeSession } from '../../wa-session.ts';
import { showGastoConfirmation } from './gasto.ts';
import {
  configReglasPago,
  mediosPagoProveedor,
  reglasQueRompe,
  reglasSinAprobar,
  totalTrasPago,
  type AprobacionLeida,
  type MedioPagoProveedor,
  type ReglaRota,
} from '../../reglas-pago.ts';
import {
  ID_MEDIO,
  ID_NINGUNO,
  ID_OTRO_SERVICIO,
  ID_SERVICIO,
  botonesPropuesta,
  opcionesDeServicio,
  servicioPropuesto,
  serviciosPendientes,
  textoConfirmacionPago,
  textoPagoRegistrado,
  textoPropuesta,
  type ServicioLeido,
} from './servicio-viaje-reglas.ts';

type Db = HandlerContext['supabase'];

async function configDeLinea(supabase: Db, negocioId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from('negocios')
    .select('linea_id, lineas_negocio(config_extra)')
    .eq('id', negocioId)
    .maybeSingle();
  const linea = (data as { lineas_negocio?: unknown } | null)?.lineas_negocio;
  const fila = Array.isArray(linea) ? linea[0] : linea;
  return ((fila as { config_extra?: Record<string, unknown> } | null)?.config_extra) ?? null;
}

function activo(config: Record<string, unknown> | null): boolean {
  const sv = (config?.servicios_viaje ?? null) as { activo?: unknown } | null;
  return sv?.activo === true;
}

async function pagadoPorServicio(supabase: Db, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const { data } = await supabase.from('gastos').select('servicio_id, monto').in('servicio_id', ids);
  const out: Record<string, number> = {};
  for (const g of (data ?? []) as Array<{ servicio_id: string; monto: number | null }>) {
    out[g.servicio_id] = (out[g.servicio_id] ?? 0) + (Number(g.monto) || 0);
  }
  return out;
}

async function pendientesDelNegocio(supabase: Db, workspaceId: string, negocioId: string) {
  const { data } = await supabase
    .from('negocio_servicios')
    .select('id, nombre, estado, costo_cotizado, valor_por_pagar, orden')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .order('orden', { ascending: true });
  const servicios = (data ?? []) as ServicioLeido[];
  const pagado = await pagadoPorServicio(supabase, servicios.map(s => s.id));
  return serviciosPendientes(servicios, pagado);
}

/**
 * Si el negocio es de una línea con servicios del viaje y tiene servicios por pagar, toma el gasto
 * y pregunta de qué servicio es. Devuelve `true` si lo tomó (quien llama no sigue).
 */
export async function desviarAServicioViaje(
  ctx: HandlerContext,
  negocio: { id: string; nombre: string },
  amount: number,
  categoria: string,
  fields: ParsedFields,
): Promise<boolean> {
  if (ctx.session.context.servicio_viaje_resuelto) return false;
  const config = await configDeLinea(ctx.supabase, negocio.id);
  if (!activo(config)) return false;
  const pendientes = await pendientesDelNegocio(ctx.supabase, ctx.user.workspace_id, negocio.id);
  if (pendientes.length === 0) return false;

  const base = {
    intent: 'GASTO' as const,
    pending_action: 'W01',
    negocio_id: negocio.id,
    proyecto_nombre: negocio.nombre,
    destino_tipo: 'negocio' as const,
    amount,
    categoria,
    parsed_fields: fields,
    paso_viaje: 'servicio' as const,
  };
  const propuesto = servicioPropuesto(pendientes, amount);
  if (propuesto) {
    const botones = botonesPropuesta(propuesto);
    await ctx.sendButtons(textoPropuesta(propuesto, amount), botones.map(b => ({ id: b.id, title: b.label })));
    await ctx.updateSession('awaiting_selection', { ...base, options: botones });
    return true;
  }
  const opciones = opcionesDeServicio(pendientes);
  await ctx.sendOptions(`💰 ${negocio.nombre}. ¿De qué servicio es el pago?`, opciones.map(o => o.label));
  await ctx.updateSession('awaiting_selection', { ...base, options: opciones });
  return true;
}

/** La respuesta a «¿De qué servicio?» o a «¿Con qué pagaste?». */
export async function seleccionDeViaje(ctx: HandlerContext, selected: { id: string; label: string }): Promise<void> {
  const { supabase, user, session } = ctx;
  const c = session.context;

  if (selected.id === ID_OTRO_SERVICIO) {
    const pendientes = await pendientesDelNegocio(supabase, user.workspace_id, c.negocio_id!);
    const opciones = opcionesDeServicio(pendientes);
    await ctx.sendOptions('¿De qué servicio es el pago?', opciones.map(o => o.label));
    await ctx.updateSession('awaiting_selection', { options: opciones, paso_viaje: 'servicio' });
    return;
  }

  if (selected.id === ID_NINGUNO) {
    // No es de un servicio: sigue como un gasto del negocio, sin volver a preguntar.
    await ctx.updateSession('awaiting_selection', { paso_viaje: undefined, servicio_viaje_resuelto: true });
    await showGastoConfirmation(
      ctx,
      { id: c.negocio_id!, nombre: c.proyecto_nombre || 'negocio' },
      c.amount!,
      c.categoria || 'otros',
      c.parsed_fields ?? {},
      'negocio',
    );
    return;
  }

  if (selected.id.startsWith(ID_SERVICIO)) {
    const servicioId = selected.id.slice(ID_SERVICIO.length);
    const { data: srv } = await supabase
      .from('negocio_servicios')
      .select('id, nombre')
      .eq('id', servicioId)
      .eq('workspace_id', user.workspace_id)
      .maybeSingle();
    if (!srv) {
      await ctx.sendMessage('❌ No encontré ese servicio. Regístralo desde la app.');
      await completeSession(supabase, session.id);
      return;
    }
    const medios = await mediosDelEspacio(supabase, user.workspace_id);
    if (medios.length === 0) {
      await ctx.sendMessage('⚠️ La agencia no tiene medios de pago a proveedores configurados. Registra este pago desde la app.');
      await completeSession(supabase, session.id);
      return;
    }
    const opciones = medios.map(m => ({ id: `${ID_MEDIO}${m.id}`, label: m.label }));
    await ctx.sendOptions(`🧾 ${(srv as { nombre: string }).nombre}. ¿Con qué se pagó?`, opciones.map(o => o.label));
    await ctx.updateSession('awaiting_selection', {
      options: opciones,
      paso_viaje: 'medio',
      servicio_id: servicioId,
      servicio_nombre: (srv as { nombre: string }).nombre,
    });
    return;
  }

  if (selected.id.startsWith(ID_MEDIO)) {
    const medioId = selected.id.slice(ID_MEDIO.length);
    const medios = await mediosDelEspacio(supabase, user.workspace_id);
    const medio = medios.find(m => m.id === medioId);
    if (!medio) {
      await ctx.sendMessage('❌ No encontré ese medio de pago. Registra este pago desde la app.');
      await completeSession(supabase, session.id);
      return;
    }
    await ctx.updateSession('awaiting_selection', {
      medio_pago: medio.id,
      medio_label: medio.label,
      titular_medio: medio.titular,
      categoria: 'proveedor_viaje',
    });
    await confirmarPagoServicio(ctx);
    return;
  }

  await ctx.sendMessage('Algo salió mal. Escríbeme de nuevo.');
  await completeSession(supabase, session.id);
}

/** Muestra lo que se va a registrar y, si rompe una regla, que quedará esperando a Edgar. */
export async function confirmarPagoServicio(ctx: HandlerContext): Promise<void> {
  const c = ctx.session.context;
  const medio = medioDeSesion(c);
  if (!medio || !c.servicio_id || !c.negocio_id) {
    await ctx.sendMessage('Algo salió mal. Escríbeme de nuevo.');
    await completeSession(ctx.supabase, ctx.session.id);
    return;
  }
  const rotas = await reglasDelPago(ctx.supabase, ctx.user.workspace_id, c.negocio_id, c.servicio_id, c.amount!, medio, false);
  const esperando = (await sinAprobar(ctx.supabase, ctx.user.workspace_id, c.servicio_id, rotas)).map(r => r.texto);
  await ctx.sendButtons(
    textoConfirmacionPago({ negocio: c.proyecto_nombre || 'negocio', servicio: c.servicio_nombre || 'servicio', monto: c.amount!, medio: medio.label, esperando }),
    [
      { id: 'btn_confirm', title: '✅ Confirmar' },
      { id: 'btn_cancel', title: '❌ Cancelar' },
    ],
  );
  await ctx.updateSession('confirming', { paso_viaje: undefined, options: undefined });
}

function medioDeSesion(c: HandlerContext['session']['context']): MedioPagoProveedor | null {
  if (!c.medio_pago || !c.titular_medio) return null;
  return { id: c.medio_pago, label: c.medio_label || c.medio_pago, titular: c.titular_medio };
}

async function mediosDelEspacio(supabase: Db, workspaceId: string): Promise<MedioPagoProveedor[]> {
  const { data } = await supabase.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle();
  return mediosPagoProveedor((data as { config_extra?: unknown } | null)?.config_extra);
}

/** Cobrado confirmado al cliente: pagos con fecha, sin anular, con la retención (`cobradoConfirmado`). */
async function cobradoDelNegocio(supabase: Db, workspaceId: string, negocioId: string): Promise<{ cobrado: number; precio: number }> {
  const [{ data: cobros }, { data: neg }] = await Promise.all([
    supabase.from('cobros').select('*').eq('negocio_id', negocioId).eq('workspace_id', workspaceId),
    supabase.from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).maybeSingle(),
  ]);
  let cobrado = 0;
  for (const c of (cobros ?? []) as Array<{ monto?: number | null; fecha?: string | null; retencion_iva?: number | null; anulado_at?: string | null }>) {
    if (!c.fecha || c.anulado_at) continue;
    cobrado += Number(c.monto ?? 0) || 0;
    const r = Number(c.retencion_iva ?? 0);
    if (Number.isFinite(r) && r > 0) cobrado += r;
  }
  const n = neg as { precio_aprobado?: number | null; precio_estimado?: number | null } | null;
  return { cobrado, precio: Number(n?.precio_aprobado ?? n?.precio_estimado ?? 0) || 0 };
}

/** Las reglas que rompe el pago. `yaRegistrado`: el gasto ya está en la base (no se cuenta dos veces). */
async function reglasDelPago(
  supabase: Db,
  workspaceId: string,
  negocioId: string,
  servicioId: string,
  monto: number,
  medio: MedioPagoProveedor,
  yaRegistrado: boolean,
): Promise<ReglaRota[]> {
  const [{ data: srv }, pagado, plata, config] = await Promise.all([
    supabase.from('negocio_servicios').select('costo_cotizado').eq('id', servicioId).maybeSingle(),
    pagadoPorServicio(supabase, [servicioId]),
    cobradoDelNegocio(supabase, workspaceId, negocioId),
    configDeLinea(supabase, negocioId),
  ]);
  const antes = (pagado[servicioId] ?? 0) - (yaRegistrado ? monto : 0);
  return reglasQueRompe({
    monto,
    pagadoAntes: antes,
    costoCotizado: Number((srv as { costo_cotizado?: number } | null)?.costo_cotizado ?? 0) || 0,
    medio,
    cobradoCliente: plata.cobrado,
    precioAprobado: plata.precio,
    config: configReglasPago(config),
  });
}

async function aprobacionesVivas(supabase: Db, workspaceId: string, servicioId: string): Promise<AprobacionLeida[]> {
  const { data } = await supabase
    .from('aprobaciones_excepcion')
    .select('id, tipo, estado, huella')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'servicio')
    .eq('entidad_id', servicioId)
    .in('estado', ['solicitada', 'aprobada']);
  return (data ?? []) as AprobacionLeida[];
}

async function sinAprobar(supabase: Db, workspaceId: string, servicioId: string, rotas: ReglaRota[]): Promise<ReglaRota[]> {
  if (rotas.length === 0) return [];
  return reglasSinAprobar(rotas, await aprobacionesVivas(supabase, workspaceId, servicioId));
}

/**
 * Después de insertar el gasto: deja las aprobaciones como lo hace la app (`aplicarReglasDePago`).
 * Pedida la que falte (caducando la del mismo tipo con otra huella), caducada la pedida que ya no
 * hace falta, y aviso a la dirección. Devuelve lo que quedó esperando a Edgar.
 */
export async function aplicarReglasTrasRegistrar(
  ctx: HandlerContext,
  gastoId: string,
): Promise<string> {
  const { supabase, user } = ctx;
  const c = ctx.session.context;
  const medio = medioDeSesion(c);
  if (!medio || !c.servicio_id || !c.negocio_id) return '';
  const monto = Number(c.amount) || 0;
  const rotas = await reglasDelPago(supabase, user.workspace_id, c.negocio_id, c.servicio_id, monto, medio, true);
  const existentes = await aprobacionesVivas(supabase, user.workspace_id, c.servicio_id);
  const tiposRotos = new Set(rotas.map(r => r.tipo));
  const sobran = existentes.filter(a => a.estado === 'solicitada' && !tiposRotos.has(a.tipo as ReglaRota['tipo']));
  if (sobran.length > 0) await supabase.from('aprobaciones_excepcion').update({ estado: 'caducada' }).in('id', sobran.map(a => a.id));

  const pendientes = reglasSinAprobar(rotas, existentes);
  const { data: staff } = user.user_id
    ? await supabase.from('staff').select('id').eq('workspace_id', user.workspace_id).eq('profile_id', user.user_id).maybeSingle()
    : { data: null };
  const staffId = (staff as { id?: string } | null)?.id ?? null;
  const antes = Math.max(0, (await pagadoPorServicio(supabase, [c.servicio_id]))[c.servicio_id] - monto);
  let nuevas = 0;
  for (const r of pendientes) {
    if (existentes.some(a => a.tipo === r.tipo && a.estado === 'solicitada' && a.huella === r.huella)) continue;
    const viejas = existentes.filter(a => a.tipo === r.tipo && a.huella !== r.huella);
    if (viejas.length > 0) await supabase.from('aprobaciones_excepcion').update({ estado: 'caducada' }).in('id', viejas.map(a => a.id));
    const { error } = await supabase.from('aprobaciones_excepcion').insert({
      workspace_id: user.workspace_id,
      negocio_id: c.negocio_id,
      entidad_tipo: 'servicio',
      entidad_id: c.servicio_id,
      tipo: r.tipo,
      estado: 'solicitada',
      huella: r.huella,
      detalle: {
        ...r.detalle,
        texto: r.texto,
        monto: Math.round(monto),
        total: totalTrasPago({ monto, pagadoAntes: antes }),
        medio: medio.id,
        medio_label: medio.label,
        servicio: c.servicio_nombre ?? null,
        gasto_id: gastoId,
        pago_registrado: true,
        canal: 'whatsapp',
      },
      solicitada_por: staffId,
    });
    if (error && (error as { code?: string }).code !== '23505') console.error('[servicio-viaje] aprobación:', error.message);
    else nuevas++;
  }
  if (nuevas > 0) await avisarDireccion(ctx, monto, pendientes);
  return textoPagoRegistrado({ servicio: c.servicio_nombre || 'el servicio', monto, esperando: pendientes.map(r => r.texto) });
}

async function avisarDireccion(ctx: HandlerContext, monto: number, rotas: ReglaRota[]): Promise<void> {
  const { supabase, user } = ctx;
  const c = ctx.session.context;
  const config = await configDeLinea(supabase, c.negocio_id!);
  const ids = ((config?.aprobaciones as { staff_ids?: unknown } | undefined)?.staff_ids);
  const staffIds = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  let perfiles: string[] = [];
  if (staffIds.length > 0) {
    const { data } = await supabase.from('staff').select('profile_id').eq('workspace_id', user.workspace_id).in('id', staffIds);
    perfiles = ((data ?? []) as Array<{ profile_id: string | null }>).map(s => s.profile_id ?? '').filter(Boolean);
  }
  if (perfiles.length === 0) {
    const { data } = await supabase.from('profiles').select('id').eq('workspace_id', user.workspace_id).eq('role', 'owner');
    perfiles = ((data ?? []) as Array<{ id: string }>).map(p => p.id);
  }
  if (perfiles.length === 0) return;
  const porque = rotas.map(r => r.texto.replace(/\.$/, '')).join(' · ');
  const contenido = `Ya se pagaron $${Math.round(monto).toLocaleString('es-CO').replace(/,/g, '.')} por ${c.servicio_nombre ?? 'un servicio'} (${c.proyecto_nombre ?? 'el viaje'}): ${porque}. ¿Lo apruebas?`;
  const { error } = await supabase.from('notificaciones').insert([...new Set(perfiles)].map(p => ({
    workspace_id: user.workspace_id,
    destinatario_id: p,
    tipo: 'aprobacion_pendiente',
    estado: 'pendiente',
    contenido: contenido.slice(0, 500),
    entidad_tipo: 'servicio',
    entidad_id: c.servicio_id,
    deep_link: `/negocios/${c.negocio_id}`,
    metadata: { negocio_id: c.negocio_id, canal: 'whatsapp' },
  })));
  if (error) console.error('[servicio-viaje] aviso a la dirección:', error.message);
}
