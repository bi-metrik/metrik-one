/**
 * Bloque A del concepto de Emilio (2026-08-31): las seis condiciones que
 * permiten conectar el clasificador de tier sin esperar los instrumentos
 * contractuales.
 *
 * Cada `describe` corresponde a una condición del concepto y la prueba es la
 * verificación que el propio concepto pide. No están agrupadas por función a
 * propósito: quien revise el cumplimiento tiene que poder leer el archivo con el
 * concepto al lado.
 *
 * Referencia: `proyectos/afi/alma/docs/entrada/2026-08-31_concepto-emilio-enrutamiento-tier.md`, §5.
 *
 * VERIFICADO POR MUTACIÓN (2026-08-31), contra este archivo + `tier-fuentes.test.ts`.
 * Cada mutación tumbó pruebas:
 *   - `puedeEmitirVeredicto` habilitando un catálogo sin firmar → caen 2
 *   - `canalDeExigencia` ignorando `haySinClasificar` → cae 1
 *   - `canalDeExigencia` ignorando `opera` → cae 1
 *   - rotular una fuente desconocida como medios → caen 2
 *   - degradar una fuente desconocida a tier 'medios' → caen 10
 *   - `verificarCeroSupresion` devolviendo siempre true → cae 1
 */

import { describe, it, expect } from 'vitest';
import {
  canalDeExigencia,
  clasificarConsulta,
  indexarCatalogo,
  puedeEmitirVeredicto,
  verificarCeroSupresion,
  type CatalogoTier,
  type FuenteCatalogada,
} from './tier-fuentes';
import type { InformaMatch } from '@/lib/actions/compliance-dual';

// ─── Catálogo de prueba, con el shape real del sembrado ────────────────────

function fuente(p: Partial<FuenteCatalogada> = {}): FuenteCatalogada {
  return {
    llave_tipo: 'fuente',
    llave: 'OFAC',
    tier: 'tier_2',
    familia: 'sanciones_extranjeras',
    provisional: false,
    etiqueta: 'Sanción extranjera',
    sustento: 'OFAC no es vinculante en Colombia por sí sola.',
    grupo_dedup: null,
    ...p,
  };
}

const FUENTES: FuenteCatalogada[] = [
  fuente({ llave: 'ONU', tier: 'tier_1', familia: 'vinculante', etiqueta: 'Lista vinculante' }),
  fuente({ llave: 'OFAC', grupo_dedup: 'ofac' }),
  fuente({ llave: 'CSL', grupo_dedup: 'ofac', etiqueta: 'Sanción extranjera (reempaqueta OFAC)' }),
  fuente({ llave: 'PEPCOL', tier: 'tier_3', familia: 'pep', etiqueta: 'PEP' }),
  fuente({
    llave_tipo: 'lista', llave: 'NSN MEDIOS', tier: 'medios', familia: 'medios',
    etiqueta: 'Mención en medios',
  }),
];

function catalogo(status: CatalogoTier['status'] = 'validada_tecnica') {
  return indexarCatalogo({ version: 1, status, fuentes: FUENTES });
}

function match(p: { fuente?: string; lista?: string; nombre?: string; coincidencia?: string } = {}): InformaMatch {
  return {
    lista: p.lista ?? 'LISTA X',
    nombre: p.nombre ?? 'ACME SAS',
    documento: null,
    fundamento: null,
    detalle: {
      fuente: p.fuente ?? 'OFAC',
      nombreEncontrado: p.nombre ?? 'ACME SAS',
      coincidencia: p.coincidencia ?? 'nombrebusqueda',
      porcentajeDeCoincidencia: '100',
    },
  } as unknown as InformaMatch;
}

// ─── C2 ────────────────────────────────────────────────────────────────────

