// El respaldo por regex y las capas de defensa del parser (lo que corre cuando
// Gemini no responde, y lo que completa lo que el modelo omitio). Mensajes reales.
import { describe, expect, it } from 'vitest';
import { enrichFields, regexParse } from './wa-parse-reglas';
import { matchCategory } from './wa-lookup';

const parsear = (t: string) => enrichFields(regexParse(t), t);

describe('respaldo por regex: el gasto sale con su descripcion completa', () => {
  it('el caso de bancolombia', () => {
    const r = parsear('14400 para impresión de documentos para abrir la cuenta en bancolombia');
    expect(r.intent).toBe('GASTO');
    expect(r.fields.amount).toBe(14400);
    expect(r.fields.descripcion).toBe('impresión de documentos para abrir la cuenta en bancolombia');
  });

  it('DEWALT: proveedor y articulo, con el negocio aparte', () => {
    const r = parsear('Gasto en DEWALT por valor de 15.000 en ESCOBILLAS TALADRO correspondiente al proyecto B1 26 2');
    expect(r.intent).toBe('GASTO');
    expect(r.fields.amount).toBe(15000);
    expect(r.fields.project_code).toBe('B1 26 2');
    expect(r.fields.descripcion).toBe('DEWALT en ESCOBILLAS TALADRO');
  });

  it('"GASTOS DE ..." ya no cae en UNCLEAR', () => {
    const r = parsear('GASTOS DE TRANSPORTE ENTREGA BARANDAS POR 900.000 CORRSPONDIENTE AL PROYECTO B1 26 2');
    expect(r.intent).toBe('GASTO');
    expect(r.fields.amount).toBe(900000);
    expect(r.fields.descripcion).toBe('TRANSPORTE ENTREGA BARANDAS');
    expect(r.fields.category_hint).toBe('transporte');
  });

  it('solo-monto (respuesta al flujo guiado): gasto, sin descripcion', () => {
    const r = parsear('18900');
    expect(r.intent).toBe('GASTO');
    expect(r.fields.amount).toBe(18900);
    expect(r.fields.descripcion).toBeUndefined();
  });

  it('monto al inicio y texto despues', () => {
    const r = parsear('10700 invitacion café cierre T1261');
    expect(r.intent).toBe('GASTO');
    expect(r.fields.descripcion).toBe('invitacion café cierre');
  });

  it('ya no inventa una categoria con el concepto ("tintos" no existe en el CHECK)', () => {
    const r = parsear('gasté 50 mil en tintos para el proyecto Test');
    expect(r.fields.category_hint).toBe('alimentacion');
  });
});

describe('categorias por palabra clave (arreglo minimo)', () => {
  it('"la campana" (ferreteria) ya no es marketing', () => {
    const r = parsear('Gasto en la campana Tubería de 30x30 por valor de 3.572.920 correspondiente al proyecto B 1 26 2');
    expect(r.fields.category_hint).not.toBe('marketing');
  });

  it('"campaña" con eñe sigue siendo marketing', () => {
    const r = parsear('pagué 200 mil de la campaña de instagram');
    expect(r.fields.category_hint).toBe('marketing');
  });

  it('"GASTOS DE MANO DE OBRA" ya no cae en arriendo por la subcadena "gas"', () => {
    expect(matchCategory('GASTOS DE MANO DE OBRA')).not.toBe('arriendo');
    expect(matchCategory('recibo del gas de la bodega')).toBe('arriendo');
  });
});
