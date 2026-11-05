import { describe, expect, it } from 'vitest'
import { grabarToques, toqueDeChatwoot, toquesDePagina, toquesDeWhatsapp } from './origen-anuncio'
import type { RpcCliente, ToqueOrigen } from './origen-anuncio'
import { canalDeChatwoot, firmaChatwoot } from './agente/publico/chatwoot-webhook'
import { toquesPorTitulo } from './agente/publico/cola'
import { CONFIG_PUBLICO_POR_DEFECTO } from './agente/publico/config'
import { recibir } from './agente/publico/entrada'
import type { PuertosEntrada } from './agente/publico/entrada'
import type { FilaPublica } from './agente/publico/tipos'

/**
 * Origen del anuncio de Meta (encargo max-agus-origen-anuncio). Los payloads siguen los ejemplos de la documentación de
 * Meta (Cloud API «Messages webhook: referral»; Messenger Platform «messages», «messaging_referrals» y
 * «messaging_postbacks»; Instagram Messaging «messages: referral»), con ids inventados. El de Chatwoot sigue el
 * `message_created` real de Dimpro (5-nov, datos enmascarados) más el `content_attributes.referral` que Chatwoot copia en
 * WhatsApp Cloud (incoming_message_service_helpers.rb#referral_attributes).
 */

const REFERRAL_WA = {
  source_url: 'https://fb.me/2ZulEu42P', source_id: '120214567890', source_type: 'ad', headline: 'Cerraduras digitales',
  body: '20% de descuento', media_type: 'image', image_url: 'https://scontent.example/img.jpg', ctwa_clid: 'ARAkLkA8rmlFeiCktEJQ-QTwRiyYHAFDLMNDBH0CD3qpjd0HR4irJ6LEkR7JwFF4XvnO2E4Nx0-eM-GABDLOPaOdRMv-_zfUQ2a',
}

const WEBHOOK_WA = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA_ID',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '573150000000', phone_number_id: '1111111111' },
        contacts: [{ profile: { name: 'Cliente' }, wa_id: '573001234567', user_id: 'CO.1A2B3C' }],
        messages: [{ from: '573001234567', from_user_id: 'CO.1A2B3C', id: 'wamid.HBgM1', timestamp: '1793367662', type: 'text', text: { body: 'Hola, vi el anuncio' }, referral: REFERRAL_WA }],
      },
    }],
  }],
}

describe('WhatsApp Cloud API: messages[].referral', () => {
  it('saca el toque con alcance = phone_number_id y los campos normalizados', () => {
    const [t, ...resto] = toquesDeWhatsapp(WEBHOOK_WA)
    expect(resto).toHaveLength(0)
    expect(t).toMatchObject({
      canal: 'whatsapp', alcance: '1111111111', idExterno: '573001234567', mensajeId: 'wamid.HBgM1',
      sourceType: 'ad', sourceId: '120214567890', adId: '120214567890', ctwaClid: REFERRAL_WA.ctwa_clid,
      sourceUrl: 'https://fb.me/2ZulEu42P', headline: 'Cerraduras digitales', ref: null,
    })
    expect(t.crudo).toEqual(REFERRAL_WA)
  })

  it('un post (no anuncio) no tiene ad_id', () => {
    const p = structuredClone(WEBHOOK_WA)
    p.entry[0].changes[0].value.messages[0].referral = { ...REFERRAL_WA, source_type: 'post' }
    expect(toquesDeWhatsapp(p)[0]).toMatchObject({ sourceType: 'post', adId: null, sourceId: '120214567890' })
  })

  it('sin teléfono (nombre de usuario) usa el BSUID', () => {
    const p = structuredClone(WEBHOOK_WA) as typeof WEBHOOK_WA
    const v = p.entry[0].changes[0].value as Record<string, unknown>
    v.contacts = [{ profile: { name: 'Cliente', username: 'cliente' }, user_id: 'CO.1A2B3C' }]
    delete (v.messages as Record<string, unknown>[])[0].from
    expect(toquesDeWhatsapp(p)[0].idExterno).toBe('CO.1A2B3C')
  })

  it('un mensaje sin referral, un acuse o un payload roto no dan toque', () => {
    const p = structuredClone(WEBHOOK_WA)
    delete (p.entry[0].changes[0].value.messages[0] as Record<string, unknown>).referral
    expect(toquesDeWhatsapp(p)).toEqual([])
    expect(toquesDeWhatsapp({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '1' }, statuses: [{ id: 'x', status: 'read' }] } }] }] })).toEqual([])
    expect(toquesDeWhatsapp(null)).toEqual([])
    expect(toquesDeWhatsapp('{')).toEqual([])
  })

  it('con el número propio, ignora los de otros números', () => {
    expect(toquesDeWhatsapp(WEBHOOK_WA, '1111111111')).toHaveLength(1)
    expect(toquesDeWhatsapp(WEBHOOK_WA, '9999999999')).toHaveLength(0)
  })
})

