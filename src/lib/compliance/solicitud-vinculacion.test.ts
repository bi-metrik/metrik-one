/**
 * El mostrador de solicitudes.
 *
 * Lo que se prueba acá no es cosmético: si el aviso nombra mal al Responsable,
 * la autorización nace defectuosa; si el documento no se normaliza, el mismo
 * proveedor entra tres veces con el mismo NIT escrito distinto; y si el mensaje
 * de "enviado" afirma que el expediente se creó, la pantalla contradice a
 * propósito la respuesta muda de Valida.
 *
 * VERIFICADO POR MUTACIÓN (2026-09-07) — cada mutación tumbó pruebas:
 *   - poner a MéTRIK como Responsable en el aviso → caen 2
 *   - no normalizar el documento → caen 2
 *   - dejar enviar sin marcar el aviso → caen 2
 *   - reportar solo el primer campo faltante → cae 1
 *   - permitir NIT sobre persona natural → cae 1
 *   - usar el mismo mensaje para el límite y el fallo de envío → cae 1
 *   - afirmar que el expediente se creó → cae 1
 *   - aceptar cualquier cosa como correo → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  CASILLA_AVISO,
  DATOS_VACIOS,
  DOCUMENTOS_POR_SUJETO,
  MENSAJE_ENLACE_SOLICITUD,
  MENSAJE_SOLICITUD_ENVIADA,
  VERSION_AVISO_SOLICITUD,
  correoValido,
  documentoCoherente,
  documentoPorDefecto,
  esMotivoEnlaceSolicitud,
  faltaEnSolicitud,
  mensajeErrorSolicitud,
  mensajeParaCompartir,
  normalizarDocumento,
  puedeEnviarSolicitud,
  textoAvisoSolicitud,
  urlDeSolicitud,
  type DatosSolicitud,
} from './solicitud-vinculacion';
import { ENCARGADO } from './vinculacion-publica';

const COMPLETOS: DatosSolicitud = {
  tipoSujeto: 'juridica',
  denominacion: 'Proveedor Ejemplo SAS',
  tipoDocumento: 'NIT',
  documento: '900.123.456-8',
  correo: 'contacto@ejemplo.com',
  acepta: true,
};

describe('el aviso del mostrador', () => {
  it('nombra a la empresa que invita como Responsable', () => {
    const t = textoAvisoSolicitud('CONCESION ALTO MAGDALENA S A S').join(' ');
    expect(t).toContain('Responsable del tratamiento: CONCESION ALTO MAGDALENA S A S');
  });

  it('nombra a MéTRIK como Encargado, nunca como Responsable', () => {
    const t = textoAvisoSolicitud('ALMA').join(' ');
    expect(t).toContain(`Encargado: ${ENCARGADO.nombre}`);
    expect(t).not.toContain(`Responsable del tratamiento: ${ENCARGADO.nombre}`);
  });

  it('dice que la autorización completa se pide después', () => {
    const t = textoAvisoSolicitud('ALMA').join(' ');
    expect(t).toContain('autorización completa');
  });

  it('la versión del aviso es la misma que guarda Valida', () => {
    expect(VERSION_AVISO_SOLICITUD).toBe('metrik-aviso-solicitud-vinculacion-v1');
  });

  it('la casilla dice para qué, no solo "acepto"', () => {
    expect(CASILLA_AVISO).toContain('para qué');
  });
});

describe('normalizar el documento', () => {
  it('el mismo NIT escrito de tres formas cae en un solo valor', () => {
    expect(normalizarDocumento('900.123.456-8')).toBe('9001234568');
    expect(normalizarDocumento('900123456 8')).toBe('9001234568');
    expect(normalizarDocumento(' 900-123-456-8 ')).toBe('9001234568');
  });

  it('conserva letras, porque un pasaporte las tiene', () => {
    expect(normalizarDocumento('AB-123456')).toBe('AB123456');
  });
});

describe('qué falta para enviar', () => {
  it('unos datos completos no dejan nada pendiente', () => {
    expect(faltaEnSolicitud(COMPLETOS)).toEqual([]);
    expect(puedeEnviarSolicitud(COMPLETOS)).toBe(true);
  });

  it('el formulario vacío reporta los cuatro campos, no uno solo', () => {
    const falta = faltaEnSolicitud(DATOS_VACIOS);
    expect(falta).toContain('razon_social');
    expect(falta).toContain('documento');
    expect(falta).toContain('correo');
    expect(falta).toContain('aviso');
  });

  it('sin marcar el aviso no se puede enviar, aunque todo lo demás esté', () => {
    expect(puedeEnviarSolicitud({ ...COMPLETOS, acepta: false })).toBe(false);
    expect(faltaEnSolicitud({ ...COMPLETOS, acepta: false })).toEqual(['aviso']);
  });

  it('un documento demasiado corto no pasa', () => {
    expect(faltaEnSolicitud({ ...COMPLETOS, documento: '900' })).toContain('documento');
  });

  it('una persona natural reporta el campo como nombre, no como razón social', () => {
    const falta = faltaEnSolicitud({ ...DATOS_VACIOS, tipoSujeto: 'natural' });
    expect(falta).toContain('nombre');
    expect(falta).not.toContain('razon_social');
  });
});

describe('el correo', () => {
  it('acepta direcciones normales', () => {
    expect(correoValido('ana.gomez@empresa.com.co')).toBe(true);
    expect(correoValido('  ana+kyc@empresa.co  ')).toBe(true);
  });

  it('rechaza lo que no puede recibir un enlace', () => {
    expect(correoValido('ana')).toBe(false);
    expect(correoValido('ana@empresa')).toBe(false);
    expect(correoValido('')).toBe(false);
  });
});

describe('tipo de sujeto y tipo de documento', () => {
  it('una empresa solo tiene NIT', () => {
    expect(DOCUMENTOS_POR_SUJETO.juridica).toEqual(['NIT']);
  });

  it('cambiar de empresa a persona propone un documento posible', () => {
    expect(documentoPorDefecto('natural')).toBe('CC');
    expect(documentoCoherente('natural', documentoPorDefecto('natural'))).toBe(true);
  });

  it('un NIT sobre una persona natural es incoherente', () => {
    expect(documentoCoherente('natural', 'NIT')).toBe(false);
    expect(documentoCoherente('juridica', 'CC')).toBe(false);
  });
});

describe('el enlace que se copia', () => {
  it('arma la URL sin barra doble', () => {
    expect(urlDeSolicitud('https://alma-afi.metrikone.co/', '/vinculacion/solicitud/abc')).toBe(
      'https://alma-afi.metrikone.co/vinculacion/solicitud/abc',
    );
  });

  it('tolera que la ruta venga sin barra inicial', () => {
    expect(urlDeSolicitud('https://x.metrikone.co', 'vinculacion/solicitud/abc')).toBe(
      'https://x.metrikone.co/vinculacion/solicitud/abc',
    );
  });

  it('el mensaje para compartir dice quién invita antes de mostrar el enlace', () => {
    const m = mensajeParaCompartir('ALMA', 'https://x.metrikone.co/v/1');
    expect(m.indexOf('ALMA')).toBeLessThan(m.indexOf('https://'));
    expect(m).toContain('https://x.metrikone.co/v/1');
  });
});

describe('lo que se le dice a la gente', () => {
  it('el enlace muerto y el enlace apagado se distinguen', () => {
    expect(esMotivoEnlaceSolicitud('cerrado')).toBe(true);
    expect(esMotivoEnlaceSolicitud('limite_excedido')).toBe(false);
    expect(MENSAJE_ENLACE_SOLICITUD.cerrado).not.toBe(MENSAJE_ENLACE_SOLICITUD.no_encontrado);
  });

  it('el límite invita a esperar y el fallo de envío a revisar la dirección', () => {
    expect(mensajeErrorSolicitud('limite_excedido')).toContain('Espera');
    expect(mensajeErrorSolicitud('envio_fallido')).toContain('Verifica');
    expect(mensajeErrorSolicitud('limite_excedido')).not.toBe(mensajeErrorSolicitud('envio_fallido'));
  });

  it('un código desconocido no deja a la persona sin mensaje', () => {
    expect(mensajeErrorSolicitud('algo_que_nadie_previo').length).toBeGreaterThan(10);
  });

  it('el mensaje de enviado es condicional, porque Valida no dice si creó o reenvió', () => {
    expect(MENSAJE_SOLICITUD_ENVIADA).toContain('Si los datos');
    expect(MENSAJE_SOLICITUD_ENVIADA).not.toContain('creamos');
  });
});
