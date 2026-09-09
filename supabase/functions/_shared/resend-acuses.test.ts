/**
 * Pruebas de la verificacion de firma Svix y de la escritura que produce cada
 * acuse de Resend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * De donde salen los datos
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * · El caso `firma oficial` es el VECTOR PUBLICADO por Svix en
 *   https://docs.svix.com/receiving/verifying-payloads/how-manual (leido el
 *   2026-09-09). No lo generamos nosotros: es el unico caso de todo el archivo
 *   que puede afirmar que la mecanica es la de Svix y no la nuestra. Si algun
 *   dia lo cambiamos "para que pase", la prueba deja de probar nada.
 *
 * · Las firmas de los demas casos se construyen con `node:crypto`
 *   (`createHmac`), NO con `crypto.subtle`, que es lo que usa el codigo bajo
 *   prueba. Es a proposito: si las dos partes usaran la misma implementacion, un
 *   error compartido pasaria inadvertido.
 *
 * · Los tres rebotes son los REALES de SOENA del 2026-09-09 (V0326, V0298,
 *   V0446), con su `type`, su `subType` y su diagnostico SMTP tal como los
 *   reporto Resend. Van copiados con su fecha para que el dia que la base cambie
 *   se vea que la prueba envejecio, en vez de parecer un defecto.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Lo que estas pruebas matan
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada caso de firma corresponde a una forma CONCRETA de escribir Svix mal, y
 * las cuatro se ven bien al leerlas: firmar el cuerpo pelado (como Meta), firmar
 * con el secreto en texto sin decodificar el base64, devolver la firma en hex, y
 * mirar solo la primera entrada del header. Las cuatro producen 401 en todo, que
 * desde afuera se lee como "Resend no esta llamando".
 *
 * Del lado de la escritura, el caso que importa es que `delivered` y
 * `complained` NO traigan `estado` en el `set`: es lo unico que impide que un
 * acuse fuera de orden devuelva un rebote a `enviado`.
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  actualizacionDeAcuse,
  acuseDesdeLastEvent,
  interpretarAcuse,
  leerCabecerasSvix,
  motivoDeRebote,
  MOTIVO_MAX,
  MOTIVO_REBOTE_RECONSTRUIDO,
  TOLERANCIA_SEGUNDOS,
  verificarFirmaSvix,
  type Acuse,
} from './resend-acuses';

// ── Vector publicado por Svix ────────────────────────────────────────────────
const OFICIAL = {
  secreto: 'whsec_plJ3nmyCDGBKInavdOK15jsl',
  cuerpo: '{"event_type":"ping","data":{"success":true}}',
  id: 'msg_loFOjxBNrRLzqYUf',
  timestamp: '1731705121',
  firma: 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=',
};
// El vector es de noviembre de 2026: para que la ventana de 5 minutos no lo
// rechace, el reloj de la prueba se para en ese instante. Es el mismo motivo por
// el que `ahoraMs` entra por parametro y no sale de `Date.now()`.
const AHORA_OFICIAL = Number(OFICIAL.timestamp) * 1000;

const SECRETO = 'whsec_c2VjcmV0by1kZS1wcnVlYmEtMTIzNDU2Nzg5MA==';

function firmarBase64(secretoConPrefijo: string, contenido: string): string {
  const bytes = Buffer.from(secretoConPrefijo.replace(/^whsec_/, ''), 'base64');
  return createHmac('sha256', bytes).update(contenido).digest('base64');
}

/** Un sobre valido: cabeceras + reloj alineados con el cuerpo. */
function sobreValido(cuerpo: string, ahoraMs = 1_757_400_000_000) {
  const id = 'msg_2f3a9c';
  const timestamp = String(Math.floor(ahoraMs / 1000));
  const firma = firmarBase64(SECRETO, `${id}.${timestamp}.${cuerpo}`);
  return {
    ahoraMs,
    cabeceras: { id, timestamp, firma: `v1,${firma}` },
    firmaCruda: firma,
    id,
    timestamp,
  };
}

