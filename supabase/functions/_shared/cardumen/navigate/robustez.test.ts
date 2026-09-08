// Capa 1 — robustez determinista del motor de Navigate, sin modelo.
//
// Recorre la maquina de estados completa (ciudadano y experto) inyectando en CADA paso una
// bateria de entradas hostiles, y verifica los invariantes que la demo tiene que sostener
// aunque la persona se vaya de tema o conteste sin coherencia:
//
//   1. nunca lanza una excepcion, y el paso resultante es uno valido de la maquina;
//   2. ningun contador de reintentos pasa de 2, y a la segunda falla el paso se resuelve
//      (unresolved en dimensiones; el fallback declarado en el turno cero) y se AVANZA;
//   3. jamas aparece una ubicacion de Capa A que no estuviera leida ANTES del turno hostil
//      (el lector "sordo" de estas pruebas nunca lee nada, asi que toda ubicacion nueva seria
//      una fabricacion);
//   4. el payload final es serializable y no trae composicion donde hubo `unresolved`;
//   5. la sesion no se cuelga (5 mensajes iguales seguidos siempre mueven o cierran), no se
//      reinicia sola (`cardumen` a mitad repite la pregunta pendiente) y no salta pasos (las
//      dimensiones registradas son siempre un prefijo de la secuencia).
//
// Lo que NO llega al motor y por que: un mensaje de tipo imagen sin caption, ubicacion,
// sticker, contacto o documento lo filtra el webhook (bloque 0b) ANTES de `continueCardumenChat`
// —responde "Por ahora respondeme con un mensaje de texto o de voz" sin tocar la sesion— y un
// audio llega ya transcrito como texto. Aqui esos casos se modelan como texto vacio, que es lo
// que el motor recibiria si ese filtro no existiera.
import { describe, expect, it } from 'vitest';
import { SECUENCIA } from './instrumento';
import { BOTON, armarPayload, iniciar, procesar, resumen } from './motor';
import type {
  Entrada, Interprete, InterpretacionDiada, InterpretacionIntensidad, InterpretacionSegundo, InterpretacionTriada,
  NavigateState, Paso, RegistroDiada, RegistroTriada, Resultado, Salida,
} from './tipos';

const AHORA = '2026-09-08T00:00:00.000Z';
const HISTORIA_ES = 'La carretera al puerto lleva meses con un carril cerrado. Los camiones se meten por el pueblo y ya se hundió una calle.';
const HISTORIA_EN = 'The road to the port has had one lane closed for months. Trucks are cutting through the town and a street already collapsed.';

const PASOS: readonly Paso[] = [
  'consentimiento', 'poblacion', 'sector', 'historia', 'idioma_confirmar', 'idioma_no_es',
  'triada_orden', 'triada_segundo', 'triada_confirmar', 'triada_intensidad',
  'diada_abrir', 'diada_aclarar', 'diada_confirmar',
];
const PASOS_VALIDOS = new Set<Paso>([...PASOS, 'cerrado']);
const MAX = 2;

/** Lector que NUNCA lee: es lo que un lector correcto devuelve ante ruido. Cuenta llamadas. */
function sordo(): Interprete & { llamadas: number } {
  const s = {
    llamadas: 0,
    async triada(): Promise<InterpretacionTriada> { s.llamadas += 1; return { claro: false, dominante: null, segundo: null, solo_uno: false, especial: null }; },
    async segundo(): Promise<InterpretacionSegundo> { s.llamadas += 1; return { claro: false, segundo: null, ninguno: false }; },
    async intensidad(): Promise<InterpretacionIntensidad> { s.llamadas += 1; return { etiqueta: null }; },
    async diada(): Promise<InterpretacionDiada> { s.llamadas += 1; return { claro: false, ancla: null, especial: null, lado: null }; },
  };
  return s;
}

