// Firma `x-hub-signature-256` del webhook de WhatsApp. La regresion que motiva el modulo: el webhook
// llamaba la verificacion sin `await`, la Promise era truthy y ningun POST sin firmar se rechazaba.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verificarFirmaMeta } from './wa-firma';

const SECRETO = 'secreto-de-prueba';
const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: '1' }] });

function firmar(body: string, secreto = SECRETO): string {
  return 'sha256=' + createHmac('sha256', secreto).update(body).digest('hex');
}

describe('verificarFirmaMeta', () => {
  it('acepta una firma valida calculada con el secreto', async () => {
    expect(await verificarFirmaMeta(BODY, firmar(BODY), SECRETO)).toBe(true);
  });

  it('rechaza si el cuerpo cambio en un solo byte', async () => {
    const firma = firmar(BODY);
    const alterado = BODY.replace('"1"', '"2"');
    expect(alterado).not.toBe(BODY);
    expect(await verificarFirmaMeta(alterado, firma, SECRETO)).toBe(false);
  });

  it('rechaza una firma hecha con otro secreto', async () => {
    expect(await verificarFirmaMeta(BODY, firmar(BODY, 'otro-secreto'), SECRETO)).toBe(false);
  });

  it('rechaza sin cabecera de firma', async () => {
    expect(await verificarFirmaMeta(BODY, null, SECRETO)).toBe(false);
  });

  it('rechaza la firma sin el prefijo sha256=', async () => {
    const soloHex = firmar(BODY).slice('sha256='.length);
    expect(await verificarFirmaMeta(BODY, soloHex, SECRETO)).toBe(false);
  });

  it('rechaza una firma de largo incorrecto', async () => {
    expect(await verificarFirmaMeta(BODY, firmar(BODY).slice(0, -2), SECRETO)).toBe(false);
    expect(await verificarFirmaMeta(BODY, firmar(BODY) + 'ab', SECRETO)).toBe(false);
  });

  it('falla cerrado si no hay secreto', async () => {
    expect(await verificarFirmaMeta(BODY, firmar(BODY), undefined)).toBe(false);
    expect(await verificarFirmaMeta(BODY, firmar(BODY), '')).toBe(false);
  });

  it('sin secreto y con WA_WEBHOOK_SKIP_FIRMA=1 deja pasar (solo desarrollo local)', async () => {
    expect(await verificarFirmaMeta(BODY, null, undefined, { saltarFirma: true })).toBe(true);
  });

  it('con secreto configurado, el bypass no aplica', async () => {
    expect(await verificarFirmaMeta(BODY, null, SECRETO, { saltarFirma: true })).toBe(false);
  });

  it('regresion: devuelve una Promise que resuelve a un booleano estricto, no algo truthy', async () => {
    const pendiente = verificarFirmaMeta(BODY, 'sha256=' + '0'.repeat(64), SECRETO);
    // El bug era tratar ESTO como resultado: una Promise siempre es truthy.
    expect(pendiente).toBeInstanceOf(Promise);
    expect(Boolean(pendiente)).toBe(true);
    const resultado = await pendiente;
    expect(resultado).toStrictEqual(false);
    expect(typeof resultado).toBe('boolean');
  });
});