describe('verificarFirmaSvix', () => {
  it('acepta el vector oficial de Svix', async () => {
    const r = await verificarFirmaSvix({
      secreto: OFICIAL.secreto,
      cabeceras: { id: OFICIAL.id, timestamp: OFICIAL.timestamp, firma: OFICIAL.firma },
      cuerpo: OFICIAL.cuerpo,
      ahoraMs: AHORA_OFICIAL,
    });
    expect(r).toEqual({ ok: true });
  });

  it('rechaza el vector oficial si le cambian un caracter al cuerpo', async () => {
    const r = await verificarFirmaSvix({
      secreto: OFICIAL.secreto,
      cabeceras: { id: OFICIAL.id, timestamp: OFICIAL.timestamp, firma: OFICIAL.firma },
      cuerpo: OFICIAL.cuerpo.replace('true', 'false'),
      ahoraMs: AHORA_OFICIAL,
    });
    expect(r).toEqual({ ok: false, razon: 'sin_firma_valida' });
  });

  it('acepta un sobre bien construido', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({ secreto: SECRETO, cabeceras: s.cabeceras, cuerpo, ahoraMs: s.ahoraMs });
    expect(r).toEqual({ ok: true });
  });

  it('acepta el secreto sin el prefijo whsec_', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO.replace('whsec_', ''),
      cabeceras: s.cabeceras,
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: true });
  });

  // ── Las cuatro formas de escribir Svix como si fuera Meta ──────────────────

  it('rechaza una firma calculada sobre el CUERPO pelado (el HMAC de Meta)', async () => {
    const cuerpo = '{"type":"email.bounced"}';
    const s = sobreValido(cuerpo);
    const alaMeta = firmarBase64(SECRETO, cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: { ...s.cabeceras, firma: `v1,${alaMeta}` },
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: false, razon: 'sin_firma_valida' });
  });

  it('rechaza una firma calculada con el secreto EN TEXTO, sin decodificar el base64', async () => {
    const cuerpo = '{"type":"email.bounced"}';
    const s = sobreValido(cuerpo);
    const sinDecodificar = createHmac('sha256', SECRETO.replace('whsec_', ''))
      .update(`${s.id}.${s.timestamp}.${cuerpo}`)
      .digest('base64');
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: { ...s.cabeceras, firma: `v1,${sinDecodificar}` },
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: false, razon: 'sin_firma_valida' });
  });

  it('rechaza la misma firma buena expresada en hex', async () => {
    const cuerpo = '{"type":"email.bounced"}';
    const s = sobreValido(cuerpo);
    const enHex = Buffer.from(s.firmaCruda, 'base64').toString('hex');
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: { ...s.cabeceras, firma: `v1,${enHex}` },
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: false, razon: 'sin_firma_valida' });
  });

  it('acepta cuando la firma buena NO es la primera de la lista', async () => {
    const cuerpo = '{"type":"email.complained"}';
    const s = sobreValido(cuerpo);
    const otra = firmarBase64(SECRETO, 'otro.contenido.cualquiera');
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: { ...s.cabeceras, firma: `v1,${otra} v1,${s.firmaCruda}` },
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: true });
  });

  it('rechaza la firma buena si viene etiquetada con otra version', async () => {
    const cuerpo = '{"type":"email.complained"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: { ...s.cabeceras, firma: `v2,${s.firmaCruda}` },
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: false, razon: 'sin_firma_valida' });
  });

  // ── Ventana de tiempo ──────────────────────────────────────────────────────

  it('acepta un desfase dentro de la ventana', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: s.cabeceras,
      cuerpo,
      ahoraMs: s.ahoraMs + (TOLERANCIA_SEGUNDOS - 1) * 1000,
    });
    expect(r).toEqual({ ok: true });
  });

  it('rechaza por VENTANA, no por firma, un sobre viejo pero bien firmado', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: s.cabeceras,
      cuerpo,
      ahoraMs: s.ahoraMs + (TOLERANCIA_SEGUNDOS + 1) * 1000,
    });
    // La razon separada es la que permite distinguir en el log un ataque de un
    // reloj corrido. Si esto dijera `sin_firma_valida`, el diagnostico apuntaria
    // al lado equivocado.
    expect(r).toEqual({ ok: false, razon: 'timestamp_fuera_de_ventana' });
  });

  it('rechaza un timestamp del FUTURO fuera de la ventana', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: s.cabeceras,
      cuerpo,
      ahoraMs: s.ahoraMs - (TOLERANCIA_SEGUNDOS + 1) * 1000,
    });
    expect(r).toEqual({ ok: false, razon: 'timestamp_fuera_de_ventana' });
  });

  it('rechaza un timestamp que no es un entero de segundos', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    const r = await verificarFirmaSvix({
      secreto: SECRETO,
      cabeceras: { ...s.cabeceras, timestamp: '2026-09-09T00:00:00Z' },
      cuerpo,
      ahoraMs: s.ahoraMs,
    });
    expect(r).toEqual({ ok: false, razon: 'timestamp_invalido' });
  });

  // ── Ausencias: nada ausente puede autorizar ────────────────────────────────

  it('un secreto ausente NO autoriza', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    for (const secreto of [undefined, null, '']) {
      const r = await verificarFirmaSvix({ secreto, cabeceras: s.cabeceras, cuerpo, ahoraMs: s.ahoraMs });
      expect(r).toEqual({ ok: false, razon: 'sin_secreto' });
    }
  });

  it('una cabecera ausente NO autoriza', async () => {
    const cuerpo = '{"type":"email.delivered"}';
    const s = sobreValido(cuerpo);
    for (const falta of ['id', 'timestamp', 'firma'] as const) {
      const r = await verificarFirmaSvix({
        secreto: SECRETO,
        cabeceras: { ...s.cabeceras, [falta]: null },
        cuerpo,
        ahoraMs: s.ahoraMs,
      });
      expect(r).toEqual({ ok: false, razon: 'sin_cabeceras' });
    }
  });
});

