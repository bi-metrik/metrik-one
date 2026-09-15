// Lectura del webhook de Meta cuando la persona tiene nombre de usuario de WhatsApp.
// El caso real (2026-09-15, 4D SOFT): `messages[0].from` no vino y el webhook revento en
// `identifyUser` con `Cannot read properties of undefined (reading 'replace')`. Los payloads de
// abajo siguen la forma de la doc de Meta ("Incoming messages webhooks" y "Status messages
// webhooks" de business-scoped-user-ids).
import { describe, expect, it } from 'vitest';
import { extraerEntrante, extraerStatuses, textoLegible } from './wa-webhook-payload';
import type { MetaWebhookPayload } from './wa-webhook-payload';
import { camposDestino } from './wa-destino';

const PROPIO = '106540352242922';
const BSUID = 'CO.13491208655302741918';

type Value = NonNullable<NonNullable<NonNullable<MetaWebhookPayload['entry']>[number]['changes']>[number]['value']>;

function webhook(value: Partial<Value>): MetaWebhookPayload {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '573181362594', phone_number_id: PROPIO },
          ...value,
        },
      }],
    }],
  };
}

describe('extraerEntrante — mensaje con telefono', () => {
  it('toma `from` como telefono y conserva BSUID y usuario', () => {
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { name: 'Pablo', username: 'pablomorales' }, wa_id: '573001234567', user_id: BSUID }],
      messages: [{ from: '573001234567', from_user_id: BSUID, id: 'wamid.1', timestamp: '1757943060', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);

    expect(r?.tipo).toBe('con_telefono');
    if (r?.tipo !== 'con_telefono') return;
    expect(r.mensaje.phone).toBe('573001234567');
    expect(r.mensaje.text).toBe('Hola');
    expect(r.mensaje.user_id).toBe(BSUID);
    expect(r.mensaje.username).toBe('pablomorales');
    expect(r.mensaje.bot_phone).toBe('573181362594');
  });

  it('un payload de antes de abril de 2026 (sin BSUID) sigue saliendo igual', () => {
    const r = extraerEntrante(webhook({
      messages: [{ from: '573001234567', id: 'wamid.2', timestamp: '1757943060', type: 'text', text: { body: 'gasto 20000 taxi' } }],
    }), PROPIO);

    expect(r).toEqual({
      tipo: 'con_telefono',
      mensaje: {
        phone: '573001234567',
        text: 'gasto 20000 taxi',
        type: 'text',
        wa_message_id: 'wamid.2',
        bot_phone: '573181362594',
        timestamp: '1757943060',
      },
    });
  });

  it('sin `from` pero con `contacts[0].wa_id` del mismo remitente, usa ese telefono', () => {
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { name: 'Pablo', username: 'pablomorales' }, wa_id: '573001234567', user_id: BSUID }],
      messages: [{ from_user_id: BSUID, id: 'wamid.3', timestamp: '1757943060', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);

    expect(r?.tipo).toBe('con_telefono');
    if (r?.tipo !== 'con_telefono') return;
    expect(r.mensaje.phone).toBe('573001234567');
  });

  it('no toma el `wa_id` de un contacto que es otra persona', () => {
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { name: 'Otra' }, wa_id: '573009999999', user_id: 'CO.99999999999999999999' }],
      messages: [{ from_user_id: BSUID, id: 'wamid.4', timestamp: '1757943060', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);

    expect(r?.tipo).toBe('sin_telefono');
  });

  it('un mensaje para otro phone_number_id no es nuestro', () => {
    const r = extraerEntrante({
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'otro' },
        messages: [{ from: '573001234567', id: 'wamid.5', timestamp: '1', type: 'text', text: { body: 'Hola' } }],
      } }] }],
    }, PROPIO);
    expect(r).toBeNull();
  });

  it('con telefono, un tipo que el bot no atiende sigue sin entrar', () => {
    const r = extraerEntrante(webhook({
      messages: [{ from: '573001234567', id: 'wamid.6', timestamp: '1', type: 'sticker' }],
    }), PROPIO);
    expect(r).toBeNull();
  });
});

