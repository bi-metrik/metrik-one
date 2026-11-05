// ============================================================
// Carrito de los asistentes de venta — el repositorio (base) y su doble en memoria
// ------------------------------------------------------------
// Las dos escrituras que pueden chocar (el modelo cambia el carrito mientras el cliente toca «Sí») pasan por funciones
// de la base con el carrito bloqueado: `carrito_guardar_lineas` y `carrito_emitir_pago` (migración 20261104210000). El
// doble en memoria repite sus reglas para las pruebas y el arnés.
// ============================================================

import type { SupabaseClient } from '../../../types.ts';
import { ABANDONO_DIAS, mismasLineas, subtotalLineas, vivoAlLeer } from './modelo.ts';
import type {
  Carrito, ConvCarrito, DominioCarrito, Entrega, ErrorEmitir, EstadoCarrito, EstadoPago, LineaCarrito, LineaNueva, LinkEmitido, PagoCarrito,
} from './modelo.ts';

export type ResultadoGuardar = { ok: true; carrito: Carrito | null } | { ok: false; error: 'carrito_pagado' };
export type ResultadoEmitir = { ok: true; pago: PagoCarrito } | { ok: false; error: ErrorEmitir };

export interface RepoCarritos {
  /** El carrito vivo de la conversación (abierto o en pago), o null. Lanza si la base falla. */
  vivo(conv: ConvCarrito): Promise<Carrito | null>;
  /** Un carrito por id (cualquier estado), o null. */
  porId(id: string): Promise<Carrito | null>;
  /** Reemplaza las líneas del carrito vivo (lo crea; sin líneas lo cancela y devuelve null). */
  guardarLineas(conv: ConvCarrito, lineas: LineaNueva[]): Promise<ResultadoGuardar>;
  /** Congela el carrito con la entrega y registra el link, si `version` sigue siendo la del carrito. */
  emitirPago(carritoId: string, version: number, entrega: Entrega, link: LinkEmitido): Promise<ResultadoEmitir>;
  pagoPorHuella(huella: string): Promise<PagoCarrito | null>;
  pagoPorReferencia(referencia: string): Promise<PagoCarrito | null>;
  /** Los links del carrito, del más viejo al más nuevo. */
  pagos(carritoId: string): Promise<PagoCarrito[]>;
}

const ERRORES_EMITIR: ErrorEmitir[] = ['carrito_no_vivo', 'carrito_cambio', 'carrito_pagado', 'monto_no_cuadra'];

/** El error de una función del carrito (`raise exception 'carrito_cambio'`), o null si es otra cosa. Pura. */
export function errorDeCarrito(mensaje: string | null | undefined): ErrorEmitir | null {
  const m = String(mensaje ?? '');
  return ERRORES_EMITIR.find((e) => m.includes(e)) ?? null;
}

type Fila = Record<string, unknown>;

/** Una fila de `carritos` con sus `carrito_lineas`. Pura. */
export function carritoDeFila(x: Fila): Carrito {
  const ls = (Array.isArray(x.carrito_lineas) ? x.carrito_lineas : []) as Fila[];
  return {
    id: String(x.id), dominio: String(x.dominio) as DominioCarrito,
    conv: { cuentaId: Number(x.chatwoot_cuenta_id), conversacionId: Number(x.chatwoot_conversacion_id), canal: String(x.canal), contactoId: x.chatwoot_contacto_id === null || x.chatwoot_contacto_id === undefined ? null : Number(x.chatwoot_contacto_id) },
    estado: String(x.estado) as EstadoCarrito, version: Number(x.version),
    lineas: ls.map((l): LineaCarrito => ({
      id: String(l.id), orden: Number(l.orden), itemTipo: String(l.item_tipo), itemId: String(l.item_id), codigo: String(l.codigo),
      descripcion: String(l.descripcion ?? ''), cantidad: Number(l.cantidad), precioUnitario: Number(l.precio_unitario), ventaId: (l.venta_id as string | null) ?? null,
    })).sort((a, b) => a.orden - b.orden),
    subtotal: Number(x.subtotal), flete: x.flete === null || x.flete === undefined ? null : Number(x.flete),
    total: x.total === null || x.total === undefined ? null : Number(x.total), zona: (x.zona as string | null) ?? null,
    ruta: x.ruta === 'despacho' || x.ruta === 'recoge' ? x.ruta : null, actividadAt: String(x.actividad_at),
  };
}