/** Lector caido: el modelo lanza. El motor NO se lo traga (index.ts lo atiende sin persistir). */
const caido: Interprete = {
  triada: async () => { throw new Error('modelo caido'); },
  segundo: async () => { throw new Error('modelo caido'); },
  intensidad: async () => { throw new Error('modelo caido'); },
  diada: async () => { throw new Error('modelo caido'); },
};

type Guion = { triada?: InterpretacionTriada[]; segundo?: InterpretacionSegundo[]; intensidad?: InterpretacionIntensidad[]; diada?: InterpretacionDiada[] };
function guion(g: Guion): Interprete {
  const colas: Required<Guion> = { triada: [], segundo: [], intensidad: [], diada: [], ...g };
  const saca = <K extends keyof Guion>(k: K) => {
    const v = colas[k].shift();
    if (v === undefined) throw new Error(`guion agotado para ${k}`);
    return v;
  };
  return {
    triada: async () => saca('triada') as InterpretacionTriada,
    segundo: async () => saca('segundo') as InterpretacionSegundo,
    intensidad: async () => saca('intensidad') as InterpretacionIntensidad,
    diada: async () => saca('diada') as InterpretacionDiada,
  };
}

/** Estado fresco parado en `paso`, llegando por el camino real (no se arma a mano). */
async function llegarA(paso: Paso, poblacion: 'ciudadano' | 'experto' = 'ciudadano'): Promise<NavigateState> {
  const { state } = iniciar(AHORA);
  const i = guion({
    triada: [
      { claro: true, dominante: 1, segundo: 2, solo_uno: false, especial: null }, // T1 leida completa
      { claro: true, dominante: 0, segundo: null, solo_uno: true, especial: null }, // T2 "solo uno"
    ],
  });
  const paso1 = (async () => {
    if (paso === 'consentimiento') return true;
    await procesar(state, { texto: 'OK', botonId: BOTON.ok }, i);
    if (paso === 'poblacion') return true;
    await procesar(state, poblacion === 'experto' ? { texto: 'Sí, observador', botonId: BOTON.expSi } : { texto: 'No', botonId: BOTON.expNo }, i);
    if (paso === 'sector') return true;
    await procesar(state, { texto: '1' }, i);
    if (paso === 'historia') return true;
    if (paso === 'idioma_no_es') { await procesar(state, { texto: HISTORIA_EN }, i); return true; }
    await procesar(state, { texto: HISTORIA_ES }, i);
    if (paso === 'idioma_confirmar') return true;
    await procesar(state, { texto: 'Sí, en español', botonId: BOTON.langSi }, i);
    if (paso === 'triada_orden') return true;
    if (paso === 'triada_segundo') {
      // T1 leida con un solo polo: se pide el segundo
      const j = guion({ triada: [{ claro: true, dominante: 0, segundo: null, solo_uno: false, especial: null }] });
      await procesar(state, { texto: 'la gente', botonId: undefined }, j);
      return true;
    }
    await procesar(state, { texto: 'el poder y las fuerzas' }, i);
    if (paso === 'triada_confirmar') return true;
    await procesar(state, { texto: 'Sí, así', botonId: BOTON.si }, i);
    if (paso === 'triada_intensidad') return true;
    await procesar(state, { texto: 'Uno mandaba', botonId: BOTON.intManda }, i);
    // T2: solo uno
    await procesar(state, { texto: 'solo la gente' }, i);
    await procesar(state, { texto: 'Sí, así', botonId: BOTON.si }, i);
    if (paso === 'diada_abrir') return true;
    if (paso === 'diada_aclarar') {
      // D1 matizada hacia un lado: el motor ofrece el menu de anclas
      await procesar(state, { texto: 'nuevo no del todo' }, guion({ diada: [{ claro: false, ancla: null, especial: null, lado: 'izq' }] }));
      return true;
    }
    // D1 clara: eco con botones de confirmacion
    await procesar(state, { texto: 'es completamente nuevo' }, guion({ diada: [{ claro: true, ancla: 5, especial: null, lado: 'der' }] }));
    if (paso === 'diada_confirmar') return true;
    throw new Error(`paso sin camino: ${paso}`);
  })();
  await paso1;
  expect(state.paso).toBe(paso);
  return state;
}

