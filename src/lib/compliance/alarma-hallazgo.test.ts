/**
 * La alarma de hallazgo del oficial (P1, 2026-10-20).
 *
 * Lo que no puede fallar: que la alarma de una contraparte tenga UNA identidad
 * (la de la liberación que la cierra), y que la campana sepa cuáles no se
 * cierran leyendo.
 */

import { describe, it, expect } from 'vitest';
import {
  PREFIJO_ALARMA_HALLAZGO,
  contenidoAlarmaHallazgo,
  enlaceContraparte,
  grupoClaveHallazgo,
  seCierraDecidiendo,
} from './alarma-hallazgo';
import { claveContraparte, partesContraparte } from './liberaciones';

describe('grupoClaveHallazgo', () => {
  it('la consulta y la liberación de la misma contraparte comparten clave', () => {
    // La consulta guarda lo que se tecleó; la liberación, la identidad canónica.
    const deConsulta = grupoClaveHallazgo('nit ', '900.123.456-7');
    const p = partesContraparte('nit ', '900.123.456-7');
    const deLiberacion = grupoClaveHallazgo(p!.tipo, p!.numero);
    expect(deConsulta).not.toBeNull();
    expect(deConsulta).toBe(deLiberacion);
    expect(deConsulta).toBe(`${PREFIJO_ALARMA_HALLAZGO}${claveContraparte('NIT', '900123456')}`);
  });

  it('sin documento no hay clave: no hay sobre qué decidir', () => {
    expect(grupoClaveHallazgo(null, null)).toBeNull();
    expect(grupoClaveHallazgo('CC', '  ')).toBeNull();
  });
});

describe('seCierraDecidiendo', () => {
  it('solo las alarmas de hallazgo', () => {
    expect(seCierraDecidiendo(grupoClaveHallazgo('CC', '1020304050'))).toBe(true);
    expect(seCierraDecidiendo('conciliacion:REF123')).toBe(false);
    expect(seCierraDecidiendo(null)).toBe(false);
    expect(seCierraDecidiendo(undefined)).toBe(false);
  });
});

describe('enlaceContraparte', () => {
  it('abre la ficha de la contraparte', () => {
    expect(enlaceContraparte('NIT:900123456')).toBe('/compliance/liberaciones?c=NIT%3A900123456');
  });
  it('sin clave, la bandeja', () => {
    expect(enlaceContraparte(null)).toBe('/compliance/liberaciones');
  });
});

describe('contenidoAlarmaHallazgo', () => {
  it('nombra a la contraparte, cuenta y rotula', () => {
    const t = contenidoAlarmaHallazgo({
      nombre: 'Proveedor SAS',
      documentoTipo: 'NIT',
      documentoNumero: '900123456',
      totalMatches: 2,
      rotulo: 'Lista vinculante',
    });
    expect(t).toBe('Proveedor SAS salió con 2 coincidencias (Lista vinculante). Queda pendiente tu decisión.');
  });
  it('por nombre: dice que hay que volver a consultar con documento', () => {
    const t = contenidoAlarmaHallazgo({
      nombre: 'Fulano',
      documentoTipo: null,
      documentoNumero: null,
      totalMatches: 1,
      rotulo: null,
    });
    expect(t).toContain('solo por nombre');
    expect(t).toContain('1 coincidencia ');
  });
});
