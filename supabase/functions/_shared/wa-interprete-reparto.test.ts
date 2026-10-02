import { describe, expect, it, vi } from 'vitest';
import { armarPlan, armarSegmentos, pendienteDeLaCaja, viajeDeLaCaja, type DestinoPlan, type MensajeViaje, type ViajeAbierto } from './wa-viajes-reglas.ts';
import { checkInboundLimit } from './wa-rate-limit.ts';
import { seguirConLaCola } from './handlers/registro/cola-gastos.ts';
import type { HandlerContext } from './types.ts';

/**
 * Lo que el intérprete deja guardado con el mensaje (`wa_bandeja_mensajes.interpretacion`) y cómo lo
 * usa el reparto al cerrar la tanda (`armarSegmentos`, `pendienteDeLaCaja`). Sin `interpretacion`, el
 * reparto es el de hoy: lo prueban sin cambios las pruebas y el snapshot de `wa-viajes-reglas`, y aquí
 * se comprueba que una `interpretacion` nula da exactamente lo mismo que ninguna.
 * También: el tope de 30 por hora sin las filas de la bandeja, y la cola de gastos.
 */

const V14: ViajeAbierto = { id: 'v14', codigo: 'T1 26 14', cliente: 'LINA PÉREZ', destino: 'CARTAGENA' };
const V11: ViajeAbierto = { id: 'v11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA' };
const V12: ViajeAbierto = { id: 'v12', codigo: 'T1 26 12', cliente: 'JORGE PÉREZ', destino: 'MADRID' };
const V = [V11, V12, V14];
const t = (n: number) => new Date(Date.parse('2026-10-02T14:00:00Z') + n * 60_000).toISOString();
const rv = (n: number, cuerpo: string): MensajeViaje => ({ n, cuerpo, reenviado: true, tipo: 'text', en: t(n) });
const esc = (n: number, cuerpo: string, interpretacion?: MensajeViaje['interpretacion']): MensajeViaje =>
  ({ n, cuerpo, reenviado: false, tipo: 'text', en: t(n), ...(interpretacion !== undefined ? { interpretacion } : {}) });
const CFG = { horasCajaActiva: 4 };
const destino = (d: DestinoPlan | null) => (d ? (d.tipo === 'existente' ? d.codigo : `NUEVO ${d.cliente}`) : null);
const reparto = (ms: MensajeViaje[]) => {
  const { segmentos, encabezados } = armarSegmentos(ms, V, CFG);
  return { segmentos, encabezados, plan: armarPlan({ mensajes: ms, viajes: V, segmentos, encabezados, codigosCerrados: new Set() }) };
};

describe('armarSegmentos con la interpretación del intérprete', () => {
  it('la caja que decidió el intérprete sobrevive al cierre: «lo de Cartagena» es Lina Pérez, sin volver a preguntar', () => {
    const sin = reparto([esc(1, 'lo de Cartagena'), rv(2, 'Vale al final vamos 4, se suma mi cuñada')]);
    // Hoy: por el destino es `aproximado` y la caja queda esperando la elección de la lista.
    expect(sin.segmentos[0].encabezado?.resolucion.tipo).toBe('aproximado');
    expect(pendienteDeLaCaja(sin.segmentos)).toMatchObject({ tipo: 'eleccion' });
    const con = reparto([esc(1, 'lo de Cartagena', { accion: 'abrir_viaje', viaje_id: 'v14' }), rv(2, 'Vale al final vamos 4, se suma mi cuñada')]);
    expect(viajeDeLaCaja(con.segmentos[0])).toEqual(V14);
    expect(pendienteDeLaCaja(con.segmentos)).toBeNull();
    expect(con.plan.mensajes.map(m => [m.n, destino(m.destino)])).toEqual([[2, 'T1 26 14']]);
  });

  it('el encabezado que también es contenido: abre la caja y entra a ella como mensaje', () => {
    const r = reparto([esc(1, 'y la de Punta Cana me dijo que prefiere todo incluido', { accion: 'abrir_viaje', viaje_id: 'v11', con_contenido: true }), rv(2, 'y con piscina')]);
    expect(r.encabezados).toEqual([]);
    expect(r.segmentos[0].mensajes).toEqual([1, 2]);
    expect(r.plan.mensajes.map(m => [m.n, destino(m.destino)])).toEqual([[1, 'T1 26 11'], [2, 'T1 26 11']]);
  });

  it('un cliente nuevo nombrado en una frase, la elección de la lista y el nombre después de «nuevo» sin nombre', () => {
    const nuevo = reparto([esc(1, 'me escribió un cliente nuevo, Daniel Pérez, quiere ir a China', { accion: 'abrir_viaje', nuevo: 'Daniel Pérez', con_contenido: true })]);
    expect(nuevo.plan.mensajes.map(m => destino(m.destino))).toEqual(['NUEVO Daniel Pérez']);

    const lista = reparto([esc(1, 'Pérez', { accion: 'preguntar_viaje', candidatos: ['v12', 'v14'] }), rv(2, 'somos 2'), esc(3, 'son de la de Cartagena', { accion: 'responder', viaje_id: 'v14' })]);
    expect(lista.segmentos[0].eleccion).toEqual({ viaje: V14, n: 3 });
    expect(lista.encabezados).toEqual([1, 3]);
    expect(lista.plan.mensajes.map(m => [m.n, destino(m.destino)])).toEqual([[2, 'T1 26 14']]);

    const nombre = reparto([esc(1, 'nuevo cliente', { accion: 'abrir_viaje', nuevo: null }), rv(2, 'somos 3'), esc(3, 'se llama Andrés Gómez', { accion: 'nombre', nuevo: 'Andrés Gómez' })]);
    expect(nombre.segmentos[0].nombre).toEqual({ texto: 'Andrés Gómez', n: 3 });
  });

  it('`contenido`: no se relee como encabezado aunque su texto lo parezca', () => {
    const sin = reparto([esc(1, 'Carolina'), rv(2, 'hola'), esc(3, 'Jorge')]);
    expect(sin.encabezados).toEqual([1, 3]);
    const con = reparto([esc(1, 'Carolina'), rv(2, 'hola'), esc(3, 'Jorge', { accion: 'contenido' })]);
    expect(con.encabezados).toEqual([1]);
    expect(con.segmentos[0].mensajes).toEqual([2, 3]);
  });

  it('una interpretación que ya no aplica (el viaje se cerró) cae al reparto de hoy', () => {
    const hoy = reparto([esc(1, 'Carolina'), rv(2, 'hola')]);
    const viejo = reparto([esc(1, 'Carolina', { accion: 'abrir_viaje', viaje_id: 'v-cerrado' }), rv(2, 'hola')]);
    expect(viejo).toEqual(hoy);
  });

  it('sin interpretación (nula o ausente) el resultado es idéntico al de hoy', () => {
    const base = [esc(1, 'Carolina'), rv(2, 'salimos el 28'), esc(3, 'Pérez'), rv(4, 'somos 3'), esc(5, '2'), esc(6, 'nuevo cliente'), rv(7, 'x'), esc(8, 'Marta Gil')];
    const nulos = base.map(m => (m.reenviado ? m : { ...m, interpretacion: null }));
    expect(reparto(nulos)).toEqual(reparto(base));
  });
});

