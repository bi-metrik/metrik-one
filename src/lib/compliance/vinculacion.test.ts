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
 *   - volver a meter cola y fallo en la misma bolsa → caen 3
 *   - contar los pendientes como ilegibles → caen 3
 *   - decirle al oficial que la cola falló → cae 1
   - pedir constancia siempre, aunque el expediente esté completo → cae 1
   - aprobar sin constancia un expediente con documentos sin leer → cae 1
   - contar los soportes de la cadena como documentos del kit → cae 1
   - no avisar de la cadena incompleta → caen 2
   - meter `cadena_sin_resolver` entre las que exigen constancia → cae 1
   - aprobar sin constancia un expediente de cadena incompleta → cae 1
   - `faltantesPorSocio` repite el mismo faltante dos veces → cae 1
   - `llegoElArchivo` siempre true: el documento vuelve a contarse por la fila
     y no por el archivo → caen 5
   - `llegoElArchivo` exige el campo, así que una respuesta que todavía no lo
     informa inventa documentos faltantes → caen 10
   - `slotsFaltantes` no filtra por archivo → caen 3
   - las alertas de lectura vuelven a mirar todo el kit y avisan de un
     documento que no llegó como si estuviera en cola → caen 2
   - lo mismo con los ilegibles → cae 1
   - `resumirIntegridad(null)` calla en vez de avisar: lo que nadie pudo
     comprobar se ve igual que un sello que cuadra → cae 1
   - `no_coincide` se reporta con el mismo tono que `coincide` → cae 1
   - `no_verificable` se reporta como `grave`: se acusa de alterado un
     expediente que nadie tocó → cae 1
   - `sin_firmar` pinta bloque → cae 1
   - un sello que no cuadra deja aprobar igual → cae 1
   - no poder verificar el sello bloquea como si hubiera hallazgo → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  agruparCamposPorDocumento,
  alertasDeExpediente,
  exigeConstanciaSinLectura,
  camposSinConfirmar,
  camposSinLlenar,
  documentosEnCola,
  documentosIlegibles,
  documentosSinLeer,
  etiquetaCampo,
  etiquetaParada,
  etiquetaSlot,
  faltantesPorSocio,
  mostrarValor,
  nombreContraparte,
  progresoEtapa,
  resumirIntegridad,
  selloImpideAprobar,
  puedeDecidirse,
  puedeDecidirVinculacion,
  puedeVerVinculacion,
  razonNoDecidible,
  resumirExpedientes,
  slotsFaltantes,
  llegoElArchivo,
  validarMotivoRechazo,
  type ExpedienteCampo,
  type ExpedienteDoc,
  type ExpedienteFila,
} from './vinculacion';
import type { Integridad } from './vinculacion';
import type { CadenaPublica } from './vinculacion-publica';

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

