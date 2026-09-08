// Recorridos completos del motor de Navigate, sin modelo ni WhatsApp.
//
// El interprete es un GUION: cada prueba declara que "leyo" el modelo en cada turno libre.
// Asi se prueba lo que el codigo decide (eco, confirmacion, intensidad, anclas, cierre,
// payload) y no lo que el modelo adivina. Las reglas que se fijan aqui vienen de
// elicitacion-resolucion-yuto.md §1-3, elicitacion-diadas-yuto.md §2-4 y del brief de la demo.
import { describe, expect, it } from 'vitest';
import {
  BOTON, CONSENT_VERSION, armarPayload, citaHistoria, iniciar, leerNumerosTriada, leerSector, preguntaInterrogativa, procesar, resumen,
} from './motor';
import { TRIADAS } from './instrumento';
import { normalizarTexto } from './interprete';
import type {
  Interprete, InterpretacionDiada, InterpretacionIntensidad, InterpretacionSegundo, InterpretacionTriada, NavigateState, Resultado, Salida,
} from './tipos';

type Guion = {
  triada?: InterpretacionTriada[];
  segundo?: InterpretacionSegundo[];
  intensidad?: InterpretacionIntensidad[];
  diada?: InterpretacionDiada[];
};

function guion(g: Guion): Interprete & { usadas: Record<keyof Guion, number> } {
  const colas: Required<Guion> = { triada: [], segundo: [], intensidad: [], diada: [], ...g };
  const usadas = { triada: 0, segundo: 0, intensidad: 0, diada: 0 };
  const saca = <K extends keyof Guion>(k: K): NonNullable<Guion[K]>[number] => {
    const v = colas[k][usadas[k]];
    if (v === undefined) throw new Error(`guion agotado para ${k}`);
    usadas[k] += 1;
    return v as NonNullable<Guion[K]>[number];
  };
  return {
    usadas,
    triada: async () => saca('triada') as InterpretacionTriada,
    segundo: async () => saca('segundo') as InterpretacionSegundo,
    intensidad: async () => saca('intensidad') as InterpretacionIntensidad,
    diada: async () => saca('diada') as InterpretacionDiada,
  };
}

const AHORA = '2026-09-07T20:00:00.000Z';
const textos = (r: { salidas: Salida[] }) => r.salidas.map((s) => s.texto).join('\n---\n');
const ultimo = (r: { salidas: Salida[] }) => r.salidas[r.salidas.length - 1];

const PREGUNTA_IDIOMA = 'ES: ¿En qué idioma prefiere continuar?\nEN: Which language do you prefer?\nPT: Em que idioma prefere continuar?';

/** Primer mensaje (idioma) respondido con el boton Espanol. Deja el estado en el consentimiento. */
async function hastaConsentimiento(): Promise<NavigateState> {
  const { state, salidas } = iniciar(AHORA);
  expect(salidas[0].tipo).toBe('botones');
  expect(state.paso).toBe('idioma');
  const r = await procesar(state, { texto: 'Español', botonId: BOTON.langEs }, guion({}));
  expect(state.paso).toBe('consentimiento');
  const u = ultimo(r);
  expect(u.tipo).toBe('botones');
  if (u.tipo === 'botones') expect(u.botones).toEqual([{ id: BOTON.ok, title: 'OK' }]);
  return state;
}

/** Turno cero hasta la pregunta de apertura, con la poblacion pedida. */
async function hastaHistoria(poblacion: 'ciudadano' | 'experto', sectorTxt = '1'): Promise<NavigateState> {
  const i = guion({});
  const state = await hastaConsentimiento();
  let r = await procesar(state, { texto: 'OK', botonId: BOTON.ok }, i);
  expect(state.consent?.version).toBe(CONSENT_VERSION);
  expect(ultimo(r).tipo).toBe('botones');
  r = await procesar(state, poblacion === 'experto' ? { texto: 'Sí, observador', botonId: BOTON.expSi } : { texto: 'No', botonId: BOTON.expNo }, i);
  expect(state.poblacion).toBe(poblacion);
  expect(textos(r)).toContain('12. Sector público');
  r = await procesar(state, { texto: sectorTxt }, i);
  expect(state.paso).toBe('historia');
  return state;
}

const HISTORIA_ES = 'La carretera al puerto lleva meses con un carril cerrado. Los camiones se meten por el pueblo y ya se hundió una calle.';
/** Las primeras palabras de HISTORIA_ES, recortadas en limite de palabra (90 caracteres). */
const CITA_ES = 'La carretera al puerto lleva meses con un carril cerrado. Los camiones se meten por el…';
const T1_APERTURA =
  `Pensando en lo que me contó ("${CITA_ES}"), ¿de dónde nace lo que observó?\n\n` +
  '1. La gente común, la vida de a pie\n2. Quienes tienen poder, dinero o influencia\n3. Fuerzas que nadie controla del todo\n\n' +
  '¿Cuál de las tres pesa más? Toque 1, 2 o 3, o dígamelo con sus palabras.';
const TITULOS_TRIADA = ['1', '2', '3'];

/** Historia en espanol. Ya no hay turno de idioma despues: deja el estado en la primera triada. */
async function hastaPrimeraTriada(poblacion: 'ciudadano' | 'experto' = 'ciudadano'): Promise<NavigateState> {
  const state = await hastaHistoria(poblacion);
  const r = await procesar(state, { texto: HISTORIA_ES }, guion({}));
  expect(state.idioma_detectado).toBe('es');
  expect(state.idioma_confirmado).toBe(true);
  expect(state.paso).toBe('triada_orden');
  const u = ultimo(r);
  expect(u.texto).toBe(T1_APERTURA);
  expect(u.tipo).toBe('botones');
  if (u.tipo === 'botones') expect(u.botones.map((b) => b.title)).toEqual(TITULOS_TRIADA);
  return state;
}