describe('tope de 30 por hora: las filas `bandeja.%` del intérprete no cuentan', () => {
  it('checkInboundLimit excluye interprete_accion like bandeja.% (y cuenta las filas de siempre, con nulo)', async () => {
    const filtros: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'or']) q[m] = (...a: unknown[]) => { filtros.push(`${m}(${a.map(x => JSON.stringify(x)).join(',')})`); return q; };
    q.then = (r: (v: unknown) => unknown) => Promise.resolve({ count: 3 }).then(r);
    expect(await checkInboundLimit({ from: () => q }, '573000000001')).toBe(true);
    expect(filtros).toContain('or("interprete_accion.is.null,interprete_accion.not.like.bandeja.*")');
    expect(filtros).toContain('eq("direction","inbound")');
  });
});

describe('cola de gastos', () => {
  it('sin cola no hace nada: ni una consulta', async () => {
    const ctx = { session: { context: {} }, supabase: new Proxy({}, { get: () => { throw new Error('no debía consultar'); } }) } as unknown as HandlerContext;
    await expect(seguirConLaCola(ctx)).resolves.toBeUndefined();
  });

  it('con cola, el siguiente gasto sale con «Gasto 2 de 3» y su propia confirmación', async () => {
    const enviados: string[] = [];
    const botones: string[] = [];
    const sesionNueva = { id: 's2', state: 'started', context: {}, workspace_id: 'ws', user_phone: 'p', intent: null, started_at: '', expires_at: '' };
    const updates: unknown[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'gt', 'order', 'limit', 'in', 'not', 'ilike']) q[m] = () => q;
    q.single = async () => ({ data: sesionNueva, error: null });
    q.maybeSingle = async () => ({ data: null, error: null });
    q.update = (p: unknown) => { updates.push(p); return q; };
    q.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r);
    const ctx = {
      user: { workspace_id: 'ws', role: 'owner' }, message: { phone: 'p', text: 'x' },
      session: { id: 's1', context: { gastos_en_cola: [{ monto: 90000, descripcion: 'gasolina', negocio: 'empresa', mensaje: 'x' }, { monto: 18900, descripcion: 'peaje', negocio: 'empresa', mensaje: 'x' }], gastos_total: 3 } },
      supabase: { from: () => q, rpc: async () => ({ data: [], error: null }) },
      sendMessage: async (s: string) => { enviados.push(s); },
      sendButtons: async (b: string) => { botones.push(b); },
      sendOptions: vi.fn(),
    } as unknown as HandlerContext;
    await seguirConLaCola(ctx);
    expect(enviados[0]).toBe('Gasto 2 de 3: te pido el sí de cada uno, uno a la vez.');
    expect(botones[0]).toMatch(/Gasto de empresa:[\s\S]*\$\s?90\.000/);
    expect(updates.some(u => JSON.stringify(u).includes('"gastos_en_cola":[{"monto":18900'))).toBe(true);
  });
});