describe('un documento registrado que nunca llegó', () => {
  const kit = ['rut', 'cedula_rl'];

  it('cuenta como faltante, no como entregado', () => {
    const docs = [doc({ doc_id: 'a', slot: 'rut', archivo_presente: false }), doc({ doc_id: 'b', slot: 'cedula_rl' })];
    expect(slotsFaltantes(kit, docs)).toEqual(['rut']);
  });

  it('un documento de una respuesta que no informa el archivo se sigue dando por entregado', () => {
    const docs = [doc({ doc_id: 'a', slot: 'rut' }), doc({ doc_id: 'b', slot: 'cedula_rl' })];
    expect(slotsFaltantes(kit, docs)).toEqual([]);
  });

  it('no le pone al oficial dos alertas que se contradicen', () => {
    const docs = [doc({ doc_id: 'a', slot: 'rut', estado_extraccion: 'pendiente', archivo_presente: false })];
    const alertas = alertasDeExpediente(docs, [], kit);

    expect(alertas.find((a) => a.clave === 'documentos_faltantes')?.cuantos).toBe(2);
    expect(alertas.find((a) => a.clave === 'documentos_en_cola')).toBeUndefined();
  });

  it('el que sí llegó y está en cola sigue avisando', () => {
    const docs = [
      doc({ doc_id: 'a', slot: 'rut', estado_extraccion: 'pendiente', archivo_presente: false }),
      doc({ doc_id: 'b', slot: 'cedula_rl', estado_extraccion: 'pendiente', archivo_presente: true }),
    ];
    const alertas = alertasDeExpediente(docs, [], kit);

    expect(alertas.find((a) => a.clave === 'documentos_faltantes')?.cuantos).toBe(1);
    expect(alertas.find((a) => a.clave === 'documentos_en_cola')?.cuantos).toBe(1);
  });

  it('tampoco se cuenta como ilegible: no es que no se pudiera leer, es que no está', () => {
    const docs = [doc({ doc_id: 'a', slot: 'rut', estado_extraccion: 'failed', archivo_presente: false })];
    const alertas = alertasDeExpediente(docs, [], kit);
    expect(alertas.find((a) => a.clave === 'documentos_sin_leer')).toBeUndefined();
  });

  it('llegoElArchivo distingue los tres casos', () => {
    expect(llegoElArchivo(doc({ archivo_presente: true }))).toBe(true);
    expect(llegoElArchivo(doc({ archivo_presente: false }))).toBe(false);
    expect(llegoElArchivo(doc())).toBe(true);
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

describe('en cola no es lo mismo que ilegible', () => {
  const doc = (slot: string, estado: string | null) =>
    ({ slot, estado_extraccion: estado }) as never;

  it('un documento en cola no cuenta como ilegible', () => {
    const docs = [doc('rut', 'pendiente')];
    expect(documentosEnCola(docs)).toHaveLength(1);
    expect(documentosIlegibles(docs)).toHaveLength(0);
  });

  it('uno que falló sí cuenta como ilegible y no como en cola', () => {
    const docs = [doc('rut', 'failed')];
    expect(documentosIlegibles(docs)).toHaveLength(1);
    expect(documentosEnCola(docs)).toHaveLength(0);
  });

  it('un documento leído no cae en ninguna de las dos', () => {
    const docs = [doc('rut', 'ok')];
    expect(documentosEnCola(docs)).toHaveLength(0);
    expect(documentosIlegibles(docs)).toHaveLength(0);
  });

  it('la alerta de cola no le dice al oficial que la lectura falló', () => {
    const alertas = alertasDeExpediente([doc('rut', 'pendiente')], [], []);
    const cola = alertas.find((a) => a.clave === 'documentos_en_cola');
    expect(cola).toBeDefined();
    expect(cola?.texto).not.toContain('no se pudo leer');
    expect(alertas.find((a) => a.clave === 'documentos_sin_leer')).toBeUndefined();
  });

  it('cola y fallo conviven como dos alertas distintas', () => {
    const alertas = alertasDeExpediente(
      [doc('rut', 'pendiente'), doc('cedula_rl', 'failed')],
      [],
      [],
    );
    expect(alertas.find((a) => a.clave === 'documentos_en_cola')?.cuantos).toBe(1);
    expect(alertas.find((a) => a.clave === 'documentos_sin_leer')?.cuantos).toBe(1);
  });
});


// ─── La constancia de aprobar sin respaldo ────────────────────────────────

describe('exigeConstanciaSinLectura', () => {
  const alerta = (clave: string) => ({ clave, texto: 'x', cuantos: 1 }) as never;

  it('la pide cuando falta un documento, o nadie lo leyó, o no se pudo leer, o la contraparte no confirmó', () => {
    for (const clave of [
      'documentos_faltantes',
      'documentos_en_cola',
      'documentos_sin_leer',
      'campos_sin_confirmar',
    ]) {
      expect(exigeConstanciaSinLectura([alerta(clave)])).toBe(true);
    }
  });

  it('no la pide con el expediente completo: una casilla marcada siempre no distingue nada', () => {
    expect(exigeConstanciaSinLectura([])).toBe(false);
    // Un campo que el documento no traía es algo que el oficial ve; no es
    // información que la plataforma le esté escondiendo.
    expect(exigeConstanciaSinLectura([alerta('campos_sin_llenar')])).toBe(false);
  });
});

describe('la cadena hasta el beneficiario final, del lado del oficial', () => {
  function cadena(over: Partial<CadenaPublica> = {}): CadenaPublica {
    return {
      completa: true,
      pendientes: [],
      beneficiarios: [],
      sin_resolver: [],
      suma_directa: 100,
      suma_excedida: false,
      ...over,
    };
  }

  it('los soportes de un socio no cuentan como documentos del kit', () => {
    const alertas = alertasDeExpediente(
      [
        doc({ doc_id: 'd1', slot: 'rut', estado_extraccion: 'ok' }),
        // El soporte del socio no se lee automáticamente. Contarlo acá le
        // pondría al oficial una alerta del kit por un documento que el kit
        // nunca pidió.
        doc({
          doc_id: 'd2',
          slot: 'soporte_bf',
          persona_id: 'p1',
          estado_extraccion: 'failed',
        }),
      ],
      [],
      ['rut'],
    );
    expect(alertas.map((a) => a.clave)).toEqual([]);
  });

  it('una cadena incompleta es una alerta, con cuántos socios le faltan', () => {
    const alertas = alertasDeExpediente(
      [doc()],
      [],
      ['rut'],
      cadena({
        completa: false,
        pendientes: [
          { persona_id: 'p1', nombre: 'Inversiones X', falta: 'soporte' },
          { persona_id: 'p1', nombre: 'Inversiones X', falta: 'socios' },
        ],
      }),
    );
    const a = alertas.find((x) => x.clave === 'cadena_incompleta');
    // Dos faltantes del mismo socio son un socio, no dos.
    expect(a?.cuantos).toBe(1);
  });

  it('los porcentajes que se pasan de 100 se dicen como lo que son', () => {
    const alertas = alertasDeExpediente(
      [doc()],
      [],
      ['rut'],
      cadena({ completa: false, suma_excedida: true }),
    );
    expect(alertas.find((x) => x.clave === 'cadena_incompleta')?.texto).toContain('100%');
  });

  it('una rama sin beneficiario final identificado se avisa aparte, no como faltante', () => {
    const alertas = alertasDeExpediente(
      [doc()],
      [],
      ['rut'],
      cadena({
        sin_resolver: [{ persona_id: 'p1', nombre: 'Offshore Ltd', justificacion: 'Se negó.' }],
      }),
    );
    expect(alertas.map((a) => a.clave)).toEqual(['cadena_sin_resolver']);
    expect(alertas[0].texto).toContain('Offshore Ltd');
  });

  it('sin cadena no se inventa alerta: los expedientes viejos no la traen', () => {
    expect(alertasDeExpediente([doc()], [], ['rut'])).toEqual([]);
    expect(alertasDeExpediente([doc()], [], ['rut'], null)).toEqual([]);
  });

  it('la cadena incompleta exige constancia; la rama declarada no', () => {
    // Incompleta = el expediente no sabe quién está detrás.
    expect(
      exigeConstanciaSinLectura([{ clave: 'cadena_incompleta', texto: 'x', cuantos: 1 }]),
    ).toBe(true);
    // Declarada y justificada = el oficial decide sobre algo que puede leer.
    expect(
      exigeConstanciaSinLectura([{ clave: 'cadena_sin_resolver', texto: 'x', cuantos: 1 }]),
    ).toBe(false);
  });

  it('los faltantes se agrupan por socio y sin repetir', () => {
    const mapa = faltantesPorSocio({
      completa: false,
      pendientes: [
        { persona_id: 'p1', nombre: 'X', falta: 'soporte' },
        { persona_id: 'p1', nombre: 'X', falta: 'soporte' },
        { persona_id: 'p1', nombre: 'X', falta: 'socios' },
        { persona_id: 'p2', nombre: 'Y', falta: 'porcentaje' },
      ],
      beneficiarios: [],
      sin_resolver: [],
      suma_directa: 0,
      suma_excedida: false,
    });
    expect(mapa.get('p1')).toEqual(['soporte', 'socios']);
    expect(mapa.get('p2')).toEqual(['porcentaje']);
  });

  it('la parada se nombra para quien revisa, y un motivo desconocido no se pinta crudo', () => {
    expect(etiquetaParada('bf_no_identificable')).toBe('Beneficiario final no identificado');
    expect(etiquetaParada(null)).toBeNull();
    expect(etiquetaParada('motivo_inventado')).toBeNull();
  });
});


describe('el veredicto del sello', () => {
  const sello = (over: Partial<Integridad> = {}): Integridad => ({
    veredicto: 'coincide',
    version_del_sello: 2,
    hash_sellado: 'a'.repeat(64),
    hash_recalculado: 'a'.repeat(64),
    firmado_en: '2026-09-01T00:00:00Z',
    nota: '',
    ...over,
  });

  it('lo que no se pudo verificar se dice, no se calla', () => {
    // Es la trampa entera: si Valida no responde y la pantalla no pinta nada,
    // el oficial lee ausencia de aviso como "el sello cuadra".
    const r = resumirIntegridad(null);
    expect(r).not.toBeNull();
    expect(r?.tono).toBe('alerta');
  });

  it('un expediente sin firmar no tiene sello del que hablar', () => {
    expect(resumirIntegridad(sello({ veredicto: 'sin_firmar' }))).toBeNull();
  });

  it('un sello que cuadra no pide nada', () => {
    expect(resumirIntegridad(sello())?.tono).toBe('ok');
  });

  it('un sello que no cuadra es un hallazgo, no un aviso más', () => {
    const r = resumirIntegridad(sello({ veredicto: 'no_coincide' }));
    expect(r?.tono).toBe('grave');
    expect(r?.tono).not.toBe(resumirIntegridad(sello())?.tono);
  });

  it('una versión vieja del sello no acusa a nadie de alterar el expediente', () => {
    // No poder recalcular no es lo mismo que recalcular y que no dé.
    expect(resumirIntegridad(sello({ veredicto: 'no_verificable', version_del_sello: null }))?.tono)
      .toBe('alerta');
  });
});

describe('el sello frente a la decisión', () => {
  const sello = (v: Integridad['veredicto']): Integridad => ({
    veredicto: v,
    version_del_sello: 2,
    hash_sellado: 'a'.repeat(64),
    hash_recalculado: 'b'.repeat(64),
    firmado_en: '2026-09-01T00:00:00Z',
    nota: '',
  });

  it('un sello que no cuadra impide aprobar, y dice por qué', () => {
    const r = selloImpideAprobar(sello('no_coincide'));
    expect(r).not.toBeNull();
    expect(r).toContain('rechaza');
  });

  it('un sello que cuadra no estorba', () => {
    expect(selloImpideAprobar(sello('coincide'))).toBeNull();
  });

  it('lo que no se pudo comprobar no bloquea: ausencia de prueba no es hallazgo', () => {
    // Frenar todas las aprobaciones porque un endpoint no respondió empuja la
    // decisión por fuera de la plataforma sin haber encontrado nada.
    expect(selloImpideAprobar(null)).toBeNull();
    expect(selloImpideAprobar(sello('no_verificable'))).toBeNull();
    expect(selloImpideAprobar(sello('sin_firmar'))).toBeNull();
  });
});
