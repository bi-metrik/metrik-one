/**
 * Clasificador de tier de fuentes.
 *
 * Lo que estas pruebas protegen no es "que devuelva el string correcto": es que
 * el filtro sea estructuralmente incapaz de silenciar una lista vinculante. Los
 * tres casos que no pueden romperse nunca son la fuente desconocida (§1.4), el
 * máximo sin suma (§5) y que la llave no dependa del texto visible de la lista
 * —en producción ya hay mojibake—.
 *
 * Los datos de los casos son los medidos contra `alma-afi` el 2026-08-25.
 */

import { describe, it, expect } from 'vitest';
import type { InformaMatch } from '@/lib/actions/compliance-dual';
import {
  clasificarConsulta,
  clasificarCoincidencia,
  indexarCatalogo,
  normalizarLlave,
  tierMasAlto,
  type CatalogoTier,
  type FuenteCatalogada,
} from './tier-fuentes';

// ─── Andamiaje ─────────────────────────────────────────────────────────────

function fuente(p: Partial<FuenteCatalogada> & Pick<FuenteCatalogada, 'llave' | 'tier'>): FuenteCatalogada {
  return {
    llave_tipo: 'fuente',
    familia: 'sanciones_extranjeras',
    provisional: false,
    etiqueta: p.llave,
    sustento: 'sustento de prueba',
    grupo_dedup: null,
    ...p,
  };
}

/** Recorte del catálogo sembrado, con las filas que ejercitan cada regla. */
const CATALOGO: CatalogoTier = {
  version: 1,
  status: 'validada_tecnica',
  fuentes: [
    fuente({ llave: 'OFAC', tier: 'tier_3', grupo_dedup: 'OFAC' }),
    fuente({ llave: 'CSL', tier: 'tier_3', grupo_dedup: 'OFAC' }),
    fuente({ llave: 'NAREWUSA', tier: 'tier_3' }),
    fuente({ llave: 'NSNLAT', tier: 'tier_3', provisional: true }),
    fuente({ llave: 'PEPSIGEP', tier: 'tier_2', familia: 'pep' }),
    fuente({ llave: 'RAMA JUDICIAL', tier: 'tier_4', familia: 'judicial' }),
    fuente({ llave: 'ANLA1', tier: 'tier_4', familia: 'ambiental' }),
    fuente({ llave: 'NSN MEDIOS', tier: 'medios', familia: 'medios', llave_tipo: 'lista' }),
    fuente({
      llave: 'PERSONA EXPUESTA POLITICAMENTE DECRETO 830 DE 2021',
      tier: 'tier_2',
      familia: 'pep',
      llave_tipo: 'lista',
    }),
    // Tier 1 no aparece en producción — cero coincidencias en lista vinculante
    // en toda la historia del workspace. Se prueba igual: es el único tier cuyo
    // error no se detecta por volumen.
    fuente({ llave: 'ONU1267', tier: 'tier_1', familia: 'vinculante' }),
  ],
};

const IDX = indexarCatalogo(CATALOGO);

function match(p: {
  lista?: string;
  fuente?: string;
  nombre?: string;
  nombreEncontrado?: string;
  coincidencia?: string;
  pct?: string;
}): InformaMatch {
  return {
    lista: p.lista ?? 'LISTA',
    nombre: p.nombre ?? 'JUAN PEREZ',
    documento: null,
    fundamento: null,
    detalle: {
      fuente: p.fuente ?? null,
      coincidencia: p.coincidencia ?? 'nombrebusqueda',
      porcentajeDeCoincidencia: p.pct ?? '80',
      nombreEncontrado: p.nombreEncontrado ?? p.nombre ?? 'JUAN PEREZ',
    },
  };
}

// ─── Llave ─────────────────────────────────────────────────────────────────

