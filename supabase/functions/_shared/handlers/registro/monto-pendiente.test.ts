// Las decisiones puras del flujo guiado del gasto (ver `monto-pendiente.ts`). El recorrido
// entero por los handlers vive en `gasto-guardado.test.ts`.
import { describe, expect, it } from 'vitest';
import {
  MAX_REINTENTOS_MONTO,
  MSG_MONTO,
  decidirConfirmacionGasto,
  decidirMontoPendiente,
  montoDeRespuesta,
  unirDescripciones,
  unirMensajes,
} from './monto-pendiente';

describe('montoDeRespuesta', () => {
  it.each([
    ['18900', 18900],
    ['18.900', 18900],
    ['$ 18.900', 18900],
    ['18900 peaje', 18900],
    ['50 mil de almuerzo', 50000],
    ['500', 500],
    ['$500', 500],
  ])('%s -> %d', (texto, monto) => {
    expect(montoDeRespuesta(texto)).toBe(monto);
  });

  it.each(['peaje', '3 peajes', 'mis números', ''])('"%s" no trae monto', (texto) => {
    expect(montoDeRespuesta(texto)).toBeUndefined();
  });
});

describe('unirDescripciones', () => {
  it('no repite el mismo detalle, con o sin tildes ni mayusculas', () => {
    expect(unirDescripciones('peaje', 'Peaje')).toBe('peaje');
    expect(unirDescripciones('cafe', 'café reunión')).toBe('café reunión');
  });
  it('une detalles distintos en orden', () => {
    expect(unirDescripciones('peaje', 'autopista norte')).toBe('peaje autopista norte');
  });
  it('con uno solo, ese', () => {
    expect(unirDescripciones(undefined, 'peaje')).toBe('peaje');
    expect(unirDescripciones('peaje', undefined)).toBe('peaje');
  });
  it('unirMensajes conserva los dos mensajes', () => {
    expect(unirMensajes('Registrar gasto', '18900')).toBe('Registrar gasto / 18900');
    expect(unirMensajes(undefined, '18900')).toBe('18900');
  });
});

describe('decidirMontoPendiente', () => {
  const previos = { descripcion: 'peaje', mensaje_original: 'Registrar gasto de peaje' };

  it('con monto combina los campos del primer mensaje', () => {
    expect(decidirMontoPendiente('18900', previos, 0)).toEqual({
      accion: 'continuar',
      fields: { descripcion: 'peaje', amount: 18900, mensaje_original: 'Registrar gasto de peaje / 18900' },
    });
  });

  it('toma un codigo de negocio de la respuesta si el primero no lo traia', () => {
    const d = decidirMontoPendiente('18900 peaje B1 26 2', {}, 0);
    if (d.accion !== 'continuar') throw new Error(d.accion);
    expect(d.fields.project_code).toBe('B1 26 2');
    expect(d.fields.descripcion).toBe('peaje');
  });

  it('respeta el codigo del primer mensaje', () => {
    const d = decidirMontoPendiente('18900 B2 26 1', { project_code: 'B1 26 2' }, 0);
    if (d.accion !== 'continuar') throw new Error(d.accion);
    expect(d.fields.project_code).toBe('B1 26 2');
  });

  it('sin monto repregunta hasta el tope y luego suelta', () => {
    let reintentos = 0;
    for (let i = 0; i < MAX_REINTENTOS_MONTO; i++) {
      const d = decidirMontoPendiente('mmm', {}, reintentos);
      if (d.accion !== 'repreguntar') throw new Error(d.accion);
      reintentos = d.reintentos;
    }
    expect(decidirMontoPendiente('mmm', {}, reintentos)).toEqual({ accion: 'cerrar', mensaje: MSG_MONTO.rendicion });
  });

  it('una respuesta corta ("ok") no se guarda como detalle', () => {
    const d = decidirMontoPendiente('ok', {}, 0);
    if (d.accion !== 'repreguntar') throw new Error(d.accion);
    expect(d.fields.descripcion).toBeUndefined();
  });

  it('"no" corto cancela; "no recuerdo cuánto fue" no', () => {
    expect(decidirMontoPendiente('no', {}, 0)).toEqual({ accion: 'cerrar', mensaje: MSG_MONTO.cancelado });
    expect(decidirMontoPendiente('no recuerdo cuánto fue', {}, 0).accion).toBe('repreguntar');
  });

  it.each(['mis números', 'cartera', 'hola'])('"%s" es otra orden: suelta', (texto) => {
    expect(decidirMontoPendiente(texto, {}, 0)).toEqual({ accion: 'cerrar', mensaje: MSG_MONTO.otraOrden });
  });
});

describe('decidirConfirmacionGasto', () => {
  const fields = { concept: 'peaje', category_hint: 'transporte', descripcion: 'peaje', mensaje_original: 'a' };

  it('los botones mandan', () => {
    expect(decidirConfirmacionGasto({ texto: 'Peaje', botonId: 'btn_confirm' }, fields, 1).accion).toBe('confirmar');
    expect(decidirConfirmacionGasto({ texto: 'Peaje', botonId: 'btn_cancel' }, fields, 1).accion).toBe('cancelar');
  });

  it.each(['si', 'Sí', 'dale', 'listo', 'ok 👍'])('"%s" confirma', (texto) => {
    expect(decidirConfirmacionGasto({ texto }, fields, 1).accion).toBe('confirmar');
  });

  it.each(['no', 'cancelar', 'No gracias'])('"%s" cancela', (texto) => {
    expect(decidirConfirmacionGasto({ texto }, fields, 1).accion).toBe('cancelar');
  });

  it('una descripcion larga con marcas de si/no sigue siendo descripcion', () => {
    expect(decidirConfirmacionGasto({ texto: 'ya pagado el peaje de la via' }, fields, 1).accion).toBe('describir');
  });

  it('la descripcion nueva reemplaza la anterior y suelta concepto y categoria viejos', () => {
    expect(decidirConfirmacionGasto({ texto: 'almuerzo del equipo' }, fields, 18900)).toEqual({
      accion: 'describir',
      fields: { descripcion: 'almuerzo del equipo', mensaje_original: 'a / almuerzo del equipo' },
    });
  });

  it('el mismo monto en el texto se limpia; otro monto no es descripcion', () => {
    const d = decidirConfirmacionGasto({ texto: '18900 de peaje' }, {}, 18900);
    if (d.accion !== 'describir') throw new Error(d.accion);
    expect(d.fields.descripcion).toBe('peaje');
    expect(decidirConfirmacionGasto({ texto: '20000' }, {}, 18900).accion).toBe('botones');
  });

  it('sin detalle tras limpiar: botones', () => {
    expect(decidirConfirmacionGasto({ texto: 'gasto' }, {}, 18900).accion).toBe('botones');
    expect(decidirConfirmacionGasto({ texto: '' }, {}, 18900).accion).toBe('botones');
  });
});
