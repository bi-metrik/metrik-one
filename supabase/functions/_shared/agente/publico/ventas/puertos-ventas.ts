// ============================================================
// Asistente de ventas — los puertos (catálogo de ONE, pasarela del workspace, links guardados) y su doble en memoria
// ------------------------------------------------------------
// Producción: `produccion-ventas.ts` (Supabase + Bold con las llaves de la bóveda del workspace, #1294). Pruebas y arnés:
// `ventasEnMemoria`. La pasarela es la del WORKSPACE o nada: sin llaves, `pasarela()` devuelve null y el asistente pasa
// a persona con `pago_no_disponible` (nunca inventa un link ni usa la llave de MéTRIK del servidor).
// ============================================================

import type { CuerpoLinkBold, PasarelaPagos, PedidoLink } from '../../../funciones/pasarela.ts';
import { cuerpoLinkBold } from '../../../funciones/pasarela.ts';
import type { ProductoNoDisponible, ProductoVenta } from './catalogo-ventas.ts';
import type { Carrito, EstadoPago, PagoCarrito } from '../carrito/modelo.ts';
import { carritosEnMemoria } from '../carrito/repo.ts';
import type { RepoCarritos } from '../carrito/repo.ts';

/**
 * Un link de pago del carrito como lo ve el asistente (`carrito_pagos` + la conversación de su carrito). `registro`:
 * `registrada` cuando el webhook ya registró la venta en ONE (pago `aprobado`).
 */
export interface LinkGuardado {
  referencia: string;
  url: string;
  huella: string;
  monto: number;
  venceAt: string;
  estado: EstadoPago;
  carritoId: string;
  cuentaId: number;
  conversacionId: number;
  canal: string;
  registro: 'registrada' | 'pendiente';
}

/** El link de un pago con la conversación de su carrito. Pura. */
export function linkDePago(p: PagoCarrito, c: Pick<Carrito, 'conv'> | null): LinkGuardado {
  return {
    referencia: p.referencia, url: p.url, huella: p.huella, monto: p.monto, venceAt: p.venceAt, estado: p.estado, carritoId: p.carritoId,
    cuentaId: c?.conv.cuentaId ?? 0, conversacionId: c?.conv.conversacionId ?? 0, canal: c?.conv.canal ?? 'otro',
    registro: p.estado === 'aprobado' ? 'registrada' : 'pendiente',
  };
}

/** Buscar un link por huella o referencia sobre el repositorio de carritos. */
export function linksDeCarritos(repo: RepoCarritos): Pick<PuertosVentas, 'linkPorHuella' | 'linkPorReferencia'> {
  const con = async (p: PagoCarrito | null) => (p ? linkDePago(p, await repo.porId(p.carritoId)) : null);
  return {
    linkPorHuella: async (h) => con(await repo.pagoPorHuella(h)),
    linkPorReferencia: async (r) => con(await repo.pagoPorReferencia(r)),
  };
}

/**
 * El link en Bold: estado, total cobrado, si es del ambiente de pruebas y si el workspace es un espacio de pruebas (la
 * marca de Vault de #1294: solo ahí vale un link de pruebas).
 */
export type EstadoLink = { estado: string; total: number | null; sandbox: boolean; espacioDePruebas: boolean } | 'sin_llaves' | null;

export interface PuertosVentas {
  /** Las publicaciones activas con precio, con su producto. Lanza si la base falla. */
  catalogo(): Promise<ProductoVenta[]>;
  /** Los productos con publicación NO activa (agotada, borrador), sin precio ni ficha. Lanza si la base falla. */
  noDisponibles(): Promise<ProductoNoDisponible[]>;
  /** La pasarela con las llaves DEL WORKSPACE, o null si no tiene. */
  pasarela(): Promise<PasarelaPagos | null>;
  /** `GET /online/link/v1/{LNK}` con la llave del workspace. `sin_llaves` si no tiene; null si Bold no respondió. */
  consultarLink(referencia: string): Promise<EstadoLink>;
  /** El carrito de la conversación, guardado en la base (`carritos`, migración 20261104210000). */
  carritos: RepoCarritos;
  linkPorHuella(huella: string): Promise<LinkGuardado | null>;
  linkPorReferencia(referencia: string): Promise<LinkGuardado | null>;
}