describe('leerCabecerasSvix', () => {
  it('lee el prefijo svix-', () => {
    const h = new Headers({ 'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c' });
    expect(leerCabecerasSvix(h)).toEqual({ id: 'a', timestamp: 'b', firma: 'c' });
  });

  it('lee tambien el prefijo webhook- (marca blanca de Svix)', () => {
    const h = new Headers({ 'webhook-id': 'a', 'webhook-timestamp': 'b', 'webhook-signature': 'c' });
    expect(leerCabecerasSvix(h)).toEqual({ id: 'a', timestamp: 'b', firma: 'c' });
  });

  it('devuelve null cuando no hay ninguna', () => {
    expect(leerCabecerasSvix(new Headers())).toEqual({ id: null, timestamp: null, firma: null });
  });
});

// ── Rebotes reales de SOENA, 2026-09-09 ──────────────────────────────────────
const REBOTES_REALES = [
  {
    caso: 'V0326',
    to: 'jprrorasg1@yahoo.com',
    bounce: {
      type: 'Permanent',
      subType: 'General',
      diagnosticCode: ['smtp; 552 1 Requested mail action aborted, mailbox not found'],
    },
    prefijoEsperado: 'rebote_permanente',
  },
  {
    caso: 'V0298',
    to: 'isa.paca@hotmail.com',
    bounce: {
      type: 'Transient',
      subType: 'MailboxFull',
      diagnosticCode: ['smtp;554 5.2.2 mailbox full; QuotaExceededException'],
    },
    prefijoEsperado: 'rebote_transitorio',
  },
  {
    caso: 'V0446',
    to: 'mervecleves@gmail.com',
    bounce: {
      type: 'Permanent',
      subType: 'General',
      diagnosticCode: [
        "smtp; 550-5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient's email address for typos or unnecessary spaces.",
      ],
    },
    prefijoEsperado: 'rebote_permanente',
  },
];

