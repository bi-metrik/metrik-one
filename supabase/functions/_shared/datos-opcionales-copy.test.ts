/**
 * SOE-021 (2026-10-20): el `{radicado}` del aviso de Certificación de SOENA y el pie
 * «Caso:» del correo al cliente.
 *
 * La forma plana es la del bloque `radicado_de_certificacion` de SOENA:
 * `data.radicado_certificacion = "VEH_GEE2026178166"`.
 */
import { describe, expect, it } from 'vitest';
import { lineaCasoHtml, valorDelCampo } from './datos-opcionales-copy.ts';

describe('valorDelCampo', () => {
  it('lee el dato plano cuando el bloque no tiene `campos` (radicado de certificación)', () => {
    const data = { radicado_certificacion: ' VEH_GEE2026178166 ' };
    expect(valorDelCampo(data, 'radicado_certificacion')).toBe('VEH_GEE2026178166');
  });

  it('un bloque de formulario sigue leyendo `campos[campo].value`', () => {
    const data = { campos: { marca: { value: ' TOYOTA ' } } };
    expect(valorDelCampo(data, 'marca')).toBe('TOYOTA');
  });

  it('si `campos[campo]` existe, manda aunque esté vacío: no cae al plano', () => {
    const data = { campos: { marca: { value: '' } }, marca: 'PLANO' };
    expect(valorDelCampo(data, 'marca')).toBe('');
  });

  it('cae al plano si `campos` existe pero no trae ese campo', () => {
    const data = { campos: { otro: { value: 'x' } }, radicado_certificacion: 'VEH_1' };
    expect(valorDelCampo(data, 'radicado_certificacion')).toBe('VEH_1');
  });

  it('el plano que no es texto no cuenta', () => {
    expect(valorDelCampo({ radicado_certificacion: 123 }, 'radicado_certificacion')).toBe('');
    expect(valorDelCampo({ radicado_certificacion: { value: 'x' } }, 'radicado_certificacion')).toBe('');
    expect(valorDelCampo(undefined, 'radicado_certificacion')).toBe('');
    expect(valorDelCampo(null, 'radicado_certificacion')).toBe('');
  });
});

describe('lineaCasoHtml', () => {
  const escapar = (s: string) => s.replaceAll('<', '&lt;');

  it('nombra el código del negocio como «Caso», no como «Radicado»', () => {
    const html = lineaCasoHtml('V0583', escapar);
    expect(html).toContain('Caso: <strong');
    expect(html).toContain('V0583');
    expect(html).not.toContain('Radicado');
  });

  it('escapa el código y no pinta nada sin código', () => {
    expect(lineaCasoHtml('<b>', escapar)).toContain('&lt;b>');
    expect(lineaCasoHtml(null, escapar)).toBe('');
    expect(lineaCasoHtml('', escapar)).toBe('');
  });
});
