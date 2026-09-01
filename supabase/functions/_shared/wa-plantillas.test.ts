// Pruebas del registro de plantillas. Es un modulo puro a proposito: la decision de
// "plantilla o texto libre" es lo unico que separa un aviso que llega de uno que Meta
// rechaza con 131047, y no se puede probar contra la Graph API.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { leerRegistro, resolverAviso } from './wa-plantillas';

const REGISTRO_OK = JSON.stringify({
  W25: { name: 'saldo_vencido', lang: 'es', params: ['codigo', 'saldo', 'dias'] },
  W29: { name: 'resumen_semanal', lang: 'es', params: [] },
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('leerRegistro', () => {
  it('lee un registro bien formado', () => {
    const r = leerRegistro(REGISTRO_OK);
    expect(r.W25).toEqual({ name: 'saldo_vencido', lang: 'es', params: ['codigo', 'saldo', 'dias'] });
    expect(r.W29.params).toEqual([]);
  });

  it('un JSON roto no lanza: degrada a vacio', () => {
    // Es la propiedad que importa. Si lanzara, un secreto mal tecleado tumbaria el cron
    // entero y NINGUNA alerta saldria — peor que el problema que este frente arregla.
    expect(leerRegistro('{esto no es json')).toEqual({});
    expect(leerRegistro('["array"]')).toEqual({});
    expect(leerRegistro('"texto"')).toEqual({});
  });

  it('vacio y ausente son registro vacio', () => {
    expect(leerRegistro(undefined)).toEqual({});
    expect(leerRegistro('')).toEqual({});
    expect(leerRegistro('   ')).toEqual({});
  });

  it('descarta la entrada incompleta y conserva las sanas', () => {
    const r = leerRegistro(JSON.stringify({
      W25: { name: 'saldo_vencido', lang: 'es' },
      W29: { name: 'sin_idioma' },
      W33: { lang: 'es' },
    }));
    expect(Object.keys(r)).toEqual(['W25']);
    expect(r.W25.params).toEqual([]);
  });
});

describe('resolverAviso', () => {
  const reg = leerRegistro(REGISTRO_OK);

  it('arma los parametros del cuerpo en el orden declarado', () => {
    const r = resolverAviso(reg, 'W25', { saldo: '$1.000', dias: 42, codigo: 'A1 26 1', sobra: 'x' });
    expect(r.modo).toBe('plantilla');
    if (r.modo !== 'plantilla') return;
    expect(r.plantilla.name).toBe('saldo_vencido');
    expect(r.componentes[0].parameters.map((p) => p.text)).toEqual(['A1 26 1', '$1.000', '42']);
  });

  it('una plantilla sin variables no manda componentes', () => {
    const r = resolverAviso(reg, 'W29');
    expect(r.modo).toBe('plantilla');
    if (r.modo !== 'plantilla') return;
    expect(r.componentes).toEqual([]);
  });

  it('registro vacio => texto libre (es el estado de hoy, no un error)', () => {
    expect(resolverAviso({}, 'W25', { codigo: 'A1' })).toEqual({ modo: 'texto', motivo: 'sin_registro' });
  });

  it('intent no declarado => texto libre y lo nombra', () => {
    const r = resolverAviso(reg, 'stale_opps');
    expect(r).toEqual({ modo: 'texto', motivo: 'intent_sin_plantilla', detalle: 'stale_opps' });
  });

  it('una variable declarada que llega vacia NO se rellena con cadena vacia', () => {
    // Meta rechaza el parametro vacio; y si no lo rechazara, el cliente recibiria el aviso
    // con un hueco. Caer a texto libre es la unica salida que no miente.
    for (const faltante of [{}, { codigo: '' }, { codigo: '   ' }, { codigo: null }]) {
      const r = resolverAviso(reg, 'W25', { saldo: '$1', dias: 3, ...faltante });
      expect(r).toEqual({ modo: 'texto', motivo: 'variable_faltante', detalle: 'W25.codigo' });
    }
  });

  it('el cero es un valor, no una ausencia', () => {
    const r = resolverAviso(reg, 'W25', { codigo: 'A1', saldo: '$0', dias: 0 });
    expect(r.modo).toBe('plantilla');
    if (r.modo !== 'plantilla') return;
    expect(r.componentes[0].parameters[2].text).toBe('0');
  });

  it('aplana saltos de linea dentro de un parametro', () => {
    const r = resolverAviso(reg, 'W25', { codigo: 'A1\n  26\t1', saldo: '$1', dias: 1 });
    expect(r.modo).toBe('plantilla');
    if (r.modo !== 'plantilla') return;
    expect(r.componentes[0].parameters[0].text).toBe('A1 26 1');
  });
});