describe('normalizarLlave', () => {
  it('ignora mayúsculas, tildes y espacios de sobra', () => {
    const esperado = normalizarLlave('RAMA JUDICIAL');
    expect(normalizarLlave('rama judicial')).toBe(esperado);
    expect(normalizarLlave('  Rama   Judicial  ')).toBe(esperado);
    expect(normalizarLlave('Rama Judiciál')).toBe(esperado);
  });

  it('NO colapsa puntuación: dos códigos distintos del proveedor siguen siendo distintos', () => {
    expect(normalizarLlave('NSN-MEDIOS')).not.toBe(normalizarLlave('NSN MEDIOS'));
  });

  it('vacío y nulo resuelven a null, no a cadena vacía', () => {
    expect(normalizarLlave('   ')).toBeNull();
    expect(normalizarLlave(null)).toBeNull();
    expect(normalizarLlave(undefined)).toBeNull();
  });
});

describe('resolución de la llave', () => {
  it('resuelve por `fuente` aunque el nombre de la lista llegue con mojibake', () => {
    // El caso real de producción: guion largo UTF-8 leído como latin-1. Si la
    // llave fuera el texto visible, esta fila caería a `sin_clasificar` y una
    // lista clasificada quedaría silenciada por un cambio de codificación.
    const c = clasificarCoincidencia(
      match({
        lista: 'USA WANTED: NARCOTICS REWARDS PROGRAMâMISCELLANEOUS TARGETS',
        fuente: 'NAREWUSA',
      }),
      0,
      IDX,
    );
    expect(c.tier).toBe('tier_3');
    expect(c.llaveResuelta).toEqual({ tipo: 'fuente', valor: 'NAREWUSA' });
  });

  it('cae a `lista` cuando `fuente` es el nombre del medio (cardinalidad abierta)', () => {
    // Bajo la única lista NSN MEDIOS se midieron 14 medios distintos, y el
    // conjunto crece con cada nota. Por eso medios se indexa por lista.
    for (const medio of ['EL TIEMPO JUSTICIA', 'THE GUARDIAN NOTICIAS', 'INFO BAE COLOMBIA']) {
      const c = clasificarCoincidencia(match({ lista: 'NSN MEDIOS', fuente: medio }), 0, IDX);
      expect(c.tier).toBe('medios');
      expect(c.llaveResuelta).toEqual({ tipo: 'lista', valor: 'NSN MEDIOS' });
    }
  });

  it('cae a `lista` cuando la `fuente` es texto con fecha adentro en vez de código', () => {
    // Producción devuelve 'PEP - Cumple Decreto 830 - 26 de Julio de 2021'. Ese
    // texto caduca el día que Informa reedite la etiqueta; el nombre de la lista
    // es lo estable de los dos.
    const c = clasificarCoincidencia(
      match({
        lista: 'PERSONA EXPUESTA POLITICAMENTE DECRETO 830 DE 2021',
        fuente: 'PEP - Cumple Decreto 830 - 26 de Julio de 2021',
      }),
      0,
      IDX,
    );
    expect(c.tier).toBe('tier_2');
    expect(c.llaveResuelta?.tipo).toBe('lista');
  });

  it('`fuente` manda sobre `lista` cuando las dos resuelven', () => {
    const c = clasificarCoincidencia(match({ lista: 'NSN MEDIOS', fuente: 'OFAC' }), 0, IDX);
    expect(c.tier).toBe('tier_3');
    expect(c.llaveResuelta?.tipo).toBe('fuente');
  });
});

// ─── Fuente desconocida (§1.4) ─────────────────────────────────────────────