describe('turno cero', () => {
  it('abre con la pregunta de idioma, trilingue y con tres botones; nada del consentimiento todavia', () => {
    const { state, salidas } = iniciar(AHORA);
    expect(salidas).toHaveLength(1);
    const s = salidas[0];
    expect(s.tipo).toBe('botones');
    expect(s.texto).toBe(PREGUNTA_IDIOMA);
    if (s.tipo === 'botones') {
      expect(s.botones).toEqual([{ id: BOTON.langEs, title: 'Español' }, { id: BOTON.langEn, title: 'English' }, { id: BOTON.langPt, title: 'Português' }]);
    }
    expect(state.paso).toBe('idioma');
    expect(state.demo).toBe(true);
    expect(state.consent).toBeUndefined();
    expect(state.historial.map((h) => h.text).join('\n')).not.toContain('demostración');
  });

  it('el consentimiento de DEMO llega tras elegir espanol, con un boton OK; nada mas hasta el si', async () => {
    const state = await hastaConsentimiento();
    const s = state.historial.at(-1)!;
    expect(s.text).toContain('demostración');
    expect(s.text).toContain('no entra en ningún estudio');
    expect(state.idioma_elegido).toBe('es');
    expect(state.idioma_confirmado).toBe(true);
    expect(state.consent).toBeUndefined();
  });

  it('sin consentimiento no hay nada que guardar: "no" cierra y borra', async () => {
    const state = await hastaConsentimiento();
    const r = await procesar(state, { texto: 'no' }, guion({}));
    expect(r.accion).toBe('cerrar_sin_guardar');
    expect(state.consent).toBeUndefined();
  });

  it('dos respuestas que no son OK ni no: se despide sin guardar', async () => {
    const state = await hastaConsentimiento();
    const i = guion({});
    let r = await procesar(state, { texto: 'hola?' }, i);
    expect(r.accion).toBe('seguir');
    r = await procesar(state, { texto: 'que es esto' }, i);
    expect(r.accion).toBe('cerrar_sin_guardar');
  });

  it('observador de su sector define la secuencia: 4 dimensiones o 6', async () => {
    const c = await hastaHistoria('ciudadano');
    expect(c.secuencia).toEqual(['T1_fuente', 'T2_tiempo', 'D1_novedad', 'D2_afecto']);
    const e = await hastaHistoria('experto');
    expect(e.secuencia).toEqual(['T1_fuente', 'T2_tiempo', 'D1_novedad', 'D2_afecto', 'T3_enjuego', 'D3_agencia']);
  });

  it('el sector se lee por numero o por nombre; ambiguo o corto no vale', () => {
    expect(leerSector('1')).toBe('Infraestructura y construccion');
    expect(leerSector('12')).toBe('Sector publico');
    expect(leerSector('13')).toBeNull();
    expect(leerSector('salud')).toBe('Salud');
    expect(leerSector('tecnologia')).toBe('Tecnologia');
    expect(leerSector(normalizarTexto('Tecnología'))).toBe('Tecnologia');
    expect(leerSector(normalizarTexto('Infraestructura y construcción'))).toBe('Infraestructura y construccion');
    expect(leerSector('infraestructura')).toBe('Infraestructura y construccion');
    expect(leerSector('sal')).toBeNull();
    expect(leerSector('servicios')).toBeNull(); // Energia y servicios publicos / Servicios financieros
  });

  it('la apertura depende de la poblacion y es la literal de la muestra', async () => {
    const i = guion({});
    const c = await hastaHistoria('ciudadano');
    expect(c.historial.at(-1)?.text).toContain('Cuéntenos algo que haya visto');
    const e = await hastaHistoria('experto');
    expect(e.historial.at(-1)?.text).toContain('Desde su ángulo particular');
    expect(i.usadas.triada).toBe(0);
  });

  it('un sector ilegible se repregunta; dos seguidos: sigue con sector null en vez de atascarse', async () => {
    const i = guion({});
    const { state } = iniciar(AHORA);
    await procesar(state, { texto: 'español' }, i); // escrito, sin boton
    expect(state.paso).toBe('consentimiento');
    await procesar(state, { texto: 'ok' }, i);
    await procesar(state, { texto: 'no' }, i);
    let r = await procesar(state, { texto: 'ni idea' }, i);
    expect(state.paso).toBe('sector');
    expect(ultimo(r).texto).toContain('No encontré ese sector en la lista');
    r = await procesar(state, { texto: 'tampoco' }, i);
    expect(state.paso).toBe('historia');
    expect(state.sector).toBeNull();
    expect(ultimo(r).texto).toContain('Cuéntenos algo que haya visto');
  });
});