const ADS_CONTEXT = { ad_title: 'Taladros en promo', photo_url: 'https://scontent.example/ad.jpg', post_id: '1234567890_987654321' }

describe('Messenger (object page)', () => {
  const evento = (messaging: Record<string, unknown>) => ({ object: 'page', entry: [{ id: 'PAGE_ID', time: 1793367662000, messaging: [messaging] }] })

  it('message.referral: primer mensaje después del anuncio', () => {
    const [t] = toquesDePagina(evento({
      sender: { id: 'PSID_1' }, recipient: { id: 'PAGE_ID' }, timestamp: 1793367662000,
      message: { mid: 'm_abc', text: 'Hola', referral: { ref: 'promo-nov', ad_id: '6045246247433', source: 'ADS', type: 'OPEN_THREAD', ads_context_data: ADS_CONTEXT } },
    }))
    expect(t).toMatchObject({
      canal: 'messenger', alcance: 'PAGE_ID', idExterno: 'PSID_1', mensajeId: 'm_abc', sourceType: 'ADS', adId: '6045246247433',
      sourceId: '6045246247433', headline: 'Taladros en promo', ref: 'promo-nov', ctwaClid: null,
    })
  })

  it('messaging_referrals: conversación ya abierta (sin mid)', () => {
    const [t] = toquesDePagina(evento({
      sender: { id: 'PSID_2' }, recipient: { id: 'PAGE_ID' }, timestamp: 1793367662001,
      referral: { ref: 'abc', ad_id: '6045246247434', source: 'ADS', type: 'OPEN_THREAD', ads_context_data: ADS_CONTEXT },
    }))
    expect(t).toMatchObject({ canal: 'messenger', idExterno: 'PSID_2', mensajeId: 'referral:1793367662001', adId: '6045246247434' })
  })

  it('postback.referral: botón de inicio con m.me?ref=', () => {
    const [t] = toquesDePagina(evento({
      sender: { id: 'PSID_3' }, recipient: { id: 'PAGE_ID' }, timestamp: 1,
      postback: { mid: 'm_pb', title: 'Empezar', payload: 'GET_STARTED', referral: { ref: 'volante-feria', source: 'SHORTLINK', type: 'OPEN_THREAD' } },
    }))
    expect(t).toMatchObject({ mensajeId: 'm_pb', sourceType: 'SHORTLINK', ref: 'volante-feria', adId: null, sourceId: null })
  })

  it('standby: la app sin el control de la conversación también lo lee', () => {
    const [t] = toquesDePagina({ object: 'page', entry: [{ id: 'PAGE_ID', time: 1, standby: [{
      sender: { id: 'PSID_4' }, recipient: { id: 'PAGE_ID' }, timestamp: 1,
      message: { mid: 'm_sb', text: 'Hola', referral: { ad_id: '6045246247436', source: 'ADS', type: 'OPEN_THREAD' } },
    }] }] })
    expect(t).toMatchObject({ canal: 'messenger', idExterno: 'PSID_4', mensajeId: 'm_sb', adId: '6045246247436' })
  })

  it('ignora el eco (mensaje nuestro) y los mensajes sin referral', () => {
    expect(toquesDePagina(evento({ sender: { id: 'PAGE_ID' }, recipient: { id: 'PSID_1' }, message: { mid: 'm_e', is_echo: true, referral: { ad_id: '1' } } }))).toEqual([])
    expect(toquesDePagina(evento({ sender: { id: 'PSID_1' }, recipient: { id: 'PAGE_ID' }, message: { mid: 'm_n', text: 'hola' } }))).toEqual([])
  })
})

