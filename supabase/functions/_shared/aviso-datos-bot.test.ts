// Reglas puras de la puerta del aviso de datos del bot. Textos, telefonos e ids inventados.
import { describe, expect, it } from 'vitest';
import {
  decidirPuerta,
  leerConfigAvisoDatos,
  mensajeParaRetener,
  mensajeRetenido,
  metaTs,
  nombreAceptante,
  respuestaEscrita,
  seRetiene,
  versionVigente,
} from './aviso-datos-bot';
import type { FilaAviso } from './aviso-datos-bot';
import type { IncomingMessage } from './types';

const DOC = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CONFIG = { activo: true, documento_version_id: DOC, texto: 'Para usar este bot acepta el aviso de datos adjunto.', version: 'v1' };
const AHORA = new Date('2026-10-05T15:00:00Z');

function fila(over: Partial<FilaAviso> = {}): FilaAviso {
  return {
    id: 'fila-1',
    estado: 'pendiente',
    enviado_at: '2026-10-05T14:00:00Z',
    ultimo_intento_at: '2026-10-05T14:00:00Z',
    expira_at: '2026-10-12T14:00:00Z',
    created_at: '2026-10-05T14:00:00Z',
    ...over,
  };
}

describe('leerConfigAvisoDatos', () => {
  it('sin la llave, o con activo distinto de true literal, esta apagada', () => {
    for (const raw of [undefined, null, 'si', 1, [], {}, { ...CONFIG, activo: false }, { ...CONFIG, activo: 'true' }, { ...CONFIG, activo: 1 }]) {
      expect(leerConfigAvisoDatos(raw)).toEqual({ estado: 'apagado' });
    }
  });

  it('activa y completa', () => {
    expect(leerConfigAvisoDatos(CONFIG)).toEqual({
      estado: 'activo',
      config: { documentoVersionId: DOC, texto: CONFIG.texto, version: 'v1' },
    });
  });

  it('activa con algo mal: invalida (la puerta falla cerrada, no deja pasar)', () => {
    expect(leerConfigAvisoDatos({ ...CONFIG, documento_version_id: 'abc' }).estado).toBe('invalido');
    expect(leerConfigAvisoDatos({ ...CONFIG, texto: '  ' }).estado).toBe('invalido');
    expect(leerConfigAvisoDatos({ ...CONFIG, texto: 'x'.repeat(1025) }).estado).toBe('invalido');
    expect(leerConfigAvisoDatos({ ...CONFIG, version: '' }).estado).toBe('invalido');
    expect(leerConfigAvisoDatos({ ...CONFIG, version: 'v'.repeat(41) }).estado).toBe('invalido');
    expect(leerConfigAvisoDatos({ activo: true }).estado).toBe('invalido');
  });
});

describe('respuestaEscrita', () => {
  it('reconoce acepto / no acepto con tildes, mayusculas y puntuacion', () => {
    for (const t of ['acepto', 'Acepto.', 'ACEPTO!', 'Sí acepto', 'si, acepto', ' yo acepto ']) expect(respuestaEscrita(t)).toBe('acepto');
    for (const t of ['No acepto', 'no acepto.', 'Yo no acepto']) expect(respuestaEscrita(t)).toBe('no_acepto');
  });

  it('nada mas cuenta como respuesta', () => {
    for (const t of ['ok', 'si', 'no', 'acepto el gasto de 20000', 'gasto 20000 acepto', '', null, undefined]) {
      expect(respuestaEscrita(t)).toBeNull();
    }
  });
});

