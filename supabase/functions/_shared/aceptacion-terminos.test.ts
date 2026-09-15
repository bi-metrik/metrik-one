// Reglas del flujo de aceptacion de terminos por WhatsApp. El webhook no se puede importar desde
// vitest, asi que aqui se prueba TODA decision: que toque se registra, cuando se reenvia, que se
// le dice a la persona y que no se registra nunca.
import { describe, expect, it } from 'vitest';
import {
  MINUTOS_ENTRE_RECORDATORIOS,
  accionImplementada,
  avisoRespuesta,
  enmascararSecreto,
  lineasAcciones,
  mensajesCredencialValida,
  botonesAceptacion,
  clasificarRespuestaNoAplicada,
  decidirEntrante,
  epochAIso,
  esIdDeTerminos,
  estaVigente,
  estadoPorDecision,
  fechaHoraBogota,
  idBoton,
  leerRespuestaBoton,
  mensajeConfirmacion,
  mensajeYaRespondida,
  mismoHash,
  nombreArchivo,
  parsearIdBoton,
  sha256Hex,
  telefonoE164,
} from './aceptacion-terminos';

const ID = '3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d';
const TEL = '+573164509919';

/** Elemento de `value.messages[]` tal como lo manda Meta al tocar un boton de respuesta. */
function toque(over: Record<string, unknown> = {}, reply: Record<string, unknown> = {}) {
  return {
    context: { from: '573181362594', id: 'wamid.PROMPT111' },
    from: '573164509919',
    id: 'wamid.TOQUE222',
    timestamp: '1757863920', // 2025-09-14T15:32:00Z
    type: 'interactive',
    interactive: {
      type: 'button_reply',
      button_reply: { id: idBoton(ID, 'acepto'), title: 'Acepto', ...reply },
    },
    ...over,
  };
}

describe('ids de boton', () => {
  it('ida y vuelta para las dos decisiones', () => {
    expect(parsearIdBoton(idBoton(ID, 'acepto'))).toEqual({ aceptacionId: ID, decision: 'acepto' });
    expect(parsearIdBoton(idBoton(ID, 'no_acepto'))).toEqual({ aceptacionId: ID, decision: 'no_acepto' });
  });

  it('respeta los limites de Meta: id <= 256 y titulo <= 20', () => {
    const botones = botonesAceptacion(ID);
    expect(botones.map((b) => b.title)).toEqual(['Acepto', 'No acepto']);
    for (const b of botones) {
      expect(b.id.length).toBeLessThanOrEqual(256);
      expect(b.title.length).toBeLessThanOrEqual(20);
    }
  });

  it('normaliza el uuid a minusculas', () => {
    expect(parsearIdBoton(`terminos:acepto:${ID.toUpperCase()}`)?.aceptacionId).toBe(ID);
  });

  it('rechaza ids de otros flujos y ids alterados', () => {
    for (const id of [
      'btn_confirm',
      'btn_sin_soporte',
      `terminos:acepto:${ID}x`,
      `terminos:acepto:${ID.slice(0, 35)}`,
      `terminos:tal_vez:${ID}`,
      `terminos:acepto:${ID}:extra`,
      `xterminos:acepto:${ID}`,
      '',
      null,
      undefined,
    ]) {
      expect(parsearIdBoton(id as string)).toBeNull();
    }
  });

  it('esIdDeTerminos reconoce el prefijo aunque el resto este mal (para no mandarlo a otro flujo)', () => {
    expect(esIdDeTerminos('terminos:acepto:basura')).toBe(true);
    expect(esIdDeTerminos('btn_confirm')).toBe(false);
    expect(esIdDeTerminos(undefined)).toBe(false);
  });

  it('acepto -> aceptado, no acepto -> rechazado', () => {
    expect(estadoPorDecision('acepto')).toBe('aceptado');
    expect(estadoPorDecision('no_acepto')).toBe('rechazado');
  });
});