describe('Instagram (object instagram)', () => {
  it('message.referral de un anuncio que abre el Direct', () => {
    const [t] = toquesDePagina({
      object: 'instagram',
      entry: [{ id: 'IG_ID', time: 1, messaging: [{
        sender: { id: 'IGSID_1' }, recipient: { id: 'IG_ID' }, timestamp: 1,
        message: { mid: 'aWdfZAG1', text: 'Info', referral: { ref: 'r', ad_id: '6045246247435', source: 'ADS', type: 'OPEN_THREAD', ads_context_data: { ad_title: 'Brocas', photo_url: 'https://x' } } },
      }] }],
    })
    expect(t).toMatchObject({ canal: 'instagram', alcance: 'IG_ID', idExterno: 'IGSID_1', mensajeId: 'aWdfZAG1', adId: '6045246247435', headline: 'Brocas' })
  })

  it('otro object no da toque', () => {
    expect(toquesDePagina({ object: 'whatsapp_business_account', entry: [] })).toEqual([])
  })
})

/** El `message_created` real de Dimpro (Messenger, 5-nov), enmascarado: así llega hoy, sin referral. */
const CHATWOOT_MESSENGER = {
  event: 'message_created', id: 960878790, content: '***', message_type: 'incoming', content_type: 'text', private: false,
  content_attributes: { in_reply_to_external_id: null }, account: { id: 189134, name: 'Dimpro' }, inbox: { id: 151556, name: 'Ingeniería Dimpro' },
  conversation: { id: 3, status: 'pending', channel: 'Channel::FacebookPage', additional_attributes: {}, contact_inbox: { source_id: '***' } },
  sender: { id: 1, name: '***', type: 'contact', identifier: null, phone_number: null, additional_attributes: { last_avatar_sync_at: '2026-10-29T21:54:03Z' } },
  attachments: [],
}

const CHATWOOT_WHATSAPP = {
  ...CHATWOOT_MESSENGER,
  id: 960900001,
  content_attributes: { referral: REFERRAL_WA },
  inbox: { id: 160000, name: 'WhatsApp' },
  conversation: { id: 4, status: 'pending', channel: 'Channel::Whatsapp', additional_attributes: {}, contact_inbox: { source_id: '573001234567' } },
  sender: { id: 2, name: 'Cliente', type: 'contact', phone_number: '+573001234567' },
}