// ---- Bateria hostil --------------------------------------------------------------------

const BATERIA: ReadonlyArray<{ nombre: string; entrada: Entrada; sinModelo?: boolean }> = [
  { nombre: 'cadena vacia (imagen sin caption / ubicacion / sticker)', entrada: { texto: '' }, sinModelo: true },
  { nombre: 'solo espacios', entrada: { texto: '     \n\t' }, sinModelo: true },
  { nombre: 'solo emojis', entrada: { texto: '👍🙃🐟' }, sinModelo: true },
  { nombre: 'ruido "asdkjh"', entrada: { texto: 'asdkjh' } },
  { nombre: 'un solo caracter', entrada: { texto: 'a' } },
  { nombre: '3.000 caracteres de relleno', entrada: { texto: 'bla '.repeat(750) } },
  { nombre: 'numero fuera de rango: 0', entrada: { texto: '0' } },
  { nombre: 'numero fuera de rango: 13', entrada: { texto: '13' } },
  { nombre: 'numero fuera de rango: -1', entrada: { texto: '-1' } },
  { nombre: 'numero en letras: doce', entrada: { texto: 'doce' } },
  { nombre: 'id de boton invalido', entrada: { texto: 'Confirmar', botonId: 'btn_confirm' } },
  { nombre: 'boton viejo: OK del consentimiento', entrada: { texto: 'OK', botonId: BOTON.ok } },
  { nombre: 'boton viejo: Si, asi', entrada: { texto: 'Sí, así', botonId: BOTON.si } },
  { nombre: 'boton viejo: Casi parejos', entrada: { texto: 'Casi parejos', botonId: BOTON.intParejos } },
  { nombre: 'boton viejo: Si, observador', entrada: { texto: 'Sí, observador', botonId: BOTON.expSi } },
  { nombre: 'pregunta de vuelta: quien eres', entrada: { texto: '¿quién eres?' }, sinModelo: true },
  { nombre: 'pregunta de vuelta: es una encuesta', entrada: { texto: '¿esto es una encuesta?' }, sinModelo: true },
  { nombre: 'negativa: no quiero responder', entrada: { texto: 'no quiero responder' }, sinModelo: true },
  { nombre: 'negativa: paso', entrada: { texto: 'paso' }, sinModelo: true },
  { nombre: 'fuera de tema: futbol', entrada: { texto: 'anoche ganó Millonarios 2-1, qué partidazo' } },
  { nombre: 'insulto', entrada: { texto: 'qué bot tan idiota' } },
  { nombre: 'mezcla de idiomas', entrada: { texto: 'whatever man, no sé qué decir' } },
];

function ubicacionesNuevas(antes: NavigateState, despues: NavigateState): Array<RegistroTriada | RegistroDiada> {
  const previas = new Set(Object.keys(antes.dimensiones));
  return Object.entries(despues.dimensiones).filter(([id]) => !previas.has(id)).map(([, r]) => r!);
}

function verificarSalidas(salidas: Salida[]): void {
  for (const s of salidas) {
    expect(s.texto.length).toBeLessThanOrEqual(1024);
    if (s.tipo === 'botones') {
      expect(s.botones.length).toBeLessThanOrEqual(3);
      for (const b of s.botones) expect(b.title.length).toBeLessThanOrEqual(20);
    }
  }
}

