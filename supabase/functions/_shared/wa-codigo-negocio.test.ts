import { describe, expect, it } from 'vitest';
import { extraerCodigoNegocio, llaveCodigo } from './wa-codigo-negocio';
import { enrichFields, regexParse } from './wa-parse-reglas';

describe('extraerCodigoNegocio', () => {
  it.each([
    ['I1 26 5', 'I1 26 5'],
    ['i1 26 5', 'I1 26 5'],
    ['I1-26-5', 'I1 26 5'],
    ['i1-26-5', 'I1 26 5'],
    ['I1.26.5', 'I1 26 5'],
    ['I1  26   5', 'I1 26 5'],
    ['I1265', 'I1 26 5'],
    ['Revisa el I1 26 5', 'I1 26 5'],
    ['es el i1-26-5 porfa', 'I1 26 5'],
    ['al negocio S12 26 13.', 'S12 26 13'],
    ['P 26 1', 'P 26 1'],
    ['B1 26 02', 'B1 26 2'],
  ])('«%s» → %s', (texto, esperado) => {
    expect(extraerCodigoNegocio(texto)).toBe(esperado);
  });

  it.each([
    'Registra un gasto de 27000 por transportes al proyecto impervium',
    'No quiero, te estoy dando el id del negocio',
    'pagué 50 mil',
    'a 25 3', // minúscula sin dígito: un artículo, no un código
    'KAE-2',
    'I1 15 5', // año fuera de 20-29
    'mi celular 3159509103',
    'I1 26', // sin consecutivo
    '',
  ])('«%s» → null', (texto) => {
    expect(extraerCodigoNegocio(texto)).toBeNull();
  });

  it('null y undefined → null', () => {
    expect(extraerCodigoNegocio(null)).toBeNull();
    expect(extraerCodigoNegocio(undefined)).toBeNull();
  });
});

describe('llaveCodigo', () => {
  it('ignora espacios, guiones y mayúsculas', () => {
    expect(llaveCodigo('i1-26-5')).toBe(llaveCodigo('I1 26 5'));
    expect(llaveCodigo('I1 26 5')).not.toBe(llaveCodigo('I1 26 50'));
  });
});

describe('el parser determinista saca el código del negocio', () => {
  it.each([
    ['gasté 27000 en transporte I1-26-5', 'I1 26 5'],
    ['gasté 27000 en transporte i1 26 5', 'I1 26 5'],
    ['Gasto en DEWALT por 15.000 correspondiente al proyecto B1 26 2', 'B1 26 2'],
  ])('«%s» → project_code %s', (texto, esperado) => {
    expect(enrichFields(regexParse(texto), texto).fields.project_code).toBe(esperado);
  });
});