describe('extraerEntrante — mensaje sin telefono (nombre de usuario)', () => {
  it('sin `from` ni `wa_id` sale como `sin_telefono` con BSUID, usuario, nombre y texto', () => {
    // Forma exacta del ejemplo de la doc: `contacts` sin `wa_id` y `messages` sin `from`.
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { name: 'Juan Guillermo', username: 'jglm_28' }, user_id: BSUID }],
      messages: [{ from_user_id: BSUID, id: 'wamid.7', timestamp: '1757943060', type: 'text', text: { body: 'Buenas tardes, ya firmé' } }],
    }), PROPIO);

    expect(r).toEqual({
      tipo: 'sin_telefono',
      mensaje: {
        user_id: BSUID,
        username: 'jglm_28',
        nombre: 'Juan Guillermo',
        tipo: 'text',
        texto: 'Buenas tardes, ya firmé',
        wa_message_id: 'wamid.7',
        timestamp: '1757943060',
      },
    });
  });

  it('nunca construye un mensaje con `phone` indefinido', () => {
    // Es el defecto que tumbo el webhook: si esto vuelve a pasar, `identifyUser` revienta.
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { username: 'jglm_28' }, user_id: BSUID }],
      messages: [{ from_user_id: BSUID, id: 'wamid.8', timestamp: '1', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);
    expect(r?.tipo).toBe('sin_telefono');
    expect(r?.mensaje).not.toHaveProperty('phone');
  });

  it('si `messages` no trae `from_user_id`, toma el BSUID de `contacts`', () => {
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { username: 'jglm_28' }, user_id: BSUID }],
      messages: [{ id: 'wamid.9', timestamp: '1', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);
    expect(r?.tipo).toBe('sin_telefono');
    expect(r?.mensaje).toMatchObject({ user_id: BSUID });
  });

  it('sin telefono entra aunque el tipo no lo atienda el bot: una tarjeta de contacto trae el numero', () => {
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { username: 'jglm_28' }, user_id: BSUID }],
      messages: [{
        from_user_id: BSUID, id: 'wamid.10', timestamp: '1', type: 'contacts',
        contacts: [{ phones: [{ phone: '+57 321 588 4456', wa_id: '573215884456' }] }],
      }],
    }), PROPIO);
    expect(r?.tipo).toBe('sin_telefono');
    expect(r?.mensaje).toMatchObject({ tipo: 'contacts', texto: '[contacto compartido] +57 321 588 4456' });
  });

  it('sin telefono ni BSUID no hay a quien contestarle', () => {
    const r = extraerEntrante(webhook({
      messages: [{ id: 'wamid.11', timestamp: '1', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);
    expect(r).toBeNull();
  });

  it('un `from` vacio cuenta como ausente', () => {
    const r = extraerEntrante(webhook({
      contacts: [{ profile: { username: 'jglm_28' }, user_id: BSUID }],
      messages: [{ from: '  ', from_user_id: BSUID, id: 'wamid.12', timestamp: '1', type: 'text', text: { body: 'Hola' } }],
    }), PROPIO);
    expect(r?.tipo).toBe('sin_telefono');
  });
});

describe('textoLegible', () => {
  it('toque de boton: el titulo', () => {
    expect(textoLegible({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'x', title: 'Acepto' } } })).toBe('Acepto');
  });
  it('foto sin pie: el tipo entre corchetes', () => {
    expect(textoLegible({ type: 'image', image: { id: 'm' } })).toBe('[image]');
  });
});

describe('extraerStatuses — acuses sin recipient_id', () => {
  it('un acuse de un mensaje enviado al BSUID usa el BSUID como destinatario', () => {
    const r = extraerStatuses(webhook({
      contacts: [{ profile: { name: 'Juan Guillermo', username: 'jglm_28' }, user_id: BSUID }],
      statuses: [{ id: 'wamid.s1', status: 'delivered', timestamp: '1750030073', recipient_user_id: BSUID }],
    }), PROPIO);

    expect(r).toEqual([{
      waMessageId: 'wamid.s1',
      status: 'delivered',
      statusAt: new Date(1750030073 * 1000).toISOString(),
      phone: BSUID,
      errorCode: undefined,
      errorTitle: undefined,
    }]);
  });

  it('con telefono y BSUID, el telefono gana', () => {
    const r = extraerStatuses(webhook({
      statuses: [{ id: 'wamid.s2', status: 'read', timestamp: '1', recipient_id: '573001234567', recipient_user_id: BSUID }],
    }), PROPIO);
    expect(r[0].phone).toBe('573001234567');
  });

  it('un `failed` sin ningun destinatario igual se aplica, con su error', () => {
    const r = extraerStatuses(webhook({
      statuses: [{ id: 'wamid.s3', status: 'failed', timestamp: '1', errors: [{ code: 131062, title: 'BSUID recipients are not supported for this message.' }] }],
    }), PROPIO);
    expect(r).toHaveLength(1);
    expect(r[0].phone).toBeUndefined();
    expect(r[0].errorCode).toBe(131062);
  });
});

describe('camposDestino — contrato de envio de la Messages API', () => {
  it('al BSUID se le escribe con `recipient` y sin `to` (si van los dos, gana `to`)', () => {
    const campos = camposDestino({ bsuid: BSUID });
    expect(campos).toEqual({ recipient_type: 'individual', recipient: BSUID });
    expect(campos).not.toHaveProperty('to');
  });
  it('al telefono, con `to` como siempre', () => {
    expect(camposDestino({ telefono: '573001234567' })).toEqual({ to: '573001234567' });
  });
});