describe('idioma: se elige en el PRIMER mensaje, antes del consentimiento', () => {
  it('espanol por boton: consentimiento de inmediato; elegido y confirmado quedan en el estado y en el payload', async () => {
    const state = await hastaConsentimiento();
    expect(state.idioma).toBe('es');
    expect(state.idioma_elegido).toBe('es');
    expect(state.idioma_confirmado).toBe(true);
    expect(state.turnos).toBe(1);
    expect(armarPayload(state, 'salir', AHORA)).toMatchObject({ idioma: 'es', idioma_elegido: 'es', idioma_confirmado: true, idioma_detectado: null, consent: null });
  });

  it('English por boton: un solo mensaje trilingue; "Sí / Yes / Sim" sigue en espanol y recien ahi llega el consentimiento', async () => {
    const { state } = iniciar(AHORA);
    const i = guion({});
    let r = await procesar(state, { texto: 'English', botonId: BOTON.langEn }, i);
    expect(state.paso).toBe('idioma_no_es');
    expect(state.idioma_elegido).toBe('en');
    expect(state.idioma_confirmado).toBe(false);
    expect(r.salidas).toHaveLength(1);
    expect(r.salidas[0].texto).toContain('EN: For now this instrument is available in Spanish only');
    expect(r.salidas[0].texto).toContain('PT: Por enquanto');
    if (r.salidas[0].tipo === 'botones') expect(r.salidas[0].botones.map((b) => b.title)).toEqual(['Sí / Yes / Sim', 'No']);
    r = await procesar(state, { texto: 'Sí / Yes / Sim', botonId: BOTON.langSi }, i);
    expect(state.paso).toBe('consentimiento');
    expect(state.idioma_confirmado).toBe(true);
    expect(state.idioma_elegido).toBe('en'); // lo que eligio no se pisa: acepto seguir en espanol
    expect(state.idioma).toBe('es');
    expect(r.salidas).toHaveLength(1);
    expect(r.salidas[0].texto).toContain('demostración');
    expect(state.consent).toBeUndefined(); // el consentimiento se PIDE aqui; todavia no se dio
  });

  it('el boton decide por su id: vale aunque el texto que lo acompana no diga nada legible', async () => {
    const { state } = iniciar(AHORA);
    await procesar(state, { texto: '', botonId: BOTON.langEs }, guion({}));
    expect(state.paso).toBe('consentimiento');
    expect(state.idioma_elegido).toBe('es');
    const { state: s2 } = iniciar(AHORA);
    await procesar(s2, { texto: '', botonId: BOTON.langPt }, guion({}));
    expect(s2.paso).toBe('idioma_no_es');
    expect(s2.idioma_elegido).toBe('pt');
  });

  it('Português por boton y "No": cierra sin guardar; no habia consentimiento ni historia que perder', async () => {
    const { state } = iniciar(AHORA);
    const i = guion({});
    await procesar(state, { texto: 'Português', botonId: BOTON.langPt }, i);
    expect(state.paso).toBe('idioma_no_es');
    expect(state.idioma_elegido).toBe('pt');
    const r = await procesar(state, { texto: 'No', botonId: BOTON.langNo }, i);
    expect(r.accion).toBe('cerrar_sin_guardar');
    expect(r.salidas[0].texto).toBe('ES: Entendido. Gracias por su tiempo.\nEN: Understood. Thank you for your time.\nPT: Entendido. Obrigado pelo seu tempo.');
    expect(state.closed).toBe(true);
    expect(state.consent).toBeUndefined();
    expect(state.historia).toBeUndefined();
  });

  it('texto libre "english please" (sin boton) lleva al trilingue; "sim" escrito acepta', async () => {
    const { state } = iniciar(AHORA);
    const i = guion({});
    const r = await procesar(state, { texto: 'english please' }, i);
    expect(state.paso).toBe('idioma_no_es');
    expect(state.idioma_elegido).toBe('en');
    expect(r.salidas[0].texto).toContain('ES: Por ahora');
    await procesar(state, { texto: 'sim' }, i);
    expect(state.paso).toBe('consentimiento');
    expect(state.idioma_confirmado).toBe(true);
  });

  it('en el trilingue, nombrar el espanol vale como si ("ok, spanish is fine")', async () => {
    const { state } = iniciar(AHORA);
    const i = guion({});
    await procesar(state, { texto: 'portugues' }, i);
    expect(state.paso).toBe('idioma_no_es');
    await procesar(state, { texto: 'ok, spanish is fine' }, i);
    expect(state.paso).toBe('consentimiento');
    expect(state.idioma_elegido).toBe('pt');
    expect(state.idioma_confirmado).toBe(true);
  });

  it('texto libre ilegible dos veces: se repregunta UNA vez con el mismo mensaje y a la segunda sigue en espanol, con nota', async () => {
    const { state } = iniciar(AHORA);
    const i = guion({});
    let r = await procesar(state, { texto: 'hola?' }, i);
    expect(state.paso).toBe('idioma');
    expect(state.reintentos).toBe(1);
    expect(r.salidas).toHaveLength(1);
    expect(r.salidas[0].texto).toBe(PREGUNTA_IDIOMA);
    r = await procesar(state, { texto: 'mmm' }, i);
    expect(state.paso).toBe('consentimiento');
    expect(state.idioma_confirmado).toBe(true);
    expect(state.idioma_elegido).toBeUndefined();
    expect(state.notas).toEqual(['no se pudo leer el idioma; se siguio en espanol, el unico del instrumento']);
    expect(r.salidas[0].texto).toContain('demostración');
    expect(armarPayload(state, 'salir', AHORA)).toMatchObject({ idioma_elegido: null, idioma_confirmado: true });
  });

  it('la historia ya no pregunta por el idioma: pasa directo a la primera triada y solo registra idioma_detectado', async () => {
    // Eligio espanol al inicio y escribio la historia en ingles: el flujo NO se desvia.
    const state = await hastaHistoria('ciudadano');
    const historiaEn = 'The road to the port has had one lane closed for months. Trucks are cutting through the town and a street already collapsed.';
    const r = await procesar(state, { texto: historiaEn }, guion({}));
    expect(state.idioma_detectado).toBe('en');
    expect(state.idioma_elegido).toBe('es');
    expect(state.historia).toBe(historiaEn);
    expect(state.paso).toBe('triada_orden');
    expect(r.salidas).toHaveLength(1);
    expect(textos(r)).toContain('¿de dónde nace lo que observó?');
    expect(textos(r)).toContain('("The road to the port has had one lane closed for months. Trucks are cutting through the…")');
    expect(textos(r)).not.toContain('Seguimos en español');
    expect(armarPayload(state, 'salir', AHORA)).toMatchObject({ idioma_elegido: 'es', idioma_detectado: 'en' });
  });
});

