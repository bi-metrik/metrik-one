import { describe, expect, it } from 'vitest';
import { decidirSeleccionGasto, type OpcionGasto } from './seleccion-gasto';
import { decidirConfirmacionGasto } from './monto-pendiente';

const OPCIONES: OpcionGasto[] = [
  { id: 'neg-1', label: 'C1 26 1 · Negocio 1', _tipo: 'negocio' },
  { id: 'neg-2', label: 'B1 26 2 · Barandas Conjunto', _tipo: 'negocio' },
  { id: 'empresa', label: '🏢 Gasto de empresa', _tipo: 'empresa' },
];

const decidir = (texto: string, botonId?: string) => decidirSeleccionGasto({ texto, botonId }, OPCIONES);

describe('respuesta a «¿Para cuál?» de un gasto', () => {
  it('número de la lista → esa opción; fuera de rango → re-pregunta', () => {
    expect(decidir('2')).toEqual({ accion: 'opcion', opcion: OPCIONES[1] });
    expect(decidir('9')).toEqual({ accion: 'repreguntar' });
    expect(decidir('0')).toEqual({ accion: 'repreguntar' });
  });

  it('botón → esa opción', () => {
    expect(decidir('', 'empresa')).toEqual({ accion: 'opcion', opcion: OPCIONES[2] });
  });

  it('código de un negocio fuera de la lista → se busca', () => {
    expect(decidir('Revisa el I1 26 5')).toEqual({ accion: 'codigo', codigo: 'I1 26 5' });
    expect(decidir('i1-26-5')).toEqual({ accion: 'codigo', codigo: 'I1 26 5' });
  });

  it('código de un negocio de la lista → esa opción, sin ir a la base', () => {
    expect(decidir('b1-26-2')).toEqual({ accion: 'opcion', opcion: OPCIONES[1] });
  });

  it('«cancelar» cancela; una frase que empieza por «no» NO', () => {
    expect(decidir('cancelar')).toEqual({ accion: 'cancelar' });
    expect(decidir('No')).toEqual({ accion: 'cancelar' });
    expect(decidir('No quiero, te estoy dando el id del negocio')).toEqual({
      accion: 'pista', texto: 'No quiero, te estoy dando el id del negocio',
    });
  });

  it('el texto de una opción → esa opción', () => {
    expect(decidir('gasto de empresa')).toEqual({ accion: 'opcion', opcion: OPCIONES[2] });
    expect(decidir('Empresa')).toEqual({ accion: 'opcion', opcion: OPCIONES[2] });
  });

  it('un nombre → se busca como pista; vacío o solo signos → re-pregunta', () => {
    expect(decidir('el de impervium')).toEqual({ accion: 'pista', texto: 'el de impervium' });
    expect(decidir('   ')).toEqual({ accion: 'repreguntar' });
    expect(decidir('???')).toEqual({ accion: 'repreguntar' });
  });
});

describe('texto sobre la confirmación que habla del negocio', () => {
  const fields = { descripcion: 'transportes' };
  it('un código cambia el negocio', () => {
    expect(decidirConfirmacionGasto({ texto: 'es el I1-26-5' }, fields, 27000)).toEqual({ accion: 'cambiar_negocio', codigo: 'I1 26 5' });
  });
  it('«te estoy dando el id del negocio» no es la descripción', () => {
    expect(decidirConfirmacionGasto({ texto: 'No quiero, te estoy dando el id del negocio' }, fields, 27000)).toEqual({ accion: 'aclarar_destino' });
    expect(decidirConfirmacionGasto({ texto: 'no, ese no es el negocio' }, fields, 27000)).toEqual({ accion: 'aclarar_destino' });
  });
  it('una descripción que nombra el proyecto sigue siendo descripción', () => {
    const d = decidirConfirmacionGasto({ texto: 'materiales para el proyecto de la bodega' }, fields, 27000);
    expect(d.accion).toBe('describir');
  });
});