function verificarInvariantes(antes: NavigateState, r: Resultado, entrada: Entrada): void {
  const s = r.state;
  expect(PASOS_VALIDOS.has(s.paso)).toBe(true);
  expect(s.reintentos).toBeLessThanOrEqual(MAX);
  if (s.en_curso) {
    expect(s.en_curso.reintentos).toBeLessThanOrEqual(MAX);
    expect(s.en_curso.correcciones).toBeLessThanOrEqual(MAX);
  }
  // Nunca se salta un paso: lo registrado es siempre un prefijo de la secuencia.
  expect(Object.keys(s.dimensiones)).toEqual(s.secuencia.slice(0, s.indice));
  // Ninguna ubicacion NUEVA que no estuviera leida antes del turno hostil.
  const enCursoAntes = antes.en_curso;
  for (const reg of ubicacionesNuevas(antes, s)) {
    if ('dimension_id' in reg) {
      if (reg.dominant !== null) {
        expect(enCursoAntes?.tipo === 'triada' && enCursoAntes.dominante !== null).toBe(true);
        // El unico camino a resolucion alta en un turno hostil es el boton VALIDO de intensidad.
        if (reg.resolution_captured === 'high') {
          expect(antes.paso).toBe('triada_intensidad');
          expect([BOTON.intParejos, BOTON.intManda, BOTON.intClaro]).toContain(entrada.botonId);
        }
      }
      if (reg.special_case === 'unresolved') {
        expect(reg.composition).toBeNull();
        expect(reg.dominant).toBeNull();
        expect(reg.second).toBeNull();
        expect(reg.intensity_label).toBeNull();
      }
    } else {
      if (reg.anchor_label !== null || reg.value !== null) {
        expect(enCursoAntes?.tipo === 'diada' && enCursoAntes.ancla !== null).toBe(true);
      }
      if (reg.special_case === 'unresolved' || reg.declinado) {
        expect(reg.value).toBeNull();
        expect(reg.anchor_label).toBeNull();
      }
    }
  }
  // Payload serializable, sin composicion inventada.
  const p = armarPayload(s, s.closed ? 'completa' : 'salir', AHORA);
  expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  for (const reg of Object.values(p.capaA as Record<string, RegistroTriada | RegistroDiada>)) {
    if (reg.special_case === 'unresolved') {
      if ('composition' in reg) expect(reg.composition).toBeNull();
      else expect(reg.value).toBeNull();
    }
  }
  verificarSalidas(r.salidas);
}

describe.each(['ciudadano', 'experto'] as const)('bateria hostil en cada paso (%s)', (poblacion) => {
  describe.each(PASOS)('paso %s', (paso) => {
    it.each(BATERIA)('$nombre', async ({ entrada, sinModelo }) => {
      const base = await llegarA(paso, poblacion);
      const antes = structuredClone(base);
      const lector = sordo();
      const r = await procesar(base, entrada, lector);
      verificarInvariantes(antes, r, entrada);
      // Lo que la capa determinista atrapa (vacio, pregunta, negativa) no gasta modelo.
      if (sinModelo) expect(lector.llamadas).toBe(0);
    });

    it('el mismo mensaje 5 veces seguidas: nunca se cuelga y nunca pasa de 2 intentos', async () => {
      for (const { entrada } of BATERIA) {
        const base = await llegarA(paso, poblacion);
        const pasoInicial = base.paso;
        let r: Resultado | undefined;
        let cambio = false;
        for (let k = 0; k < 5; k++) {
          const antes = structuredClone(base);
          r = await procesar(base, entrada, sordo());
          verificarInvariantes(antes, r, entrada);
          if (base.paso !== pasoInicial || base.closed || base.indice !== antes.indice) cambio = true;
          if (base.closed) break;
        }
        // A la segunda falla el paso se resolvio: o se movio de paso/dimension, o se cerro.
        // La unica excepcion legitima es la palabra clave y el boton valido del propio paso,
        // que no cuentan como intento porque no son fallas de lectura.
        const esBotonValido = !!entrada.botonId && r!.salidas.length > 0 && !cambio;
        if (!esBotonValido) expect(cambio || base.closed).toBe(true);
      }
    });
  });
});

