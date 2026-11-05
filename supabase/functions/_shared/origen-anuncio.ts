// ============================================================
// Origen del anuncio de Meta — leer el `referral` y grabarlo como toque de origen
// ------------------------------------------------------------
// Encargo max-agus-origen-anuncio (2026-11-05); tabla y puerta de escritura en la migración 20261105231500.
//
// Meta manda el `referral` SOLO en el primer mensaje después del clic en el anuncio: lo que no se graba ese día se
// pierde. Por eso se lee antes de cualquier otra lógica (aunque el remitente no esté registrado) y un fallo al grabar
// nunca tumba la respuesta: se registra y se sigue.
//
// Formas del `referral` (documentación de Meta):
//   WhatsApp Cloud API   `entry[].changes[].value.messages[].referral`
//                        { source_url, source_id, source_type: 'ad'|'post', headline, body, media_type, image_url,
//                          video_url, thumbnail_url, ctwa_clid, welcome_message }
//   Messenger (object 'page') e Instagram (object 'instagram')   `entry[].messaging[]` con el `referral` en
//                        `message.referral` (primer mensaje tras el anuncio), en `referral` (evento
//                        `messaging_referrals`, conversación ya abierta) o en `postback.referral` (botón de inicio):
//                        { ref, ad_id, source: 'ADS'|'SHORTLINK'|…, type: 'OPEN_THREAD', ads_context_data:
//                          { ad_title, photo_url, video_url, post_id, product_id } }
//   Chatwoot             solo WhatsApp Cloud: copia el `referral` crudo de Meta a `content_attributes.referral` del
//                        mensaje (app/services/whatsapp/incoming_message_service_helpers.rb). Messenger e Instagram NO:
//                        Chatwoot no suscribe la página a `messaging_referrals` ni lee `message.referral`
//                        (lib/integrations/facebook/message_parser.rb). Para esos dos queda la Fase B (`meta-origen`).
//
// Puro salvo `grabarToques` (que recibe el cliente de Supabase).
// ============================================================

export type CanalOrigen = 'whatsapp' | 'messenger' | 'instagram';
export type FuenteOrigen = 'wa-webhook' | 'chatwoot' | 'meta-origen';

export interface ToqueOrigen {
  canal: CanalOrigen;
  /** whatsapp: phone_number_id (o 'cw:<cuenta>:<inbox>' por Chatwoot); messenger: page_id; instagram: id de la cuenta. */
  alcance: string;
  /** whatsapp: wa_id (o BSUID); messenger: PSID; instagram: IGSID. */
  idExterno: string;
  mensajeId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  adId: string | null;
  ctwaClid: string | null;
  sourceUrl: string | null;
  headline: string | null;
  ref: string | null;
  crudo: Record<string, unknown>;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};
const esReferral = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as Obj).length > 0;

/** El `referral` de WhatsApp (de Meta directo o reenviado por Chatwoot) normalizado. Pura. */
function deWhatsapp(r: Obj): Pick<ToqueOrigen, 'sourceType' | 'sourceId' | 'adId' | 'ctwaClid' | 'sourceUrl' | 'headline' | 'ref'> {
  const sourceType = texto(r.source_type);
  const sourceId = texto(r.source_id);
  return {
    sourceType,
    sourceId,
    adId: sourceType?.toLowerCase() === 'ad' ? sourceId : null,
    ctwaClid: texto(r.ctwa_clid),
    sourceUrl: texto(r.source_url),
    headline: texto(r.headline),
    ref: null,
  };
}

/** El `referral` de Messenger o Instagram normalizado. Pura. */
function dePagina(r: Obj): Pick<ToqueOrigen, 'sourceType' | 'sourceId' | 'adId' | 'ctwaClid' | 'sourceUrl' | 'headline' | 'ref'> {
  const ads = obj(r.ads_context_data);
  const adId = texto(r.ad_id);
  return {
    sourceType: texto(r.source),
    sourceId: adId ?? texto(ads.post_id),
    adId,
    ctwaClid: null,
    sourceUrl: null,
    headline: texto(ads.ad_title),
    ref: texto(r.ref),
  };
}

/**
 * Los toques de un webhook de la Cloud API de WhatsApp: cada `messages[]` que trae `referral`. Recorre todas las
 * entries y changes. Con `soloPhoneNumberId`, ignora los de otros números. Nunca lanza. Pura.
 */
export function toquesDeWhatsapp(payload: unknown, soloPhoneNumberId?: string): ToqueOrigen[] {
  const out: ToqueOrigen[] = [];
  try {
    for (const entry of lista(obj(payload).entry)) {
      for (const change of lista(obj(entry).changes)) {
        const value = obj(obj(change).value);
        const pnid = texto(obj(value.metadata).phone_number_id);
        if (!pnid) continue;
        if (soloPhoneNumberId && pnid !== soloPhoneNumberId) continue;
        const contactos = lista(value.contacts).map(obj);
        for (const m of lista(value.messages).map(obj)) {
          if (!esReferral(m.referral)) continue;
          const bsuid = texto(m.from_user_id);
          const contacto = contactos.find((c) => !bsuid || texto(c.user_id) === bsuid) ?? contactos[0] ?? {};
          const idExterno = texto(m.from) ?? texto(contacto.wa_id) ?? bsuid ?? texto(contacto.user_id);
          if (!idExterno) continue;
          out.push({ canal: 'whatsapp', alcance: pnid, idExterno, mensajeId: texto(m.id), ...deWhatsapp(m.referral), crudo: m.referral });
        }
      }
    }
  } catch (e) {
    console.error('[origen-anuncio] no se pudo leer el referral de WhatsApp:', e);
  }
  return out;
}

