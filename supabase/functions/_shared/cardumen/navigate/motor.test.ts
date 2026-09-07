// Recorridos completos del motor de Navigate, sin modelo ni WhatsApp.
//
// El interprete es un GUION: cada prueba declara que "leyo" el modelo en cada turno libre.
// Asi se prueba lo que el codigo decide (eco, confirmacion, intensidad, anclas, cierre,
// payload) y no lo que el modelo adivina. Las reglas que se fijan aqui vienen de
// elicitacion-resolucion-yuto.md §1-3, elicitacion-diadas-yuto.md §2-4 y del brief de la demo.
import { describe, expect, it } from 'vitest';
import { BOTON, CONSENT_VERSION, armarPayload, iniciar, leerSector, procesar, resumen } from './motor';
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

/** Turno cero hasta la pregunta de apertura, con la poblacion pedida. */
async function hastaHistoria(poblacion: 'ciudadano' | 'experto', sectorTxt = '1'): Promise<NavigateState> {
  const i = guion({});
  const { state, salidas } = iniciar(AHORA);
  expect(salidas[0].tipo).toBe('botones');
  let r = await procesar(state, { texto: 'OK', botonId: BOTON.ok }, i);
  expect(state.consent?.version).toBe(CONSENT_VERSION);
  expect(ultimo(r).tipo).toBe('botones');
  r = await procesar(state, poblacion === 'experto' ? { texto: 'Sí, observador', botonId: BOTON.expSi } : { texto: 'No', botonId: BOTON.expNo }, i);
  expect(state.poblacion).toBe(poblacion);
  expect(textos(r)).toContain('12. Sector publico');
  r = await procesar(state, { texto: sectorTxt }, i);
  expect(state.paso).toBe('historia');
  return state;
}

const HISTORIA_ES = 'La carretera al puerto lleva meses con un carril cerrado. Los camiones se meten por el pueblo y ya se hundió una calle.';

/** Historia en espanol + confirmacion de idioma. Deja el estado en la primera triada. */
async function hastaPrimeraTriada(poblacion: 'ciudadano' | 'experto' = 'ciudadano'): Promise<NavigateState> {
  const state = await hastaHistoria(poblacion);
  const i = guion({});
  let r = await procesar(state, { texto: HISTORIA_ES }, i);
  expect(state.idioma_detectado).toBe('es');
  expect(state.paso).toBe('idioma_confirmar');
  r = await procesar(state, { texto: 'Sí, en español', botonId: BOTON.langSi }, i);
  expect(state.idioma_confirmado).toBe(true);
  expect(state.paso).toBe('triada_orden');
  expect(textos(r)).toContain('*De donde nace lo que observo.*');
  return state;
}