describe('fuente desconocida', () => {
  it('una fuente ausente del catálogo dispara: no es medios y no es "no dispara"', () => {
    const c = clasificarCoincidencia(
      match({ lista: 'LISTA NUEVA DE ALGO', fuente: 'CODIGO_QUE_NADIE_CLASIFICO' }),
      0,
      IDX,
    );
    expect(c.tier).toBe('sin_clasificar');
    expect(c.familia).toBeNull();
    expect(c.etiqueta).toBe('Fuente no clasificada');
  });

  it('una coincidencia sin `detalle` tampoco se degrada a medios', () => {
    const sinDetalle: InformaMatch = {
      lista: 'LISTA SIN DETALLE',
      nombre: 'JUAN PEREZ',
      documento: null,
      fundamento: null,
    };
    expect(clasificarCoincidencia(sinDetalle, 0, IDX).tier).toBe('sin_clasificar');
  });

  it('reporta la fuente cruda para que alguien pueda clasificarla', () => {
    const r = clasificarConsulta([match({ fuente: 'FUENTE X' })], IDX);
    expect(r.haySinClasificar).toBe(true);
    expect(r.fuentesSinClasificar).toEqual(['FUENTE X']);
  });

  it('una fuente vinculante que llegue con nombre nuevo NO queda silenciada', () => {
    // Es el escenario inaceptable completo: la lista importante entra con un
    // código que el catálogo no tiene, junto a diez menciones de prensa.
    const matches = [
      ...Array.from({ length: 10 }, () => match({ lista: 'NSN MEDIOS', fuente: 'EL TIEMPO JUSTICIA' })),
      match({ lista: 'LISTA VINCULANTE NUEVA', fuente: 'CODIGO_NUEVO' }),
    ];
    const r = clasificarConsulta(matches, IDX);
    expect(r.haySinClasificar).toBe(true);
    expect(r.tierMaximo).toBe('sin_clasificar');
  });
});

// ─── Máximo sin suma (§5) ──────────────────────────────────────────────────

describe('tier de la consulta = máximo presente', () => {
  it('Tier 1 gana sobre todo lo demás', () => {
    const r = clasificarConsulta(
      [
        match({ lista: 'NSN MEDIOS', fuente: 'EL TIEMPO JUSTICIA' }),
        match({ fuente: 'OFAC' }),
        match({ fuente: 'ONU1267' }),
        match({ fuente: 'PEPSIGEP' }),
      ],
      IDX,
    );
    expect(r.tierMaximo).toBe('tier_1');
  });

  it('cinco menciones de prensa NO igualan un OFAC — ni cincuenta', () => {
    const cincuentaMedios = Array.from({ length: 50 }, (_, i) =>
      match({ lista: 'NSN MEDIOS', fuente: `MEDIO ${i}`, nombre: `PERSONA ${i}` }),
    );
    expect(clasificarConsulta(cincuentaMedios, IDX).tierMaximo).toBe('medios');
    expect(clasificarConsulta([...cincuentaMedios, match({ fuente: 'OFAC' })], IDX).tierMaximo).toBe(
      'tier_3',
    );
  });

  it('Tier 4 tampoco escala por acumulación', () => {
    const judiciales = Array.from({ length: 8 }, (_, i) =>
      match({ lista: 'INCIDENTES JUDICIALES', fuente: 'RAMA JUDICIAL', nombre: `P${i}` }),
    );
    expect(clasificarConsulta(judiciales, IDX).tierMaximo).toBe('tier_4');
  });

  it('dentro de un mismo tier el conteo no cambia el resultado', () => {
    const uno = clasificarConsulta([match({ fuente: 'OFAC' })], IDX);
    const varios = clasificarConsulta(
      [match({ fuente: 'NAREWUSA' }), match({ fuente: 'PANVEN_DESCONOCIDA' })],
      IDX,
    );
    expect(uno.tierMaximo).toBe('tier_3');
    // La segunda trae además una desconocida: el máximo sigue siendo Tier 3,
    // que es el hallazgo conocido, y la desconocida se reporta aparte.
    expect(varios.tierMaximo).toBe('tier_3');
    expect(varios.haySinClasificar).toBe(true);
  });

  it('`sin_clasificar` no esconde un Tier 3 conocido detrás de la etiqueta de catálogo incompleto', () => {
    const r = clasificarConsulta([match({ fuente: 'DESCONOCIDA' }), match({ fuente: 'OFAC' })], IDX);
    expect(r.tierMaximo).toBe('tier_3');
    expect(r.haySinClasificar).toBe(true);
  });

  it('sin coincidencias no hay tier', () => {
    const r = clasificarConsulta([], IDX);
    expect(r.tierMaximo).toBeNull();
    expect(r.tiersPresentes).toEqual([]);
    expect(clasificarConsulta(null, IDX).tierMaximo).toBeNull();
  });

  it('tierMasAlto es simétrico', () => {
    expect(tierMasAlto('medios', 'tier_1')).toBe('tier_1');
    expect(tierMasAlto('tier_1', 'medios')).toBe('tier_1');
    expect(tierMasAlto('tier_4', 'tier_2')).toBe('tier_2');
    expect(tierMasAlto('sin_clasificar', 'tier_2')).toBe('sin_clasificar');
    expect(tierMasAlto('sin_clasificar', 'tier_3')).toBe('tier_3');
  });

  it('los tiers presentes salen en orden de precedencia, no de llegada', () => {
    const r = clasificarConsulta(
      [
        match({ lista: 'NSN MEDIOS', fuente: 'EL TIEMPO JUSTICIA' }),
        match({ fuente: 'ONU1267' }),
        match({ fuente: 'PEPSIGEP' }),
      ],
      IDX,
    );
    expect(r.tiersPresentes).toEqual(['tier_1', 'tier_2', 'medios']);
  });
});

