// ============================================================
// Modo obras — el puerto de producción (Supabase), 2026-10-21
// ------------------------------------------------------------
// Sobre el puerto ONE de siempre (gastos, soportes, actividades, contactos), lo de la migración
// 20261021183000_obras_asistente_wa.sql:
//   · el pago: el gasto como lo escribe el bot de siempre (canal whatsapp, `created_by_wa_name`, `mensaje_original`,
//     tipo directo/empresa, centro de costos) más `fecha` (la del pantallazo), `obra_rubro_id`, `numero_transaccion`,
//     `numero_repetido`, `huella_soporte` y `propuesta_huella`. Idempotente por `propuesta_huella`: un reintento no
//     duplica.
//   · el ingreso: un cobro con `negocio_id`, `factura_id`, `tipo_cobro` regular y el soporte en `cobros.soporte` con la
//     forma de `archivarSoporte` (referencia `one://`).
//   · la factura: `facturas` con `negocio_id` y estado abierta; la marca de pagada la pone la plataforma.
//   · el cierre, de `v_cierre_obra`; las facturas, de `v_facturas_obra`; las llegadas, de `llegadas_obra` (el trigger
//     copia el valor de la jornada vigente y no deja una tercera obra en el día).
// Todo filtra por el workspace del remitente (el cliente es de servicio: no pasa por RLS).
// ============================================================

import type { SupabaseClient, WaUser } from '../../types.ts';
import { descripcionParaGuardar } from '../../wa-gasto-descripcion.ts';
import { puertoOneSupabase } from './puerto-supabase.ts';
import type { SoporteGuardado } from './dominio.ts';
import type { CierreObraOne, FacturaOne, ObraOne, PuertoObras, RegistroOne } from './obras-comun.ts';

type Fila = Record<string, unknown>;
const uno = (v: unknown): Fila | null => (Array.isArray(v) ? (v[0] as Fila | undefined) ?? null : (v as Fila | null) ?? null);
const llave = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const num = (v: unknown) => Number(v) || 0;

function obraDe(f: Fila): ObraOne {
  return {
    id: String(f.id), codigo: String(f.codigo ?? ''), nombre: String(f.nombre ?? ''), nombre_corto: (f.nombre_corto as string | null) ?? null,
    empresa: (uno(f.empresas)?.nombre as string | undefined) ?? null, etapa: (f.stage_actual as string | null) ?? null,
  };
}

function cierreDe(f: Fila): CierreObraOne {
  return {
    negocio_id: String(f.negocio_id), codigo: String(f.codigo ?? ''), nombre: String(f.nombre ?? ''), nombre_corto: (f.nombre_corto as string | null) ?? null,
    estado: (f.estado as string | null) ?? null, vendido: num(f.vendido),
    por_rubro: ((f.gastos_por_rubro ?? []) as Array<{ rubro: string; total: number }>).map((r) => ({ rubro: String(r.rubro), total: num(r.total) })),
    gastos_total: num(f.gastos_total), mano_obra: num(f.mano_obra), jornadas: num(f.jornadas), jornadas_sin_valor: num(f.jornadas_sin_valor),
    utilidad: num(f.utilidad), facturado: num(f.facturado), cobrado: num(f.cobrado), retenido: num(f.retenido), por_cobrar: num(f.por_cobrar),
  };
}

const SELECT_PAGO = 'id, fecha, monto, negocio_id, obra_rubro_id, categoria, numero_transaccion, descripcion, revisado, negocios(nombre), obra_rubros(nombre)';
const SELECT_INGRESO = 'id, fecha, monto, negocio_id, factura_id, numero_transaccion, negocios(nombre), facturas(numero_factura)';

function pagoDe(f: Fila): RegistroOne {
  return {
    tipo: 'pago', id: String(f.id), fecha: String(f.fecha ?? '').slice(0, 10), monto: num(f.monto), negocio_id: (f.negocio_id as string | null) ?? null,
    obra: (uno(f.negocios)?.nombre as string | undefined) ?? null, rubro_id: (f.obra_rubro_id as string | null) ?? null,
    rubro: (uno(f.obra_rubros)?.nombre as string | undefined) ?? null, categoria: (f.categoria as string | null) ?? null,
    numero: (f.numero_transaccion as string | null) ?? null, descripcion: (f.descripcion as string | null) ?? null, revisado: f.revisado === true,
  };
}

