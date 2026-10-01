import { describe, expect, it } from 'vitest';

/**
 * `suma_de` (número de pasajeros = adultos + niños + infantes) se calcula en DOS lados que tienen
 * que coincidir: la pantalla y el guardado de ONE (`src/lib/negocios/campo-suma.ts`) y la bandeja de
 * WhatsApp (`aplicarSumas` de `wa-entendimiento-reglas.ts`). Si no coinciden, el primer guardado de la
 * pantalla cambia lo que dejó el bot y parece una edición de una persona.
 *
 * Regla (prueba en vivo del 2026-10-01, error 5): la suma solo con las tres fuentes; con alguna
 * vacía, el total vacío; sin ninguna, no se toca. Datos sintéticos.
 *
 * Mutaciones (2026-10-01), cada una contra los dos lados por separado:
 *   · volver a sumar lo conocido (quitar el `some(null)`)      → cae «una fuente vacía» (las dos copias);
 *   · vaciar también sin ninguna fuente                         → cae «sin ninguna fuente»;
 *   · contar un cero escrito como vacío                         → cae «un cero escrito».
 */
import { aplicarSumas as deONE } from '../../../src/lib/negocios/campo-suma';
import { aplicarSumas as deLaBandeja, type CampoEntendible } from './wa-entendimiento-reglas';

const CAMPOS = [
  { slug: 'adultos', tipo: 'numero' },
  { slug: 'ninos', tipo: 'numero' },
  { slug: 'infantes', tipo: 'numero' },
  { slug: 'numero_pasajeros', tipo: 'numero', suma_de: ['adultos', 'ninos', 'infantes'] },
] as CampoEntendible[];

const CASOS: Array<[string, Record<string, unknown>, unknown]> = [
  ['las tres fuentes', { adultos: 2, ninos: 1, infantes: 0 }, 3],
  ['un cero escrito es un número', { adultos: '5', ninos: '0', infantes: 0 }, 5],
  ['una fuente vacía: Diego, 5 adultos y los menores sin saber', { adultos: 5, ninos: null, infantes: '' }, undefined],
  ['una fuente vacía con un total viejo: se vacía', { adultos: 5, ninos: '', infantes: 0, numero_pasajeros: 5 }, ''],
  ['sin ninguna fuente: el total escrito a mano se queda', { numero_pasajeros: 6 }, 6],
  ['pisa un total que no cuadra con el desglose', { adultos: 2, ninos: 0, infantes: 0, numero_pasajeros: 7 }, 2],
];

describe('suma_de: la pantalla de ONE y la bandeja de WhatsApp dicen lo mismo', () => {
  it.each(CASOS)('%s', (_n, valores, esperado) => {
    expect(deONE(CAMPOS, { ...valores }).numero_pasajeros).toEqual(esperado);
    expect(deLaBandeja(CAMPOS, { ...valores }).numero_pasajeros).toEqual(esperado);
  });
});
