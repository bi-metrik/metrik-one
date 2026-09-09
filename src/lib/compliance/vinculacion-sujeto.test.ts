import { describe, expect, it } from 'vitest';

import {
  indexarVinculaciones,
  resumirVinculacion,
  type RefExpediente,
} from './vinculacion-sujeto';

/**
 * VERIFICADO POR MUTACIÓN
 *
 * Cada mutación se aplicó de verdad sobre `vinculacion-sujeto.ts` y se contó
 * cuántas pruebas se caen.
 *
 *  1. el cruce compara los documentos crudos en vez de `claveContraparte` (el
 *     "900.123.456-7" del expediente no encuentra al "9001234567" de la ficha
 *     y el proveedor sale como "sin expediente") -> cae 1
 *  2. manda el expediente más VIEJO (un proveedor rechazado en agosto se
 *     muestra con el aprobado de marzo) -> cae 1
 *  3. las filas sin documento se pegan igual, a la clave vacía (un expediente
 *     que no se puede pegar a nadie se le pega a cualquiera) -> cae 1
 *  4. el desempate por id no existe (dos filas con el mismo `actualizado_en`
 *     dejan a la ficha cambiando de rótulo entre dos cargas) -> cae 1
 *  5. un estado que ONE no conoce se descarta en vez de mostrarse crudo (si
 *     Valida agrega uno, la ficha finge que no hay expediente) -> cae 1
 */

function ref(over: Partial<RefExpediente> = {}): RefExpediente {
  return {
    expediente_kyc_id: 'exp-1',
    razon_social: 'Proveedora del Norte SAS',
    nombre: null,
    documento_tipo: 'NIT',
    documento_numero: '9001234567',
    estado_cache: 'aprobado',
    etapa_cache: 'archivo',
    actualizado_en: '2026-03-01T10:00:00.000Z',
    ...over,
  };
}

describe('indexarVinculaciones', () => {
  it('encuentra al sujeto aunque el documento venga escrito de otra forma', () => {
    const idx = indexarVinculaciones([ref({ documento_numero: '900.123.456-7' })]);
    // La ficha guarda el documento ya normalizado; el espejo puede no estarlo.
    expect(idx.get('NIT:9001234567')?.expediente_kyc_id).toBe('exp-1');
  });

  it('manda el expediente más reciente, no el aprobado', () => {
    const idx = indexarVinculaciones([
      ref({ expediente_kyc_id: 'viejo', estado_cache: 'aprobado', actualizado_en: '2026-03-01T10:00:00.000Z' }),
      ref({ expediente_kyc_id: 'nuevo', estado_cache: 'rechazado', actualizado_en: '2026-08-01T10:00:00.000Z' }),
    ]);
    const v = idx.get('NIT:9001234567');
    expect(v?.expediente_kyc_id).toBe('nuevo');
    expect(v?.etiqueta).toBe('Rechazado');
    // Y no esconde que hubo otro antes.
    expect(v?.total).toBe(2);
  });

  it('con la misma fecha elige siempre el mismo, venga en el orden que venga', () => {
    const a = ref({ expediente_kyc_id: 'aaa', estado_cache: 'aprobado' });
    const b = ref({ expediente_kyc_id: 'bbb', estado_cache: 'rechazado' });
    const uno = indexarVinculaciones([a, b]).get('NIT:9001234567');
    const otro = indexarVinculaciones([b, a]).get('NIT:9001234567');
    expect(uno?.expediente_kyc_id).toBe(otro?.expediente_kyc_id);
  });

  it('un expediente sin documento no se le pega a nadie', () => {
    const idx = indexarVinculaciones([
      ref({ expediente_kyc_id: 'huerfano', documento_tipo: null, documento_numero: null }),
    ]);
    expect(idx.size).toBe(0);
  });

  it('el que no tiene documento no contamina al que sí', () => {
    const idx = indexarVinculaciones([
      ref({ expediente_kyc_id: 'huerfano', documento_numero: null, actualizado_en: '2026-12-01T10:00:00.000Z' }),
      ref({ expediente_kyc_id: 'bueno' }),
    ]);
    const v = idx.get('NIT:9001234567');
    expect(v?.expediente_kyc_id).toBe('bueno');
    expect(v?.total).toBe(1);
  });

  it('dos contrapartes distintas no se mezclan', () => {
    const idx = indexarVinculaciones([
      ref({ expediente_kyc_id: 'uno' }),
      ref({ expediente_kyc_id: 'dos', documento_tipo: 'CC', documento_numero: '1020304050' }),
    ]);
    expect(idx.size).toBe(2);
    expect(idx.get('CC:1020304050')?.expediente_kyc_id).toBe('dos');
  });
});

describe('resumirVinculacion', () => {
  it('traduce el estado a lo que le toca hacer al oficial', () => {
    const v = resumirVinculacion(ref({ estado_cache: 'pendiente_revision' }), 1);
    expect(v.etiqueta).toBe('Por revisar');
    expect(v.accion).toBe('Firmó y quedó listo. Te toca decidir.');
  });

  it('un estado que ONE no conoce se muestra crudo, no se esconde', () => {
    const v = resumirVinculacion(ref({ estado_cache: 'en_pausa_por_contrato' }), 1);
    expect(v.estado).toBeNull();
    expect(v.etiqueta).toBe('en_pausa_por_contrato');
    expect(v.accion).toBe('Ábrelo en la bandeja para ver cómo va.');
  });

  it('conserva la fecha del último aviso recibido', () => {
    expect(resumirVinculacion(ref(), 1).actualizado_en).toBe('2026-03-01T10:00:00.000Z');
  });
});
