// Que se le contesta a quien escribe sin telefono y cuando se avisa a quien opera.
import { describe, expect, it } from 'vitest';
import {
  MENSAJE_SIN_TELEFONO_PRIMERO,
  MENSAJE_SIN_TELEFONO_SEGUIMIENTO,
  TOPE_AVISOS_SIN_TELEFONO,
  avisoSinTelefono,
  decidirSinTelefono,
  previewSinTelefono,
  variablesAvisoSinTelefono,
} from './wa-sin-telefono';
import type { MensajeSinTelefono } from './wa-webhook-payload';
import { aEspanolNeutro } from './es-neutro';

const JUAN: MensajeSinTelefono = {
  user_id: 'CO.13491208655302741918',
  username: 'jglm_28',
  nombre: 'Juan Guillermo',
  tipo: 'text',
  texto: 'Buenas tardes, ya firmé',
  wa_message_id: 'wamid.7',
  timestamp: '1757943060',
};

describe('decidirSinTelefono', () => {
  it('la primera vez le pide el numero y avisa', () => {
    expect(decidirSinTelefono(0)).toEqual({ mensaje: MENSAJE_SIN_TELEFONO_PRIMERO, avisar: true });
  });

  it('el segundo mensaje sigue avisando: suele ser el que trae el numero', () => {
    expect(decidirSinTelefono(1)).toEqual({ mensaje: MENSAJE_SIN_TELEFONO_SEGUIMIENTO, avisar: true });
  });

  it('pasado el tope contesta pero ya no avisa', () => {
    expect(decidirSinTelefono(TOPE_AVISOS_SIN_TELEFONO - 1).avisar).toBe(true);
    expect(decidirSinTelefono(TOPE_AVISOS_SIN_TELEFONO)).toEqual({ mensaje: MENSAJE_SIN_TELEFONO_SEGUIMIENTO, avisar: false });
  });

  it('si no se pudo contar, se trata como la primera vez: perder el aviso es peor que repetirlo', () => {
    expect(decidirSinTelefono(null)).toEqual({ mensaje: MENSAJE_SIN_TELEFONO_PRIMERO, avisar: true });
  });
});

describe('textos', () => {
  it('lo que recibe la persona pide el numero y no sale corregido por el guard de voseo', () => {
    expect(MENSAJE_SIN_TELEFONO_PRIMERO).toContain('número de celular');
    for (const t of [MENSAJE_SIN_TELEFONO_PRIMERO, MENSAJE_SIN_TELEFONO_SEGUIMIENTO]) {
      expect(aEspanolNeutro(t).correcciones).toEqual([]);
    }
  });

  it('el aviso interno trae usuario, nombre, BSUID y lo que escribio', () => {
    const aviso = avisoSinTelefono(JUAN);
    expect(aviso).toContain('Usuario: @jglm_28');
    expect(aviso).toContain('Nombre: Juan Guillermo');
    expect(aviso).toContain('BSUID: CO.13491208655302741918');
    expect(aviso).toContain('Dice: Buenas tardes, ya firmé');
  });

  it('sin usuario ni nombre lo dice, no deja la linea en blanco', () => {
    const aviso = avisoSinTelefono({ ...JUAN, username: undefined, nombre: undefined });
    expect(aviso).toContain('Usuario: (sin nombre de usuario)');
    expect(aviso).toContain('Nombre: (sin nombre de perfil)');
  });

  it('el texto del aviso se corta a 200 caracteres', () => {
    const aviso = avisoSinTelefono({ ...JUAN, texto: 'x'.repeat(500) });
    expect(aviso).toContain(`Dice: ${'x'.repeat(200)}\n`);
    expect(aviso).not.toContain('x'.repeat(201));
  });

  it('la bitacora y las variables llevan el usuario con arroba', () => {
    expect(previewSinTelefono(JUAN)).toBe('[@jglm_28] Buenas tardes, ya firmé');
    expect(variablesAvisoSinTelefono(JUAN)).toEqual({
      usuario: '@jglm_28',
      nombre: 'Juan Guillermo',
      bsuid: 'CO.13491208655302741918',
      mensaje: 'Buenas tardes, ya firmé',
    });
  });
});
