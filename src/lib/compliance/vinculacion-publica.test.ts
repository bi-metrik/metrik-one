/**
 * El portón del formulario público.
 *
 * Si estas reglas se equivocan, la contraparte entrega su cédula y su
 * declaración de renta sin haber autorizado nada, o el expediente afirma que
 * aceptó un texto que nunca vio. Las dos cosas son defectos que no se arreglan
 * después: la autorización o se pidió antes, o no se pidió.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-07) — cada mutación tumbó pruebas:
 *   - dar por válida una aceptación de versión anterior → cae 1
 *   - tratar `aceptada: false` como aceptada → cae 1
 *   - dejar pasar a documentos sin aceptar → caen 2
 *   - poner a MéTRIK como Responsable en el texto → cae 1
 *   - omitir la transmisión internacional del aviso → cae 1
 *   - aceptar un archivo de 20 MB → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  ENCARGADO,
  TIPOS_ACEPTACION,
  VERSION_TEXTO,
  esMotivoEnlaceCerrado,
  faltaAceptar,
  nombrePedido,
  pasoActual,
  textosAceptacion,
  validarArchivo,
  yaAcepto,
  type DeclaracionRegistrada,
} from './vinculacion-publica';

function dec(over: Partial<DeclaracionRegistrada> = {}): DeclaracionRegistrada {
  return {
    tipo: 'nda',
    aceptada: true,
    texto_version: VERSION_TEXTO.nda,
    aceptada_en: '2026-09-07T00:00:00Z',
    ...over,
  };
}

const ACEPTADO_TODO: DeclaracionRegistrada[] = [
  dec({ tipo: 'nda', texto_version: VERSION_TEXTO.nda }),
  dec({ tipo: 'autorizacion_datos', texto_version: VERSION_TEXTO.autorizacion_datos }),
];

describe('qué falta aceptar', () => {
  it('sin nada registrado, faltan las dos', () => {
    expect(faltaAceptar([])).toEqual(['nda', 'autorizacion_datos']);
    expect(yaAcepto([])).toBe(false);
  });

  it('con las dos aceptadas en la versión vigente, no falta nada', () => {
    expect(faltaAceptar(ACEPTADO_TODO)).toEqual([]);
    expect(yaAcepto(ACEPTADO_TODO)).toBe(true);
  });

  it('una aceptación de una versión anterior NO cubre la vigente', () => {
    const viejas: DeclaracionRegistrada[] = [
      dec({ tipo: 'nda', texto_version: 'metrik-confidencialidad-contraparte-v0' }),
      dec({ tipo: 'autorizacion_datos', texto_version: VERSION_TEXTO.autorizacion_datos }),
    ];
    expect(faltaAceptar(viejas)).toEqual(['nda']);
  });

  it('una fila registrada pero con aceptada en false sigue faltando', () => {
    const rechazada: DeclaracionRegistrada[] = [
      dec({ tipo: 'nda', aceptada: false }),
      dec({ tipo: 'autorizacion_datos', texto_version: VERSION_TEXTO.autorizacion_datos }),
    ];
    expect(faltaAceptar(rechazada)).toEqual(['nda']);
  });

  it('una declaración ajena al portón no cuenta como aceptación', () => {
    expect(faltaAceptar([dec({ tipo: 'origen_licito_fondos' })])).toEqual([
      'nda',
      'autorizacion_datos',
    ]);
  });
});

describe('nada se puede hacer antes de aceptar', () => {
  it('sin aceptar, el paso es el de las autorizaciones aunque falten documentos', () => {
    expect(pasoActual({ acepto: false, slotsFaltantes: 4, camposPorConfirmar: 0 })).toBe(
      'aceptaciones',
    );
  });

  it('sin aceptar, el paso es el de las autorizaciones aunque no falte nada más', () => {
    expect(pasoActual({ acepto: false, slotsFaltantes: 0, camposPorConfirmar: 0 })).toBe(
      'aceptaciones',
    );
  });

  it('aceptado, va a documentos mientras falte alguno', () => {
    expect(pasoActual({ acepto: true, slotsFaltantes: 1, camposPorConfirmar: 5 })).toBe(
      'documentos',
    );
  });

  it('con los documentos completos, pasa a confirmar datos', () => {
    expect(pasoActual({ acepto: true, slotsFaltantes: 0, camposPorConfirmar: 3 })).toBe('datos');
  });

  it('sin nada pendiente, queda listo', () => {
    expect(pasoActual({ acepto: true, slotsFaltantes: 0, camposPorConfirmar: 0 })).toBe('listo');
  });
});

describe('los textos dicen de quién es el tratamiento', () => {
  const textos = textosAceptacion('ALMA Concesión Alto Magdalena');

  it('trae una entrada por cada aceptación del portón', () => {
    expect(textos.map((t) => t.tipo)).toEqual([...TIPOS_ACEPTACION]);
  });

  it('la empresa que invita es la Responsable, y MéTRIK el Encargado', () => {
    const datos = textos.find((t) => t.tipo === 'autorizacion_datos')!;
    const cuerpo = datos.parrafos.join(' ');
    expect(cuerpo).toContain('Responsable del tratamiento: ALMA Concesión Alto Magdalena');
    expect(cuerpo).toContain(`Encargado: ${ENCARGADO.nombre}`);
    expect(cuerpo).not.toContain(`Responsable del tratamiento: ${ENCARGADO.nombre}`);
  });

  it('el aviso dice que hay transmisión internacional y por qué', () => {
    const datos = textos.find((t) => t.tipo === 'autorizacion_datos')!;
    const cuerpo = datos.parrafos.join(' ');
    expect(cuerpo).toContain('Estados Unidos');
    expect(cuerpo).toContain('Ley 1581 de 2012');
  });

  it('el aviso dice cuánto se conserva y que hay un deber legal detrás', () => {
    const datos = textos.find((t) => t.tipo === 'autorizacion_datos')!;
    const cuerpo = datos.parrafos.join(' ');
    expect(cuerpo).toContain('cinco (5) años');
  });

  it('cada texto viaja con su versión, que es lo que se guarda como prueba', () => {
    for (const t of textos) expect(t.version).toBe(VERSION_TEXTO[t.tipo]);
  });

  it('sin nombre de empresa no deja el hueco a la vista', () => {
    const cuerpo = textosAceptacion('   ')
      .flatMap((t) => t.parrafos)
      .join(' ');
    expect(cuerpo).toContain('la empresa que te invitó');
    expect(cuerpo).not.toContain('undefined');
  });
});

describe('archivos', () => {
  it('rechaza lo que no es PDF ni imagen', () => {
    expect(validarArchivo({ type: 'application/zip', size: 1000 })).not.toBeNull();
    expect(validarArchivo({ type: 'application/pdf', size: 1000 })).toBeNull();
    expect(validarArchivo({ type: 'image/jpeg', size: 1000 })).toBeNull();
  });

  it('rechaza el que pesa más de 10 MB y el vacío', () => {
    expect(validarArchivo({ type: 'application/pdf', size: 20 * 1024 * 1024 })).not.toBeNull();
    expect(validarArchivo({ type: 'application/pdf', size: 0 })).not.toBeNull();
  });
});

describe('mensajes del enlace', () => {
  it('reconoce los tres motivos que devuelve Valida', () => {
    expect(esMotivoEnlaceCerrado('expirado')).toBe(true);
    expect(esMotivoEnlaceCerrado('cerrado')).toBe(true);
    expect(esMotivoEnlaceCerrado('no_encontrado')).toBe(true);
    expect(esMotivoEnlaceCerrado('db_error')).toBe(false);
  });

  it('los documentos se piden por su nombre, no por su slot', () => {
    expect(nombrePedido('camara_comercio')).toBe(
      'Certificado de existencia y representación legal',
    );
    expect(nombrePedido('algo_raro')).toBe('algo raro');
  });
});