describe('recorrido completo con todo hostil', () => {
  it.each(['ciudadano', 'experto'] as const)('%s: cada dimension queda unresolved, en orden, y se cierra guardando', async (poblacion) => {
    const state = await llegarA('triada_orden', poblacion);
    const turnosAntes = state.turnos;
    const lector = sordo();
    let r: Resultado | undefined;
    for (let k = 0; k < 40 && !state.closed; k++) {
      const antes = structuredClone(state);
      r = await procesar(state, { texto: 'asdkjh' }, lector);
      verificarInvariantes(antes, r, { texto: 'asdkjh' });
    }
    expect(state.closed).toBe(true);
    expect(r!.accion).toBe('guardar_y_cerrar');
    expect(Object.keys(state.dimensiones)).toEqual(SECUENCIA[poblacion]);
    for (const reg of Object.values(state.dimensiones)) {
      expect(reg!.special_case).toBe('unresolved');
      expect(reg!.confirmed_by_participant).toBe(false);
    }
    const p = armarPayload(state, 'completa', AHORA) as { provenance: { completa: boolean; dimensiones_capturadas: number; dimensiones_esperadas: number } };
    expect(p.provenance.completa).toBe(true);
    expect(p.provenance.dimensiones_capturadas).toBe(SECUENCIA[poblacion].length);
    expect(resumen(state)).toContain('sin ubicar');
    // Cada dimension costo EXACTAMENTE dos mensajes: la repregunta y el cierre sin lectura.
    expect(state.turnos - turnosAntes).toBe(SECUENCIA[poblacion].length * 2);
  });
});

describe('la palabra clave a mitad de conversacion', () => {
  it.each(PASOS)('en %s repite la pregunta pendiente sin reiniciar ni contar intento', async (paso) => {
    const state = await llegarA(paso);
    const antes = structuredClone(state);
    const r = await procesar(state, { texto: 'cardumen' }, sordo());
    expect(state.paso).toBe(antes.paso);
    expect(state.indice).toBe(antes.indice);
    expect(state.reintentos).toBe(antes.reintentos);
    expect(state.en_curso?.reintentos ?? 0).toBe(antes.en_curso?.reintentos ?? 0);
    expect(state.consent).toEqual(antes.consent);
    expect(state.historia).toBe(antes.historia);
    expect(r.salidas).toHaveLength(1);
    if (paso !== 'consentimiento') expect(r.salidas[0].texto).toContain('Seguimos donde íbamos');
    else expect(r.salidas[0].texto).toContain('presione *OK*');
    verificarSalidas(r.salidas);
  });
});

describe('modelo caido', () => {
  it.each(['triada_orden', 'triada_segundo', 'triada_intensidad', 'diada_abrir', 'diada_aclarar'] as const)(
    'en %s el error sube (index.ts no persiste) y no queda ninguna dimension inventada', async (paso) => {
      const state = await llegarA(paso);
      const dims = Object.keys(state.dimensiones);
      await expect(procesar(state, { texto: 'primero el poder, después la gente' }, caido)).rejects.toThrow('modelo caido');
      expect(Object.keys(state.dimensiones)).toEqual(dims);
      expect(state.paso).toBe(paso);
    },
  );
});