describe('decidirPuerta', () => {
  it('el reintento de Meta del «acepto» ya registrado no pasa como mensaje', () => {
    const aceptada = fila({ estado: 'aceptado', reply_wamid: 'wamid.ACEPTO' });
    expect(decidirPuerta({ filas: [aceptada], texto: 'acepto', ahora: AHORA, wamid: 'wamid.ACEPTO' })).toEqual({ accion: 'duplicado' });
    expect(decidirPuerta({ filas: [aceptada], texto: 'acepto', ahora: AHORA, wamid: 'wamid.OTRO' })).toEqual({ accion: 'pasar' });
  });

  it('con una aceptacion de la version vigente, pasa', () => {
    expect(decidirPuerta({ filas: [fila({ estado: 'aceptado' })], texto: 'hola', ahora: AHORA })).toEqual({ accion: 'pasar' });
  });

  it('una aceptacion revocada no cuenta: se pide de nuevo', () => {
    const revocada = fila({ estado: 'aceptado', revocada_at: '2026-10-05T14:30:00Z' });
    expect(decidirPuerta({ filas: [revocada], texto: 'hola', ahora: AHORA })).toEqual({ accion: 'crear', vencidas: [] });
  });

  it('sin filas de esta version (primera vez, rechazo previo o version nueva), crea', () => {
    expect(decidirPuerta({ filas: [], texto: 'hola', ahora: AHORA })).toEqual({ accion: 'crear', vencidas: [] });
  });

  it('con una pendiente vigente, retiene', () => {
    expect(decidirPuerta({ filas: [fila()], texto: 'gasto 20000 taxi', ahora: AHORA }).accion).toBe('retener');
  });

  it('«acepto» escrito sobre un aviso ya mostrado es respuesta', () => {
    const d = decidirPuerta({ filas: [fila()], texto: 'Acepto', ahora: AHORA });
    expect(d).toMatchObject({ accion: 'responder', decision: 'acepto' });
  });

  it('«acepto» escrito antes de que el aviso salga no acepta nada', () => {
    const d = decidirPuerta({ filas: [fila({ enviado_at: null })], texto: 'acepto', ahora: AHORA });
    expect(d.accion).toBe('retener');
  });

  it('una pendiente vencida no cuenta: se crea otra y la vieja se marca para expirar', () => {
    const vieja = fila({ id: 'vieja', expira_at: '2026-10-01T00:00:00Z' });
    expect(decidirPuerta({ filas: [vieja], texto: 'hola', ahora: AHORA })).toEqual({ accion: 'crear', vencidas: ['vieja'] });
  });
});

describe('retencion', () => {
  const base: IncomingMessage = { phone: '573001112233', text: 'gasto 20000 taxi', type: 'text', timestamp: '1791212400', wa_message_id: 'wamid.X' };

  it('la respuesta al aviso no se retiene; todo lo demas si', () => {
    expect(seRetiene({ type: 'text', text: 'acepto' })).toBe(false);
    expect(seRetiene({ type: 'text', text: 'no acepto' })).toBe(false);
    expect(seRetiene({ type: 'text', text: 'gasto 20000' })).toBe(true);
    expect(seRetiene({ type: 'audio', text: '' })).toBe(true);
    expect(seRetiene({ type: 'image', text: 'acepto' })).toBe(true);
  });

  it('lo guardado no lleva el cuerpo crudo del webhook ni el mensaje crudo de Meta', () => {
    const guardado = mensajeParaRetener({ ...base, webhook_crudo: { cuerpo: '{"secreto":1}', firma: 'sha256=x' }, meta_mensaje: { id: 'x' } });
    expect(guardado).not.toHaveProperty('webhook_crudo');
    expect(guardado).not.toHaveProperty('meta_mensaje');
    expect(guardado).toMatchObject({ text: 'gasto 20000 taxi', type: 'text', wa_message_id: 'wamid.X' });
  });

  it('al reprocesar, el telefono es el de la fila, no el del JSON', () => {
    const m = mensajeRetenido({ ...base, phone: '579999999999' }, '573001112233');
    expect(m?.phone).toBe('573001112233');
    expect(mensajeRetenido({ type: 'flow_response' }, '573001112233')).toBeNull();
    expect(mensajeRetenido(null, '573001112233')).toBeNull();
  });

  it('metaTs solo acepta segundos epoch', () => {
    expect(metaTs('1791212400')).toBe(1791212400);
    expect(metaTs('')).toBeNull();
    expect(metaTs('abc')).toBeNull();
    expect(metaTs(undefined)).toBeNull();
  });
});

describe('versionVigente y nombre', () => {
  it('vigencia por fecha de Bogota', () => {
    expect(versionVigente({ vigente_desde: '2026-10-01', vigente_hasta: null }, '2026-10-05')).toBe(true);
    expect(versionVigente({ vigente_desde: '2026-10-06', vigente_hasta: null }, '2026-10-05')).toBe(false);
    expect(versionVigente({ vigente_desde: '2026-10-01', vigente_hasta: '2026-10-04' }, '2026-10-05')).toBe(false);
    expect(versionVigente({ vigente_desde: '2026-10-01', vigente_hasta: '2026-10-05' }, '2026-10-05')).toBe(true);
  });

  it('el nombre nunca queda vacio', () => {
    expect(nombreAceptante('  Ana Prueba ')).toBe('Ana Prueba');
    expect(nombreAceptante('')).toBe('Usuario del bot');
    expect(nombreAceptante(null)).toBe('Usuario del bot');
  });
});
