import { describe, expect, it } from 'vitest'
import { abandonado, mismasLineas, pagoVigente, preciosCambiados, subtotalLineas, totalConFlete, vivoAlLeer } from './modelo'
import type { Carrito, LineaNueva, PagoCarrito } from './modelo'
import { carritoDeFila, carritosEnMemoria, errorDeCarrito, lineasParaBase } from './repo'
import { convDeContexto, itemsDe, itemsDeCarrito, usarCarrito } from './herramienta'

const CONV = { cuentaId: 77, conversacionId: 10, canal: 'otro' }
const L = (id: string, codigo: string, cantidad: number, precio: number): LineaNueva =>
  ({ itemTipo: 'ferreteria_publicacion', itemId: id, codigo, descripcion: `Producto ${codigo}`, cantidad, precioUnitario: precio });
const ENTREGA = { zona: 'bogota', ruta: 'despacho' as const, flete: 15000, nombre: 'Ana', telefono: '300', direccion: 'Calle 1' };
const link = (ref: string, huella: string, monto: number) => ({ referencia: ref, url: `https://checkout.bold.co/${ref}`, huella, monto, venceAt: '2099-01-01T00:00:00.000Z' });

describe('modelo del carrito', () => {
  it('subtotal en pesos enteros y UN flete', () => {
    const ls = [L('a', 'MP-62', 1, 220000), L('b', 'MP-64', 2, 30000)];
    expect(subtotalLineas(ls)).toBe(280000);
    expect(totalConFlete(ls, 15000)).toBe(295000);
  });

  it('mismas líneas compara producto, unidades y precio; los precios cambiados se nombran', () => {
    expect(mismasLineas([L('a', 'MP-62', 1, 220000)], [L('a', 'MP-62', 1, 220000)])).toBe(true);
    expect(mismasLineas([L('a', 'MP-62', 1, 220000)], [L('a', 'MP-62', 1, 230000)])).toBe(false);
    expect(preciosCambiados([L('a', 'MP-62', 1, 220000)], [L('a', 'MP-62', 1, 230000), L('b', 'MP-64', 1, 1)])).toEqual([{ codigo: 'MP-62', antes: 220000, ahora: 230000 }]);
  });

  it('un abierto viejo no está vivo; un en_pago sí; el link vigente es el último creado sin vencer', () => {
    const ahora = Date.parse('2026-11-04T12:00:00Z');
    const c = { estado: 'abierto', actividadAt: '2026-10-20T12:00:00Z' } as Carrito;
    expect(abandonado(c, ahora)).toBe(true);
    expect(vivoAlLeer(c, ahora)).toBeNull();
    expect(vivoAlLeer({ ...c, estado: 'en_pago' }, ahora)).not.toBeNull();
    const p = (ref: string, estado: PagoCarrito['estado'], venceAt: string) => ({ referencia: ref, estado, venceAt }) as PagoCarrito;
    expect(pagoVigente([p('A', 'creado', '2026-11-05T00:00:00Z'), p('B', 'vencido', '2026-11-06T00:00:00Z')], ahora)?.referencia).toBe('A');
    expect(pagoVigente([p('A', 'creado', '2026-11-03T00:00:00Z')], ahora)).toBeNull();
  });
});

describe('repositorio en memoria (las reglas de las funciones de la base)', () => {
  it('guardar, congelar, reabrir al cambiar y no cobrar otra versión', async () => {
    const { repo, estado } = carritosEnMemoria();
    const g1 = await repo.guardarLineas(CONV, [L('a', 'MP-62', 1, 220000)]);
    if (!g1.ok || !g1.carrito) throw new Error('sin carrito');
    expect(g1.carrito.version).toBe(1);
    expect((await repo.guardarLineas(CONV, [L('a', 'MP-62', 1, 220000)]) as { carrito: Carrito }).carrito.version).toBe(1);
    const g2 = await repo.guardarLineas(CONV, [L('a', 'MP-62', 1, 220000), L('b', 'MP-64', 1, 30000)]);
    const c = (g2 as { carrito: Carrito }).carrito;
    expect(c.version).toBe(2);

    expect(await repo.emitirPago(c.id, 1, ENTREGA, link('LNK_1', 'h1', 265000))).toEqual({ ok: false, error: 'carrito_cambio' });
    expect(await repo.emitirPago(c.id, 2, ENTREGA, link('LNK_1', 'h1', 1))).toEqual({ ok: false, error: 'monto_no_cuadra' });
    const e = await repo.emitirPago(c.id, 2, ENTREGA, link('LNK_1', 'h1', 265000));
    expect(e).toMatchObject({ ok: true, pago: { referencia: 'LNK_1', estado: 'creado' } });
    expect((await repo.vivo(CONV))?.estado).toBe('en_pago');
    // La misma huella: el mismo link.
    expect(await repo.emitirPago(c.id, 2, ENTREGA, link('LNK_2', 'h1', 265000))).toMatchObject({ ok: true, pago: { referencia: 'LNK_1' } });

    // Cambiar el carrito en pago: se reabre y el link queda vencido.
    await repo.guardarLineas(CONV, [L('a', 'MP-62', 2, 220000)]);
    expect((await repo.vivo(CONV))).toMatchObject({ estado: 'abierto', version: 3 });
    expect(estado.pagos[0].estado).toBe('vencido');
  });

  it('con un pago en curso el carrito no cambia; sin líneas se cancela', async () => {
    const m = carritosEnMemoria();
    const g = await m.repo.guardarLineas(CONV, [L('a', 'MP-62', 1, 220000)]);
    const c = (g as { carrito: Carrito }).carrito;
    await m.repo.emitirPago(c.id, 1, ENTREGA, link('LNK_1', 'h1', 235000));
    m.estado.pagos[0].estado = 'procesando';
    expect(await m.repo.guardarLineas(CONV, [])).toEqual({ ok: false, error: 'carrito_pagado' });
    m.registrar('LNK_1');
    expect(await m.repo.vivo(CONV)).toBeNull();
    // El siguiente carrito de la misma conversación es otro.
    const g2 = await m.repo.guardarLineas(CONV, [L('b', 'MP-64', 1, 30000)]);
    expect((g2 as { carrito: Carrito }).carrito.id).not.toBe(c.id);
    expect(await m.repo.guardarLineas(CONV, [])).toEqual({ ok: true, carrito: null });
    expect(m.estado.carritos.at(-1)?.estado).toBe('cancelado');
  });

  it('un carrito abierto sin cambios en 7 días se abandona', async () => {
    const m = carritosEnMemoria();
    await m.repo.guardarLineas(CONV, [L('a', 'MP-62', 1, 220000)]);
    m.envejecer(CONV, 8);
    expect(await m.repo.vivo(CONV)).toBeNull();
    await m.repo.guardarLineas(CONV, [L('b', 'MP-64', 1, 30000)]);
    expect(m.estado.carritos.map((c) => c.estado)).toEqual(['abandonado', 'abierto']);
  });
});

