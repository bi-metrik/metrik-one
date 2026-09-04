/**
 * Estado de un sujeto de debida diligencia.
 *
 * Es la regla que le contesta al ejecutor "¿puedo contratar a este?". Si se
 * equivoca hacia el "sí", ONE habilita a alguien rechazado o con la vigencia
 * caducada; si se equivoca hacia el "no", frena contrataciones válidas y el
 * equipo deja de usar la pantalla. Por eso tiene pruebas propias.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-04) — cada mutación tumbó pruebas:
 *   - dejar que una consulta limpia posterior levante un rechazo → cae 1
 *   - ignorar `seguimiento` y devolver siempre 'habilitado' → cae 1
 *   - devolver 'sin_consultar' en vez de 'vencido' al caducar → caen 2
 *   - aceptar una consulta limpia ANTERIOR a la liberación vencida → cae 1
 *   - `venceEl < hoy` en vez de `>=` para seguir vigente → cae "el último día"
 *   - contar 'por vencer' como estado propio → cae la prueba de contratable
 */

import { describe, it, expect } from 'vitest';
import {
  claveSujeto,
  normalizarDocumento,
  porVencer,
  puedeGestionarSujetos,
  puedeVerSujetos,
  resumirSujetos,
  situacionSujeto,
  validarMotivoCierre,
  validarSujeto,
  type SituacionSujeto,
} from './sujetos';
import type { ComplianceLiberacion } from './liberaciones';

const HOY = '2026-09-04';
const RELACION_ABIERTA = { relacion_hasta: null };

function liberacion(over: Partial<ComplianceLiberacion> = {}): ComplianceLiberacion {
  return {
    id: 'lib-1',
    consulta_id: 'c-1',
    documento_tipo: 'NIT',
    documento_numero: '9001234567',
    nombre: 'Proveedor SAS',
    decision: 'liberada',
    justificacion: 'Homónimo descartado con cédula.',
    vigente_desde: '2026-06-01',
    vigente_hasta: '2027-06-01',
    control_id: null,
    liberada_por: 'u-1',
    created_at: '2026-06-01T10:00:00Z',
    ...over,
  };
}

describe('situacionSujeto', () => {
  it('sin liberación y sin consulta: sin consultar, no habilitado por defecto', () => {
    const s = situacionSujeto(RELACION_ABIERTA, [], null, HOY);
    expect(s.estado).toBe('sin_consultar');
    expect(s.fuente).toBeNull();
  });

  it('consulta limpia vigente habilita, aunque nunca haya pasado por el oficial', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [],
      { created_at: '2026-08-01T10:00:00Z', vigente_hasta: '2027-02-01' },
      HOY,
    );
    expect(s.estado).toBe('habilitado');
    expect(s.fuente).toBe('consulta');
    expect(s.venceEl).toBe('2027-02-01');
  });

  it('consulta limpia caducada deja vencido, no sin consultar', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [],
      { created_at: '2025-08-01T10:00:00Z', vigente_hasta: '2026-08-01' },
      HOY,
    );
    expect(s.estado).toBe('vencido');
  });

  it('sin periodicidad adoptada la consulta limpia habilita sin fecha', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [],
      { created_at: '2026-08-01T10:00:00Z', vigente_hasta: null },
      HOY,
    );
    expect(s.estado).toBe('habilitado');
    expect(s.venceEl).toBeNull();
  });

  it('liberación vigente sin condición: habilitado', () => {
    const s = situacionSujeto(RELACION_ABIERTA, [liberacion()], null, HOY);
    expect(s.estado).toBe('habilitado');
    expect(s.fuente).toBe('liberacion');
  });

  it('liberación vigente condicionada: en seguimiento', () => {
    const s = situacionSujeto(RELACION_ABIERTA, [liberacion({ seguimiento: true })], null, HOY);
    expect(s.estado).toBe('en_seguimiento');
  });

  it('el último día de vigencia todavía habilita', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [liberacion({ vigente_hasta: HOY })],
      null,
      HOY,
    );
    expect(s.estado).toBe('habilitado');
  });

  it('liberación caducada: vencido', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [liberacion({ vigente_hasta: '2026-09-03' })],
      null,
      HOY,
    );
    expect(s.estado).toBe('vencido');
    expect(s.venceEl).toBe('2026-09-03');
  });

  it('rechazo del oficial: inhabilitado', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [liberacion({ decision: 'rechazada', vigente_hasta: null })],
      null,
      HOY,
    );
    expect(s.estado).toBe('inhabilitado');
  });

  it('una consulta limpia POSTERIOR no levanta un rechazo del oficial', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [liberacion({ decision: 'rechazada', vigente_hasta: null, created_at: '2026-06-01T10:00:00Z' })],
      { created_at: '2026-09-01T10:00:00Z', vigente_hasta: '2027-09-01' },
      HOY,
    );
    expect(s.estado).toBe('inhabilitado');
  });

  it('consulta limpia posterior a una liberación vencida sí rehabilita', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [liberacion({ vigente_hasta: '2026-08-01', created_at: '2025-08-01T10:00:00Z' })],
      { created_at: '2026-09-01T10:00:00Z', vigente_hasta: '2027-09-01' },
      HOY,
    );
    expect(s.estado).toBe('habilitado');
    expect(s.fuente).toBe('consulta');
  });

  it('consulta limpia ANTERIOR a la liberación vencida no rehabilita', () => {
    const s = situacionSujeto(
      RELACION_ABIERTA,
      [liberacion({ vigente_hasta: '2026-08-01', created_at: '2026-05-01T10:00:00Z' })],
      { created_at: '2026-01-01T10:00:00Z', vigente_hasta: '2027-01-01' },
      HOY,
    );
    expect(s.estado).toBe('vencido');
    expect(s.fuente).toBe('liberacion');
  });

  it('cerrar la relación no cambia el estado de cumplimiento', () => {
    const s = situacionSujeto({ relacion_hasta: '2026-08-01' }, [liberacion()], null, HOY);
    expect(s.estado).toBe('habilitado');
    expect(s.relacionCerrada).toBe(true);
  });

  it('un cierre con fecha futura todavía no cierra la relación', () => {
    const s = situacionSujeto({ relacion_hasta: '2026-12-31' }, [liberacion()], null, HOY);
    expect(s.relacionCerrada).toBe(false);
  });
});

