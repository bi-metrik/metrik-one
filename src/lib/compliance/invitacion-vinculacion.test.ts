/**
 * Invitar a una contraparte desde ONE.
 *
 * Lo que se prueba acá decide qué ve el oficial después de apretar el botón. Si
 * el resumen dice "listo" cuando el correo no salió, el expediente se queda en
 * `invitado` para siempre y a los tres meses nadie sabe por qué. Si dice
 * "creado" cuando en realidad se reenvió uno que ya existía, el oficial invita
 * otra vez y parte el rastro de la misma contraparte en dos.
 *
 * VERIFICADO POR MUTACIÓN
 *
 * Cada mutación se aplicó de verdad sobre `invitacion-vinculacion.ts` y se contó
 * cuántas pruebas se caen.
 *
 *  1. el correo que no salió deja de mandar sobre lo demás (un envío fallido se
 *     anuncia como si el enlace hubiera llegado) → caen 2
 *  2. un expediente reenviado se anuncia como creado (el oficial cree que abrió
 *     uno nuevo y vuelve a invitar) → caen 2
 *  3. no se distingue que el correo registrado es otro (el enlace salió a una
 *     dirección y la pantalla nombra la que se escribió) → cae 1
 *  4. el campo que falta se reporta siempre como `razon_social`, también para
 *     persona natural (la pantalla marca el campo equivocado) → cae 1
 *  5. el documento se mide sin normalizar (`9.0.0-1` pasa como si tuviera siete
 *     caracteres cuando el documento es `9001`) → cae 1
 *  6. se exige una casilla de aviso, como en el mostrador (el oficial declara
 *     en nombre de quien no estuvo presente) → caen 4
 */

import { describe, expect, it } from 'vitest';
import {
  DATOS_INVITACION_VACIOS,
  faltaEnInvitacion,
  puedeInvitar,
  resumirInvitacion,
  type DatosInvitacion,
  type ResultadoInvitacion,
} from './invitacion-vinculacion';

function datos(over: Partial<DatosInvitacion> = {}): DatosInvitacion {
  return {
    tipoSujeto: 'juridica',
    denominacion: 'Proveedora del Norte SAS',
    tipoDocumento: 'NIT',
    documento: '900.123.456-7',
    correo: 'contacto@proveedora.co',
    ...over,
  };
}

function resultado(over: Partial<ResultadoInvitacion> = {}): ResultadoInvitacion {
  return {
    resultado: 'creado',
    expedienteId: 'exp-1',
    url: 'https://alma.metrikone.co/vinculacion/tok',
    correoDistinto: false,
    correoSalio: true,
    ...over,
  };
}

describe('qué falta para poder invitar', () => {
  it('el formulario vacío no se puede enviar', () => {
    expect(puedeInvitar(DATOS_INVITACION_VACIOS)).toBe(false);
  });

  it('unos datos completos sí', () => {
    expect(puedeInvitar(datos())).toBe(true);
  });

  it('no pide la casilla del aviso: la marca quien no estuvo presente', () => {
    // El mostrador sí la exige porque ahí escribe la propia contraparte. Acá
    // escribe el oficial, y una declaración suya en nombre de un tercero sería
    // evidencia fabricada.
    expect(faltaEnInvitacion(datos())).toEqual([]);
  });

  it('señala el campo, no solo que algo falta', () => {
    expect(faltaEnInvitacion(datos({ denominacion: 'X', correo: 'roto' })).sort()).toEqual([
      'correo',
      'razon_social',
    ]);
  });

  it('a una persona natural le reclama nombre, no razón social', () => {
    expect(faltaEnInvitacion(datos({ tipoSujeto: 'natural', denominacion: '' }))).toContain('nombre');
  });

  it('el NIT escrito con puntos y guion es un documento válido', () => {
    expect(faltaEnInvitacion(datos({ documento: '900.123.456-7' }))).toEqual([]);
  });

  it('los puntos y guiones no cuentan como largo del documento', () => {
    // `9.0.0-1` son siete caracteres, pero el documento es `9001`. Si no se
    // normaliza antes de medir, un documento demasiado corto pasa.
    expect(faltaEnInvitacion(datos({ documento: '9.0.0-1' }))).toContain('documento');
  });
});

describe('qué se le dice al oficial', () => {
  it('el camino feliz nombra el correo al que salió', () => {
    const r = resumirInvitacion(resultado(), 'contacto@proveedora.co');
    expect(r.tono).toBe('ok');
    expect(r.detalle).toContain('contacto@proveedora.co');
    expect(r.ofreceEnlace).toBe(false);
  });

  it('si el correo no salió, no se dice que salió', () => {
    const r = resumirInvitacion(resultado({ correoSalio: false }), 'contacto@proveedora.co');
    expect(r.tono).toBe('alerta');
    // Lo que tiene que hacer el oficial: copiar el enlace, no volver a invitar.
    expect(r.ofreceEnlace).toBe(true);
    expect(r.detalle).toContain('No vuelvas a invitar');
  });

  it('un expediente que ya existía no se anuncia como nuevo', () => {
    const r = resumirInvitacion(resultado({ resultado: 'reenviado' }), 'contacto@proveedora.co');
    expect(r.tono).toBe('alerta');
    expect(r.titulo).toContain('ya tenía un expediente');
  });

  it('si el correo registrado es otro, se dice y se ofrece el enlace', () => {
    const r = resumirInvitacion(
      resultado({ resultado: 'reenviado', correoDistinto: true }),
      'nuevo@proveedora.co',
    );
    expect(r.tono).toBe('alerta');
    expect(r.ofreceEnlace).toBe(true);
    expect(r.detalle).toContain('nuevo@proveedora.co');
  });

  it('el correo no salió manda sobre todo lo demás', () => {
    // Un reenvío cuyo correo falló no puede leerse como "le reenviamos el
    // enlace": nadie recibió nada.
    const r = resumirInvitacion(
      resultado({ resultado: 'reenviado', correoSalio: false }),
      'contacto@proveedora.co',
    );
    expect(r.ofreceEnlace).toBe(true);
    expect(r.titulo).toContain('no salió');
  });
});