describe('de y hacia la base', () => {
  it('filas y errores de las funciones', () => {
    const c = carritoDeFila({
      id: 'c', dominio: 'ferreteria', chatwoot_cuenta_id: '77', chatwoot_conversacion_id: '10', chatwoot_contacto_id: null, canal: 'otro', estado: 'en_pago', version: 2,
      subtotal: '250000.00', flete: '15000.00', total: '265000.00', zona: 'bogota', ruta: 'despacho', actividad_at: 'x',
      carrito_lineas: [
        { id: 'l2', orden: 2, item_tipo: 't', item_id: 'b', codigo: 'MP-64', descripcion: null, cantidad: 1, precio_unitario: '30000.00', venta_id: null },
        { id: 'l1', orden: 1, item_tipo: 't', item_id: 'a', codigo: 'MP-62', descripcion: 'Batería', cantidad: 1, precio_unitario: '220000.00', venta_id: 'v' },
      ],
    });
    expect(c.conv).toEqual({ cuentaId: 77, conversacionId: 10, canal: 'otro', contactoId: null });
    expect(c.lineas.map((l) => l.codigo)).toEqual(['MP-62', 'MP-64']);
    expect(c.total).toBe(265000);
    expect(lineasParaBase([L('a', 'MP-62', 1, 220000.123)])[0]).toMatchObject({ item_id: 'a', precio_unitario: 220000.12 });
    expect(errorDeCarrito('P0001: carrito_cambio')).toBe('carrito_cambio');
    expect(errorDeCarrito('otra cosa')).toBeNull();
  });
});

describe('herramienta carrito', () => {
  it('la conversación sale del contexto; los productos de los argumentos o del carrito guardado', () => {
    expect(convDeContexto({ phone: '77:10', conversacion: [{ canal: 'otro' }] as never })).toEqual({ cuentaId: 77, conversacionId: 10, canal: 'otro' });
    expect(itemsDe({ productos: [{ producto: ' MP-62 ', cantidad: 2 }] })).toEqual([{ codigo: 'MP-62', cantidad: 2 }]);
    expect(itemsDe({ producto: 'MP-62', cantidad: 1 })).toEqual([{ codigo: 'MP-62', cantidad: 1 }]);
    expect(itemsDe({})).toBeNull();
    expect(itemsDeCarrito(null)).toBeNull();
  });

  it('guarda lo que resuelve el dominio y devuelve el subtotal; el error del dominio no guarda nada', async () => {
    const m = carritosEnMemoria();
    const resolver = async (items: Array<{ codigo: string; cantidad: number }>) =>
      items.some((i) => i.codigo === 'MP-99') ? { ok: false as const, error: 'no publicado', candado: 'producto_invalido' } : { ok: true as const, lineas: items.map((i) => L(i.codigo, i.codigo, i.cantidad, 100000)) };
    const pesos = (n: number) => `$${n}`;
    const r = await usarCarrito(m.repo, CONV, resolver, { productos: [{ producto: 'MP-62', cantidad: 2 }] }, { pesos, queHacer: 'x' });
    expect(r).toMatchObject({ ok: true, datos: { subtotal: '$200000', items: [{ codigo: 'MP-62', cantidad: 2 }] } });
    const mal = await usarCarrito(m.repo, CONV, resolver, { productos: [{ producto: 'MP-99', cantidad: 1 }] }, { pesos, queHacer: 'x' });
    expect(mal).toMatchObject({ ok: false, error: 'no publicado' });
    expect((await m.repo.vivo(CONV))?.lineas.map((l) => l.codigo)).toEqual(['MP-62']);
  });
});