describe('triadas: reparto en dos tiempos', () => {
  it('orden espontaneo -> eco con confirmacion -> intensidad -> composicion pre-registrada', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({ triada: [{ claro: true, dominante: 1, segundo: 2, solo_uno: false, especial: null }] });
    let r = await procesar(state, { texto: 'Sobre todo los que tienen poder. Y algo de fuerzas que nadie controla, pero menos.' }, i);
    expect(state.paso).toBe('triada_confirmar');
    expect(ultimo(r).texto).toBe(
      'Le leo entonces: *primero, Quienes tienen poder, dinero o influencia*; *en segundo lugar, Fuerzas que nadie controla del todo*; y *La gente común, la vida de a pie* quedó al margen. ¿Lo dejo así?',
    );
    r = await procesar(state, { texto: 'Sí, así', botonId: BOTON.si }, i);
    expect(state.paso).toBe('triada_intensidad');
    const u = ultimo(r);
    expect(u.texto).toBe(
      'Una última de esta parte. Entre *Quienes tienen poder, dinero o influencia* y *Fuerzas que nadie controla del todo*, ¿cómo se repartió el peso?\n\n' +
      '• casi parejos\n• uno mandaba pero el otro contaba\n• fue claramente Quienes tienen poder, dinero o influencia\n\n' +
      'Toque una opción, o dígamelo con sus palabras.',
    );
    // "Claramente el N" nombra al dominante por su numero de polo (aqui el 2), no "el primero".
    if (u.tipo === 'botones') expect(u.botones.map((b) => b.title)).toEqual(['Casi parejos', 'Uno mandaba más', 'Claramente el 2']);
    r = await procesar(state, { texto: 'Claramente el 2', botonId: BOTON.intClaro }, i);
    const reg = state.dimensiones.T1_fuente!;
    expect('dimension_id' in reg && reg).toMatchObject({
      dimension_id: 'T1_fuente',
      dominant: 'Quienes tienen poder, dinero o influencia',
      second: 'Fuerzas que nadie controla del todo',
      residual: 'La gente común, la vida de a pie',
      intensity_label: 'claramente_el_primero',
      composition: [0.05, 0.85, 0.1],
      resolution_captured: 'high',
      confirmed_by_participant: true,
      special_case: null,
      elicitation_turns: 3,
    });
    // De donde salio cada lectura queda en la nota: el orden lo leyo el modelo, el peso fue boton.
    expect((reg as { reflexivity_note: string }).reflexivity_note).toContain('orden: texto');
    expect((reg as { reflexivity_note: string }).reflexivity_note).toContain('intensidad: boton');
    expect(r.salidas[0].texto).toBe('Listo. Lo guardo así: *Quienes tienen poder, dinero o influencia* fue lo principal, *Fuerzas que nadie controla del todo* acompañó, y *La gente común, la vida de a pie* quedó al margen.');
    // y ya viene la segunda triada, con otra intro y la misma cita
    expect(state.paso).toBe('triada_orden');
    expect(ultimo(r).texto).toContain(`Sobre eso mismo ("${CITA_ES}"), en el fondo, ¿qué se siente que es?`);
    expect(ultimo(r).texto).toContain('1. Algo que se está acabando\n2. Algo que apenas comienza\n3. Algo que se repite una y otra vez');
  });

  it('nombra uno solo: se pide el segundo; "ninguno" = solo uno, sin turno de intensidad', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({
      triada: [{ claro: true, dominante: 0, segundo: null, solo_uno: false, especial: null }],
      segundo: [{ claro: true, segundo: null, ninguno: true }],
    });
    let r = await procesar(state, { texto: 'la gente común' }, i);
    expect(state.paso).toBe('triada_segundo');
    const u = ultimo(r);
    expect(u.texto).toBe(
      'Entendido, primero *1. La gente común, la vida de a pie*. ¿Y en segundo lugar?\n\n' +
      '2. Quienes tienen poder, dinero o influencia\n3. Fuerzas que nadie controla del todo\n\n' +
      'Toque el número, o *Ninguno* si nada más pesó.',
    );
    // Los restantes conservan SU numero (2 y 3), no se renumeran.
    if (u.tipo === 'botones') expect(u.botones).toEqual([{ id: BOTON.tri2, title: '2' }, { id: BOTON.tri3, title: '3' }, { id: BOTON.triNinguno, title: 'Ninguno' }]);
    // "ninguno" escrito es texto libre: lo lee el modelo y se confirma, como hoy.
    r = await procesar(state, { texto: 'ninguno' }, i);
    expect(ultimo(r).texto).toBe('Le leo entonces: *solo La gente común, la vida de a pie*, y lo demás al margen. ¿Lo dejo así?');
    r = await procesar(state, { texto: 'sí' }, i);
    expect(state.dimensiones.T1_fuente).toMatchObject({
      intensity_label: 'solo_uno', composition: [0.9, 0.05, 0.05], resolution_captured: 'high', confirmed_by_participant: true, second: null,
    });
    expect(i.usadas.intensidad).toBe(0);
  });

  it('corrige el eco: no se insiste, se pide con sus palabras y se relee', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({
      triada: [
        { claro: true, dominante: 1, segundo: 0, solo_uno: false, especial: null },
        { claro: true, dominante: 0, segundo: 1, solo_uno: false, especial: null },
      ],
      intensidad: [{ etiqueta: 'no_gradua' }],
    });
    await procesar(state, { texto: 'el poder y la gente' }, i);
    let r = await procesar(state, { texto: 'No, corrijo', botonId: BOTON.corrijo }, i);
    expect(state.paso).toBe('triada_orden');
    // Al corregir vuelve el menu con botones (sin la cita), por si prefiere tocar el numero.
    expect(ultimo(r).texto).toBe(
      'Entendido.\n\n1. La gente común, la vida de a pie\n2. Quienes tienen poder, dinero o influencia\n3. Fuerzas que nadie controla del todo\n\n' +
      '¿Cuál de las tres pesa más? Toque 1, 2 o 3, o dígamelo con sus palabras.',
    );
    expect(ultimo(r).tipo).toBe('botones');
    r = await procesar(state, { texto: 'al revés: primero la gente, después el poder' }, i);
    expect(ultimo(r).texto).toContain('*primero, La gente común, la vida de a pie*');
    await procesar(state, { texto: 'exacto' }, i);
    expect(state.paso).toBe('triada_intensidad');
    r = await procesar(state, { texto: 'no sé, da igual' }, i);
    // No graduo: resolucion gruesa, dominante = 1 y resto 0, pero el orden si quedo avalado.
    expect(state.dimensiones.T1_fuente).toMatchObject({
      dominant: 'La gente común, la vida de a pie', second: 'Quienes tienen poder, dinero o influencia',
      intensity_label: null, composition: [1, 0, 0], resolution_captured: 'coarse', confirmed_by_participant: true,
    });
    expect(r.salidas[0].texto).toContain('sin graduar');
  });

  it('corrige el eco CON contenido: se lee como orden nuevo sin pedirlo otra vez', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({
      triada: [
        { claro: true, dominante: 1, segundo: 0, solo_uno: false, especial: null },
        { claro: true, dominante: 2, segundo: 1, solo_uno: false, especial: null },
      ],
    });
    await procesar(state, { texto: 'el poder y la gente' }, i);
    const r = await procesar(state, { texto: 'no, primero las fuerzas que nadie controla y después el poder' }, i);
    expect(i.usadas.triada).toBe(2);
    expect(state.paso).toBe('triada_confirmar');
    expect(ultimo(r).texto).toContain('*primero, Fuerzas que nadie controla del todo*');
  });

  it('"no aplica" se saca del eje, se confirma y no se rellena', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({ triada: [{ claro: true, dominante: null, segundo: null, solo_uno: false, especial: 'not_applicable' }] });
    let r = await procesar(state, { texto: 'ninguna de esas tres tiene que ver' }, i);
    expect(ultimo(r).texto).toBe('Lo dejo como *no aplica a lo que contó*. ¿Así?');
    r = await procesar(state, { texto: 'sí' }, i);
    expect(state.dimensiones.T1_fuente).toMatchObject({ dominant: null, composition: null, special_case: 'not_applicable', resolution_captured: 'coarse', confirmed_by_participant: true });
  });

  it('dos lecturas fallidas: queda "unresolved" y se sigue, sin inventar', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({
      triada: [
        { claro: false, dominante: null, segundo: null, solo_uno: false, especial: null },
        { claro: false, dominante: null, segundo: null, solo_uno: false, especial: null },
      ],
    });
    let r = await procesar(state, { texto: 'mmm' }, i);
    expect(ultimo(r).texto).toBe(
      'No le alcancé a seguir.\n\n1. La gente común, la vida de a pie\n2. Quienes tienen poder, dinero o influencia\n3. Fuerzas que nadie controla del todo\n\n' +
      '¿Cuál de las tres pesa más? Toque 1, 2 o 3, o dígamelo con sus palabras.',
    );
    r = await procesar(state, { texto: 'es que no sé bien' }, i);
    expect(state.dimensiones.T1_fuente).toMatchObject({ special_case: 'unresolved', confirmed_by_participant: false, dominant: null });
    expect(state.paso).toBe('triada_orden'); // ya en T2
    expect(r.salidas[0].texto).toContain('Lo dejo sin ubicar');
  });

  it('T3 se le muestra al experto sin la anotacion "(solo expertos)"', async () => {
    const state = await hastaPrimeraTriada('experto');
    state.indice = 4; // salto directo a T3 para no recorrer todo
    const i = guion({});
    // reabrir la dimension como haria avanzar(): se simula pidiendo el texto via un cierre previo
    const { iniciar: _i } = await import('./motor');
    void _i;
    // Se verifica el literal por la via publica: la pregunta que arma el motor al abrir T3.
    state.indice = 3;
    state.paso = 'diada_confirmar';
    state.en_curso = { tipo: 'diada', turnos: 0, ancla: 5, especial: null, ofrecidas: [], correcciones: 0, reintentos: 0, notas: [] };
    const r = await procesar(state, { texto: 'sí' }, i);
    expect(ultimo(r).texto).toContain(`Una más sobre lo que contó ("${CITA_ES}"), ¿qué está realmente en juego?`);
    expect(ultimo(r).texto).not.toContain('solo expertos');
  });
});