/** Una fila de `carrito_pagos`. Pura. */
export function pagoDeFila(x: Fila): PagoCarrito {
  return {
    id: String(x.id), carritoId: String(x.carrito_id), referencia: String(x.referencia), url: String(x.url), huella: String(x.huella),
    version: Number(x.version), monto: Number(x.monto), venceAt: String(x.vence_at), estado: String(x.estado) as EstadoPago,
  };
}

const COLUMNAS_CARRITO = 'id, dominio, chatwoot_cuenta_id, chatwoot_conversacion_id, chatwoot_contacto_id, canal, estado, version, subtotal, flete, total, zona, ruta, actividad_at, carrito_lineas(id, orden, item_tipo, item_id, codigo, descripcion, cantidad, precio_unitario, venta_id)';
const COLUMNAS_PAGO = 'id, carrito_id, referencia, url, huella, version, monto, vence_at, estado';

/** Las líneas como las recibe `carrito_guardar_lineas`. Pura. */
export function lineasParaBase(lineas: LineaNueva[]): Fila[] {
  return lineas.map((l) => ({
    item_tipo: l.itemTipo, item_id: l.itemId, codigo: l.codigo, descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: Math.round(l.precioUnitario * 100) / 100,
  }));
}

export function carritosSupabase(supabase: SupabaseClient, workspaceId: string, dominio: DominioCarrito, ahoraMs: () => number = () => Date.now()): RepoCarritos {
  const porId = async (id: string): Promise<Carrito | null> => {
    const { data, error } = await supabase.from('carritos').select(COLUMNAS_CARRITO).eq('workspace_id', workspaceId).eq('id', id).maybeSingle();
    if (error) throw new Error(`no se pudo leer el carrito: ${error.message}`);
    return data ? carritoDeFila(data as Fila) : null;
  };
  const unPago = async (col: 'huella' | 'referencia', valor: string): Promise<PagoCarrito | null> => {
    const { data, error } = await supabase.from('carrito_pagos').select(COLUMNAS_PAGO).eq('workspace_id', workspaceId).eq(col, valor).maybeSingle();
    if (error) throw new Error(`no se pudo leer el link del carrito: ${error.message}`);
    return data ? pagoDeFila(data as Fila) : null;
  };
  return {
    async vivo(conv) {
      const { data, error } = await supabase.from('carritos').select(COLUMNAS_CARRITO).eq('workspace_id', workspaceId)
        .eq('chatwoot_cuenta_id', conv.cuentaId).eq('chatwoot_conversacion_id', conv.conversacionId).in('estado', ['abierto', 'en_pago']).maybeSingle();
      if (error) throw new Error(`no se pudo leer el carrito: ${error.message}`);
      return vivoAlLeer(data ? carritoDeFila(data as Fila) : null, ahoraMs());
    },
    porId,
    async guardarLineas(conv, lineas) {
      const { data, error } = await supabase.rpc('carrito_guardar_lineas', {
        p_workspace: workspaceId, p_dominio: dominio, p_cuenta: conv.cuentaId, p_conversacion: conv.conversacionId, p_canal: conv.canal || 'otro',
        p_contacto: conv.contactoId ?? null, p_lineas: lineasParaBase(lineas), p_abandono: `${ABANDONO_DIAS} days`,
      });
      if (error) {
        if (String(error.message).includes('carrito_pagado')) return { ok: false, error: 'carrito_pagado' };
        throw new Error(`no se pudo guardar el carrito: ${error.message}`);
      }
      if (!data) return { ok: true, carrito: null };
      const c = await porId(String(data));
      return { ok: true, carrito: c && (c.estado === 'abierto' || c.estado === 'en_pago') ? c : null };
    },
    async emitirPago(carritoId, version, e, l) {
      const { data, error } = await supabase.rpc('carrito_emitir_pago', {
        p_workspace: workspaceId, p_carrito: carritoId, p_version: version, p_zona: e.zona, p_ruta: e.ruta, p_flete: e.flete, p_nombre: e.nombre,
        p_telefono: e.telefono, p_direccion: e.direccion, p_referencia: l.referencia, p_url: l.url, p_huella: l.huella, p_monto: l.monto, p_vence_at: l.venceAt,
      });
      if (error) {
        const conocido = errorDeCarrito(error.message);
        if (conocido) return { ok: false, error: conocido };
        throw new Error(`no se pudo registrar el link del carrito: ${error.message}`);
      }
      const { data: fila, error: e2 } = await supabase.from('carrito_pagos').select(COLUMNAS_PAGO).eq('workspace_id', workspaceId).eq('id', String(data)).single();
      if (e2 || !fila) throw new Error(`no se pudo leer el link del carrito: ${e2?.message ?? 'sin fila'}`);
      return { ok: true, pago: pagoDeFila(fila as Fila) };
    },
    pagoPorHuella: (h) => unPago('huella', h),
    pagoPorReferencia: (r) => unPago('referencia', r),
    async pagos(carritoId) {
      const { data, error } = await supabase.from('carrito_pagos').select(COLUMNAS_PAGO).eq('workspace_id', workspaceId).eq('carrito_id', carritoId).order('created_at');
      if (error) throw new Error(`no se pudieron leer los links del carrito: ${error.message}`);
      return ((data ?? []) as Fila[]).map(pagoDeFila);
    },
  };
}