describe('turno cero', () => {
  it('abre con el consentimiento de DEMO y un boton OK; nada mas hasta el si', () => {
    const { state, salidas } = iniciar(AHORA);
    expect(salidas).toHaveLength(1);
    const s = salidas[0];
    expect(s.tipo).toBe('botones');
    expect(s.texto).toContain('demostración');
    expect(s.texto).toContain('no entra en ningún estudio');
    if (s.tipo === 'botones') expect(s.botones).toEqual([{ id: BOTON.ok, title: 'OK' }]);
    expect(state.paso).toBe('consentimiento');
    expect(state.demo).toBe(true);
  });

  it('sin consentimiento no hay nada que guardar: "no" cierra y borra', async () => {
    const { state } = iniciar(AHORA);
    const r = await procesar(state, { texto: 'no' }, guion({}));
    expect(r.accion).toBe('cerrar_sin_guardar');
    expect(state.consent).toBeUndefined();
  });

  it('dos respuestas que no son OK ni no: se despide sin guardar', async () => {
    const { state } = iniciar(AHORA);
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

describe('idioma', () => {
  it('espanol detectado: se confirma en un turno y se bloquea', async () => {
    const state = await hastaPrimeraTriada();
    expect(state.idioma).toBe('es');
    expect(state.idioma_confirmado).toBe(true);
  });

  it('ingles detectado: un solo mensaje trilingue; "no" cierra sin guardar', async () => {
    const state = await hastaHistoria('ciudadano');
    const i = guion({});
    let r = await procesar(state, { texto: 'The road to the port has had one lane closed for months. Trucks are cutting through the town and a street already collapsed.' }, i);
    expect(state.idioma_detectado).toBe('en');
    expect(state.paso).toBe('idioma_no_es');
    expect(r.salidas).toHaveLength(1);
    expect(r.salidas[0].texto).toContain('EN: For now this instrument is available in Spanish only');
    expect(r.salidas[0].texto).toContain('PT: Por enquanto');
    r = await procesar(state, { texto: 'No', botonId: BOTON.langNo }, i);
    expect(r.accion).toBe('cerrar_sin_guardar');
  });

  it('portugues detectado y "sim": sigue con el instrumento en espanol, sin traducir', async () => {
    const state = await hastaHistoria('ciudadano');
    const i = guion({});
    let r = await procesar(state, { texto: 'A estrada para o porto está há meses com uma faixa fechada. Os caminhões passam pela cidade e uma rua já afundou.' }, i);
    expect(state.idioma_detectado).toBe('pt');
    r = await procesar(state, { texto: 'sim' }, i);
    expect(state.idioma_confirmado).toBe(true);
    expect(state.idioma).toBe('es');
    expect(textos(r)).toContain('La gente comun, la vida de a pie');
  });

  it('"otro idioma" tras espanol detectado lleva al trilingue', async () => {
    const state = await hastaHistoria('ciudadano');
    const i = guion({});
    await procesar(state, { texto: HISTORIA_ES }, i);
    const r = await procesar(state, { texto: 'Otro idioma', botonId: BOTON.langOtro }, i);
    expect(state.paso).toBe('idioma_no_es');
    expect(r.salidas[0].texto).toContain('ES: Por ahora');
  });
});

describe('triadas: reparto en dos tiempos', () => {
  it('orden espontaneo -> eco con confirmacion -> intensidad -> composicion pre-registrada', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({ triada: [{ claro: true, dominante: 1, segundo: 2, solo_uno: false, especial: null }] });
    let r = await procesar(state, { texto: 'Sobre todo los que tienen poder. Y algo de fuerzas que nadie controla, pero menos.' }, i);
    expect(state.paso).toBe('triada_confirmar');
    expect(ultimo(r).texto).toBe(
      'Le leo entonces: *primero, Quienes tienen poder, dinero o influencia*; *en segundo lugar, Fuerzas que nadie controla del todo*; y *La gente comun, la vida de a pie* quedó al margen. ¿Lo dejo así?',
    );
    r = await procesar(state, { texto: 'Sí, así', botonId: BOTON.si }, i);
    expect(state.paso).toBe('triada_intensidad');
    const u = ultimo(r);
    expect(u.texto).toContain('¿iban *casi parejos*, *uno mandaba pero el otro contaba*, o *fue claramente Quienes tienen poder, dinero o influencia*?');
    if (u.tipo === 'botones') expect(u.botones.map((b) => b.title)).toEqual(['Casi parejos', 'Uno mandaba', 'Claramente el 1º']);
    r = await procesar(state, { texto: 'Claramente el 1º', botonId: BOTON.intClaro }, i);
    const reg = state.dimensiones.T1_fuente!;
    expect('dimension_id' in reg && reg).toMatchObject({
      dimension_id: 'T1_fuente',
      dominant: 'Quienes tienen poder, dinero o influencia',
      second: 'Fuerzas que nadie controla del todo',
      residual: 'La gente comun, la vida de a pie',
      intensity_label: 'claramente_el_primero',
      composition: [0.05, 0.85, 0.1],
      resolution_captured: 'high',
      confirmed_by_participant: true,
      special_case: null,
      elicitation_turns: 3,
    });
    expect(r.salidas[0].texto).toBe('Listo. Lo guardo así: *Quienes tienen poder, dinero o influencia* fue lo principal, *Fuerzas que nadie controla del todo* acompañó, y *La gente comun, la vida de a pie* quedó al margen.');
    // y ya viene la segunda triada
    expect(state.paso).toBe('triada_orden');
    expect(ultimo(r).texto).toContain('*En el fondo, que se siente que es.*');
  });

  it('nombra uno solo: se pide el segundo; "ninguno" = solo uno, sin turno de intensidad', async () => {
    const state = await hastaPrimeraTriada();
    const i = guion({
      triada: [{ claro: true, dominante: 0, segundo: null, solo_uno: false, especial: null }],
      segundo: [{ claro: true, segundo: null, ninguno: true }],
    });
    let r = await procesar(state, { texto: 'la gente común' }, i);
    expect(state.paso).toBe('triada_segundo');
    expect(ultimo(r).texto).toContain('¿Y en segundo lugar: *Quienes tienen poder, dinero o influencia* o *Fuerzas que nadie controla del todo*?');
    r = await procesar(state, { texto: 'ninguno' }, i);
    expect(ultimo(r).texto).toBe('Le leo entonces: *solo La gente comun, la vida de a pie*, y lo demás al margen. ¿Lo dejo así?');
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
    expect(ultimo(r).texto).toBe('Dígamelo con sus palabras: ¿cuáles dos pesaron más, y en qué orden?');
    r = await procesar(state, { texto: 'al revés: primero la gente, después el poder' }, i);
    expect(ultimo(r).texto).toContain('*primero, La gente comun, la vida de a pie*');
    await procesar(state, { texto: 'exacto' }, i);
    expect(state.paso).toBe('triada_intensidad');
    r = await procesar(state, { texto: 'no sé, da igual' }, i);
    // No graduo: resolucion gruesa, dominante = 1 y resto 0, pero el orden si quedo avalado.
    expect(state.dimensiones.T1_fuente).toMatchObject({
      dominant: 'La gente comun, la vida de a pie', second: 'Quienes tienen poder, dinero o influencia',
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
    expect(ultimo(r).texto).toBe('Lo dejo como *no aplica a lo que conto*. ¿Así?');
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
    expect(ultimo(r).texto).toBe('No le alcancé a seguir. Dígame cuál de las tres pesó más, y cuál iría en segundo lugar.');
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
    expect(ultimo(r).texto).toContain('*Que esta realmente en juego.*');
    expect(ultimo(r).texto).not.toContain('solo expertos');
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
    expect(ultimo(r).texto).toBe('Una cosa más sobre lo que contó. ¿Siente que *Esto ya venia pasando*, o que *Esto es completamente nuevo*?');
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
    expect(state.paso).toBe('diada_abrir'); // D2
    expect(ultimo(r).texto).toContain('*Me preocupa profundamente*, o que *Me da esperanza*');
  });

  it('matiz hacia un lado: se ofrecen SOLO las anclas de ese lado; elegir por numero no pide confirmacion', async () => {
    const state = await hastaD1();
    const i = guion({ diada: [{ claro: false, ancla: null, especial: null, lado: 'izq' }] });
    let r = await procesar(state, { texto: 'nuevo no del todo, pero se aceleró mucho este año' }, i);
    expect(state.paso).toBe('diada_aclarar');
    expect(ultimo(r).texto).toBe(
      'Entonces, ¿lo dejo como...?\n\n1. mas cerca de "Esto ya venia pasando", con matices\n2. Esto ya venia pasando\n3. un poco de las dos\n\nResponda con el número, o dígamelo con sus palabras.',
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
    expect(ultimo(r).texto).toBe('Dígamelo con sus palabras: ¿más hacia *Esto ya venia pasando* o hacia *Esto es completamente nuevo*?');
    r = await procesar(state, { texto: 'más bien nuevo' }, i);
    expect(ultimo(r).texto).toBe('Lo dejo como *mas cerca de "Esto es completamente nuevo", con matices*. ¿Así?');
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
    expect(cierre).toContain('• Sector: Infraestructura y construccion');
    expect(cierre).toContain('• De donde nace lo que observo: Quienes tienen poder, dinero o influencia › Fuerzas que nadie controla del todo (uno mandaba pero el otro contaba)');
    expect(cierre).toContain('• En el fondo, que se siente que es: solo Algo que se repite una y otra vez');
    expect(cierre).toContain('• Esto ya venia pasando ↔ Esto es completamente nuevo: mas cerca de "Esto ya venia pasando", con matices');
    expect(cierre).toContain('• Me preocupa profundamente ↔ Me da esperanza: Me preocupa profundamente');

    const p = armarPayload(state, 'completa', AHORA) as Record<string, unknown>;
    expect(p).toMatchObject({
      source: 'chat', motor: 'navigate', demo: true, study_id: 'navigate', collection_mode: 'panel_recurrente',
      poblacion: 'ciudadano', sector: 'Infraestructura y construccion', idioma: 'es', idioma_detectado: 'es', idioma_confirmado: true,
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
  it('ningun boton pasa de 20 caracteres y ningun cuerpo de 1024', async () => {
    const { state, r } = await (async () => {
      const state = await hastaPrimeraTriada('experto');
      const i = guion({
        triada: [{ claro: true, dominante: 1, segundo: 2, solo_uno: false, especial: null }],
        diada: [{ claro: false, ancla: null, especial: null, lado: null }],
      });
      const r1 = await procesar(state, { texto: 'x' }, i);
      const r2 = await procesar(state, { texto: 'sí' }, i);
      return { state, r: [r1, r2] };
    })();
    void state;
    for (const res of r) {
      for (const s of res.salidas) {
        expect(s.texto.length).toBeLessThanOrEqual(1024);
        if (s.tipo === 'botones') {
          expect(s.botones.length).toBeLessThanOrEqual(3);
          for (const b of s.botones) expect(b.title.length).toBeLessThanOrEqual(20);
        }
      }
    }
    const { salidas } = iniciar(AHORA);
    expect(salidas[0].texto.length).toBeLessThanOrEqual(1024);
  });
});
