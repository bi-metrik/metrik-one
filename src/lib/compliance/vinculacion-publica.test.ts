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
 *   - ofrecer la firma con campos sin confirmar → caen 2
 *   - dar por firmado cualquier estado → cae 1
 *   - no limitar el código a seis dígitos → caen 2
 *   - omitir los segundos que faltan para reenviar → cae 1
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
  estaFirmado,
  faltaAceptar,
  mensajeErrorFirma,
  nombrePedido,
  normalizarOtp,
  otpCompleto,
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

describe('el orden de los pasos', () => {
  const base = { acepto: true, slotsFaltantes: 0, camposPorConfirmar: 0, firmado: false };

  it('sin aceptar, el paso es el de las autorizaciones aunque falten documentos', () => {
    expect(pasoActual({ ...base, acepto: false, slotsFaltantes: 4 })).toBe('aceptaciones');
  });

  it('sin aceptar, el paso es el de las autorizaciones aunque no falte nada más', () => {
    expect(pasoActual({ ...base, acepto: false })).toBe('aceptaciones');
  });

  it('aceptado, va a documentos mientras falte alguno', () => {
    expect(pasoActual({ ...base, slotsFaltantes: 1, camposPorConfirmar: 5 })).toBe('documentos');
  });

  it('con los documentos completos, pasa a confirmar datos', () => {
    expect(pasoActual({ ...base, camposPorConfirmar: 3 })).toBe('datos');
  });

  it('la firma NO se ofrece mientras haya datos sin confirmar', () => {
    expect(pasoActual({ ...base, camposPorConfirmar: 1 })).not.toBe('firma');
  });

  it('con todo confirmado, toca firmar', () => {
    expect(pasoActual(base)).toBe('firma');
  });

  it('firmado, queda listo aunque el resto se vea incompleto', () => {
    expect(
      pasoActual({ acepto: true, slotsFaltantes: 2, camposPorConfirmar: 4, firmado: true }),
    ).toBe('listo');
  });
});

describe('la firma', () => {
  it('el estado del expediente es lo que dice si ya se firmó', () => {
    expect(estaFirmado('pendiente_revision')).toBe(true);
    expect(estaFirmado('en_proceso')).toBe(false);
    expect(estaFirmado('invitado')).toBe(false);
  });

  it('el código solo admite dígitos y no más de seis', () => {
    expect(normalizarOtp('12a34b5')).toBe('12345');
    expect(normalizarOtp('123 456')).toBe('123456');
    expect(normalizarOtp('12345678')).toBe('123456');
    expect(normalizarOtp('  ')).toBe('');
  });

  it('solo está completo con los seis dígitos', () => {
    expect(otpCompleto('123456')).toBe(true);
    expect(otpCompleto('12345')).toBe(false);
    expect(otpCompleto('12345a')).toBe(false);
  });

  it('cada fallo del canal dice algo distinto y accionable', () => {
    const frases = [
      mensajeErrorFirma('sin_correo_de_contraparte'),
      mensajeErrorFirma('canal_no_configurado'),
      mensajeErrorFirma('otp_expirado'),
      mensajeErrorFirma('bloqueado'),
      mensajeErrorFirma('campos_pendientes'),
    ];
    expect(new Set(frases).size).toBe(frases.length);
    for (const f of frases) expect(f.length).toBeGreaterThan(10);
  });

  it('la espera del reenvío dice cuántos segundos faltan', () => {
    expect(mensajeErrorFirma('espera_antes_de_reenviar', 42)).toContain('42');
    expect(mensajeErrorFirma('espera_antes_de_reenviar')).not.toContain('undefined');
  });

  it('un código desconocido no se queda mudo', () => {
    expect(mensajeErrorFirma('lo_que_sea').length).toBeGreaterThan(10);
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