function ingresoDe(f: Fila): RegistroOne {
  return {
    tipo: 'ingreso', id: String(f.id), fecha: String(f.fecha ?? '').slice(0, 10), monto: num(f.monto), negocio_id: (f.negocio_id as string | null) ?? null,
    obra: (uno(f.negocios)?.nombre as string | undefined) ?? null, factura_id: (f.factura_id as string | null) ?? null,
    factura: (uno(f.facturas)?.numero_factura as string | undefined) ?? null, numero: (f.numero_transaccion as string | null) ?? null,
  };
}

export function puertoObrasSupabase(supabase: SupabaseClient, user: WaUser): PuertoObras {
  const ws = user.workspace_id;
  const one = puertoOneSupabase(supabase, user);
  const log = (que: string, e: { message?: string } | null | undefined) => console.error(`[agente-obras] ${que}:`, e?.message ?? e);

  async function obrasActivas(): Promise<ObraOne[] | 'error'> {
    const { data, error } = await supabase.from('negocios')
      .select('id, codigo, nombre, nombre_corto, stage_actual, is_paused, pausado, updated_at, empresas(nombre)')
      .eq('workspace_id', ws).eq('estado', 'abierto').in('stage_actual', ['ejecucion', 'cobro']).order('updated_at', { ascending: false }).limit(50);
    if (error) { log('obras activas', error); return 'error'; }
    return ((data ?? []) as Fila[]).filter((f) => f.is_paused !== true && f.pausado !== true).map(obraDe);
  }

  async function facturas(filtro: { negocioId?: string | null; abiertas?: boolean; numero?: string }): Promise<FacturaOne[] | 'error'> {
    let q = supabase.from('v_facturas_obra').select('id, negocio_id, numero_factura, fecha_emision, monto, estado, recibido').eq('workspace_id', ws);
    if (filtro.negocioId) q = q.eq('negocio_id', filtro.negocioId);
    if (filtro.abiertas) q = q.eq('estado', 'abierta');
    if (filtro.numero) q = q.ilike('numero_factura', filtro.numero.replace(/[%_]/g, ''));
    const { data, error } = await q.order('fecha_emision', { ascending: false }).limit(30);
    if (error) { log('facturas', error); return 'error'; }
    const filas = (data ?? []) as Fila[];
    const ids = [...new Set(filas.map((f) => String(f.negocio_id)))];
    const nombres = new Map<string, string>();
    if (ids.length) {
      const { data: ns } = await supabase.from('negocios').select('id, nombre').eq('workspace_id', ws).in('id', ids);
      for (const n of (ns ?? []) as Fila[]) nombres.set(String(n.id), String(n.nombre ?? ''));
    }
    return filas.map((f) => ({
      id: String(f.id), numero: String(f.numero_factura ?? ''), fecha: String(f.fecha_emision ?? '').slice(0, 10), monto: num(f.monto),
      negocio_id: (f.negocio_id as string | null) ?? null, obra: nombres.get(String(f.negocio_id)) ?? null, recibido: num(f.recibido),
      estado: f.estado === 'pagada' ? 'pagada' : 'abierta',
    }));
  }

  /** El soporte de un cobro, con la forma de `archivarSoporte` (referencia, no URL pública). */
  const soporteCobro = (ref: string | null) => (ref ? { url: ref, file_name: ref.split('/').pop() ?? 'soporte', mime_type: ref.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', storage_path: ref.replace(/^one:\/\/[^/]+\//, ''), drive_file_id: null, subido_por: user.user_id ?? null, subido_en: new Date().toISOString() } : null);

  return {
    ...one,
    obrasActivas,
    async obraPorCodigo(codigo) {
      const os = await obrasActivas();
      if (os === 'error') return os;
      return os.find((o) => llave(o.codigo) === llave(codigo)) ?? null;
    },
    async rubros() {
      const { data, error } = await supabase.from('obra_rubros').select('id, nombre, descripcion, ejemplos, categoria').eq('workspace_id', ws).eq('activo', true).order('orden').order('nombre');
      if (error) { log('rubros', error); return 'error'; }
      return ((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.nombre), descripcion: (f.descripcion as string | null) ?? null, ejemplos: (f.ejemplos as string | null) ?? null, categoria: String(f.categoria ?? 'otros') }));
    },
    async pagosConNumero(numero) {
      const [g, c] = await Promise.all([
        supabase.from('gastos').select(SELECT_PAGO).eq('workspace_id', ws).eq('numero_transaccion', numero).limit(5),
        supabase.from('cobros').select(SELECT_INGRESO).eq('workspace_id', ws).eq('numero_transaccion', numero).is('anulado_at', null).limit(5),
      ]);
      if (g.error || c.error) { log('número repetido', g.error ?? c.error); return 'error'; }
      return [...((g.data ?? []) as Fila[]).map(pagoDe), ...((c.data ?? []) as Fila[]).map(ingresoDe)];
    },
    async pagosConHuella(huella) {
      const [g, c] = await Promise.all([
        supabase.from('gastos').select(SELECT_PAGO).eq('workspace_id', ws).eq('huella_soporte', huella).limit(5),
        supabase.from('cobros').select(SELECT_INGRESO).eq('workspace_id', ws).eq('huella_soporte', huella).is('anulado_at', null).limit(5),
      ]);
      if (g.error || c.error) { log('imagen repetida', g.error ?? c.error); return 'error'; }
      return [...((g.data ?? []) as Fila[]).map(pagoDe), ...((c.data ?? []) as Fila[]).map(ingresoDe)];
    },
    facturasAbiertas: (negocioId) => facturas({ negocioId, abiertas: true }),
    facturasConNumero: (numero) => facturas({ numero }),
    async registrarPago(p) {
      // Idempotente: un reintento del mismo toque no duplica.
      const { data: ya } = await supabase.from('gastos').select('id, soporte_pendiente').eq('workspace_id', ws).eq('propuesta_huella', p.propuestaHuella).maybeSingle();
      if (ya) return { id: String((ya as Fila).id), soporte: ((ya as Fila).soporte_pendiente === false ? 'guardado' : 'sin') as SoporteGuardado };
      const cc = await one.centroCostos({ negocioId: p.negocioId, descripcion: p.descripcion });
      const insert: Record<string, unknown> = {
        workspace_id: ws, monto: p.monto, fecha: p.fecha, categoria: p.categoria,
        descripcion: descripcionParaGuardar({ descripcion: p.descripcion ?? undefined }, p.categoria, p.monto),
        mensaje_original: p.mensajeOriginal, tipo: p.negocioId ? 'directo' : 'empresa', canal_registro: 'whatsapp',
        created_by_wa_name: user.name, soporte_pendiente: true, created_by: user.user_id ?? null,
        numero_transaccion: p.numero, numero_repetido: p.repetido, huella_soporte: p.huella, propuesta_huella: p.propuestaHuella,
        ...(p.rubroId ? { obra_rubro_id: p.rubroId } : {}),
        ...(p.negocioId ? { negocio_id: p.negocioId } : {}),
        ...(cc.centro ? { centro_costos: cc.centro } : {}), ...(cc.origen ? { origen_asignacion: cc.origen } : {}),
      };
      const { data, error } = await supabase.from('gastos').insert(insert).select('id').single();
      if (error || !data) throw new Error(`no se pudo registrar el pago: ${error?.message ?? 'sin fila'}`);
      const id = String((data as Fila).id);
      if (!p.mediaId && !p.ref) return { id, soporte: 'sin' };
      return { id, soporte: (await one.adjuntarSoporte(id, p.mediaId ?? '', p.ref)) ? 'guardado' : 'fallo' };
    },
    async registrarIngreso(p) {
      const { data: ya } = await supabase.from('cobros').select('id').eq('workspace_id', ws).eq('propuesta_huella', p.propuestaHuella).maybeSingle();
      if (ya) return { id: String((ya as Fila).id), soporte: p.ref ? 'guardado' : 'sin' };
      const soporte = soporteCobro(p.ref);
      const { data, error } = await supabase.from('cobros').insert({
        workspace_id: ws, negocio_id: p.negocioId, factura_id: p.facturaId, monto: p.monto, fecha: p.fecha, tipo_cobro: 'regular',
        canal_registro: 'whatsapp', created_by_wa_name: user.name, created_by: user.user_id ?? null, mensaje_original: p.mensajeOriginal,
        numero_transaccion: p.numero, numero_repetido: p.repetido, huella_soporte: p.huella, propuesta_huella: p.propuestaHuella,
        ...(soporte ? { soporte } : {}),
      }).select('id').single();
      if (error || !data) throw new Error(`no se pudo registrar el ingreso: ${error?.message ?? 'sin fila'}`);
      // Sin `ref` (no se alcanzó a subir al llegar) el soporte queda por subir en la app: no se baja de Meta aquí.
      return { id: String((data as Fila).id), soporte: soporte ? 'guardado' : p.mediaId ? 'fallo' : 'sin' };
    },
    async registrarFactura(p) {
      const { data: ya } = await supabase.from('facturas').select('id').eq('workspace_id', ws).eq('propuesta_huella', p.propuestaHuella).maybeSingle();
      if (ya) return { id: String((ya as Fila).id), soporte: p.ref ? 'guardado' : 'sin' };
      const { data, error } = await supabase.from('facturas').insert({
        workspace_id: ws, negocio_id: p.negocioId, numero_factura: p.numero, monto: p.monto, fecha_emision: p.fecha, canal_registro: 'whatsapp',
        estado: 'abierta', numero_repetido: p.repetido, soporte_url: p.ref, created_by: user.user_id ?? null, created_by_wa_name: user.name,
        propuesta_huella: p.propuestaHuella,
      }).select('id').single();
      if (error || !data) throw new Error(`no se pudo registrar la factura: ${error?.message ?? 'sin fila'}`);
      return { id: String((data as Fila).id), soporte: p.ref ? 'guardado' : p.mediaId ? 'fallo' : 'sin' };
    },
    async buscarRegistros({ tipo, monto, desde, negocioId, limite }) {
      if (tipo === 'factura') {
        const fs = await facturas({ negocioId });
        if (fs === 'error') return fs;
        return fs.filter((f) => f.fecha >= desde && (monto === null || Math.abs(f.monto - monto) <= monto * 0.05)).slice(0, limite)
          .map((f) => ({ tipo: 'factura' as const, id: f.id, fecha: f.fecha, monto: f.monto, negocio_id: f.negocio_id, obra: f.obra, numero: f.numero }));
      }
      const tabla = tipo === 'pago' ? 'gastos' : 'cobros';
      let q = supabase.from(tabla).select(tipo === 'pago' ? SELECT_PAGO : SELECT_INGRESO).eq('workspace_id', ws).gte('fecha', desde);
      if (tipo === 'ingreso') q = q.is('anulado_at', null);
      if (negocioId) q = q.eq('negocio_id', negocioId);
      if (monto !== null) q = q.gte('monto', Math.floor(monto * 0.95)).lte('monto', Math.ceil(monto * 1.05));
      const { data, error } = await q.order('fecha', { ascending: false }).order('created_at', { ascending: false }).limit(limite);
      if (error) { log('buscar registros', error); return 'error'; }
      return ((data ?? []) as Fila[]).map(tipo === 'pago' ? pagoDe : ingresoDe);
    },
    async registro(tipo, id) {
      if (tipo === 'factura') {
        const fs = await facturas({});
        if (fs === 'error') return fs;
        const f = fs.find((x) => x.id === id);
        return f ? { tipo, id, fecha: f.fecha, monto: f.monto, negocio_id: f.negocio_id, obra: f.obra, numero: f.numero } : null;
      }
      const { data, error } = await supabase.from(tipo === 'pago' ? 'gastos' : 'cobros').select(tipo === 'pago' ? SELECT_PAGO : SELECT_INGRESO).eq('workspace_id', ws).eq('id', id).maybeSingle();
      if (error) { log('registro', error); return 'error'; }
      return data ? (tipo === 'pago' ? pagoDe : ingresoDe)(data as Fila) : null;
    },
    async corregirRegistro({ tipo, id, cambios }) {
      const c: Record<string, unknown> = {};
      if (tipo === 'factura') {
        if (cambios.negocioId !== undefined) c.negocio_id = cambios.negocioId;
        if (cambios.fecha !== undefined) c.fecha_emision = cambios.fecha;
        if (cambios.monto !== undefined) c.monto = cambios.monto;
        const { data, error } = await supabase.from('facturas').update({ ...c, updated_at: new Date().toISOString() }).eq('workspace_id', ws).eq('id', id).eq('estado', 'abierta').select('id');
        if (error) throw new Error(`no se pudo corregir la factura: ${error.message}`);
        if (!((data ?? []) as Fila[]).length) throw new Error('la factura no existe o ya está pagada');
        return;
      }
      if (cambios.negocioId !== undefined) c.negocio_id = cambios.negocioId;
      if (cambios.fecha !== undefined) c.fecha = cambios.fecha;
      if (cambios.monto !== undefined) c.monto = cambios.monto;
      if (tipo === 'pago') {
        if (cambios.rubroId !== undefined) c.obra_rubro_id = cambios.rubroId;
        if (cambios.categoria !== undefined) c.categoria = cambios.categoria;
        if (cambios.negocioId !== undefined) c.tipo = cambios.negocioId ? 'directo' : 'empresa';
        const { data, error } = await supabase.from('gastos').update(c).eq('workspace_id', ws).eq('id', id).eq('revisado', false).select('id');
        if (error) throw new Error(`no se pudo corregir el pago: ${error.message}`);
        if (!((data ?? []) as Fila[]).length) throw new Error('el pago no existe o ya se revisó');
        return;
      }
      if (cambios.facturaId !== undefined) c.factura_id = cambios.facturaId;
      const { data, error } = await supabase.from('cobros').update(c).eq('workspace_id', ws).eq('id', id).is('anulado_at', null).select('id');
      if (error) throw new Error(`no se pudo corregir el ingreso: ${error.message}`);
      if (!((data ?? []) as Fila[]).length) throw new Error('el ingreso no existe o está anulado');
    },
    async cierreObra(negocioId) {
      const { data, error } = await supabase.from('v_cierre_obra').select('*').eq('workspace_id', ws).eq('negocio_id', negocioId).maybeSingle();
      if (error) { log('cierre', error); return 'error'; }
      return data ? cierreDe(data as Fila) : null;
    },
    async cierresActivos() {
      const os = await obrasActivas();
      if (os === 'error') return os;
      if (!os.length) return [];
      const { data, error } = await supabase.from('v_cierre_obra').select('*').eq('workspace_id', ws).in('negocio_id', os.map((o) => o.id));
      if (error) { log('cierres', error); return 'error'; }
      return ((data ?? []) as Fila[]).map(cierreDe);
    },
    async llegadas({ desde, hasta, negocioId, collaboratorId }) {
      let q = supabase.from('llegadas_obra').select('id, collaborator_id, negocio_id, fecha, hora, wa_collaborators(name), negocios(nombre, nombre_corto)')
        .eq('workspace_id', ws).gte('fecha', desde).lte('fecha', hasta);
      if (negocioId) q = q.eq('negocio_id', negocioId);
      if (collaboratorId) q = q.eq('collaborator_id', collaboratorId);
      const { data, error } = await q.order('hora').limit(2000);
      if (error) { log('llegadas', error); return 'error'; }
      return ((data ?? []) as Fila[]).map((f) => {
        const n = uno(f.negocios);
        return {
          id: String(f.id), collaborator_id: String(f.collaborator_id), persona: String(uno(f.wa_collaborators)?.name ?? ''),
          negocio_id: String(f.negocio_id), obra: String(n?.nombre_corto || n?.nombre || ''), fecha: String(f.fecha), hora: String(f.hora),
        };
      });
    },
    async operarios() {
      const { data, error } = await supabase.from('wa_collaborators').select('id, name').eq('workspace_id', ws).eq('tipo', 'operario').eq('is_active', true).order('name');
      if (error) { log('operarios', error); return 'error'; }
      return ((data ?? []) as Fila[]).map((f) => ({ id: String(f.id), nombre: String(f.name ?? '') }));
    },
    async mensajesDelMes(mes) {
      const { data, error } = await supabase.rpc('bot_mensajes_mes', { p_workspace_id: ws, p_mes: `${mes}-01` });
      if (error) { log('mensajes del mes', error); return 'error'; }
      const d = (data ?? {}) as Fila;
      return { total: num(d.total), gestion: num(d.gestion), operario: num(d.operario) };
    },
    async registrarLlegada(p) {
      const { data, error } = await supabase.from('llegadas_obra').insert({
        workspace_id: ws, collaborator_id: p.collaboratorId, negocio_id: p.negocioId, fecha: p.fecha, hora: p.hora,
        canal: 'whatsapp', wa_message_id: p.waMessageId, propuesta_huella: p.propuestaHuella,
      }).select('id').single();
      if (error || !data) throw new Error(`no se pudo anotar la llegada: ${error?.message ?? 'sin fila'}`);
      return { id: String((data as Fila).id) };
    },
    async cambiarLlegada({ llegadaId, negocioId, hora }) {
      const { data, error } = await supabase.from('llegadas_obra').update({ negocio_id: negocioId, hora }).eq('workspace_id', ws).eq('id', llegadaId).select('id');
      if (error) throw new Error(`no se pudo cambiar la llegada: ${error.message}`);
      if (!((data ?? []) as Fila[]).length) throw new Error('la llegada no existe');
    },
  };
}