/**
 * Los toques de un webhook de Messenger (`object: 'page'`) o de Instagram (`object: 'instagram'`). Ignora los ecos
 * (mensajes nuestros). Nunca lanza. Pura. La usa la Fase B (`meta-origen`).
 */
export function toquesDePagina(payload: unknown): ToqueOrigen[] {
  const out: ToqueOrigen[] = [];
  try {
    const p = obj(payload);
    const canal: CanalOrigen | null = p.object === 'page' ? 'messenger' : p.object === 'instagram' ? 'instagram' : null;
    if (!canal) return out;
    for (const entry of lista(p.entry).map(obj)) {
      const alcance = texto(entry.id);
      if (!alcance) continue;
      for (const ev of lista(entry.messaging).map(obj)) {
        const message = obj(ev.message);
        const postback = obj(ev.postback);
        if (message.is_echo === true) continue;
        const r = [message.referral, ev.referral, postback.referral].find(esReferral);
        if (!r) continue;
        const idExterno = texto(obj(ev.sender).id);
        if (!idExterno || idExterno === alcance) continue;
        const mensajeId = texto(message.mid) ?? texto(postback.mid) ?? (texto(ev.timestamp) ? `referral:${texto(ev.timestamp)}` : null);
        out.push({ canal, alcance, idExterno, mensajeId, ...dePagina(r), crudo: r });
      }
    }
  } catch (e) {
    console.error('[origen-anuncio] no se pudo leer el referral de la página:', e);
  }
  return out;
}

/**
 * El toque de un webhook de Chatwoot (`message_created`), si el mensaje trae el `referral` de Meta. Hoy Chatwoot solo
 * lo copia en WhatsApp Cloud (`content_attributes.referral`); se mira también `conversation.additional_attributes`
 * por si lo guarda ahí. Alcance: 'cw:<cuenta>:<inbox>' (el payload no trae el phone_number_id). Nunca lanza. Pura.
 */
export function toqueDeChatwoot(cuerpo: unknown): ToqueOrigen | null {
  try {
    const p = obj(cuerpo);
    if (p.event !== 'message_created' || !(p.message_type === 'incoming' || p.message_type === 0)) return null;
    const conv = obj(p.conversation);
    const r = [obj(p.content_attributes).referral, obj(conv.additional_attributes).referral].find(esReferral);
    if (!r) return null;
    const tipo = (texto(conv.channel) ?? texto(obj(p.inbox).channel_type) ?? '').toLowerCase();
    const canal: CanalOrigen | null = tipo.includes('whatsapp') ? 'whatsapp'
      : tipo.includes('instagram') ? 'instagram'
      : tipo.includes('facebook') ? 'messenger'
      : null;
    if (!canal) return null;
    const cuenta = texto(obj(p.account).id);
    const inbox = texto(obj(p.inbox).id) ?? texto(conv.inbox_id);
    if (!cuenta || !inbox) return null;
    const sender = obj(p.sender);
    const fuente = texto(obj(conv.contact_inbox).source_id);
    const telefono = texto(sender.phone_number)?.replace(/^\+/, '') ?? null;
    const idExterno = canal === 'whatsapp' ? (telefono ?? fuente) : (fuente ?? texto(sender.identifier));
    if (!idExterno) return null;
    const norm = canal === 'whatsapp' ? deWhatsapp(r) : dePagina(r);
    return { canal, alcance: `cw:${cuenta}:${inbox}`, idExterno, mensajeId: texto(p.id), ...norm, crudo: r };
  } catch (e) {
    console.error('[origen-anuncio] no se pudo leer el referral de Chatwoot:', e);
    return null;
  }
}

/** Lo mínimo del cliente de Supabase que se usa aquí. */
export interface RpcCliente {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Graba los toques por `registrar_toque_origen`. NUNCA lanza: un fallo se registra y se sigue (la respuesta al
 * cliente no depende de esto). Devuelve cuántos quedaron grabados.
 */
export async function grabarToques(supabase: RpcCliente, toques: ToqueOrigen[], fuente: FuenteOrigen, workspaceId: string | null = null): Promise<number> {
  let n = 0;
  for (const t of toques) {
    try {
      const { error } = await supabase.rpc('registrar_toque_origen', {
        p_canal: t.canal, p_alcance: t.alcance, p_id_externo: t.idExterno, p_fuente: fuente, p_crudo: t.crudo,
        p_workspace_id: workspaceId, p_mensaje_id: t.mensajeId, p_source_type: t.sourceType, p_source_id: t.sourceId,
        p_ad_id: t.adId, p_ctwa_clid: t.ctwaClid, p_source_url: t.sourceUrl, p_headline: t.headline, p_ref: t.ref,
      });
      if (error) {
        console.error(`[origen-anuncio] no se pudo grabar el toque (${t.canal}, ${t.alcance}, ${t.mensajeId ?? 'sin id'}):`, error.message);
        continue;
      }
      n++;
    } catch (e) {
      console.error(`[origen-anuncio] no se pudo grabar el toque (${t.canal}, ${t.alcance}, ${t.mensajeId ?? 'sin id'}):`, e);
    }
  }
  return n;
}
