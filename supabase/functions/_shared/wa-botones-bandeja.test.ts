import { describe, expect, it } from 'vitest';
import {
  canonicoDelToque, esBotonDeBandeja, huella, idBoton, leerToque, MAX_TITULO_BOTON, TITULO_CARGAR, TITULO_DESCARTAR, TITULO_NO_ES,
  TITULO_SI_CARGARLOS, TITULO_SI_CREALO, TITULO_SI_ES,
} from './wa-botones-bandeja.ts';
import { botonesDelResumen } from './wa-viajes-reglas.ts';
import type { PlanViajes } from './wa-viajes-reglas.ts';

/** Los botones de la bandeja (2026-10-05): el id, la huella del reparto y qué botones lleva cada resumen. Datos inventados. */

const existente = { tipo: 'existente' as const, negocio_id: 'n-1', codigo: 'F 26 1', cliente: 'FERMÍN OCAMPO' };
const plan = (o: Partial<PlanViajes> = {}): PlanViajes => ({
  version: 2,
  mensajes: [{ n: 1, destino: existente, por: 'encabezado' as never }, { n: 2, destino: existente, por: 'encabezado' as never }],
  encabezados: [],
  avisos: [],
  ...o,
});

describe('el id del botón', () => {
  it('se lee de vuelta: capa, acción, la entrega y la versión', () => {
    const id = idBoton('r', 'si', 'e-1', 'abc');
    expect(esBotonDeBandeja(id)).toBe(true);
    expect(leerToque(id)).toEqual({ capa: 'r', accion: 'si', ref: 'e-1', version: 'abc' });
  });
  it('un id que no es de la bandeja, o mal formado, no es un toque de la bandeja', () => {
    expect(esBotonDeBandeja('acepto_terminos')).toBe(false);
    expect(leerToque('bdj|r|si')).toBeNull();
    expect(leerToque('bdj|x|si|e-1|-')).toBeNull();
    expect(leerToque('bdj|r|cargar|e-1|-')).toBeNull();
  });
  it('cada toque se contesta con el mismo texto que ya lee el código', () => {
    expect([canonicoDelToque('si'), canonicoDelToque('no'), canonicoDelToque('des')]).toEqual(['sí', 'no', 'descartar']);
  });
  it('los títulos caben en los 20 caracteres de Meta', () => {
    for (const t of [TITULO_CARGAR, TITULO_DESCARTAR, TITULO_SI_ES, TITULO_NO_ES, TITULO_SI_CARGARLOS, TITULO_SI_CREALO]) {
      expect(t.length).toBeLessThanOrEqual(MAX_TITULO_BOTON);
    }
  });
});

describe('la huella del reparto', () => {
  it('no depende del orden de las claves y cambia con cualquier corrección', () => {
    const a = plan();
    const b = JSON.parse(JSON.stringify({ avisos: a.avisos, encabezados: a.encabezados, mensajes: a.mensajes, version: 2 }));
    expect(huella(a)).toBe(huella(b));
    const quitado = plan({ mensajes: [a.mensajes[0], { ...a.mensajes[1], descartado: true }] });
    expect(huella(quitado)).not.toBe(huella(a));
  });
});

describe('los botones de cada resumen', () => {
  const titulos = (p: PlanViajes) => botonesDelResumen(p, 'e-1').map(b => b.title);
  it('listo para cargar: «Cargar» y «Descartar», con la huella del reparto en el id', () => {
    const p = plan();
    const bs = botonesDelResumen(p, 'e-1');
    expect(bs.map(b => b.title)).toEqual([TITULO_CARGAR, TITULO_DESCARTAR]);
    expect(leerToque(bs[0].id)).toEqual({ capa: 'r', accion: 'si', ref: 'e-1', version: huella(p) });
  });
  it('con algo por decidir (⚠) o sin viaje: solo «Descartar»', () => {
    expect(titulos(plan({ mensajes: [{ n: 1, destino: existente, por: null, sospecha: true, motivo: 'saluda a mitad de la caja' }] }))).toEqual([TITULO_DESCARTAR]);
    expect(titulos(plan({ mensajes: [{ n: 1, destino: null, por: null, motivo: 'sin viaje' }] }))).toEqual([TITULO_DESCARTAR]);
  });
  it('un viaje nuevo sin la llave del cliente: solo «Descartar» (sin llave no se crea)', () => {
    const nuevo = { tipo: 'nuevo' as const, cliente: 'Laura Prueba', falta: 'llave' as const };
    expect(titulos(plan({ mensajes: [{ n: 1, destino: nuevo as never, por: null }] }))).toEqual([TITULO_DESCARTAR]);
  });
});