describe('motivoDeRebote', () => {
  it.each(REBOTES_REALES)('$caso: nombra el tipo y conserva el diagnostico', ({ bounce, prefijoEsperado }) => {
    const motivo = motivoDeRebote(bounce);
    expect(motivo.startsWith(`${prefijoEsperado}: `)).toBe(true);
    // El codigo SMTP sobrevive: es lo que separa "buzon lleno" de "cuenta
    // inexistente" cuando el resto de la frase es generico.
    expect(motivo).toContain(bounce.diagnosticCode[0].slice(0, 20).replace(/\s+/g, ' '));
  });

  it('un buzon lleno y una cuenta inexistente NO comparten prefijo', () => {
    const lleno = motivoDeRebote(REBOTES_REALES[1].bounce);
    const inexistente = motivoDeRebote(REBOTES_REALES[0].bounce);
    expect(lleno.split(':')[0]).not.toBe(inexistente.split(':')[0]);
  });

  it('acepta Temporary ademas de Transient', () => {
    expect(motivoDeRebote({ type: 'Temporary', message: 'mailbox full' })).toBe('rebote_transitorio: mailbox full');
  });

  it('un tipo desconocido NO se declara transitorio por descarte', () => {
    // Decir "se puede reintentar" sobre algo que no sabemos es exactamente el
    // default silencioso que convierte un desconocimiento en una afirmacion.
    expect(motivoDeRebote({ type: 'Vaporware', message: 'algo' })).toBe('rebote: algo');
    expect(motivoDeRebote({})).toBe('rebote');
    expect(motivoDeRebote(null)).toBe('rebote');
  });

  it('cae al message y despues al subType cuando no hay diagnostico SMTP', () => {
    expect(motivoDeRebote({ type: 'Permanent', message: 'Suprimido por rebotes previos', subType: 'Suppressed' }))
      .toBe('rebote_permanente: Suprimido por rebotes previos');
    expect(motivoDeRebote({ type: 'Permanent', subType: 'Suppressed' })).toBe('rebote_permanente: Suppressed');
  });

  it('recorta el diagnostico largo sin pasarse del tope', () => {
    const motivo = motivoDeRebote({ type: 'Permanent', message: 'x'.repeat(1000) });
    expect(motivo.length).toBe(MOTIVO_MAX);
    expect(motivo.endsWith('…')).toBe(true);
  });

  it('normaliza los saltos de linea del diagnostico', () => {
    expect(motivoDeRebote({ type: 'Permanent', message: 'linea uno\n  linea dos' }))
      .toBe('rebote_permanente: linea uno linea dos');
  });
});

// ── Lectura del evento ───────────────────────────────────────────────────────
const AHORA = '2026-09-09T18:00:00.000Z';
const EMAIL_ID = '56761188-7520-42d8-8898-ff6fc54ce618';

function evento(tipo: string, extra: Record<string, unknown> = {}, createdAt = '2026-09-09T17:41:12.126Z') {
  return {
    type: tipo,
    created_at: createdAt,
    data: {
      // El `created_at` de DENTRO es el del correo, no el del evento. Se pone
      // distinto a proposito: si el codigo leyera este, la prueba lo delata.
      created_at: '2026-09-01T04:07:59.264Z',
      email_id: EMAIL_ID,
      to: ['cliente@ejemplo.com'],
      subject: 'Tu tramite avanzo',
      ...extra,
    },
  };
}

