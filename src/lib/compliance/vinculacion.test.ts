/**
 * Reglas del expediente de vinculación.
 *
 * Lo que se prueba acá no es formato: es lo que decide si el oficial aprueba a
 * una contraparte con información que en realidad no tiene. La trampa central
 * del módulo es que un documento que la IA no pudo leer se ve igual que un
 * documento leído sin hallazgos, y en los dos casos la pantalla queda vacía.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-04) — cada mutación tumbó pruebas:
 *   - tratar `estado_extraccion: 'pendiente'` como leído → cae 1
 *   - contar como sin confirmar también los ya confirmados → cae 1
 *   - dejar decidir cualquier expediente → caen 3
 *   - descartar los campos cuyo doc_id no está en la lista de documentos → cae 1
 *   - aceptar cualquier motivo de rechazo → cae 1
 *   - tratar el arreglo vacío como valor lleno → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  agruparCamposPorDocumento,
  alertasDeExpediente,
  camposSinConfirmar,
  camposSinLlenar,
  documentosSinLeer,
  etiquetaCampo,
  etiquetaSlot,
  mostrarValor,
  nombreContraparte,
  progresoEtapa,
  puedeDecidirse,
  puedeDecidirVinculacion,
  puedeVerVinculacion,
  razonNoDecidible,
  resumirExpedientes,
  slotsFaltantes,
  validarMotivoRechazo,
  type ExpedienteCampo,
  type ExpedienteDoc,
  type ExpedienteFila,
} from './vinculacion';

function doc(over: Partial<ExpedienteDoc> = {}): ExpedienteDoc {
  return {
    doc_id: 'd1',
    slot: 'rut',
    tipo_doc: 'rut',
    estado_extraccion: 'ok',
    vigencia_hasta: null,
    mime: 'application/pdf',
    size_bytes: 1000,
    subido_en: '2026-09-01T00:00:00Z',
    procesado_en: '2026-09-01T00:05:00Z',
    ...over,
  };
}

function campo(over: Partial<ExpedienteCampo> = {}): ExpedienteCampo {
  return {
    campo_id: 'c1',
    doc_id: 'd1',
    slug: 'nit',
    value: '900123456',
    confidence: 0.95,
    confidence_estado: 'extraido',
    source_hint: null,
    evidencia: 'NIT 900.123.456-7',
    reason_if_null: null,
    origen: 'ia',
    confirmado_contraparte: false,
    ...over,
  };
}

function fila(over: Partial<ExpedienteFila> = {}): ExpedienteFila {
  return {
    expediente_id: 'e1',
    razon_social: 'Constructora Ejemplo SAS',
    nombre: null,
    documento_tipo: 'NIT',
    documento_numero: '900123456',
    estado: 'pendiente_revision',
    etapa_actual: 'revision_oc',
    email_contraparte: 'contacto@ejemplo.co',
    fecha_invitacion: '2026-08-01T00:00:00Z',
    fecha_cierre: null,
    creado_en: '2026-08-01T00:00:00Z',
    ...over,
  };
}

describe('un documento sin leer no es un documento limpio', () => {
  it('cuenta como sin leer todo lo que no quedó en ok', () => {
    const docs = [
      doc({ doc_id: 'a', estado_extraccion: 'ok' }),
      doc({ doc_id: 'b', estado_extraccion: 'pendiente' }),
      doc({ doc_id: 'c', estado_extraccion: 'failed' }),
      doc({ doc_id: 'd', estado_extraccion: 'no_key' }),
      doc({ doc_id: 'e', estado_extraccion: null }),
    ];
    expect(documentosSinLeer(docs).map((d) => d.doc_id)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('avisa que los campos no están, no que vinieran vacíos', () => {
    const alertas = alertasDeExpediente([doc({ estado_extraccion: 'failed' })], []);
    const a = alertas.find((x) => x.clave === 'documentos_sin_leer');
    expect(a).toBeDefined();
    expect(a!.texto).toContain('no es que vinieran vacíos');
  });

  it('un expediente con todo leído no genera esa alerta', () => {
    const alertas = alertasDeExpediente([doc()], [campo()]);
    expect(alertas.find((x) => x.clave === 'documentos_sin_leer')).toBeUndefined();
  });
});

describe('campos que el oficial tiene que mirar', () => {
  it('solo cuenta sin confirmar los que pedían confirmación y no la tienen', () => {
    const campos = [
      campo({ campo_id: '1', confidence_estado: 'requiere_confirmacion', confirmado_contraparte: false }),
      campo({ campo_id: '2', confidence_estado: 'requiere_confirmacion', confirmado_contraparte: true }),
      campo({ campo_id: '3', confidence_estado: 'extraido', confirmado_contraparte: false }),
    ];
    expect(camposSinConfirmar(campos).map((c) => c.campo_id)).toEqual(['1']);
  });

  it('un obligatorio con arreglo vacío sigue sin llenar', () => {
    const campos = [
      campo({ campo_id: '1', confidence_estado: 'manual_obligatorio', value: [] }),
      campo({ campo_id: '2', confidence_estado: 'manual_obligatorio', value: '   ' }),
      campo({ campo_id: '3', confidence_estado: 'manual_obligatorio', value: null }),
      campo({ campo_id: '4', confidence_estado: 'manual_obligatorio', value: 'Bogotá' }),
      campo({ campo_id: '5', confidence_estado: 'manual_obligatorio', value: false }),
    ];
    expect(camposSinLlenar(campos).map((c) => c.campo_id)).toEqual(['1', '2', '3']);
  });

  it('los slots del kit que nadie subió salen como faltantes', () => {
    const kit = ['camara_comercio', 'rut', 'estados_financieros', 'cedula_rl'];
    const docs = [doc({ doc_id: 'a', slot: 'rut' }), doc({ doc_id: 'b', slot: 'cedula_rl' })];
    expect(slotsFaltantes(kit, docs)).toEqual(['camara_comercio', 'estados_financieros']);
  });

  it('sin kit conocido no inventa documentos faltantes', () => {
    const alertas = alertasDeExpediente([doc()], [campo()], []);
    expect(alertas.find((x) => x.clave === 'documentos_faltantes')).toBeUndefined();
  });
});

describe('cuándo se puede decidir', () => {
  it('solo con el expediente en pendiente_revision', () => {
    expect(puedeDecidirse('pendiente_revision')).toBe(true);
    expect(puedeDecidirse('en_proceso')).toBe(false);
    expect(puedeDecidirse('invitado')).toBe(false);
    expect(puedeDecidirse('aprobado')).toBe(false);
  });

  it('un expediente ya decidido dice que la decisión no se reescribe', () => {
    expect(razonNoDecidible('aprobado')).toContain('no se reescribe');
    expect(razonNoDecidible('rechazado')).toContain('no se reescribe');
  });

  it('uno a medio llenar explica que falta la contraparte', () => {
    expect(razonNoDecidible('en_proceso')).toContain('no ha terminado');
  });

  it('el decidible no trae razón', () => {
    expect(razonNoDecidible('pendiente_revision')).toBeNull();
  });
});

describe('el motivo del rechazo', () => {
  it('no acepta vacío ni una palabra suelta', () => {
    expect(validarMotivoRechazo('')).not.toBeNull();
    expect(validarMotivoRechazo('   ')).not.toBeNull();
    expect(validarMotivoRechazo('no')).not.toBeNull();
  });

  it('acepta un motivo escrito de verdad', () => {
    expect(validarMotivoRechazo('Aparece en lista vinculante ONU')).toBeNull();
  });
});

describe('agrupación por documento', () => {
  it('agrupa siguiendo el orden en que se subieron los documentos', () => {
    const docs = [doc({ doc_id: 'a', slot: 'camara_comercio' }), doc({ doc_id: 'b', slot: 'rut' })];
    const campos = [
      campo({ campo_id: '1', doc_id: 'b' }),
      campo({ campo_id: '2', doc_id: 'a' }),
    ];
    const grupos = agruparCamposPorDocumento(campos, docs);
    expect(grupos.map((g) => g.titulo)).toEqual(['Cámara de comercio', 'RUT']);
  });

  it('un campo cuyo documento no vino en la lista no se pierde', () => {
    const docs = [doc({ doc_id: 'a', slot: 'rut' })];
    const campos = [campo({ campo_id: '1', doc_id: 'a' }), campo({ campo_id: '2', doc_id: 'zzz' })];
    const grupos = agruparCamposPorDocumento(campos, docs);
    const todos = grupos.flatMap((g) => g.campos.map((c) => c.campo_id));
    expect(todos).toContain('2');
  });

  it('los campos sin documento van en su propio grupo, al final', () => {
    const docs = [doc({ doc_id: 'a', slot: 'rut' })];
    const campos = [campo({ campo_id: '1', doc_id: null }), campo({ campo_id: '2', doc_id: 'a' })];
    const grupos = agruparCamposPorDocumento(campos, docs);
    expect(grupos[grupos.length - 1].titulo).toBe('Escrito por la contraparte');
    expect(grupos[grupos.length - 1].docId).toBeNull();
  });
});

describe('permisos', () => {
  it('la vinculación es del oficial de cumplimiento', () => {
    expect(puedeVerVinculacion('owner')).toBe(true);
    expect(puedeVerVinculacion('admin')).toBe(true);
    expect(puedeVerVinculacion('supervisor')).toBe(false);
    expect(puedeVerVinculacion('operator')).toBe(false);
    expect(puedeVerVinculacion(null)).toBe(false);
  });

  it('quien ve es quien decide', () => {
    for (const rol of ['owner', 'admin', 'supervisor', 'operator', 'read_only', null]) {
      expect(puedeDecidirVinculacion(rol)).toBe(puedeVerVinculacion(rol));
    }
  });
});

describe('presentación', () => {
  it('el progreso ubica la etapa en la secuencia', () => {
    expect(progresoEtapa('invitacion')).toEqual({ paso: 1, total: 8 });
    expect(progresoEtapa('revision_oc')).toEqual({ paso: 7, total: 8 });
    expect(progresoEtapa('lo_que_sea')).toEqual({ paso: 0, total: 8 });
  });

  it('el nombre cae a la razón social, al nombre y al documento en ese orden', () => {
    expect(nombreContraparte({ razon_social: 'ACME SAS', nombre: 'x', documento_numero: '1' })).toBe('ACME SAS');
    expect(nombreContraparte({ razon_social: null, nombre: 'Ana Ruiz', documento_numero: '1' })).toBe('Ana Ruiz');
    expect(nombreContraparte({ razon_social: '  ', nombre: null, documento_numero: '900123' })).toBe('Sin nombre (900123)');
    expect(nombreContraparte({ razon_social: null, nombre: null, documento_numero: null })).toBe('Sin nombre');
  });

  it('el resumen cuenta por estado y da el total', () => {
    const r = resumirExpedientes([
      fila({ expediente_id: '1', estado: 'pendiente_revision' }),
      fila({ expediente_id: '2', estado: 'pendiente_revision' }),
      fila({ expediente_id: '3', estado: 'aprobado' }),
    ]);
    expect(r.pendiente_revision).toBe(2);
    expect(r.aprobado).toBe(1);
    expect(r.rechazado).toBe(0);
    expect(r.total).toBe(3);
  });

  it('un slot desconocido se muestra legible en vez de crudo', () => {
    expect(etiquetaSlot('camara_comercio')).toBe('Cámara de comercio');
    expect(etiquetaSlot('algo_nuevo')).toBe('algo nuevo');
    expect(etiquetaCampo('razon_social')).toBe('Razon social');
  });

  it('el valor se muestra sea escalar, arreglo u objeto', () => {
    expect(mostrarValor('Bogotá')).toBe('Bogotá');
    expect(mostrarValor(42)).toBe('42');
    expect(mostrarValor(true)).toBe('true');
    expect(mostrarValor(['a', 'b'])).toBe('a, b');
    expect(mostrarValor({ ciudad: 'Cali' })).toBe('{"ciudad":"Cali"}');
    expect(mostrarValor(null)).toBe('');
  });
});