// ─── Deduplicación OFAC ↔ CSL ──────────────────────────────────────────────

describe('deduplicación', () => {
  it('la misma entidad por OFAC y por CSL es un hallazgo, no dos', () => {
    const r = clasificarConsulta(
      [
        match({ lista: 'OFAC', fuente: 'OFAC', nombreEncontrado: 'MADURO MOROS NICOLAS' }),
        match({
          lista: 'CONSOLIDATED SCREENING LIST',
          fuente: 'CSL',
          nombreEncontrado: 'Maduro  Moros  Nicolás',
        }),
      ],
      IDX,
    );
    expect(r.hallazgos).toHaveLength(1);
    expect(r.duplicados).toHaveLength(1);
    // El descartado no desaparece: queda para poder mostrar por qué dos filas
    // del proveedor son un solo caso.
    expect(r.duplicados[0].fuente).toBe('CSL');
  });

  it('entidades DISTINTAS del mismo grupo no colapsan', () => {
    const r = clasificarConsulta(
      [
        match({ fuente: 'OFAC', nombreEncontrado: 'PERSONA UNO' }),
        match({ fuente: 'CSL', nombreEncontrado: 'PERSONA DOS' }),
      ],
      IDX,
    );
    expect(r.hallazgos).toHaveLength(2);
    expect(r.duplicados).toHaveLength(0);
  });

  it('las fuentes sin grupo NUNCA se deduplican: el conteo de medios tiene que sobrevivir', () => {
    // Si dedupliáramos por llave, las 25 menciones de prensa de una misma
    // persona colapsarían en una y se destruiría el indicador de concentración
    // de medios, que es la cifra que sustenta el diseño ante ALMA.
    const veinticinco = Array.from({ length: 25 }, () =>
      match({ lista: 'NSN MEDIOS', fuente: 'EL TIEMPO JUSTICIA', nombreEncontrado: 'JUAN PEREZ' }),
    );
    const r = clasificarConsulta(veinticinco, IDX);
    expect(r.hallazgos).toHaveLength(25);
    expect(r.duplicados).toHaveLength(0);
  });

  it('dos coincidencias de OFAC consigo mismo sí colapsan (mismo grupo, misma entidad)', () => {
    const r = clasificarConsulta(
      [
        match({ fuente: 'OFAC', nombreEncontrado: 'MADURO MOROS NICOLAS' }),
        match({ fuente: 'OFAC', nombreEncontrado: 'MADURO MOROS NICOLAS' }),
      ],
      IDX,
    );
    expect(r.hallazgos).toHaveLength(1);
  });
});

// ─── Ejes secundarios ──────────────────────────────────────────────────────