describe('interpretarAcuse', () => {
  it('lee un email.delivered', () => {
    const r = interpretarAcuse(evento('email.delivered'), AHORA);
    expect(r).toEqual({
      ok: true,
      acuse: { clase: 'entregado', emailId: EMAIL_ID, ocurridoEn: '2026-09-09T17:41:12.126Z' },
    });
  });

  it('lee un email.bounced con su motivo', () => {
    const r = interpretarAcuse(evento('email.bounced', { bounce: REBOTES_REALES[0].bounce }), AHORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.acuse.clase).toBe('rebotado');
    expect(r.acuse).toHaveProperty('motivo');
  });

  it('lee un email.complained', () => {
    const r = interpretarAcuse(evento('email.complained'), AHORA);
    expect(r.ok && r.acuse.clase).toBe('queja');
  });

  it('usa el created_at de la RAIZ, no el del correo', () => {
    const r = interpretarAcuse(evento('email.delivered'), AHORA);
    expect(r.ok && r.acuse.ocurridoEn).toBe('2026-09-09T17:41:12.126Z');
    expect(r.ok && r.acuse.ocurridoEn).not.toBe('2026-09-01T04:07:59.264Z');
  });

  it('cae al reloj de quien llama cuando el created_at falta o no parsea', () => {
    for (const malo of [undefined, '', 'ayer']) {
      const e = evento('email.delivered');
      if (malo === undefined) delete (e as Record<string, unknown>).created_at;
      else (e as Record<string, unknown>).created_at = malo;
      expect(interpretarAcuse(e, AHORA)).toMatchObject({ acuse: { ocurridoEn: AHORA } });
    }
  });

  it('ignora los eventos que este webhook no aplica', () => {
    for (const tipo of ['email.sent', 'email.opened', 'email.clicked', 'email.delivery_delayed', 'contact.created']) {
      expect(interpretarAcuse(evento(tipo), AHORA)).toEqual({ ok: false, razon: `tipo_no_manejado:${tipo}` });
    }
  });

  it('rechaza un evento sin email_id', () => {
    const e = evento('email.bounced');
    delete (e.data as Record<string, unknown>).email_id;
    expect(interpretarAcuse(e, AHORA)).toEqual({ ok: false, razon: 'sin_email_id' });
  });

  it('rechaza un payload que no es un objeto', () => {
    for (const basura of [null, undefined, 'texto', 42]) {
      expect(interpretarAcuse(basura, AHORA)).toEqual({ ok: false, razon: 'payload_invalido' });
    }
  });
});

// ── La escritura: idempotencia y orden ───────────────────────────────────────
describe('actualizacionDeAcuse', () => {
  const entregado: Acuse = { clase: 'entregado', emailId: EMAIL_ID, ocurridoEn: AHORA };
  const rebotado: Acuse = { clase: 'rebotado', emailId: EMAIL_ID, ocurridoEn: AHORA, motivo: 'rebote_permanente: x' };
  const queja: Acuse = { clase: 'queja', emailId: EMAIL_ID, ocurridoEn: AHORA };

  it('entregado escribe entregado_at y NO toca estado', () => {
    const a = actualizacionDeAcuse(entregado);
    expect(Object.keys(a.set)).toEqual(['entregado_at']);
    expect(a.set).not.toHaveProperty('estado');
    expect(a.guarda).toEqual({ columna: 'entregado_at', modo: 'es_nulo' });
  });

  it('queja escribe queja_at y NO toca estado — el correo SI llego', () => {
    const a = actualizacionDeAcuse(queja);
    expect(Object.keys(a.set)).toEqual(['queja_at']);
    expect(a.set).not.toHaveProperty('estado');
    expect(a.guarda).toEqual({ columna: 'queja_at', modo: 'es_nulo' });
  });

  it('rebotado escribe estado y motivo, guardado contra estado = enviado', () => {
    const a = actualizacionDeAcuse(rebotado);
    expect(a.set).toEqual({ estado: 'rebotado', motivo: 'rebote_permanente: x' });
    expect(a.guarda).toEqual({ columna: 'estado', modo: 'igual_a', valor: 'enviado' });
  });

  it('ningun acuse escribe sobre una columna que otro acuse tambien escriba', () => {
    // Esta es la afirmacion que sostiene "el orden de llegada no importa": si
    // dos clases compartieran columna, la ultima en llegar ganaria y un
    // `delivered` atrasado podria pisar un rebote.
    const columnas = [entregado, rebotado, queja].map((a) => Object.keys(actualizacionDeAcuse(a).set));
    const todas = columnas.flat();
    expect(new Set(todas).size).toBe(todas.length);
  });

  it('las tres guardas hacen que la segunda pasada no encuentre nada', () => {
    // La idempotencia vive en el WHERE: cada guarda niega justamente el efecto
    // que su propio `set` deja escrito.
    for (const acuse of [entregado, rebotado, queja]) {
      const { set, guarda } = actualizacionDeAcuse(acuse);
      if (guarda.modo === 'es_nulo') {
        expect(set[guarda.columna]).toBeTruthy();
      } else {
        expect(set[guarda.columna]).toBeTruthy();
        expect(set[guarda.columna]).not.toBe(guarda.valor);
      }
    }
  });
});