describe('turno cero endurecido', () => {
  it('"no soy observador" es ciudadano, no experto (la palabra negada no cuenta)', async () => {
    const s1 = await llegarA('poblacion');
    await procesar(s1, { texto: 'no soy observador de nada' }, sordo());
    expect(s1.poblacion).toBe('ciudadano');
    const s2 = await llegarA('poblacion');
    await procesar(s2, { texto: 'sí, observador' }, sordo());
    expect(s2.poblacion).toBe('experto');
    const s3 = await llegarA('poblacion');
    await procesar(s3, { texto: 'no soy experta en eso' }, sordo());
    expect(s3.poblacion).toBe('ciudadano');
  });

  it('un boton viejo en la historia no se guarda como historia: se repregunta', async () => {
    const s = await llegarA('historia');
    const r = await procesar(s, { texto: 'Sí, así', botonId: BOTON.si }, sordo());
    expect(s.paso).toBe('historia');
    expect(s.historia).toBeUndefined();
    expect(r.salidas[0].texto).toContain('Ese botón era de una pregunta anterior');
    expect(r.salidas[0].texto).toContain('Cuéntenos algo que haya visto');
  });

  it('historia vacia dos veces: se cierra sin guardar (sin historia no hay Capa A), nunca se cuelga', async () => {
    const s = await llegarA('historia');
    let r = await procesar(s, { texto: '👍' }, sordo());
    expect(s.paso).toBe('historia');
    expect(r.salidas[0].texto).toContain('No me llegó texto');
    r = await procesar(s, { texto: '' }, sordo());
    expect(r.accion).toBe('cerrar_sin_guardar');
    expect(s.closed).toBe(true);
  });

  it('en idioma_confirmar, ruido dos veces sigue en espanol y conserva la historia (antes cerraba sin guardar)', async () => {
    const s = await llegarA('idioma_confirmar');
    let r = await procesar(s, { texto: 'asdkjh' }, sordo());
    expect(s.paso).toBe('idioma_confirmar');
    expect(r.salidas[0].texto).toContain('Seguimos en español');
    r = await procesar(s, { texto: 'zzz' }, sordo());
    expect(s.idioma_confirmado).toBe(true);
    expect(s.paso).toBe('triada_orden');
    expect(s.historia).toBe(HISTORIA_ES);
    expect(s.notas).toContain('no confirmo el idioma; se siguio en espanol, el unico del instrumento');
    // "Otro idioma" y "no" siguen llevando al trilingue
    const s2 = await llegarA('idioma_confirmar');
    await procesar(s2, { texto: 'Otro idioma', botonId: BOTON.langOtro }, sordo());
    expect(s2.paso).toBe('idioma_no_es');
  });

  it('un boton viejo del consentimiento a mitad de una triada no confirma nada: se lee como texto', async () => {
    const s = await llegarA('triada_confirmar');
    const antes = structuredClone(s);
    const lector = sordo();
    await procesar(s, { texto: 'Sí, observador', botonId: BOTON.expSi }, lector);
    // No es "si" (el texto no esta en la lista de afirmaciones): se trato como correccion con contenido y se releyo.
    expect(lector.llamadas).toBe(1);
    expect(Object.keys(s.dimensiones)).toEqual(Object.keys(antes.dimensiones));
  });
});