describe('triadas con botones y numeros: la eleccion explicita no se confirma', () => {
  const NOTA = (s: NavigateState) => (s.dimensiones.T1_fuente as { reflexivity_note: string }).reflexivity_note;

  it('boton 2 -> boton 1 -> boton "Casi parejos": cierra sin eco ni confirmacion, sin modelo, con la composicion pre-registrada', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({});
    let r = await procesar(state, { texto: '2', botonId: BOTON.tri2 }, i);
    expect(state.paso).toBe('triada_segundo');
    expect(textos(r)).not.toContain('Le leo entonces');
    let u = ultimo(r);
    expect(u.texto).toContain('Entendido, primero *2. Quienes tienen poder, dinero o influencia*. ¿Y en segundo lugar?');
    if (u.tipo === 'botones') expect(u.botones.map((b) => b.title)).toEqual(['1', '3', 'Ninguno']);
    r = await procesar(state, { texto: '1', botonId: BOTON.tri1 }, i);
    expect(state.paso).toBe('triada_intensidad');
    expect(textos(r)).not.toContain('Le leo entonces');
    u = ultimo(r);
    if (u.tipo === 'botones') expect(u.botones.map((b) => b.title)).toEqual(['Casi parejos', 'Uno mandaba más', 'Claramente el 2']);
    r = await procesar(state, { texto: 'Casi parejos', botonId: BOTON.intParejos }, i);
    expect(state.dimensiones.T1_fuente).toMatchObject({
      dominant: 'Quienes tienen poder, dinero o influencia', second: 'La gente común, la vida de a pie', residual: 'Fuerzas que nadie controla del todo',
      intensity_label: 'casi_parejos', composition: [0.45, 0.5, 0.05], resolution_captured: 'high', confirmed_by_participant: true, elicitation_turns: 3,
    });
    expect(NOTA(state)).toContain('orden: boton');
    expect(NOTA(state)).toContain('segundo: boton');
    expect(NOTA(state)).toContain('intensidad: boton');
    expect(i.usadas).toEqual({ triada: 0, segundo: 0, intensidad: 0, diada: 0 });
    expect(r.salidas[0].texto).toContain('Listo. Lo guardo así');
    expect(state.paso).toBe('triada_orden'); // T2
  });

  it('texto "1 y 3" va directo a la intensidad, sin modelo; "Claramente el 1" cierra', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({});
    const r = await procesar(state, { texto: '1 y 3' }, i);
    expect(state.paso).toBe('triada_intensidad');
    expect(textos(r)).not.toContain('Le leo entonces');
    expect(ultimo(r).texto).toContain('Entre *La gente común, la vida de a pie* y *Fuerzas que nadie controla del todo*');
    await procesar(state, { texto: 'Claramente el 1', botonId: BOTON.intClaro }, i);
    expect(state.dimensiones.T1_fuente).toMatchObject({ intensity_label: 'claramente_el_primero', composition: [0.85, 0.05, 0.1], confirmed_by_participant: true });
    expect(NOTA(state)).toContain('orden: numero');
    expect(NOTA(state)).toContain('segundo: numero');
    expect(i.usadas.triada).toBe(0);
  });

  it.each(['el 2', '2 y luego 1', 'primero 2 después 1', '3, 1'])('"%s" escrito se lee como numeros, sin modelo', async (t) => {
    const state = await hastaPrimeraTriada();
    const i = guion({});
    await procesar(state, { texto: t }, i);
    const ec = state.en_curso as { dominante: number | null; segundo: number | null };
    const esperado = leerNumerosTriada(normalizarTexto(t))!;
    expect(ec.dominante).toBe(esperado[0] - 1);
    expect(ec.segundo).toBe(esperado.length > 1 ? esperado[1] - 1 : null);
    expect(state.paso).toBe(esperado.length > 1 ? 'triada_intensidad' : 'triada_segundo');
    expect(i.usadas.triada).toBe(0);
  });

  it('"Ninguno" en segundo lugar tras un boton: solo uno, cerrado sin confirmar', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({});
    await procesar(state, { texto: '2', botonId: BOTON.tri2 }, i);
    const r = await procesar(state, { texto: 'Ninguno', botonId: BOTON.triNinguno }, i);
    expect(state.dimensiones.T1_fuente).toMatchObject({
      dominant: 'Quienes tienen poder, dinero o influencia', second: null, intensity_label: 'solo_uno', composition: [0.05, 0.9, 0.05],
      resolution_captured: 'high', confirmed_by_participant: true, elicitation_turns: 2,
    });
    expect(r.salidas[0].texto).toBe('Listo. Lo guardo así: *Quienes tienen poder, dinero o influencia*, y lo demás al margen.');
    expect(i.usadas.segundo).toBe(0);
  });

  it('texto libre sigue como hoy: lector, eco y confirmacion; y el segundo por boton tras un dominante leido por el modelo TAMBIEN se confirma', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({ triada: [{ claro: true, dominante: 1, segundo: null, solo_uno: false, especial: null }] });
    let r = await procesar(state, { texto: 'sobre todo los que tienen poder' }, i);
    expect(state.paso).toBe('triada_segundo');
    // El dominante lo interpreto el modelo: aunque el segundo llegue por boton, hay eco.
    r = await procesar(state, { texto: '3', botonId: BOTON.tri3 }, i);
    expect(state.paso).toBe('triada_confirmar');
    expect(ultimo(r).texto).toBe('Le leo entonces: *primero, Quienes tienen poder, dinero o influencia*; *en segundo lugar, Fuerzas que nadie controla del todo*; y *La gente común, la vida de a pie* quedó al margen. ¿Lo dejo así?');
    await procesar(state, { texto: 'Sí, así', botonId: BOTON.si }, i);
    expect(state.paso).toBe('triada_intensidad');
    expect((state.en_curso as { notas: string[] }).notas).toEqual(expect.arrayContaining(['orden: texto', 'segundo: boton']));
  });

  it('en segundo lugar, el numero del propio dominante no vale: se repregunta sin gastar lector', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({});
    await procesar(state, { texto: '2', botonId: BOTON.tri2 }, i);
    const r = await procesar(state, { texto: '2' }, i);
    expect(state.paso).toBe('triada_segundo');
    expect(ultimo(r).texto).toContain('¿Y en segundo lugar?');
    expect((state.en_curso as { reintentos: number }).reintentos).toBe(1);
    expect(i.usadas.segundo).toBe(0);
  });

  it('en la intensidad un numero es un polo: el del dominante es "claramente"; otro se repregunta sin fabricar', async () => {
    const s1 = await hastaPrimeraTriada();
    const i = guion({});
    await procesar(s1, { texto: '2 y 1' }, i);
    await procesar(s1, { texto: 'claramente el 2' }, i);
    expect(s1.dimensiones.T1_fuente).toMatchObject({ intensity_label: 'claramente_el_primero', composition: [0.1, 0.85, 0.05] });
    expect((s1.dimensiones.T1_fuente as { reflexivity_note: string }).reflexivity_note).toContain('intensidad: numero');
    const s2 = await hastaPrimeraTriada();
    await procesar(s2, { texto: '2 y 1' }, i);
    const r = await procesar(s2, { texto: 'claramente el 1' }, i);
    expect(s2.paso).toBe('triada_intensidad');
    expect(ultimo(r).texto).toContain('¿cómo se repartió el peso?');
    expect(i.usadas.intensidad).toBe(0);
  });

  it('un boton de triada tocado durante una diada no es una respuesta: se repregunta la diada sin modelo', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({});
    await procesar(state, { texto: '1 y 2' }, i);
    await procesar(state, { texto: 'Casi parejos', botonId: BOTON.intParejos }, i);
    await procesar(state, { texto: '3 y 1' }, i);
    await procesar(state, { texto: 'Casi parejos', botonId: BOTON.intParejos }, i);
    expect(state.paso).toBe('diada_abrir');
    const r = await procesar(state, { texto: '2', botonId: BOTON.tri2 }, i);
    expect(state.paso).toBe('diada_abrir');
    expect(state.dimensiones.D1_novedad).toBeUndefined();
    expect(r.salidas[0].texto).toContain('Ese botón era de una pregunta anterior');
    expect(r.salidas[0].texto).toContain('• Esto ya venía pasando\n• Esto es completamente nuevo');
    expect(i.usadas.diada).toBe(0);
  });

  it('un boton de triada viejo tocado en la confirmacion se lee como numero: corrige el orden sin modelo', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({ triada: [{ claro: true, dominante: 0, segundo: 1, solo_uno: false, especial: null }] });
    await procesar(state, { texto: 'la gente y después el poder' }, i);
    expect(state.paso).toBe('triada_confirmar');
    const r = await procesar(state, { texto: '3', botonId: BOTON.tri3 }, i);
    expect(state.paso).toBe('triada_segundo');
    expect((state.en_curso as { dominante: number }).dominante).toBe(2);
    expect(ultimo(r).texto).toContain('Entendido, primero *3. Fuerzas que nadie controla del todo*');
    expect(i.usadas.triada).toBe(1);
  });

  it('la cita de la historia se recorta en limite de palabra y no rompe si es corta o vacia', async () => {
    expect(citaHistoria(HISTORIA_ES)).toBe(CITA_ES);
    expect(citaHistoria(HISTORIA_ES).length).toBeLessThanOrEqual(91);
    expect(citaHistoria('El alcalde cerró la vía y la gente se quedó sin transporte durante toda la semana, hasta que llegaron')).toBe(
      'El alcalde cerró la vía y la gente se quedó sin transporte durante toda la semana, hasta…',
    );
    expect(citaHistoria('Corta.')).toBe('Corta.');
    expect(citaHistoria('linea uno\n\nlinea   dos')).toBe('linea uno linea dos');
    expect(citaHistoria('')).toBe('');
    expect(citaHistoria(undefined)).toBe('');
    expect(citaHistoria('x'.repeat(120))).toBe(`${'x'.repeat(90)}…`);
    // Sin historia, la pregunta se arma sin la cita.
    const state = await hastaPrimeraTriada();
    state.historia = '';
    const r = await procesar(state, { texto: 'cardumen' }, guion({}));
    expect(r.salidas[0].texto).toContain('Pensando en lo que me contó, ¿de dónde nace lo que observó?');
    expect(r.salidas[0].texto).not.toContain('("');
  });

  it('la pregunta del instrumento no cambia de palabras: solo se envuelve en ¿…?', () => {
    expect(preguntaInterrogativa(TRIADAS.T1_fuente)).toBe('¿De dónde nace lo que observó?');
    expect(preguntaInterrogativa(TRIADAS.T2_tiempo)).toBe('En el fondo, ¿qué se siente que es?');
    expect(preguntaInterrogativa(TRIADAS.T3_enjuego)).toBe('¿Qué está realmente en juego?');
  });

  it('leerNumerosTriada: solo numeros de polo con relleno; una duda o cualquier otra palabra no es un orden', () => {
    const lee = (s: string) => leerNumerosTriada(normalizarTexto(s));
    expect(lee('1')).toEqual([1]);
    expect(lee('el 2')).toEqual([2]);
    expect(lee('1 y 3')).toEqual([1, 3]);
    expect(lee('2 y luego 1')).toEqual([2, 1]);
    expect(lee('3, 1')).toEqual([3, 1]);
    expect(lee('primero 2 después 1')).toEqual([2, 1]);
    expect(lee('el 1º')).toEqual([1]);
    expect(lee('#3')).toEqual([3]);
    expect(lee('2 y 2')).toEqual([2]);
    expect(lee('1 o 2')).toBeNull();
    expect(lee('12')).toBeNull();
    expect(lee('0')).toBeNull();
    expect(lee('-1')).toBeNull();
    expect(lee('doce')).toBeNull();
    expect(lee('el 2 que más pesa')).toBeNull();
    expect(lee('ninguno')).toBeNull();
    expect(lee('')).toBeNull();
  });
});