/** Lo que guarda el doble, para que las pruebas lo miren y lo cambien (pagar, vencer, envejecer). */
export interface EstadoMemoria {
  carritos: Array<Carrito & { entrega: Entrega | null }>;
  pagos: PagoCarrito[];
}

/** El doble: las mismas reglas que las funciones de la base, en memoria. */
export function carritosEnMemoria(dominio: DominioCarrito = 'ferreteria', ahoraMs: () => number = () => Date.now()) {
  const m: EstadoMemoria = { carritos: [], pagos: [] };
  let n = 0;
  const iso = () => new Date(ahoraMs()).toISOString();
  const copia = <T>(x: T): T => structuredClone(x);
  const sinExtras = (c: EstadoMemoria['carritos'][number]): Carrito => {
    const { entrega: _e, ...resto } = c;
    return copia(resto);
  };
  const delaConv = (conv: ConvCarrito) => m.carritos.find((c) => c.conv.cuentaId === conv.cuentaId && c.conv.conversacionId === conv.conversacionId && (c.estado === 'abierto' || c.estado === 'en_pago'));
  const repo: RepoCarritos = {
    async vivo(conv) {
      const c = delaConv(conv);
      return vivoAlLeer(c ? sinExtras(c) : null, ahoraMs());
    },
    async porId(id) {
      const c = m.carritos.find((x) => x.id === id);
      return c ? sinExtras(c) : null;
    },
    async guardarLineas(conv, lineas) {
      let c = delaConv(conv);
      if (c && c.estado === 'abierto' && Date.parse(c.actividadAt) < ahoraMs() - ABANDONO_DIAS * 86_400_000) {
        c.estado = 'abandonado';
        c = undefined;
      }
      if (!c) {
        if (!lineas.length) return { ok: true, carrito: null };
        c = { id: `carrito-${++n}`, dominio, estado: 'abierto', version: 0, lineas: [], subtotal: 0, flete: null, total: null, zona: null, ruta: null, actividadAt: iso(), conv: copia(conv), entrega: null };
        m.carritos.push(c);
      } else {
        const iguales = mismasLineas(c.lineas, lineas);
        if (iguales && c.estado === 'abierto') return { ok: true, carrito: sinExtras(c) };
        if (c.estado === 'en_pago') {
          if (m.pagos.some((p) => p.carritoId === c!.id && (p.estado === 'procesando' || p.estado === 'aprobado'))) return { ok: false, error: 'carrito_pagado' };
          if (iguales) return { ok: true, carrito: sinExtras(c) };
          for (const p of m.pagos) if (p.carritoId === c.id && ['creado', 'rechazado', 'error'].includes(p.estado)) p.estado = 'vencido';
          c.estado = 'abierto';
        }
      }
      c.version += 1;
      c.actividadAt = iso();
      if (!lineas.length) {
        c.estado = 'cancelado';
        c.lineas = [];
        c.subtotal = 0;
        return { ok: true, carrito: null };
      }
      c.lineas = lineas.map((l, i) => ({ ...copia(l), id: `${c!.id}-l${c!.version}-${i + 1}`, orden: i + 1, ventaId: null }));
      c.subtotal = subtotalLineas(lineas);
      c.total = c.flete === null ? null : c.subtotal + c.flete;
      return { ok: true, carrito: sinExtras(c) };
    },
    async emitirPago(carritoId, version, e, l) {
      const ya = m.pagos.find((p) => p.huella === l.huella);
      if (ya) return { ok: true, pago: copia(ya) };
      const c = m.carritos.find((x) => x.id === carritoId);
      if (!c || (c.estado !== 'abierto' && c.estado !== 'en_pago')) return { ok: false, error: 'carrito_no_vivo' };
      if (c.version !== version) return { ok: false, error: 'carrito_cambio' };
      if (m.pagos.some((p) => p.carritoId === c.id && (p.estado === 'procesando' || p.estado === 'aprobado'))) return { ok: false, error: 'carrito_pagado' };
      if (Math.round(l.monto) !== Math.round(c.subtotal + e.flete)) return { ok: false, error: 'monto_no_cuadra' };
      if (m.pagos.some((p) => p.referencia === l.referencia)) throw new Error('duplicado (23505)');
      for (const p of m.pagos) if (p.carritoId === c.id && ['creado', 'rechazado', 'error'].includes(p.estado)) p.estado = 'vencido';
      Object.assign(c, { estado: 'en_pago', zona: e.zona, ruta: e.ruta, flete: e.flete, total: c.subtotal + e.flete, entrega: copia(e) });
      const pago: PagoCarrito = { id: `pago-${++n}`, carritoId: c.id, referencia: l.referencia, url: l.url, huella: l.huella, version, monto: l.monto, venceAt: l.venceAt, estado: 'creado' };
      m.pagos.push(pago);
      return { ok: true, pago: copia(pago) };
    },
    pagoPorHuella: async (h) => copia(m.pagos.find((p) => p.huella === h) ?? null),
    pagoPorReferencia: async (r) => copia(m.pagos.find((p) => p.referencia === r) ?? null),
    pagos: async (id) => copia(m.pagos.filter((p) => p.carritoId === id)),
  };
  return {
    repo,
    estado: m,
    /** Lo que hace el webhook al registrar la venta: el pago aprobado y el carrito registrado. */
    registrar(referencia: string) {
      const p = m.pagos.find((x) => x.referencia === referencia);
      if (!p) return;
      p.estado = 'aprobado';
      const c = m.carritos.find((x) => x.id === p.carritoId);
      if (c) c.estado = 'registrado';
    },
    /** Corre la última actividad del carrito de la conversación hacia atrás (para probar el abandono). */
    envejecer(conv: ConvCarrito, dias: number) {
      const c = delaConv(conv);
      if (c) c.actividadAt = new Date(Date.parse(c.actividadAt) - dias * 86_400_000).toISOString();
    },
  };
}
