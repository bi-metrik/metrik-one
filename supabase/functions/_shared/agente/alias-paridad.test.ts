/**
 * El alias de una conversación de WhatsApp es el mismo en el correo de caída (`caida.ts`), en `asistente_escalamientos`
 * y en la calificación y el resumen diarios (`src/lib/asistentes/conversaciones.ts`, que lo copia para no arrastrar
 * `Deno` al chequeo de tipos de Next). Si uno cambia, los tres dejan de cruzarse.
 */
import { describe, expect, it } from 'vitest';
import { aliasConversacionWa, horaBogota } from './caida.ts';
import { aliasWa, horaBogota as horaBogotaNext } from '../../../../src/lib/asistentes/conversaciones.ts';

describe('alias de la conversación de WhatsApp', () => {
  it('el de Next y el del edge dan lo mismo', async () => {
    for (const [ws, phone] of [['ws-1', '573001234567'], ['11111111-1111-1111-1111-111111111111', '+57 300 123 4567']]) {
      expect(await aliasWa(ws, phone)).toBe(await aliasConversacionWa(ws, phone));
    }
    expect(horaBogotaNext(Date.parse('2026-10-26T19:05:00Z'))).toBe(horaBogota(Date.parse('2026-10-26T19:05:00Z')));
  });
});