describe('diadas: un turno, cinco anclas', () => {
  async function hastaD1(): Promise<NavigateState> {
    const state = await hastaPrimeraTriada();
    // Dos triadas resueltas por la via corta ("solo X" confirmado) para llegar a D1.
    const i = guion({
      triada: [
        { claro: true, dominante: 0, segundo: null, solo_uno: true, especial: null },
        { claro: true, dominante: 1, segundo: null, solo_uno: true, especial: null },
      ],
    });
    await procesar(state, { texto: 'solo la gente' }, i);
    await procesar(state, { texto: 'sí' }, i);
    await procesar(state, { texto: 'solo que comienza' }, i);
    const r = await procesar(state, { texto: 'sí' }, i);
    expect(state.paso).toBe('diada_abrir');
    // Los dos polos en lineas aparte; sin botones ni numeros: se responde con palabras.
    expect(ultimo(r).texto).toBe(
      'Una cosa más sobre lo que contó. ¿Cuál de las dos se acerca más a lo que siente?\n\n• Esto ya venía pasando\n• Esto es completamente nuevo\n\nDígamelo con sus palabras.',
    );
    expect(ultimo(r).tipo).toBe('texto');
    return state;
  }

  it('extremo limpio: eco + confirmacion, valor 1.0', async () => {
    const state = await hastaD1();
    const i = guion({ diada: [{ claro: true, ancla: 5, especial: null, lado: 'der' }] });
    let r = await procesar(state, { texto: 'es completamente nuevo, nunca lo había visto' }, i);
    expect(ultimo(r).texto).toBe('Lo dejo como *Esto es completamente nuevo*. ¿Así?');
    r = await procesar(state, { texto: 'sí' }, i);
    expect(state.dimensiones.D1_novedad).toMatchObject({
      dyad_id: 'D1_novedad', anchor_label: 'extremo_der', anchor_text: 'Esto es completamente nuevo', value: 1,
      special_case: null, resolution_captured: 'high', confirmed_by_participant: true, elicitation_turns: 2,
    });
    expect(state.paso).toBe('diada_abrir'); // D2, la ultima del ciudadano
    expect(ultimo(r).texto).toContain('Por último. ¿Cuál de las dos se acerca más a lo que siente?\n\n• Me preocupa profundamente\n• Me da esperanza');
  });

  it('matiz hacia un lado: se ofrecen SOLO las anclas de ese lado; elegir por numero no pide confirmacion', async () => {
    const state = await hastaD1();
    const i = guion({ diada: [{ claro: false, ancla: null, especial: null, lado: 'izq' }] });
    let r = await procesar(state, { texto: 'nuevo no del todo, pero se aceleró mucho este año' }, i);
    expect(state.paso).toBe('diada_aclarar');
    expect(ultimo(r).texto).toBe(
      'Entonces, ¿lo dejo como...?\n\n1. más cerca de "Esto ya venía pasando", con matices\n2. Esto ya venía pasando\n3. un poco de las dos\n\nResponda con el número, o dígamelo con sus palabras.',
    );
    r = await procesar(state, { texto: '1' }, i);
    expect(state.dimensiones.D1_novedad).toMatchObject({ anchor_label: 'intermedio_izq', value: 0.25, confirmed_by_participant: true, elicitation_turns: 2 });
    expect(r.salidas[0].texto).toBe('Listo, lo guardo así.');
    expect(i.usadas.diada).toBe(1);
  });

  it('matiz sin lado: intermedias + punto medio + "las dos con fuerza"', async () => {
    const state = await hastaD1();
    const i = guion({ diada: [{ claro: false, ancla: null, especial: null, lado: null }] });
    await procesar(state, { texto: 'depende de cómo se mire' }, i);
    expect(state.en_curso?.tipo === 'diada' && state.en_curso.ofrecidas).toEqual([2, 3, 4, 'both_intense']);
    await procesar(state, { texto: '4' }, i);
    expect(state.dimensiones.D1_novedad).toMatchObject({ special_case: 'both_intense', value: null, anchor_label: null });
  });

  it('ambivalencia en la diada afectiva: both_intense no es 0.5', async () => {
    const state = await hastaD1();
    const i = guion({
      diada: [
        { claro: true, ancla: 3, especial: 'middle', lado: null },
        { claro: true, ancla: null, especial: 'both_intense', lado: null },
      ],
    });
    await procesar(state, { texto: 'un poco de las dos' }, i);
    await procesar(state, { texto: 'sí' }, i);
    expect(state.dimensiones.D1_novedad).toMatchObject({ anchor_label: 'medio', value: 0.5, special_case: 'middle' });
    let r = await procesar(state, { texto: 'me preocupa muchísimo y a la vez me da esperanza, las dos con fuerza' }, i);
    expect(ultimo(r).texto).toBe('Lo dejo como *las dos cosas a la vez, con fuerza*. ¿Así?');
    r = await procesar(state, { texto: 'sí' }, i);
    expect(state.dimensiones.D2_afecto).toMatchObject({ special_case: 'both_intense', value: null, anchor_text: 'las dos cosas a la vez, con fuerza', resolution_captured: 'high' });
    expect(r.accion).toBe('guardar_y_cerrar');
  });

  it('"no aplica" y "no se" se excluyen del eje (value null)', async () => {
    const state = await hastaD1();
    const i = guion({ diada: [{ claro: true, ancla: null, especial: 'not_applicable', lado: null }] });
    await procesar(state, { texto: 'ninguna de las dos' }, i);
    await procesar(state, { texto: 'sí' }, i);
    expect(state.dimensiones.D1_novedad).toMatchObject({ special_case: 'not_applicable', value: null });
  });

  it('corrige el eco: se vuelve a preguntar con sus palabras', async () => {
    const state = await hastaD1();
    const i = guion({
      diada: [
        { claro: true, ancla: 1, especial: null, lado: 'izq' },
        { claro: true, ancla: 4, especial: null, lado: 'der' },
      ],
    });
    await procesar(state, { texto: 'ya venía pasando' }, i);
    let r = await procesar(state, { texto: 'no' }, i);
    expect(ultimo(r).texto).toBe('Dígamelo con sus palabras: ¿más hacia *Esto ya venía pasando* o hacia *Esto es completamente nuevo*?');
    r = await procesar(state, { texto: 'más bien nuevo' }, i);
    expect(ultimo(r).texto).toBe('Lo dejo como *más cerca de "Esto es completamente nuevo", con matices*. ¿Así?');
  });
});

