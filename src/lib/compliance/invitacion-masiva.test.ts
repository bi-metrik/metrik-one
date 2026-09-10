/**
 * Invitación a expediente en lote.
 *
 * Es la regla que decide a QUIÉN se le manda un correo real, con el nombre de
 * la empresa encima y sin reversa. Un falso "invitable" le escribe a un
 * desvinculado o le vuelve a escribir a quien ya contestó; un falso excluido
 * deja un proveedor sin expediente y nadie se entera hasta la auditoría.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-10) — cada mutación tumbó pruebas:
 *   - invitar igual a quien ya tiene expediente abierto → caen 2
 *   - invitar a alguien con la relación cerrada → caen 3
 *   - poner "sin correo" por encima de "ya salió" → cae 1
 *   - cruzar el espejo por documento crudo y no por `claveContraparte` → cae 1
 *   - decidir el tipo de persona del empleado por su documento → cae 1
 *   - que `invitables` devuelva todo el plan → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  invitables,
  planearInvitacionMasiva,
  tipoPersonaDe,
  type SujetoInvitable,
} from './invitacion-masiva';
import type { RefExpediente } from './vinculacion-sujeto';

const HOY = '2026-09-10';

function sujeto(over: Partial<SujetoInvitable> = {}): SujetoInvitable {
  return {
    id: 'suj-1',
    tipo: 'proveedor',
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    nombre: 'Ferretería del Norte SAS',
    correo: 'compras@ferre.co',
    relacion_hasta: null,
    ...over,
  };
}

function ref(over: Partial<RefExpediente> = {}): RefExpediente {
  return {
    expediente_kyc_id: 'exp-1',
    razon_social: 'Ferretería del Norte SAS',
    nombre: null,
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    estado_cache: 'en_curso',
    etapa_cache: null,
    actualizado_en: '2026-09-01T00:00:00Z',
    ...over,
  };
}

describe('planearInvitacionMasiva', () => {
  it('un tercero vivo, con correo y sin expediente es invitable', () => {
    const plan = planearInvitacionMasiva([sujeto()], [], HOY);
    expect(plan.items[0].estado).toBe('invitable');
    expect(plan.items[0].detalle).toContain('compras@ferre.co');
  });

  it('a quien ya tiene expediente NO se le vuelve a escribir', () => {
    const plan = planearInvitacionMasiva([sujeto()], [ref()], HOY);
    expect(plan.items[0].estado).toBe('ya_tiene_expediente');
  });

  it('el cruce con el espejo usa la clave normalizada', () => {
    const plan = planearInvitacionMasiva(
      [sujeto()],
      [ref({ documento_tipo: ' nit ', documento_numero: '900.123.456' })],
      HOY,
    );
    expect(plan.items[0].estado).toBe('ya_tiene_expediente');
  });

  it('a un desvinculado no se le pide documentación', () => {
    const plan = planearInvitacionMasiva([sujeto({ relacion_hasta: '2026-08-31' })], [], HOY);
    expect(plan.items[0].estado).toBe('relacion_cerrada');
  });

  it('un cierre con fecha futura todavía es invitable: sigue adentro', () => {
    const plan = planearInvitacionMasiva([sujeto({ relacion_hasta: '2026-12-31' })], [], HOY);
    expect(plan.items[0].estado).toBe('invitable');
  });

  it('la relación cerrada gana sobre la falta de correo, para no invitar a completarlo', () => {
    const plan = planearInvitacionMasiva(
      [sujeto({ relacion_hasta: '2026-08-31', correo: null })],
      [],
      HOY,
    );
    expect(plan.items[0].estado).toBe('relacion_cerrada');
  });

  it('sin correo se cuenta aparte, no se descarta callado', () => {
    const plan = planearInvitacionMasiva([sujeto({ correo: null })], [], HOY);
    expect(plan.items[0].estado).toBe('sin_correo');
    expect(plan.resumen.sin_correo).toBe(1);
  });

  it('solo los invitables reciben correo', () => {
    const plan = planearInvitacionMasiva(
      [
        sujeto({ id: 'a' }),
        sujeto({ id: 'b', documento_numero: '800111222', correo: null }),
        sujeto({ id: 'c', documento_numero: '800333444', relacion_hasta: '2026-01-01' }),
      ],
      [],
      HOY,
    );
    expect(invitables(plan).map((i) => i.sujeto_id)).toEqual(['a']);
    expect(plan.resumen.invitable).toBe(1);
  });

  it('el espejo apagado viaja en el plan para poder avisarlo', () => {
    const plan = planearInvitacionMasiva([sujeto()], [], HOY, false);
    expect(plan.espejoVivo).toBe(false);
    // Y sin espejo nadie sale como ya invitado: es justo el riesgo que se avisa.
    expect(plan.items[0].estado).toBe('invitable');
  });
});

describe('tipoPersonaDe', () => {
  it('un empleado es persona natural aunque el documento diga otra cosa', () => {
    expect(tipoPersonaDe('empleado', 'NIT')).toBe('natural');
  });

  it('un proveedor con NIT es persona jurídica', () => {
    expect(tipoPersonaDe('proveedor', 'NIT')).toBe('juridica');
  });

  it('un contratista con cédula es persona natural', () => {
    expect(tipoPersonaDe('contratista', 'CC')).toBe('natural');
  });

  it('el tipo de documento se lee sin importar espacios ni minúsculas', () => {
    expect(tipoPersonaDe('cliente', ' nit ')).toBe('juridica');
  });
});