describe('acuseDesdeLastEvent (el backfill)', () => {
  const CUANDO = '2026-09-01T04:07:59.264Z';

  it('delivered reconstruye una entrega', () => {
    expect(acuseDesdeLastEvent('delivered', EMAIL_ID, CUANDO))
      .toEqual({ clase: 'entregado', emailId: EMAIL_ID, ocurridoEn: CUANDO });
  });

  it('opened y clicked TAMBIEN cuentan como entrega', () => {
    // No se puede abrir un correo que no llego. Sin esta regla, los correos que
    // mejor salieron —los que el cliente abrio— quedarian sin `entregado_at`.
    for (const evento of ['opened', 'clicked']) {
      expect(acuseDesdeLastEvent(evento, EMAIL_ID, CUANDO))
        .toMatchObject({ clase: 'entregado' });
    }
  });

  it('bounced reconstruye un rebote con un motivo DISTINGUIBLE del que deja el webhook', () => {
    const a = acuseDesdeLastEvent('bounced', EMAIL_ID, CUANDO);
    expect(a).toEqual({ clase: 'rebotado', emailId: EMAIL_ID, ocurridoEn: CUANDO, motivo: MOTIVO_REBOTE_RECONSTRUIDO });
    // El del webhook empieza por `rebote_permanente:` o `rebote_transitorio:`
    // porque conoce el `type`; el reconstruido no lo conoce y no lo finge.
    expect(MOTIVO_REBOTE_RECONSTRUIDO.startsWith('rebote:')).toBe(true);
    expect(motivoDeRebote(REBOTES_REALES[0].bounce).startsWith('rebote:')).toBe(false);
  });

  it('complained reconstruye una queja', () => {
    expect(acuseDesdeLastEvent('complained', EMAIL_ID, CUANDO)).toMatchObject({ clase: 'queja' });
  });

  it('los eventos que no dicen nada sobre la entrega devuelven null', () => {
    for (const evento of ['sent', 'queued', 'scheduled', 'delivery_delayed', 'failed', 'canceled', '', null, undefined]) {
      expect(acuseDesdeLastEvent(evento, EMAIL_ID, CUANDO)).toBeNull();
    }
  });

  it('suppressed devuelve null: el vocabulario de estado no tiene donde ponerlo', () => {
    // Hueco declarado, no olvidado. `suppressed` quiere decir que Resend acepto
    // el POST y no envio nada, asi que la fila dice `enviado` sobre un correo
    // que no salio. El backfill lo cuenta aparte en vez de elegirle un estado.
    expect(acuseDesdeLastEvent('suppressed', EMAIL_ID, CUANDO)).toBeNull();
  });

  it('no distingue mayusculas ni espacios sobrantes', () => {
    expect(acuseDesdeLastEvent('  Delivered ', EMAIL_ID, CUANDO)).toMatchObject({ clase: 'entregado' });
  });

  it('lo reconstruido pasa por las MISMAS guardas que lo que llega en vivo', () => {
    // Es lo que hace que correr el backfill dos veces, o correrlo despues de que
    // el webhook ya aplico el acuse, no cambie nada.
    const a = acuseDesdeLastEvent('bounced', EMAIL_ID, CUANDO)!;
    expect(actualizacionDeAcuse(a).guarda).toEqual({ columna: 'estado', modo: 'igual_a', valor: 'enviado' });
  });
});