describe('cierre, salida y borrado', () => {
  async function ciudadanoCompleto(): Promise<{ state: NavigateState; r: Resultado }> {
    const state = await hastaPrimeraTriada();
    const i = guion({
      triada: [
        { claro: true, dominante: 1, segundo: 2, solo_uno: false, especial: null },
        { claro: true, dominante: 2, segundo: null, solo_uno: true, especial: null },
      ],
      diada: [
        { claro: true, ancla: 2, especial: null, lado: 'izq' },
        { claro: true, ancla: 1, especial: null, lado: 'izq' },
      ],
    });
    await procesar(state, { texto: 'el poder, y algo las fuerzas' }, i);
    await procesar(state, { texto: 'sí' }, i);
    await procesar(state, { texto: 'uno mandaba', botonId: BOTON.intManda }, i);
    await procesar(state, { texto: 'solo se repite' }, i);
    await procesar(state, { texto: 'sí' }, i);
    await procesar(state, { texto: 'venía pasando pero distinto' }, i);
    await procesar(state, { texto: 'sí' }, i);
    await procesar(state, { texto: 'me preocupa' }, i);
    const r = await procesar(state, { texto: 'sí' }, i);
    return { state, r };
  }

  it('al terminar la ultima dimension: guardar_y_cerrar, resumen en palabras y payload completo', async () => {
    const { state, r } = await ciudadanoCompleto();
    expect(r.accion).toBe('guardar_y_cerrar');
    expect(state.closed).toBe(true);
    const cierre = ultimo(r).texto;
    expect(cierre).toContain('como prueba de demostración');
    expect(cierre).toContain('• Sector: Infraestructura y construcción');
    expect(cierre).toContain('• De dónde nace lo que observó: Quienes tienen poder, dinero o influencia › Fuerzas que nadie controla del todo (uno mandaba pero el otro contaba)');
    expect(cierre).toContain('• En el fondo, qué se siente que es: solo Algo que se repite una y otra vez');
    expect(cierre).toContain('• Esto ya venía pasando ↔ Esto es completamente nuevo: más cerca de "Esto ya venía pasando", con matices');
    expect(cierre).toContain('• Me preocupa profundamente ↔ Me da esperanza: Me preocupa profundamente');

    const p = armarPayload(state, 'completa', AHORA) as Record<string, unknown>;
    expect(p).toMatchObject({
      source: 'chat', motor: 'navigate', demo: true, study_id: 'navigate', collection_mode: 'panel_recurrente',
      poblacion: 'ciudadano', sector: 'Infraestructura y construccion' /* slug sin tildes, como respuestas.json */, idioma: 'es', idioma_elegido: 'es', idioma_detectado: 'es', idioma_confirmado: true,
      consent: { version: CONSENT_VERSION },
      narrative: { historia: HISTORIA_ES },
    });
    const capaA = p.capaA as Record<string, unknown>;
    expect(Object.keys(capaA)).toEqual(['T1_fuente', 'T2_tiempo', 'D1_novedad', 'D2_afecto']);
    expect(capaA.T1_fuente).toMatchObject({ composition: [0.05, 0.65, 0.3], intensity_label: 'uno_manda_otro_cuenta' });
    expect(capaA.D1_novedad).toMatchObject({ value: 0.25, anchor_label: 'intermedio_izq' });
    expect(p.provenance).toMatchObject({ completa: true, salida: 'completa', dimensiones_capturadas: 4, dimensiones_esperadas: 4 });
    expect(resumen(state)).toContain('• Responde como: panel ciudadano');
  });

  it('salir a mitad con datos: se guarda como incompleta; salir antes del consentimiento: nada', async () => {
    const state = await hastaPrimeraTriada();
    const r = await procesar(state, { texto: 'salir' }, guion({}));
    expect(r.accion).toBe('guardar_y_cerrar');
    const p = armarPayload(state, 'salir', AHORA) as { provenance: { completa: boolean; dimensiones_capturadas: number } };
    expect(p.provenance.completa).toBe(false);
    expect(p.provenance.dimensiones_capturadas).toBe(0);

    const { state: s2 } = iniciar(AHORA);
    const r2 = await procesar(s2, { texto: 'salir' }, guion({}));
    expect(r2.accion).toBe('cerrar_sin_guardar');
  });

  it('borrar vale en cualquier momento', async () => {
    const state = await hastaPrimeraTriada();
    const r = await procesar(state, { texto: 'BORRAR' }, guion({}));
    expect(r.accion).toBe('borrar');
    expect(ultimo(r).texto).toContain('borré');
  });

  it('experto: seis dimensiones y el cierre solo llega tras D3', async () => {
    const state = await hastaPrimeraTriada('experto');
    const i = guion({
      triada: [0, 1, 2].map((d) => ({ claro: true, dominante: d as 0 | 1 | 2, segundo: null, solo_uno: true, especial: null })),
      diada: [1, 5, 3].map((a) => ({ claro: true, ancla: a as 1 | 5 | 3, especial: a === 3 ? 'middle' as const : null, lado: null })),
    });
    let r: Resultado | undefined;
    for (const paso of ['T1', 'T2', 'D1', 'D2', 'T3', 'D3']) {
      r = await procesar(state, { texto: paso }, i);
      expect(r.accion).toBe('seguir');
      r = await procesar(state, { texto: 'sí' }, i);
    }
    expect(r!.accion).toBe('guardar_y_cerrar');
    expect(Object.keys(state.dimensiones)).toEqual(['T1_fuente', 'T2_tiempo', 'D1_novedad', 'D2_afecto', 'T3_enjuego', 'D3_agencia']);
    expect(state.dimensiones.D3_agencia).toMatchObject({ anchor_label: 'medio', value: 0.5 });
  });
});