/** Un producto del catálogo como queda al salir de la venta (agotado): sin precio, ficha ni fotos. Pura. */
export function comoNoDisponible(p: ProductoVenta, estado = 'agotada'): ProductoNoDisponible {
  return { publicacionId: p.publicacionId, codigo: p.codigo, sku: p.sku, titulo: p.titulo, nombre: p.nombre, marca: p.marca, categoria: p.categoria, etiquetas: p.etiquetas, estado };
}

/** El doble: catálogo fijo, pasarela en memoria (o ninguna), estados de link que el caso fija a mano. */
export function ventasEnMemoria(o: {
  productos: ProductoVenta[]; sinLlaves?: boolean; pasarelaCaida?: boolean;
  /** Lo que existe en Ferretería pero no está publicado hoy (agotado o borrador). */
  noDisponibles?: ProductoNoDisponible[];
  /** Lo que Bold responde al consultar (por defecto: el total del link, de producción). */
  consulta?: { total?: number | null; sandbox?: boolean; espacioDePruebas?: boolean };
}) {
  // Como Bold: arma el cuerpo real del pedido (valida monto y vencimiento) y devuelve un `LNK_…` con su checkout.
  const pedidos: Array<{ pedido: PedidoLink; cuerpo: CuerpoLinkBold }> = [];
  let n = 0;
  // Copias: `agotar` las cambia sin tocar el catálogo del caso (que comparten las k corridas).
  let productos = [...o.productos];
  const noDisponibles = [...(o.noDisponibles ?? [])];
  const pasarela: PasarelaPagos = {
    async crearLink(p) {
      if (o.pasarelaCaida) return { ok: false, error: 'pasarela caída (doble)' };
      pedidos.push({ pedido: structuredClone(p), cuerpo: cuerpoLinkBold(p) });
      const referencia = `LNK_PRUEBA${++n}`;
      return { ok: true, referencia, url: `https://checkout.bold.co/${referencia}` };
    },
  };
  const carritos = carritosEnMemoria('ferreteria');
  const estados = new Map<string, string>();
  const consultas: string[] = [];
  const puertos: PuertosVentas = {
    catalogo: async () => structuredClone(productos),
    noDisponibles: async () => structuredClone(noDisponibles),
    pasarela: async () => (o.sinLlaves ? null : pasarela),
    async consultarLink(referencia) {
      consultas.push(referencia);
      if (o.sinLlaves) return 'sin_llaves';
      const l = carritos.estado.pagos.find((x) => x.referencia === referencia);
      if (!l) return null;
      return {
        estado: estados.get(referencia) ?? 'ACTIVE', total: o.consulta && 'total' in o.consulta ? o.consulta.total ?? null : l.monto,
        sandbox: o.consulta?.sandbox ?? false, espacioDePruebas: o.consulta?.espacioDePruebas ?? false,
      };
    },
    carritos: carritos.repo,
    ...linksDeCarritos(carritos.repo),
  };
  return {
    puertos, estados, consultas, pedidos, carritos,
    /** Los links emitidos, con la entrega y la conversación de su carrito (para las pruebas y el arnés). */
    get links() {
      return carritos.estado.pagos.map((p) => {
        const c = carritos.estado.carritos.find((x) => x.id === p.carritoId);
        return { ...linkDePago(p, c ?? null), direccion: c?.entrega?.direccion ?? null, flete: c?.flete ?? null, lineas: structuredClone(c?.lineas ?? []) };
      });
    },
    pagar: (referencia: string) => estados.set(referencia, 'PAID'),
    /** Lo que haría el webhook al registrar la venta en ONE. */
    registrar: (referencia: string) => carritos.registrar(referencia),
    /** Lo que hace Ferretería al cerrar una campaña: la publicación pasa a `agotada` (sale del catálogo, sigue existiendo). */
    agotar: (codigo: string) => {
      const p = productos.find((x) => x.codigo === codigo);
      if (!p) return;
      productos = productos.filter((x) => x !== p);
      noDisponibles.push(comoNoDisponible(p));
    },
  };
}