describe('C2 — sin catálogo firmado no se emite veredicto', () => {
  it('con el catálogo en validada_tecnica NO se puede emitir veredicto', () => {
    expect(puedeEmitirVeredicto(catalogo('validada_tecnica'))).toBe(false);
  });

  it('solo un catálogo vigente habilita el veredicto', () => {
    expect(puedeEmitirVeredicto(catalogo('vigente'))).toBe(true);
    expect(puedeEmitirVeredicto(catalogo('propuesta'))).toBe(false);
    expect(puedeEmitirVeredicto(catalogo('historica'))).toBe(false);
  });

  it('sin catálogo tampoco', () => {
    expect(puedeEmitirVeredicto(null)).toBe(false);
    expect(puedeEmitirVeredicto(undefined)).toBe(false);
  });

  // La verificación textual que pide el concepto: con catálogo no firmado, TODO
  // va al canal de mayor exigencia, incluida una consulta de puras menciones de
  // prensa que en otras condiciones sería lo más bajo del orden.
  it('con catálogo no firmado hasta los medios van al canal de mayor exigencia', () => {
    const c = clasificarConsulta(
      [match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' })],
      catalogo('validada_tecnica'),
    );
    expect(c.opera).toBe(false);
    expect(canalDeExigencia(c)).toBe('maxima');
  });

  it('firmado, esa misma consulta baja a ordinario', () => {
    const c = clasificarConsulta(
      [match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' })],
      catalogo('vigente'),
    );
    expect(canalDeExigencia(c)).toBe('ordinario');
  });
});

// ─── C3 ────────────────────────────────────────────────────────────────────

describe('C3 — cero supresión', () => {
  it('hallazgos + duplicados siempre iguala lo devuelto por la fuente', () => {
    const matches = [
      match({ fuente: 'ONU' }),
      match({ fuente: 'OFAC' }),
      match({ fuente: 'CSL' }), // reempaqueta OFAC: duplicado del mismo nombre
      match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' }),
    ];
    const c = clasificarConsulta(matches, catalogo('vigente'));
    expect(c.duplicados.length).toBe(1);
    expect(verificarCeroSupresion(c, matches.length)).toBe(true);
    expect(c.hallazgos.length + c.duplicados.length).toBe(matches.length);
  });

  // El caso que sustenta el diseño ante ALMA: 25 menciones de prensa de la misma
  // persona son 25, no una. Deduplicarlas destruiría la cifra de concentración
  // de medios y escondería 24 hallazgos.
  it('las menciones de prensa de la misma entidad NO colapsan', () => {
    const matches = Array.from({ length: 25 }, () =>
      match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' }));
    const c = clasificarConsulta(matches, catalogo('vigente'));
    expect(c.hallazgos.length).toBe(25);
    expect(c.duplicados.length).toBe(0);
    expect(verificarCeroSupresion(c, 25)).toBe(true);
  });

  it('detecta una pérdida cuando la hay', () => {
    const c = clasificarConsulta([match()], catalogo('vigente'));
    expect(verificarCeroSupresion(c, 2)).toBe(false);
  });

  // El volumen exacto medido en alma-afi el 2026-08-25.
  it('sobre las 50 coincidencias del workspace no se pierde ninguna', () => {
    const matches = [
      ...Array.from({ length: 25 }, () => match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' })),
      ...Array.from({ length: 15 }, (_, i) => match({ fuente: 'PEPCOL', nombre: `PEP ${i}` })),
      ...Array.from({ length: 10 }, (_, i) => match({ fuente: 'OFAC', nombre: `SANCION ${i}` })),
    ];
    const c = clasificarConsulta(matches, catalogo('vigente'));
    expect(matches).toHaveLength(50);
    expect(verificarCeroSupresion(c, 50)).toBe(true);
    expect(c.hallazgos.length + c.duplicados.length).toBe(50);
  });
});

// ─── C4 ────────────────────────────────────────────────────────────────────

describe('C4 — la fuente que el catálogo no resuelve dispara', () => {
  const INVENTADA = 'REGISTRO NACIONAL DE ALGO QUE NO EXISTE';

  it('queda en sin_clasificar, no en medios ni en "no dispara"', () => {
    const c = clasificarConsulta(
      [match({ fuente: INVENTADA, lista: 'LISTA INVENTADA' })],
      catalogo('vigente'),
    );
    expect(c.hallazgos[0].tier).toBe('sin_clasificar');
    expect(c.haySinClasificar).toBe(true);
  });

  it('va al canal de mayor exigencia aunque el catálogo esté firmado', () => {
    const c = clasificarConsulta(
      [match({ fuente: INVENTADA, lista: 'LISTA INVENTADA' })],
      catalogo('vigente'),
    );
    expect(canalDeExigencia(c)).toBe('maxima');
  });

  it('se rotula, y la fuente cruda queda para quien vaya a clasificarla', () => {
    const c = clasificarConsulta(
      [match({ fuente: INVENTADA, lista: 'LISTA INVENTADA' })],
      catalogo('vigente'),
    );
    expect(c.hallazgos[0].etiqueta).toBe('Fuente no clasificada');
    expect(c.fuentesSinClasificar).toEqual([INVENTADA]);
  });

  // Una fuente nueva no puede tapar un hallazgo conocido: el tier máximo que se
  // reporta sigue siendo el Tier 1.
  it('no esconde un Tier 1 detrás de la etiqueta de catálogo incompleto', () => {
    const c = clasificarConsulta(
      [match({ fuente: 'ONU' }), match({ fuente: INVENTADA, lista: 'OTRA' })],
      catalogo('vigente'),
    );
    expect(c.tierMaximo).toBe('tier_1');
    expect(c.haySinClasificar).toBe(true);
    expect(canalDeExigencia(c)).toBe('maxima');
  });
});

// ─── C6 ────────────────────────────────────────────────────────────────────

describe('C6 — el camino Tier 1, que nunca se ha ejecutado en producción', () => {
  const consulta = () => clasificarConsulta([
    match({ fuente: 'ONU', nombre: 'ENTIDAD SANCIONADA ONU', coincidencia: 'nit' }),
    match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' }),
  ], catalogo('vigente'));

  it('clasifica: la coincidencia de ONU sale como tier_1', () => {
    expect(consulta().hallazgos[0].tier).toBe('tier_1');
  });

  it('prioridad: el tier máximo es tier_1 aunque haya menciones de prensa', () => {
    expect(consulta().tierMaximo).toBe('tier_1');
  });

  it('los medios no diluyen el Tier 1 por acumulación', () => {
    const conMuchosMedios = clasificarConsulta([
      match({ fuente: 'ONU', nombre: 'ENTIDAD SANCIONADA ONU' }),
      ...Array.from({ length: 40 }, () => match({ fuente: 'EL TIEMPO', lista: 'NSN MEDIOS' })),
    ], catalogo('vigente'));
    expect(conMuchosMedios.tierMaximo).toBe('tier_1');
  });

  it('enrutamiento: va al canal de mayor exigencia', () => {
    expect(canalDeExigencia(consulta())).toBe('maxima');
  });

  it('presentación: la etiqueta y el orden de los tiers llegan a pantalla', () => {
    const c = consulta();
    expect(c.hallazgos[0].etiqueta).toBe('Lista vinculante');
    expect(c.tiersPresentes).toEqual(['tier_1', 'medios']);
    expect(c.hayIdentidadPorDocumento).toBe(true);
  });
});