describe('restricciones de WhatsApp', () => {
  // Lo que `sendButtons` (wa-respond.ts) manda tal cual: 3 botones como maximo, titulo de 20
  // caracteres, cuerpo de 1024. El envio recorta botones y titulos pero NO el cuerpo, asi que
  // el motor tiene que cumplirlo solo, con la historia mas larga que la cita admite.
  function verificar(salidas: Salida[]): void {
    for (const s of salidas) {
      expect(s.texto.length).toBeLessThanOrEqual(1024);
      if (s.tipo === 'botones') {
        expect(s.botones.length).toBeLessThanOrEqual(3);
        for (const b of s.botones) expect(b.title.length).toBeLessThanOrEqual(20);
      }
    }
  }

  it('ningun boton pasa de 20 caracteres y ningun cuerpo de 1024, en todos los mensajes de la triada', async () => {
    const { salidas } = iniciar(AHORA);
    verificar(salidas);
    const state = await hastaHistoria('experto');
    // El contador de reintentos es UNO por triada: cada repregunta va en una triada distinta.
    const i = guion({
      triada: [{ claro: false, dominante: null, segundo: null, solo_uno: false, especial: null }],
      intensidad: [{ etiqueta: null }],
      diada: [{ claro: true, ancla: 5, especial: null, lado: 'der' }, { claro: true, ancla: 1, especial: null, lado: 'izq' }],
    });
    const paso = async (entrada: { texto: string; botonId?: string }) => {
      const r = await procesar(state, entrada, i);
      verificar(r.salidas);
      return r;
    };
    // Historia larga: la cita se recorta, el cuerpo no crece con ella.
    await paso({ texto: `${HISTORIA_ES} ${HISTORIA_ES} ${HISTORIA_ES}` });
    // T1: pregunta de vuelta en el segundo lugar (la respuesta va DENTRO del mensaje con botones), intensidad larga.
    await paso({ texto: '2', botonId: BOTON.tri2 });
    await paso({ texto: '¿esto es una encuesta?' });
    await paso({ texto: '3', botonId: BOTON.tri3 });
    await paso({ texto: 'Uno mandaba más', botonId: BOTON.intManda });
    expect(state.indice).toBe(1);
    // T2: pregunta de vuelta sobre la apertura (quienSoy + cita + menu, el cuerpo mas largo) y una lectura fallida.
    await paso({ texto: '¿quién eres?' });
    await paso({ texto: 'asdkjh' });
    expect(state.indice).toBe(2);
    // D1 y D2 por el camino corto.
    await paso({ texto: 'es completamente nuevo' });
    await paso({ texto: 'sí' });
    await paso({ texto: 'me preocupa' });
    await paso({ texto: 'sí' });
    expect(state.indice).toBe(4);
    // T3: numeros -> intensidad; una lectura fallida del peso -> la version corta; cierre y apertura de D3.
    await paso({ texto: '1 y 2' });
    await paso({ texto: 'zzz' });
    expect(state.paso).toBe('triada_intensidad');
    await paso({ texto: 'Claramente el 1', botonId: BOTON.intClaro });
    expect(state.paso).toBe('diada_abrir');
    expect(state.indice).toBe(5);
  });
});