describe('Chatwoot', () => {
  it('Messenger: el payload real no trae referral → sin toque (de ahí la Fase B)', () => {
    expect(toqueDeChatwoot(CHATWOOT_MESSENGER)).toBeNull()
  })

  it('WhatsApp: lee content_attributes.referral; alcance = el inbox de Chatwoot', () => {
    expect(toqueDeChatwoot(CHATWOOT_WHATSAPP)).toMatchObject({
      canal: 'whatsapp', alcance: 'cw:189134:160000', idExterno: '573001234567', mensajeId: '960900001',
      adId: '120214567890', ctwaClid: REFERRAL_WA.ctwa_clid, headline: 'Cerraduras digitales',
    })
  })

  it('solo mensajes entrantes creados', () => {
    expect(toqueDeChatwoot({ ...CHATWOOT_WHATSAPP, message_type: 'outgoing' })).toBeNull()
    expect(toqueDeChatwoot({ ...CHATWOOT_WHATSAPP, event: 'message_updated' })).toBeNull()
  })

  it('canalDeChatwoot reconoce Messenger', () => {
    expect(canalDeChatwoot('Channel::FacebookPage')).toBe('messenger')
    expect(canalDeChatwoot('Channel::Whatsapp')).toBe('whatsapp')
    expect(canalDeChatwoot('Channel::Instagram')).toBe('instagram')
    expect(canalDeChatwoot('Channel::WebWidget')).toBe('otro')
  })

  it('el botón tocado en Messenger sigue llegando como toque con el canal nuevo', () => {
    const fila = (x: Partial<FilaPublica>) => ({ id: String(Math.random()), workspace_id: 'w', direccion: 'entrante', clase: 'escrito', texto: null, canal: 'messenger', created_at: '2026-11-05T13:40:00Z', ...x }) as FilaPublica
    const propuesta = fila({ direccion: 'saliente', clase: 'bot', turno_id: 't1', ranura: 'respuesta', opciones: [{ id: 'op|si', titulo: 'Sí, enviar link' }] })
    expect(toquesPorTitulo([propuesta, fila({ texto: 'Sí, enviar link' })], 'messenger')[1]).toMatchObject({ clase: 'toque', toque_id: 'op|si' })
  })

  describe('recibir: graba el toque antes de los filtros y nunca se cae por él', () => {
    const puertos = (o: Partial<PuertosEntrada> = {}): PuertosEntrada => ({
      secreto: () => 's',
      workspace: async () => ({ id: 'ws', slug: 'dimpro', config: { ...CONFIG_PUBLICO_POR_DEFECTO, activo: true, cuentaId: 189134, inboxes: [{ id: 160000, canal: 'otro', anuncio7Dias: false }] } }),
      primeraVez: async () => true,
      olvidar: async () => {},
      guardarEntrante: async () => 'ok',
      registrarCierre: async () => true,
      completarAudio: async () => true,
      ahoraS: () => 1792000000,
      reloj: () => 0,
      ...o,
    })
    const pedir = async (payload: unknown, p: PuertosEntrada) => {
      const cuerpo = JSON.stringify(payload)
      return recibir({ slug: 'dimpro', cuerpo, firma: await firmaChatwoot('s', '1792000000', cuerpo), timestamp: '1792000000' }, p)
    }

    it('graba con la empresa del webhook y guarda el mensaje igual', async () => {
      const grabados: [ToqueOrigen, string][] = []
      const r = await pedir(CHATWOOT_WHATSAPP, puertos({ grabarToque: async (t, ws) => { grabados.push([t, ws]) } }))
      expect(grabados).toHaveLength(1)
      expect(grabados[0][1]).toBe('ws')
      expect(r).toMatchObject({ status: 200, motivo: 'guardado' })
      expect(r.atender?.canal).toBe('whatsapp')
    })

    it('graba aunque el mensaje se filtre (conversación ya abierta por una persona)', async () => {
      let n = 0
      const r = await pedir({ ...CHATWOOT_WHATSAPP, conversation: { ...CHATWOOT_WHATSAPP.conversation, status: 'open' } }, puertos({ grabarToque: async () => { n++ } }))
      expect(n).toBe(1)
      expect(r.motivo).toBe('filtrado: no_pending')
    })

    it('si grabar falla, el mensaje se guarda igual', async () => {
      const r = await pedir(CHATWOOT_WHATSAPP, puertos({ grabarToque: async () => { throw new Error('base caída') } }))
      expect(r).toMatchObject({ status: 200, motivo: 'guardado' })
    })

    it('Messenger: el canal sale messenger aunque el inbox diga otro', async () => {
      const p = puertos({ workspace: async () => ({ id: 'ws', slug: 'dimpro', config: { ...CONFIG_PUBLICO_POR_DEFECTO, activo: true, cuentaId: 189134, inboxes: [{ id: 151556, canal: 'otro', anuncio7Dias: false }] } }) })
      const r = await pedir(CHATWOOT_MESSENGER, p)
      expect(r.atender?.canal).toBe('messenger')
    })
  })
})

describe('grabarToques', () => {
  const toque = toquesDeWhatsapp(WEBHOOK_WA)[0]

  it('llama a registrar_toque_origen con los campos normalizados', async () => {
    const llamadas: [string, Record<string, unknown>][] = []
    const sb: RpcCliente = { rpc: async (fn, args) => { llamadas.push([fn, args]); return { data: 'id', error: null } } }
    expect(await grabarToques(sb, [toque], 'wa-webhook')).toBe(1)
    expect(llamadas[0][0]).toBe('registrar_toque_origen')
    expect(llamadas[0][1]).toMatchObject({ p_canal: 'whatsapp', p_alcance: '1111111111', p_id_externo: '573001234567', p_fuente: 'wa-webhook', p_mensaje_id: 'wamid.HBgM1', p_ad_id: '120214567890', p_workspace_id: null })
  })

  it('nunca lanza: error de la base o excepción cuentan como no grabado', async () => {
    expect(await grabarToques({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, [toque], 'wa-webhook')).toBe(0)
    expect(await grabarToques({ rpc: () => { throw new Error('red') } }, [toque], 'wa-webhook')).toBe(0)
  })
})