describe('porVencer', () => {
  const base: SituacionSujeto = {
    estado: 'habilitado',
    venceEl: null,
    fuente: 'consulta',
    relacionCerrada: false,
  };

  it('avisa dentro del margen', () => {
    expect(porVencer({ ...base, venceEl: '2026-09-20' }, HOY)).toBe(true);
  });

  it('no avisa fuera del margen', () => {
    expect(porVencer({ ...base, venceEl: '2026-12-20' }, HOY)).toBe(false);
  });

  it('un vencido no está "por vencer": ya venció', () => {
    expect(porVencer({ ...base, estado: 'vencido', venceEl: '2026-08-01' }, HOY)).toBe(false);
  });

  it('el que está en seguimiento también avisa', () => {
    expect(porVencer({ ...base, estado: 'en_seguimiento', venceEl: '2026-09-10' }, HOY)).toBe(true);
  });

  it('sin fecha de vencimiento no avisa', () => {
    expect(porVencer(base, HOY)).toBe(false);
  });
});

describe('identidad', () => {
  it('normaliza igual que la clave de contraparte', () => {
    expect(normalizarDocumento('900.123.456-7')).toBe('9001234567');
    expect(normalizarDocumento(' 1 020 304 ')).toBe('1020304');
  });

  it('dos escrituras del mismo NIT dan la misma clave', () => {
    const a = claveSujeto({ documento_tipo: 'nit', documento_numero: '900.123.456-7' });
    const b = claveSujeto({ documento_tipo: 'NIT ', documento_numero: '9001234567' });
    expect(a).toBe(b);
    expect(a).toBe('NIT:9001234567');
  });
});

describe('validarSujeto', () => {
  const ok = { tipo: 'proveedor', documento_tipo: 'NIT', documento_numero: '900123456', nombre: 'Acme SAS' };

  it('acepta un input completo', () => {
    expect(validarSujeto(ok)).toBeNull();
  });

  it('rechaza un tipo que no está en el catálogo', () => {
    expect(validarSujeto({ ...ok, tipo: 'aliado' })).not.toBeNull();
  });

  it('rechaza un documento que solo tiene puntos y guiones', () => {
    expect(validarSujeto({ ...ok, documento_numero: '.-.-' })).not.toBeNull();
  });

  it('exige nombre', () => {
    expect(validarSujeto({ ...ok, nombre: ' ' })).not.toBeNull();
  });
});

describe('validarMotivoCierre', () => {
  it('no deja cerrar sin motivo', () => {
    expect(validarMotivoCierre('   ')).not.toBeNull();
  });

  it('acepta un motivo escrito', () => {
    expect(validarMotivoCierre('Terminó el contrato de obra.')).toBeNull();
  });
});

describe('permisos', () => {
  it('el ejecutor ve y gestiona la base', () => {
    expect(puedeVerSujetos('operator')).toBe(true);
    expect(puedeGestionarSujetos('operator')).toBe(true);
  });

  it('el contador y quien no tiene rol no la ven', () => {
    expect(puedeVerSujetos('contador')).toBe(false);
    expect(puedeVerSujetos(null)).toBe(false);
  });
});

describe('resumirSujetos', () => {
  it('cuenta por estado y no confunde por vencer con vencido', () => {
    const situaciones: SituacionSujeto[] = [
      { estado: 'habilitado', venceEl: '2026-09-10', fuente: 'consulta', relacionCerrada: false },
      { estado: 'habilitado', venceEl: '2027-09-10', fuente: 'consulta', relacionCerrada: false },
      { estado: 'vencido', venceEl: '2026-01-10', fuente: 'consulta', relacionCerrada: true },
      { estado: 'inhabilitado', venceEl: null, fuente: 'liberacion', relacionCerrada: false },
    ];
    const r = resumirSujetos(situaciones, HOY);
    expect(r.total).toBe(4);
    expect(r.habilitado).toBe(2);
    expect(r.vencido).toBe(1);
    expect(r.inhabilitado).toBe(1);
    expect(r.porVencer).toBe(1);
    expect(r.relacionesCerradas).toBe(1);
  });
});