describe('leerRespuestaBoton (payload interactivo de Meta)', () => {
  it('lee un toque completo', () => {
    expect(leerRespuestaBoton(toque())).toEqual({
      aceptacionId: ID,
      decision: 'acepto',
      buttonId: idBoton(ID, 'acepto'),
      replyWamid: 'wamid.TOQUE222',
      contextWamid: 'wamid.PROMPT111',
      respondidoAt: '2025-09-14T15:32:00.000Z',
      titulo: 'Acepto',
    });
  });

  it('lee el "No acepto"', () => {
    const r = leerRespuestaBoton(toque({}, { id: idBoton(ID, 'no_acepto'), title: 'No acepto' }));
    expect(r?.decision).toBe('no_acepto');
  });

  it('sin wamid no hay registro: no se podria deduplicar un reintento de Meta', () => {
    expect(leerRespuestaBoton(toque({ id: undefined }))).toBeNull();
    expect(leerRespuestaBoton(toque({ id: '' }))).toBeNull();
  });

  it('sin context ni timestamp se lee igual, con esos campos en null', () => {
    const r = leerRespuestaBoton(toque({ context: undefined, timestamp: 'nope' }));
    expect(r?.contextWamid).toBeNull();
    expect(r?.respondidoAt).toBeNull();
  });

  it('una lista (list_reply) no es un toque de aceptacion aunque traiga nuestro id', () => {
    const lista = {
      ...toque(),
      interactive: { type: 'list_reply', list_reply: { id: idBoton(ID, 'acepto'), title: 'Acepto' } },
    };
    expect(leerRespuestaBoton(lista)).toBeNull();
  });

  it('una respuesta de Flow (nfm_reply) no es un toque de aceptacion', () => {
    const flow = { ...toque(), interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{}' } } };
    expect(leerRespuestaBoton(flow)).toBeNull();
  });

  it('texto, botones de otros flujos y basura devuelven null', () => {
    expect(leerRespuestaBoton({ type: 'text', text: { body: 'Acepto' }, id: 'wamid.X' })).toBeNull();
    expect(leerRespuestaBoton(toque({}, { id: 'btn_confirm' }))).toBeNull();
    expect(leerRespuestaBoton(null)).toBeNull();
    expect(leerRespuestaBoton('terminos:acepto')).toBeNull();
    expect(leerRespuestaBoton([toque()])).toBeNull();
  });
});

describe('epochAIso y telefonoE164', () => {
  it('convierte el timestamp de Meta (segundos, string o numero)', () => {
    expect(epochAIso('1757863920')).toBe('2025-09-14T15:32:00.000Z');
    expect(epochAIso(1757863920)).toBe('2025-09-14T15:32:00.000Z');
  });

  it('descarta lo que no es un timestamp plausible', () => {
    for (const v of ['', 'abc', '12', '1757863920000', -1, null, undefined, '1.5']) {
      expect(epochAIso(v)).toBeNull();
    }
  });

  it('el from de Meta viene sin +; la tabla guarda E.164', () => {
    expect(telefonoE164('573164509919')).toBe(TEL);
    expect(telefonoE164('+57 316 450 9919')).toBe(TEL);
    expect(telefonoE164('0573164509919')).toBeNull();
    expect(telefonoE164('123')).toBeNull();
    expect(telefonoE164('')).toBeNull();
    expect(telefonoE164(undefined)).toBeNull();
  });
});

describe('estaVigente', () => {
  const ahora = new Date('2026-09-14T15:00:00Z');
  it('pendiente con plazo por delante', () => {
    expect(estaVigente({ estado: 'pendiente', expira_at: '2026-09-21T15:00:00Z' }, ahora)).toBe(true);
  });
  it('vencida en el instante exacto, respondida, expirada o con fecha ilegible: no', () => {
    expect(estaVigente({ estado: 'pendiente', expira_at: '2026-09-14T15:00:00Z' }, ahora)).toBe(false);
    expect(estaVigente({ estado: 'aceptado', expira_at: '2026-09-21T15:00:00Z' }, ahora)).toBe(false);
    expect(estaVigente({ estado: 'expirado', expira_at: '2026-09-21T15:00:00Z' }, ahora)).toBe(false);
    expect(estaVigente({ estado: 'pendiente', expira_at: 'mañana' }, ahora)).toBe(false);
  });
});

describe('decidirEntrante', () => {
  const ahora = new Date('2026-09-14T15:00:00Z');
  const base = { estado: 'pendiente', expira_at: '2026-09-21T15:00:00Z', enviado_at: null, ultimo_intento_at: null };
  const hace = (min: number) => new Date(ahora.getTime() - min * 60_000).toISOString();

  it('sin pendiente no cambia nada, este o no registrado', () => {
    expect(decidirEntrante({ pendiente: null, registrado: false, ahora })).toEqual({ enviar: null, continuar: true });
    expect(decidirEntrante({ pendiente: null, registrado: true, ahora })).toEqual({ enviar: null, continuar: true });
  });

  it('pendiente vencida cuenta como sin pendiente (sigue al "no reconozco")', () => {
    const vencida = { ...base, expira_at: hace(1) };
    expect(decidirEntrante({ pendiente: vencida, registrado: false, ahora })).toEqual({ enviar: null, continuar: true });
  });

  it('primer mensaje de quien no esta registrado: documento, y NO sigue al "no reconozco"', () => {
    expect(decidirEntrante({ pendiente: base, registrado: false, ahora })).toEqual({ enviar: 'documento', continuar: false });
  });

  it('ya se le mostro y escribe despues del enfriamiento: solo los botones', () => {
    const mostrada = { ...base, enviado_at: hace(30), ultimo_intento_at: hace(MINUTOS_ENTRE_RECORDATORIOS) };
    expect(decidirEntrante({ pendiente: mostrada, registrado: false, ahora })).toEqual({ enviar: 'botones', continuar: false });
  });

  it('escribe dentro del enfriamiento: nada se reenvia y tampoco sale el "no reconozco"', () => {
    const mostrada = { ...base, enviado_at: hace(3), ultimo_intento_at: hace(MINUTOS_ENTRE_RECORDATORIOS - 1) };
    expect(decidirEntrante({ pendiente: mostrada, registrado: false, ahora })).toEqual({ enviar: null, continuar: false });
  });

  it('un intento fallido (sin enviado_at) tambien enfria: no se reintenta la descarga con cada mensaje', () => {
    const fallida = { ...base, enviado_at: null, ultimo_intento_at: hace(2) };
    expect(decidirEntrante({ pendiente: fallida, registrado: false, ahora })).toEqual({ enviar: null, continuar: false });
    const enfriada = { ...base, enviado_at: null, ultimo_intento_at: hace(MINUTOS_ENTRE_RECORDATORIOS + 1) };
    expect(decidirEntrante({ pendiente: enfriada, registrado: false, ahora }).enviar).toBe('documento');
  });

  it('numero registrado: recibe el documento pero su mensaje sigue al flujo normal', () => {
    expect(decidirEntrante({ pendiente: base, registrado: true, ahora })).toEqual({ enviar: 'documento', continuar: true });
    const mostrada = { ...base, enviado_at: hace(3), ultimo_intento_at: hace(3) };
    expect(decidirEntrante({ pendiente: mostrada, registrado: true, ahora })).toEqual({ enviar: null, continuar: true });
  });

  it('los minutos del enfriamiento se pueden pasar', () => {
    const mostrada = { ...base, enviado_at: hace(3), ultimo_intento_at: hace(3) };
    expect(decidirEntrante({ pendiente: mostrada, registrado: false, ahora, minutos: 2 }).enviar).toBe('botones');
  });
});

describe('clasificarRespuestaNoAplicada', () => {
  const ahora = new Date('2026-09-14T15:00:00Z');
  const fila = { telefono: TEL, estado: 'pendiente', reply_wamid: null, expira_at: '2026-09-21T15:00:00Z' };

  it('no existe o es de otro telefono: ajena', () => {
    expect(clasificarRespuestaNoAplicada(null, TEL, 'wamid.T', ahora)).toBe('ajena');
    expect(clasificarRespuestaNoAplicada({ ...fila, telefono: '+573000000000' }, TEL, 'wamid.T', ahora)).toBe('ajena');
  });

  it('otro telefono gana aunque el wamid coincida: no se confirma nada a quien no es', () => {
    const ajena = { ...fila, telefono: '+573000000000', estado: 'aceptado', reply_wamid: 'wamid.T' };
    expect(clasificarRespuestaNoAplicada(ajena, TEL, 'wamid.T', ahora)).toBe('ajena');
  });

  it('el mismo toque ya registrado es un reintento de Meta: duplicado', () => {
    const respondida = { ...fila, estado: 'aceptado', reply_wamid: 'wamid.T' };
    expect(clasificarRespuestaNoAplicada(respondida, TEL, 'wamid.T', ahora)).toBe('duplicado');
  });

  it('otro toque sobre una fila respondida: ya_respondida (la primera respuesta vale)', () => {
    const respondida = { ...fila, estado: 'rechazado', reply_wamid: 'wamid.OTRO' };
    expect(clasificarRespuestaNoAplicada(respondida, TEL, 'wamid.T', ahora)).toBe('ya_respondida');
  });

  it('expirada o pendiente con el plazo cumplido: vencida', () => {
    expect(clasificarRespuestaNoAplicada({ ...fila, estado: 'expirado' }, TEL, 'wamid.T', ahora)).toBe('vencida');
    expect(clasificarRespuestaNoAplicada({ ...fila, expira_at: '2026-09-14T14:59:59Z' }, TEL, 'wamid.T', ahora)).toBe('vencida');
  });

  it('pendiente, vigente y del mismo telefono pero sin escribir: reintentar', () => {
    expect(clasificarRespuestaNoAplicada(fila, TEL, 'wamid.T', ahora)).toBe('reintentar');
  });
});

describe('textos', () => {
  const fila = {
    nombre_aceptante: 'Bayron Correa',
    calidad: 'apoderado',
    empresa_nombre: '4D SOFT S.A.S.',
    empresa_nit: '901220269-6',
    documento_titulo: 'Términos del servicio',
    documento_version: '1.0',
    documento_url: 'https://x.supabase.co/storage/v1/object/sign/docs/terminos-4d.pdf?token=abc',
    telefono: TEL,
    estado: 'aceptado',
    respondido_at: '2026-09-14T15:32:00Z',
  };

  it('fecha y hora de Bogota (UTC-5), en 24 horas', () => {
    expect(fechaHoraBogota('2026-09-14T15:32:00Z')).toBe('14/09/2026 a las 10:32');
    // Medianoche en Bogota: con hour12:false algunas versiones de ICU escriben 24:05.
    expect(fechaHoraBogota('2026-09-15T05:05:00Z')).toBe('15/09/2026 a las 00:05');
    // Un toque a las 8 p.m. de Bogota ya es el dia siguiente en UTC.
    expect(fechaHoraBogota('2026-09-15T01:00:00Z')).toBe('14/09/2026 a las 20:00');
  });

  it('una fecha ilegible no revienta', () => {
    expect(fechaHoraBogota('nunca')).toBe('nunca');
  });

  it('confirmacion de aceptacion: nombre, documento, version y hora de Colombia', () => {
    const m = mensajeConfirmacion(fila, 'acepto', '2026-09-14T15:32:00Z');
    expect(m).toContain('Bayron');
    expect(m).toContain('«Términos del servicio» (versión 1.0)');
    expect(m).toContain('14/09/2026 a las 10:32 (hora de Colombia)');
    expect(m).toContain('aceptación');
  });

  it('confirmacion de "No acepto" no dice que acepto', () => {
    const m = mensajeConfirmacion(fila, 'no_acepto', '2026-09-14T15:32:00Z');
    expect(m).toContain('no aceptas');
    expect(m).not.toContain('tu aceptación');
  });

  it('ya respondida dice que respondio y no se cambia por aqui', () => {
    expect(mensajeYaRespondida(fila)).toContain('que aceptaste');
    expect(mensajeYaRespondida({ ...fila, estado: 'rechazado' })).toContain('que no aceptaste');
  });

  it('aviso interno con todo lo que hace falta para actuar, y la alarma si el documento no llego', () => {
    const aviso = avisoRespuesta({ fila, decision: 'acepto', respondidoAt: '2026-09-14T15:32:00Z', negocioCodigo: 'X1 26 1', estadoDocumento: 'read' });
    for (const parte of ['ACEPTÓ', 'Términos del servicio', 'versión 1.0', 'Bayron Correa, apoderado de 4D SOFT S.A.S. (NIT 901220269-6)', TEL, 'X1 26 1', '10:32', 'read']) {
      expect(aviso).toContain(parte);
    }
    expect(aviso).not.toContain('NO se entregó');
    const fallido = avisoRespuesta({ fila, decision: 'no_acepto', respondidoAt: '2026-09-14T15:32:00Z', negocioCodigo: null, estadoDocumento: 'failed' });
    expect(fallido).toContain('NO ACEPTÓ');
    expect(fallido).toContain('NO se entregó');
    expect(fallido).not.toContain('Negocio:');
  });

  it('nombre de archivo: titulo + version con la extension de la URL (pdf si no se lee)', () => {
    expect(nombreArchivo(fila)).toBe('Términos del servicio v1.0.pdf');
    expect(nombreArchivo({ ...fila, documento_url: 'https://x.com/a/anexo.DOCX' })).toBe('Términos del servicio v1.0.docx');
    expect(nombreArchivo({ ...fila, documento_url: 'https://x.com/descargar?id=9' })).toBe('Términos del servicio v1.0.pdf');
    expect(nombreArchivo({ ...fila, documento_titulo: 'Contrato 1/2: "final"' })).toBe('Contrato 1 2 final v1.0.pdf');
  });
});

describe('acciones post-aceptacion', () => {
  // Forma real de una llave de Valida (`vk_` + 32 bytes en hex, ver setup-valida-workspace.ts).
  // Inventada para la prueba: no es de ningun cliente.
  const LLAVE = 'vk_ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';

  it('solo la credencial esta implementada; el acceso al portal espera al portal', () => {
    expect(accionImplementada('enviar_credencial_valida')).toBe(true);
    expect(accionImplementada('enviar_acceso_portal')).toBe(false);
    expect(accionImplementada('otra')).toBe(false);
  });

  it('los dos mensajes llevan el texto aprobado, la llave completa y la documentacion', () => {
    const [llave, portal] = mensajesCredencialValida(LLAVE);
    expect(llave).toBe(
      `Esta es su llave de API de Valida: ${LLAVE} (guárdenla en su gestor de secretos, no en el código). Documentación: https://valida.metrik.com.co/docs`,
    );
    expect(portal).toBe('En unos minutos les damos acceso a la plataforma, desde donde podrán generar y regenerar sus llaves');
    expect(portal).not.toContain('vk_');
  });

  it('enmascarar deja el prefijo y 4 caracteres, como vk_ab12…', () => {
    expect(enmascararSecreto(LLAVE)).toBe('vk_ab12…');
    expect(enmascararSecreto(`  ${LLAVE}\n`)).toBe('vk_ab12…');
  });

  it('un secreto corto o sin prefijo no muestra caracteres de mas', () => {
    expect(enmascararSecreto('vk_abc')).toBe('vk_…');
    expect(enmascararSecreto('0123456789abcdef0123')).toBe('0123…');
    expect(enmascararSecreto('corta')).toBe('…');
    expect(enmascararSecreto('')).toBe('…');
  });

  it('la version publicable (wa_envios.preview) nunca contiene la llave', () => {
    const preview = mensajesCredencialValida(enmascararSecreto(LLAVE))[0];
    expect(preview).toContain('vk_ab12…');
    expect(preview).not.toContain(LLAVE);
    expect(preview).not.toContain(LLAVE.slice(3, 20));
  });

  it('el aviso interno lista las acciones y marca la falla sin reintento', () => {
    const fila = {
      nombre_aceptante: 'Bayron Correa', calidad: 'apoderado', empresa_nombre: '4D SOFT S.A.S.', empresa_nit: '901220269-6',
      documento_titulo: 'Términos', documento_version: '1.0', telefono: TEL,
    };
    const ok = avisoRespuesta({
      fila, decision: 'acepto', respondidoAt: '2026-09-14T15:32:00Z', negocioCodigo: null, estadoDocumento: 'read',
      acciones: [
        { tipo: 'enviar_credencial_valida', estado: 'enviada', detalle: 'llave vk_ab12… entregada y borrada de Vault' },
        { tipo: 'enviar_acceso_portal', estado: 'pendiente', detalle: 'sin implementar' },
      ],
    });
    expect(ok).toContain('• Llave de API de Valida: enviada — llave vk_ab12… entregada y borrada de Vault');
    expect(ok).toContain('• Acceso a la plataforma: pendiente — sin implementar');
    expect(ok).not.toContain('NO se reintenta');

    const fallo = avisoRespuesta({
      fila, decision: 'acepto', respondidoAt: '2026-09-14T15:32:00Z', negocioCodigo: null, estadoDocumento: 'read',
      acciones: [{ tipo: 'enviar_credencial_valida', estado: 'fallida', detalle: 'Meta no aceptó el mensaje con la llave vk_ab12…' }],
    });
    expect(fallo).toContain('fallida');
    expect(fallo).toContain('NO se reintenta sola');
  });

  it('sin acciones el aviso no agrega la seccion', () => {
    expect(lineasAcciones([])).toEqual([]);
  });
});

describe('integridad del documento', () => {
  it('sha256Hex da el vector conocido de "abc"', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('mismoHash ignora mayusculas y espacios, y nada mas', () => {
    expect(mismoHash('ABC', ' abc ')).toBe(true);
    expect(mismoHash('abc', 'abd')).toBe(false);
  });
});