describe('identidad y provisionalidad', () => {
  it('el porcentaje llega como texto en el jsonb y sale como número', () => {
    expect(clasificarCoincidencia(match({ fuente: 'OFAC', pct: '80' }), 0, IDX).porcentaje).toBe(80);
    expect(clasificarCoincidencia(match({ fuente: 'OFAC', pct: '  40 ' }), 0, IDX).porcentaje).toBe(40);
    expect(clasificarCoincidencia(match({ fuente: 'OFAC', pct: 'n/a' }), 0, IDX).porcentaje).toBeNull();
  });

  it('la coincidencia por documento se marca; la búsqueda por nombre no', () => {
    expect(
      clasificarCoincidencia(match({ fuente: 'ANLA1', coincidencia: 'nit' }), 0, IDX)
        .identidadPorDocumento,
    ).toBe(true);
    expect(
      clasificarCoincidencia(match({ fuente: 'ANLA1', coincidencia: 'nombrebusqueda' }), 0, IDX)
        .identidadPorDocumento,
    ).toBe(false);
  });

  it('un tipo de coincidencia nuevo se trata como documento, no como nombre', () => {
    // Por exclusión: si el proveedor agrega `cedula` o `pasaporte`, una lista
    // blanca le bajaría el escrutinio. En una duda sobre identidad, gana el lado
    // que exige más.
    expect(
      clasificarCoincidencia(match({ fuente: 'ANLA1', coincidencia: 'pasaporte' }), 0, IDX)
        .identidadPorDocumento,
    ).toBe(true);
  });

  it('la identidad NO degrada el tier: un Tier 3 al 40% sigue siendo Tier 3', () => {
    const r = clasificarConsulta([match({ fuente: 'OFAC', pct: '40' })], IDX);
    expect(r.tierMaximo).toBe('tier_3');
  });

  it('NSNLAT se aplica pero se marca provisional', () => {
    const r = clasificarConsulta([match({ fuente: 'NSNLAT' })], IDX);
    expect(r.tierMaximo).toBe('tier_3');
    expect(r.hayProvisional).toBe(true);
  });
});

// ─── El catálogo sin firmar no opera ───────────────────────────────────────

describe('firma del catálogo', () => {
  it('un catálogo sin firma jurídica clasifica pero no opera', () => {
    const r = clasificarConsulta([match({ fuente: 'OFAC' })], IDX);
    expect(IDX.status).toBe('validada_tecnica');
    expect(r.opera).toBe(false);
    // Sigue clasificando: así se mide la cobertura del catálogo ANTES de firmarlo.
    expect(r.tierMaximo).toBe('tier_3');
    expect(r.catalogoVersion).toBe(1);
  });

  it('solo `vigente` opera', () => {
    expect(indexarCatalogo({ ...CATALOGO, status: 'vigente' }).opera).toBe(true);
    expect(indexarCatalogo({ ...CATALOGO, status: 'propuesta' }).opera).toBe(false);
    expect(indexarCatalogo({ ...CATALOGO, status: 'historica' }).opera).toBe(false);
  });
});

// ─── El lote real de producción ────────────────────────────────────────────

describe('la consulta 738de67e — 10 de 10 medios', () => {
  it('es el caso que motivó el dictamen: todo medios, ningún tier que dispare', () => {
    const medios = [
      'EL TIEMPO JUSTICIA',
      'EL COLOMBIANO COLOMBIA',
      'INFO BAE COLOMBIA',
      'CARACOL RADIO JUSTICIA',
      'THE GUARDIAN NOTICIAS',
      'EL ESPECTADOR JUDICIAL',
      'LA REPUBLICA ACTUALIDAD',
      'EL HERALDO JUDICIAL',
      'EL PAIS JUDICIAL',
      'EL NUEVO SIGLO INTERNACIONAL',
    ].map((m) => match({ lista: 'NSN MEDIOS', fuente: m }));

    const r = clasificarConsulta(medios, IDX);
    expect(r.hallazgos).toHaveLength(10);
    expect(r.tiersPresentes).toEqual(['medios']);
    expect(r.haySinClasificar).toBe(false);
  });
});