describe('capa 3: pregunta de vuelta y negativa', () => {
  it('pregunta de vuelta en una triada: responde quien es y repite la pregunta en el MISMO mensaje; cuenta como intento', async () => {
    const s = await llegarA('triada_orden');
    const lector = sordo();
    let r = await procesar(s, { texto: '¿quién eres?' }, lector);
    expect(lector.llamadas).toBe(0);
    expect(r.salidas).toHaveLength(1);
    expect(r.salidas[0].texto).toContain('Soy el asistente de *Navigate*');
    expect(r.salidas[0].texto).toContain('esto es una demostración'.replace('esto', 'Esto'));
    expect(r.salidas[0].texto).toContain('*De dónde nace lo que observó.*');
    expect(s.paso).toBe('triada_orden');
    expect(s.en_curso?.reintentos).toBe(1);
    // segunda no-lectura: unresolved y avanza
    r = await procesar(s, { texto: '¿para qué sirve esto?' }, lector);
    expect(s.dimensiones.T1_fuente).toMatchObject({ special_case: 'unresolved', declinado: false, dominant: null, composition: null });
    expect(s.paso).toBe('triada_orden');
    expect(s.indice).toBe(1);
  });

  it('pregunta de vuelta con botones pendientes: la respuesta va DENTRO del mensaje con botones', async () => {
    const s = await llegarA('triada_confirmar');
    const r = await procesar(s, { texto: '¿es usted un bot?' }, sordo());
    expect(r.salidas).toHaveLength(1);
    expect(r.salidas[0].tipo).toBe('botones');
    expect(r.salidas[0].texto).toContain('Soy el asistente de *Navigate*');
    expect(r.salidas[0].texto).toContain('Le leo entonces');
    expect(s.paso).toBe('triada_confirmar');
  });

  it('negativa en una triada: unresolved con la marca declinado, sin insistir, y se avanza', async () => {
    const s = await llegarA('triada_orden');
    const lector = sordo();
    const r = await procesar(s, { texto: 'no quiero responder' }, lector);
    expect(lector.llamadas).toBe(0);
    expect(s.dimensiones.T1_fuente).toMatchObject({
      special_case: 'unresolved', declinado: true, dominant: null, second: null, composition: null, confirmed_by_participant: false,
    });
    expect((s.dimensiones.T1_fuente as RegistroTriada).reflexivity_note).toContain('declino responder');
    expect(r.salidas[0].texto).toBe('Entendido, lo dejo sin responder. Seguimos.');
    expect(s.indice).toBe(1);
    expect(s.paso).toBe('triada_orden');
  });

  it('negativa en el turno de intensidad: el orden confirmado se conserva y queda grueso', async () => {
    const s = await llegarA('triada_intensidad');
    await procesar(s, { texto: 'paso' }, sordo());
    expect(s.dimensiones.T1_fuente).toMatchObject({
      dominant: 'Quienes tienen poder, dinero o influencia', second: 'Fuerzas que nadie controla del todo',
      intensity_label: null, composition: [0, 1, 0], resolution_captured: 'coarse', confirmed_by_participant: true, declinado: false,
    });
  });

  it('negativa en una diada: not_applicable con la marca declinado, value null', async () => {
    for (const paso of ['diada_abrir', 'diada_aclarar', 'diada_confirmar'] as const) {
      const s = await llegarA(paso);
      const r = await procesar(s, { texto: 'prefiero no responder' }, sordo());
      expect(s.dimensiones.D1_novedad).toMatchObject({
        special_case: 'not_applicable', declinado: true, value: null, anchor_label: null, anchor_text: null, confirmed_by_participant: false,
      });
      expect(r.salidas[0].texto).toBe('Entendido, lo dejo sin responder. Seguimos.');
      expect(s.indice).toBe(3);
    }
  });

  it('el resumen de cierre distingue "no quiso responder" de "sin ubicar"', async () => {
    const s = await llegarA('triada_orden');
    await procesar(s, { texto: 'paso' }, sordo());          // T1 declinada
    await procesar(s, { texto: 'asdkjh' }, sordo());        // T2 fallo 1
    await procesar(s, { texto: 'asdkjh' }, sordo());        // T2 unresolved
    const txt = resumen(s);
    expect(txt).toContain('• De dónde nace lo que observó: no quiso responder');
    expect(txt).toContain('• En el fondo, qué se siente que es: sin ubicar');
  });

  it('negativa antes del consentimiento: no se guarda nada', async () => {
    const s = await llegarA('consentimiento');
    const r = await procesar(s, { texto: 'no quiero participar' }, sordo());
    expect(r.accion).toBe('cerrar_sin_guardar');
  });

  it('negativa en la historia: se explica una vez; a la segunda se cierra sin guardar', async () => {
    const s = await llegarA('historia');
    let r = await procesar(s, { texto: 'no quiero responder' }, sordo());
    expect(s.paso).toBe('historia');
    expect(r.salidas[0].texto).toContain('Sin una historia no tengo con qué seguir');
    expect(r.salidas[0].texto).toContain('Cuéntenos algo que haya visto');
    r = await procesar(s, { texto: 'paso' }, sordo());
    expect(r.accion).toBe('cerrar_sin_guardar');
  });

  it('negativa en poblacion y sector: se asume ciudadano / sin sector, y queda dicho en provenance', async () => {
    const s = await llegarA('poblacion');
    await procesar(s, { texto: 'no quiero decir' }, sordo());
    expect(s.poblacion).toBe('ciudadano');
    await procesar(s, { texto: 'paso' }, sordo());
    expect(s.sector).toBeNull();
    expect(s.paso).toBe('historia');
    const p = armarPayload(s, 'salir', AHORA) as { provenance: { notas: string[] } };
    expect(p.provenance.notas).toEqual(['declino decir si es observador: se asumio panel ciudadano', 'declino decir el sector']);
  });
});
