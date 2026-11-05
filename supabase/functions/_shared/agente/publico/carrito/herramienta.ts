// ============================================================
// Carrito de los asistentes de venta — la herramienta `carrito` (genérica)
// ------------------------------------------------------------
// Cualquier asistente público que venda la declara igual: el modelo manda el carrito ENTERO como queda cada vez que el
// cliente agrega, quita o cambia algo (más robusto para un modelo que «agregar» y «quitar» sueltos: un «sí» repetido o un
// turno reintentado no duplica nada). El dominio pone el catálogo: `resolver` convierte códigos y unidades en líneas con
// su precio (o dice qué corregir). Aquí se guarda en la base y se devuelve lo que el modelo le dice al cliente.
// ============================================================

import type { ContextoDominio, DeclaracionHerramienta, ResultadoHerramienta } from '../../tipos.ts';
import type { FilaPublica } from '../tipos.ts';
import { resumenLineas, subtotalLineas } from './modelo.ts';
import type { Carrito, ConvCarrito, LineaNueva } from './modelo.ts';
import type { RepoCarritos } from './repo.ts';

export const CARRITO = 'carrito';

/** Lo que pidió el cliente: un código y sus unidades. */
export interface ItemPedido { codigo: string; cantidad: number }

export type Resolver = (items: ItemPedido[]) => Promise<{ ok: true; lineas: LineaNueva[] } | { ok: false; error: string; candado: string }>;

/** La conversación del contexto: `phone` es `cuenta:conversación` en el asistente sobre Chatwoot. Pura. */
export function convDeContexto(ctx: Pick<ContextoDominio, 'phone' | 'conversacion'>): ConvCarrito {
  const [cuenta, conv] = ctx.phone.split(':').map(Number);
  const canal = (ctx.conversacion as FilaPublica[])[0]?.canal ?? 'otro';
  return { cuentaId: cuenta, conversacionId: conv, canal };
}

/** Los productos de los argumentos (`productos: [{ producto, cantidad }]`, o `producto`/`cantidad` sueltos). Pura. */
export function itemsDe(args: Record<string, unknown>): ItemPedido[] | null {
  const crudo = args.productos;
  if (Array.isArray(crudo)) {
    return crudo.map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { codigo: String(o.producto ?? o.codigo ?? '').trim(), cantidad: Number(o.cantidad) };
    });
  }
  if (args.producto !== undefined && String(args.producto).trim()) return [{ codigo: String(args.producto).trim(), cantidad: Number(args.cantidad) }];
  return null;
}

/** Los ítems de un carrito guardado (para `proponer` sin `productos`). Pura. */
export function itemsDeCarrito(c: Carrito | null): ItemPedido[] | null {
  return c?.lineas.length ? c.lineas.map((l) => ({ codigo: l.codigo, cantidad: l.cantidad })) : null;
}

export function declaracionCarrito(o: { maxUnidades: number; codigo: string; extra?: string }): DeclaracionHerramienta {
  return {
    name: CARRITO,
    description: `El carrito de la compra, guardado: cada vez que el cliente agrega, quita o cambia un producto o sus unidades, llámala con el carrito ENTERO como queda (todos los productos, cada uno con ${o.codigo} y unidades, de 1 a ${o.maxUnidades}; si quita todo, con la lista vacía). Devuelve cada línea con su precio y el subtotal (sin flete). Todo el carrito se paga en UN solo link con un solo flete. Si devuelve error, haz lo que dice.${o.extra ? ` ${o.extra}` : ''}`,
    parameters: {
      type: 'object',
      properties: {
        productos: {
          type: 'array',
          items: { type: 'object', properties: { producto: { type: 'string', description: o.codigo }, cantidad: { type: 'integer', description: `unidades (1 a ${o.maxUnidades})` } }, required: ['producto', 'cantidad'] },
        },
      },
      required: ['productos'],
    },
  };
}

/** Corre la herramienta: resuelve con el catálogo del dominio y guarda. `pesos` formatea para el modelo. */
export async function usarCarrito(
  repo: RepoCarritos, conv: ConvCarrito, resolver: Resolver, args: Record<string, unknown>, o: { pesos: (n: number) => string; queHacer: string },
): Promise<ResultadoHerramienta> {
  const items = itemsDe(args);
  if (items === null) return { ok: false, datos: null, error: 'Pasa `productos`: el carrito entero como queda (lista vacía si quita todo).' };
  let lineas: LineaNueva[] = [];
  if (items.length) {
    const r = await resolver(items);
    if (!r.ok) return { ok: false, datos: null, error: r.error };
    lineas = r.lineas;
  }
  const g = await repo.guardarLineas(conv, lineas);
  if (!g.ok) {
    return { ok: false, datos: null, error: 'El cliente ya pagó (o está pagando) este pedido: no lo cambies. Si quiere algo más, es otra compra: arma un carrito nuevo cuando Bold confirme el pago; si dice que pagó, verificar_pago.' };
  }
  if (!g.carrito) {
    return { ok: true, datos: { items: [], carrito: [], vacio: true, que_hacer: 'El carrito quedó vacío. Pregúntale qué está buscando.' }, privado: { carrito: null } };
  }
  const c = g.carrito;
  return {
    ok: true,
    datos: {
      items: c.lineas.map((l) => ({ codigo: l.codigo, cantidad: l.cantidad })),
      carrito: c.lineas.map((l) => ({ codigo: l.codigo, producto: l.descripcion, precio: o.pesos(l.precioUnitario), cantidad: l.cantidad })),
      subtotal: o.pesos(subtotalLineas(c.lineas)),
      que_hacer: o.queHacer,
    },
    privado: { carrito: { id: c.id, version: c.version, resumen: resumenLineas(c.lineas) } },
  };
}
