/**
 * Modo `objetos` de Cardumen: lectura del spec, parseo de lo que vuelve y avance de una
 * secuencia de pasos HETEROGENEOS (opcion unica, relato, reparto).
 *
 * Lo que se protege aqui son cuatro cosas que se rompen en silencio:
 *   1. que el texto que escribe la persona en WhatsApp se entienda aunque venga torcido (el
 *      prellenado de `wa.me` es EDITABLE y el teclado del celular corrige solo);
 *   2. que la sesion de objetos NO la atienda el motor de chat — misma tabla que la demo viva
 *      de Grupo Progreso, y la palabra de consentimiento del chat es justamente "LISTO";
 *   3. que un reintento no duplique ni salte un paso, y que un link viejo no retroceda la
 *      secuencia NI se guarde como si fuera el relato de la persona;
 *   4. que el relato se guarde VERBATIM y la longitud de una respuesta nunca bloquee;
 *   5. que ningun texto `bot` del instrumento se pierda — en especial el cambio de marco
 *      antes de `semana`, sin el cual ese reparto mide otra cosa.
 *
 * VISTO FALLAR (mutaciones, todas corridas):
 *   - quitando el `(?<![a-z0-9])` del regex de numeros cae `id con digito al final`;
 *   - `una sola cifra no es un reparto` cae al quitar LOS DOS frenos a la vez (el `+` final
 *     del regex de numeros y el `porcentajes.length < 2`): cada uno tapa al otro, y por eso
 *     mutar solo uno no la hace fallar — verificado;
 *   - quitando el chequeo de `paso.opciones` cae `numeros de mas o de menos`;
 *   - quitando el tope de 100, el freno de suma cero, el rechazo de id duplicado en el spec
 *     o el saneado del paso (`pasoSano`), cae su caso respectivo;
 *   - moviendo el `parsearListo` DESPUES de la rama del paso pendiente cae `un reparto de un
 *     link viejo no se guarda como el relato`;
 *   - quitando el `!yaRepreguntado` cae `la repregunta es UNA sola vez`;
 *   - bajando el relato a minuscula (cualquier toque al texto) cae `guarda el texto VERBATIM`;
 *   - fijando `deAudio: false` cae `una nota de voz transcrita queda MARCADA`;
 *   - dejando que un boton de otro paso se caiga al texto, o aflojando el regex de `solo
 *     numero`, cae su caso de `leerChips`;
 *   - aceptando un paso narrativo sin enunciado, o un `tipo` desconocido, cae
 *     `un paso narrativo SIN enunciado invalida el spec` / `tipo desconocido`;
 *   - marcando el relato con `origen: 'texto_whatsapp'` cae `relato: micro_narrativa ...`;
 *   - descartando los `bot` en `tramoDesde`, o devolviendo `textos: []` en `avanza` o en
 *     `cierra`, cae `NINGUN bot del guion se pierde` (y con el, el cambio de marco de
 *     `semana`); aceptando un `bot` sin texto cae su caso;
 *   - contando el avance desde `estado.paso` en vez de desde el paso RESPONDIDO, o dejando
 *     que `pasoPendiente` no salte los `bot`, cae `un estado que quedo apuntando a un bot`;
 *   - devolviendo `estado` sin tocar en `fuera_de_secuencia` (o avanzando el paso) cae
 *     `un link viejo registra pero NO retrocede`;
 *   - quitando el `s.modo === MODO_OBJETOS` de `esEstadoObjetos` cae `una sesion de chat o de
 *     Navigate NO es de objetos`, y con el la proteccion de la demo viva;
 *   - quitando el `if (data.modo !== MODO_OBJETOS)` de `cargarEstudioObjetos` cae `una fila de
 *     chat o de miniweb no la atiende el bloque de objetos`.
 */
import { describe, expect, it } from 'vitest'
import {
  MODO_OBJETOS,
  ORIGEN_TEXTO,
  ORIGEN_WA,
  cargarEstudioObjetos,
  decidirObjetos,
  esEstadoObjetos,
  estadoInicialObjetos,
  guardarRespuestaDelPaso,
  hayRegistroDelObjeto,
  idBotonChip,
  leerChips,
  leerSpecObjetos,
  normalizarIdObjeto,
  parsearListo,
  pasoPendiente,
  relatoEsMuyCorto,
  tramoDesde,
  resolverEstudioObjetosPorTrigger,
  urlDelObjeto,
  vectorDePorcentajes,
  type EstadoObjetos,
  type PasoChips,
  type PasoRelato,
  type PasoReparto,
  type SpecObjetos,
} from './objetos'

// ---------------------------------------------------------------------------------------
// Datos: el GUION REAL del instrumento de adultos, en su orden (leido de adultos.html).
// Los enunciados van literales porque es lo que el bot manda: si aqui se parafrasean, la
// prueba deja de verificar lo unico que importa de un paso narrativo.
// ---------------------------------------------------------------------------------------

// Los cuatro `bot` del guion de adultos, literales (lineas 748, 749, 755 y 770 del HTML).
// Van en constantes porque las pruebas verifican que NINGUNO se pierda, y para eso hay que
// compararlos caracter por caracter.
const BOT_SALUDO = 'Hola. Soy el entrevistador de Cardumen. Esto toma unos minutos y no hay respuestas correctas.'
const BOT_METODO = 'Vamos a hacerlo al revés de una encuesta: primero tu historia, después tú mismo la ubicas. Yo no la interpreto.'
const BOT_REGLA_OBJETO = 'Gracias. Ahora te voy a pedir que ubiques esa misma historia en tres objetos. Cada uno reparte un total fijo: si subes uno, los demás ceden.'
const BOT_CAMBIO_DE_MARCO = 'Ahora salgamos de esa historia y hablemos de tu semana. Esta se responde con fichas, sin arrastrar nada.'

const SPEC_CRUDO = {
  base_url: 'https://reframeit.metrik.com.co/adultos',
  encuadre: 'Antes de empezar: lo que respondas se envía al estudio.',
  cierre: 'Listo, eso era todo.',
  pasos: [
    { tipo: 'bot', texto: BOT_SALUDO },
    { tipo: 'bot', texto: BOT_METODO },
    {
      tipo: 'chips', id: 'antiguedad', pregunta: '¿Cuánto llevas en tu trabajo actual?',
      opciones: ['Menos de 1 año', '1 a 3 años', '3 a 7 años', 'Más de 7 años'],
    },
    {
      tipo: 'relato', id: 'historia',
      pregunta: 'Cuéntame una situación reciente del trabajo que de verdad te haya costado. No necesito el contexto completo, solo lo que pasó.',
    },
    { tipo: 'bot', texto: BOT_REGLA_OBJETO },
    { tipo: 'reparto', id: 'quien_decidio', titulo: 'Las tres fuerzas', opciones: 3 },
    { tipo: 'reparto', id: 'sentia_vs_esperaban', titulo: 'La balanza', opciones: 2 },
    { tipo: 'bot', texto: BOT_CAMBIO_DE_MARCO },
    { tipo: 'reparto', id: 'semana', titulo: 'Tu semana en diez fichas', opciones: 5 },
    { tipo: 'reparto', id: 'preocupaciones', titulo: 'Lo que te quita el sueño', opciones: 8 },
    {
      tipo: 'relato', id: 'cierre_narrativo',
      pregunta: 'Para terminar: si pudieras cambiar una sola cosa de lo que me contaste al principio, ¿cuál sería?',
    },
  ],
}

const spec = leerSpecObjetos(SPEC_CRUDO) as SpecObjetos
const ESTUDIO = 'cardumen-objetos-adultos'

/** Indice de un paso por su id. Las pruebas ya no pueden contar a mano: entre los pasos que
 *  esperan respuesta hay `bot` intercalados, y un indice fijo se desalinea al tocar el guion. */
const indiceDe = (id: string) => spec.pasos.findIndex((p) => p.id === id)

const CHIPS = spec.pasos[indiceDe('antiguedad')] as PasoChips
const HISTORIA = spec.pasos[indiceDe('historia')] as PasoRelato
const QUIEN = spec.pasos[indiceDe('quien_decidio')] as PasoReparto

/** Estado justo antes de responder el paso `id`. */
const ante = (id: string, recibidos: string[] = [], repreguntados: string[] = []): EstadoObjetos => ({
  modo: MODO_OBJETOS,
  study_id: ESTUDIO,
  paso: indiceDe(id),
  recibidos,
  repreguntados,
})

const estadoEn = (paso: number, recibidos: string[] = [], repreguntados: string[] = []): EstadoObjetos => ({
  modo: MODO_OBJETOS,
  study_id: ESTUDIO,
  paso,
  recibidos,
  repreguntados,
})

const entrada = (texto: string, extra: { botonId?: string | null; deAudio?: boolean } = {}) => ({ texto, ...extra })

// ---------------------------------------------------------------------------------------
// leerSpecObjetos
// ---------------------------------------------------------------------------------------

describe('leerSpecObjetos', () => {
  it('lee la secuencia completa, en orden, con sus tipos', () => {
    expect(spec.base_url).toBe(SPEC_CRUDO.base_url)
    expect(spec.pasos.map((p) => [p.tipo, p.id])).toEqual([
      ['bot', 'bot_0'],              // id sintetizado: un `bot` no tiene id en el guion
      ['bot', 'bot_1'],
      ['chips', 'antiguedad'],
      ['relato', 'historia'],
      ['bot', 'bot_4'],
      ['reparto', 'quien_decidio'],
      ['reparto', 'sentia_vs_esperaban'],
      ['bot', 'bot_7'],
      ['reparto', 'semana'],
      ['reparto', 'preocupaciones'],
      ['relato', 'cierre_narrativo'],
    ])
  })

  it('el enunciado queda LITERAL, con sus tildes y su puntuacion', () => {
    // Si esto se "limpia" en algun punto, el bot manda otra pregunta y las respuestas dejan
    // de ser comparables entre participantes.
    expect(HISTORIA.pregunta).toBe('Cuéntame una situación reciente del trabajo que de verdad te haya costado. No necesito el contexto completo, solo lo que pasó.')
    expect(CHIPS.pregunta).toBe('¿Cuánto llevas en tu trabajo actual?')
    expect(CHIPS.opciones).toEqual(['Menos de 1 año', '1 a 3 años', '3 a 7 años', 'Más de 7 años'])
  })

  it('`objetos: [...]` sigue valiendo como una secuencia de puros repartos', () => {
    // Es la forma con la que nacio el modo: un spec viejo no queda invalido de golpe.
    const s = leerSpecObjetos({
      base_url: 'https://x.co/a',
      objetos: [{ id: 'quien_decidio', titulo: 'T', opciones: 3 }, { id: 'semana', opciones: 5 }],
    })
    expect(s?.pasos.map((p) => p.tipo)).toEqual(['reparto', 'reparto'])
  })

  it('toma la base_url de la columna `url` de la fila si el spec no la trae', () => {
    const s = leerSpecObjetos({ pasos: [{ tipo: 'reparto', id: 'a' }] }, 'https://x.co/ninos')
    expect(s?.base_url).toBe('https://x.co/ninos')
  })

  it('devuelve null (no lanza) ante cualquier spec inutilizable', () => {
    // El llamador es el webhook: un throw aqui tumbaria el turno completo de la persona.
    for (const malo of [
      null, undefined, 'x', 3, [SPEC_CRUDO],
      { pasos: [{ tipo: 'reparto', id: 'a' }] },                          // sin base_url
      { base_url: 'ftp://x.co', pasos: [{ tipo: 'reparto', id: 'a' }] },  // esquema que Meta rechaza
      { base_url: 'https://x.co', pasos: [] },                           // secuencia vacia
      { base_url: 'https://x.co', pasos: 'a' },
      { base_url: 'https://x.co', pasos: [{ tipo: 'reparto', id: '' }] },
      { base_url: 'https://x.co', pasos: [{ tipo: 'reparto', id: '---' }] }, // normaliza a vacio
      { base_url: 'https://x.co', pasos: [{ tipo: 'reparto', id: 'a' }, { tipo: 'relato', id: 'A', pregunta: 'x' }] }, // id repetido
      { base_url: 'https://x.co', pasos: [{ tipo: 'otro', id: 'a' }] },   // tipo desconocido
    ]) {
      expect(leerSpecObjetos(malo), JSON.stringify(malo)).toBe(null)
    }
  })

  it('un paso narrativo SIN enunciado invalida el spec: el bot no puede redactar la pregunta', () => {
    for (const paso of [
      { tipo: 'relato', id: 'historia' },
      { tipo: 'relato', id: 'historia', pregunta: '   ' },
      { tipo: 'chips', id: 'edad', opciones: ['8', '9'] },
      { tipo: 'chips', id: 'edad', pregunta: '¿Edad?' },                       // sin opciones
      { tipo: 'chips', id: 'edad', pregunta: '¿Edad?', opciones: ['8'] },      // una sola
      { tipo: 'chips', id: 'edad', pregunta: '¿Edad?', opciones: ['Sí', 'si'] }, // normalizan igual
    ]) {
      expect(leerSpecObjetos({ base_url: 'https://x.co', pasos: [paso] }), JSON.stringify(paso)).toBe(null)
    }
  })

  it('un `opciones` de reparto fuera de rango queda en null: se deja de verificar, no se inventa', () => {
    const s = leerSpecObjetos({
      base_url: 'https://x.co',
      pasos: [
        { tipo: 'reparto', id: 'a', opciones: 1 },
        { tipo: 'reparto', id: 'b', opciones: 99 },
        { tipo: 'reparto', id: 'c', opciones: 2.5 },
      ],
    })
    expect(s?.pasos.map((p) => (p as PasoReparto).opciones)).toEqual([null, null, null])
  })
})

// El guion de ninos (leido de ninos.html). Va aparte porque es el que trae los dos casos
// que no estan en adultos: una opcion unica de CINCO opciones (arriba del tope de botones
// interactivos de WhatsApp) y un paso de opcion unica al FINAL de la secuencia.
const BOT_NINOS_SALUDO = '¡Hola! Soy Pulpo. Vivo en el fondo del mar y me gusta que me cuenten cosas. 🐙'
const BOT_NINOS_SEMILLAS = 'Ya casi. Esta última es con semillas: te doy siete y las siembras donde quieras.'

const SPEC_NINOS = {
  base_url: 'https://reframeit.metrik.com.co/ninos',
  pasos: [
    { tipo: 'bot', texto: BOT_NINOS_SALUDO },
    { tipo: 'bot', texto: 'No hay respuestas buenas ni malas. Nadie te va a calificar.' },
    { tipo: 'chips', id: 'edad', pregunta: 'Primero, lo más fácil: ¿cuántos años tienes?', opciones: ['8', '9', '10', '11', '12'] },
    { tipo: 'relato', id: 'historia', pregunta: 'Ahora cuéntame algo que te pasó esta semana y que todavía te acuerdas. Puede ser bueno o puede ser feo.' },
    { tipo: 'bot', texto: 'Gracias por contármelo. Ahora te voy a pedir algo distinto: en vez de escribir, vas a estirarme los brazos.' },
    { tipo: 'reparto', id: 'peso_quien', titulo: 'El pulpo', opciones: 4 },
    { tipo: 'reparto', id: 'como_me_dejo', titulo: 'La balanza', opciones: 2 },
    { tipo: 'bot', texto: BOT_NINOS_SEMILLAS },
    { tipo: 'reparto', id: 'donde_tranquilo', titulo: 'Las semillas', opciones: 3 },
    { tipo: 'chips', id: 'le_conte', pregunta: 'Una última: ¿eso que me contaste se lo habías contado a alguien más?', opciones: ['Sí, a un adulto', 'Sí, a un amigo', 'No, a nadie'] },
  ],
}

describe('el guion de ninos, tal como queda sembrado', () => {
  const sn = leerSpecObjetos(SPEC_NINOS) as SpecObjetos

  it('se lee entero y en orden, con sus `bot` en su sitio', () => {
    expect(sn.pasos.filter((p) => p.tipo !== 'bot').map((p) => p.id)).toEqual([
      'edad', 'historia', 'peso_quien', 'como_me_dejo', 'donde_tranquilo', 'le_conte',
    ])
    expect(sn.pasos.filter((p) => p.tipo === 'bot')).toHaveLength(4)
  })

  it('el cambio de marco de las semillas viaja con el paso, no se pierde', () => {
    const i = sn.pasos.findIndex((p) => p.id === 'como_me_dejo')
    const d = decidirObjetos(sn, { modo: MODO_OBJETOS, study_id: 'x', paso: i, recibidos: [] }, entrada('Listo como_me_dejo 70-30'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.textos).toEqual([BOT_NINOS_SEMILLAS])
    expect(d.siguiente.id).toBe('donde_tranquilo')
  })

  it('la opcion unica de CINCO opciones vale: el tope de 3 es de los botones, no del spec', () => {
    // Arriba de 3 el flujo manda lista numerada. Si el spec las rechazara, el paso de edad
    // de ninos (5 opciones) y el de antiguedad de adultos (4) no se podrian sembrar.
    const edad = sn.pasos.find((p) => p.id === 'edad') as PasoChips
    expect(edad.opciones).toHaveLength(5)
    expect(leerChips(edad, '5')).toBe('12')
  })

  it('termina en una opcion unica: el ultimo paso tambien cierra', () => {
    const i = sn.pasos.findIndex((p) => p.id === 'le_conte')
    const d = decidirObjetos(sn, { modo: MODO_OBJETOS, study_id: 'x', paso: i, recibidos: [] }, entrada('3'))
    expect(d?.tipo).toBe('cierra')
    if (d?.tipo !== 'cierra') return
    expect(d.respuesta).toEqual({ tipo: 'chips', valor: 'No, a nadie' })
  })
})

describe('normalizarIdObjeto', () => {
  it('iguala tildes, mayusculas, espacios y guiones al id del guion', () => {
    for (const texto of ['quien_decidio', 'QUIEN DECIDIO', 'quién decidió', ' Quien-Decidio ', 'quien   decidio']) {
      expect(normalizarIdObjeto(texto), texto).toBe('quien_decidio')
    }
  })
})

// ---------------------------------------------------------------------------------------
// parsearListo — la parte que de verdad recibe texto escrito a mano
// ---------------------------------------------------------------------------------------

describe('parsearListo', () => {
  it('lee el texto tal como lo prellena la pagina', () => {
    expect(parsearListo('Listo preocupaciones 50-30-20')).toEqual({
      objeto: 'preocupaciones', porcentajes: [50, 30, 20],
    })
  })

  it('aguanta todas las formas torcidas que puede producir un celular', () => {
    const casos: Array<[string, number[]]> = [
      ['listo preocupaciones 50-30-20', [50, 30, 20]],
      ['LISTO PREOCUPACIONES 50-30-20', [50, 30, 20]],
      ['Listó preocupaciones 50-30-20', [50, 30, 20]],          // tilde del corrector
      ['  Listo   preocupaciones   50 - 30 - 20  ', [50, 30, 20]],
      ['Listo preocupaciones 50/30/20', [50, 30, 20]],          // separador /
      ['Listo preocupaciones 50,30,20', [50, 30, 20]],          // separador ,
      ['Listo preocupaciones 50 30 20', [50, 30, 20]],          // separador espacio
      ['Listo preocupaciones 50-30-20 gracias', [50, 30, 20]],  // texto pegado despues
      ['ya quedo, listo preocupaciones 50-30-20', [50, 30, 20]],// texto pegado antes
    ]
    for (const [texto, esperado] of casos) {
      expect(parsearListo(texto), texto).toEqual({ objeto: 'preocupaciones', porcentajes: esperado })
    }
  })

  it('el objeto con espacio en vez de guion bajo resuelve al mismo id', () => {
    expect(parsearListo('Listo sentia vs esperaban 70-30')?.objeto).toBe('sentia_vs_esperaban')
    expect(parsearListo('Listo sentía vs esperaban 70-30')?.objeto).toBe('sentia_vs_esperaban')
  })

  it('id con digito al final: el digito no arranca la corrida de numeros', () => {
    // `amigos2` es un id real de opcion del instrumento de ninos. Sin el lookbehind, el "2"
    // abriria la corrida y el objeto quedaria en `amigos`.
    expect(parsearListo('Listo amigos2 50-50')).toEqual({ objeto: 'amigos2', porcentajes: [50, 50] })
  })

  it('devuelve null y no adivina cuando el mensaje no es un reparto', () => {
    for (const texto of [
      '', '   ', 'hola', 'gracias',
      'Listo',                                 // sin numeros
      'Listo preocupaciones',                  // idem
      'preocupaciones 50-30-20',               // sin la palabra
      'Listo 50-30-20',                        // sin objeto
      'alistando 50-30-20',                    // `listo` dentro de otra palabra
      'Listo preocupaciones 50',               // una sola cifra no es un reparto
      'Listo preocupaciones 120-30',           // porcentaje imposible
      'Listo preocupaciones 0-0-0',            // suma cero: no hay reparto
    ]) {
      expect(parsearListo(texto), texto).toBe(null)
    }
  })

  it('una sola cifra no es un reparto, aunque venga pegada a texto', () => {
    expect(parsearListo('listo semana 10')).toBe(null)
  })
})

describe('vectorDePorcentajes', () => {
  it('normaliza a suma 1', () => {
    expect(vectorDePorcentajes([50, 30, 20])).toEqual([0.5, 0.3, 0.2])
  })
  it('un reparto que no suma 100 igual se normaliza (la pagina redondea)', () => {
    const v = vectorDePorcentajes([33, 33, 33])
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
  })
})

// ---------------------------------------------------------------------------------------
// leerChips — opcion unica
// ---------------------------------------------------------------------------------------

describe('leerChips', () => {
  it('resuelve por el id del boton y devuelve el literal del spec', () => {
    expect(leerChips(CHIPS, 'Más de 7 años', idBotonChip('antiguedad', 3))).toBe('Más de 7 años')
  })

  it('un boton de OTRO paso no resuelve, ni se cae al texto', () => {
    // El titulo del boton viaja tambien como texto del mensaje: sin este corte, tocar un
    // boton viejo del chat contestaria la pregunta actual.
    expect(leerChips(CHIPS, 'Más de 7 años', idBotonChip('le_conte', 1))).toBe(null)
    expect(leerChips(CHIPS, 'Más de 7 años', 'chip:antiguedad:99')).toBe(null)
  })

  it('resuelve por el numero de la lista numerada (arriba de 3 opciones no hay botones)', () => {
    expect(leerChips(CHIPS, '1')).toBe('Menos de 1 año')
    expect(leerChips(CHIPS, '4')).toBe('Más de 7 años')
    expect(leerChips(CHIPS, '4.')).toBe('Más de 7 años')
    expect(leerChips(CHIPS, '5')).toBe(null)
    expect(leerChips(CHIPS, '0')).toBe(null)
  })

  it('resuelve por el texto escrito, con o sin tildes y en cualquier caja', () => {
    // Ojo: `normalizarTexto` descompone en NFD y quita las marcas, asi que la ñ SI se
    // normaliza a n. Es lo contrario de `normalizarTrigger` (las palabras que abren un
    // estudio), donde `ninos` y `niños` son dos filas distintas. Aqui conviene: alguien
    // que escribe sin ñ igual contesta.
    expect(leerChips(CHIPS, 'mas de 7 anos')).toBe('Más de 7 años')
    expect(leerChips(CHIPS, 'mas de 7 años')).toBe('Más de 7 años')
    expect(leerChips(CHIPS, '  1 A 3 AÑOS ')).toBe('1 a 3 años')
    expect(leerChips(CHIPS, 'menos de un año')).toBe(null)    // no es el literal
  })

  it('un numero dentro de una frase no es una eleccion', () => {
    expect(leerChips(CHIPS, 'tengo 3 hijos')).toBe(null)
    expect(leerChips(CHIPS, '')).toBe(null)
  })
})

// ---------------------------------------------------------------------------------------
// Relato
// ---------------------------------------------------------------------------------------

describe('relatoEsMuyCorto', () => {
  it('una o dos palabras si; una frase no', () => {
    for (const t of ['', '  ', 'mal', 'muy mal', 'nada']) expect(relatoEsMuyCorto(t), t).toBe(true)
    for (const t of ['me fue bastante mal', 'mi jefe me cambio el proyecto dos veces']) {
      expect(relatoEsMuyCorto(t), t).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------------------
// Estado y marca que protege la demo viva
// ---------------------------------------------------------------------------------------

describe('esEstadoObjetos', () => {
  it('reconoce la sesion de objetos', () => {
    expect(esEstadoObjetos(estadoInicialObjetos(ESTUDIO))).toBe(true)
  })

  it('una sesion de chat o de Navigate NO es de objetos', () => {
    // Esto es lo que mantiene el texto "Listo ..." fuera del entrevistador de chat.
    for (const state of [
      null, undefined, 'x', [],
      { study_id: 'navigate', motor: 'navigate', paso: 'triada_1' },   // Navigate
      { study_id: 'araucania-turismo', history: [] },                  // chat R1/R2
      { modo: 'objetos' },                                             // sin study_id
      { modo: 'miniweb', study_id: ESTUDIO },
    ]) {
      expect(esEstadoObjetos(state), JSON.stringify(state)).toBe(false)
    }
  })
})

describe('pasoPendiente', () => {
  it('es el paso en que va, y null cuando ya se respondieron todos', () => {
    expect(pasoPendiente(spec, ante('antiguedad'))?.id).toBe('antiguedad')
    expect(pasoPendiente(spec, ante('cierre_narrativo'))?.id).toBe('cierre_narrativo')
    expect(pasoPendiente(spec, estadoEn(spec.pasos.length))).toBe(null)
  })
})

// ---------------------------------------------------------------------------------------
// decidirObjetos — el avance de la secuencia
// ---------------------------------------------------------------------------------------

describe('decidirObjetos — opcion unica', () => {
  it('la opcion elegida avanza y se guarda el literal, no el numero', () => {
    const d = decidirObjetos(spec, ante('antiguedad'), entrada('3'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.respuesta).toEqual({ tipo: 'chips', valor: '3 a 7 años' })
    expect(d.siguiente.id).toBe('historia')
    expect(d.estado.paso).toBe(indiceDe('historia'))
  })

  it('el boton del paso tambien avanza', () => {
    const d = decidirObjetos(spec, ante('antiguedad'), entrada('Menos de 1 año', { botonId: idBotonChip('antiguedad', 0) }))
    expect(d?.tipo).toBe('avanza')
  })

  it('lo que no es una opcion reenvia la pregunta, sin error tecnico', () => {
    const d = decidirObjetos(spec, ante('antiguedad'), entrada('pues depende'))
    expect(d).toEqual({ tipo: 'no_entendido', pendiente: CHIPS })
  })
})

describe('decidirObjetos — relato', () => {
  it('guarda el texto VERBATIM, sin tocarle nada', () => {
    const texto = '  Mi jefe me cambió el proyecto dos veces en la misma semana.  '
    const d = decidirObjetos(spec, ante('historia'), entrada(texto))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    // Solo se recortan los espacios de los extremos: ni resumen, ni tildes quitadas, ni
    // mayusculas tocadas.
    expect(d.respuesta).toEqual({ tipo: 'relato', texto: texto.trim(), deAudio: false })
  })

  it('una nota de voz transcrita queda MARCADA como tal', () => {
    // Una transcripcion no es el texto que la persona escribio.
    const d = decidirObjetos(spec, ante('historia'), entrada('me cambiaron el proyecto dos veces', { deAudio: true }))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.respuesta).toEqual({ tipo: 'relato', texto: 'me cambiaron el proyecto dos veces', deAudio: true })
  })

  it('un relato de una palabra: UNA repregunta suave, y queda anotada', () => {
    const d = decidirObjetos(spec, ante('historia'), entrada('mal'))
    expect(d?.tipo).toBe('repregunta')
    if (d?.tipo !== 'repregunta') return
    expect(d.pendiente.id).toBe('historia')
    expect(d.estado.repreguntados).toEqual(['historia'])
    expect(d.estado.paso).toBe(indiceDe('historia')) // no avanza
  })

  it('la repregunta es UNA sola vez: si insiste con poco, se acepta y sigue', () => {
    // Nunca se bloquea la secuencia por la longitud de una respuesta.
    const primera = decidirObjetos(spec, ante('historia'), entrada('mal'))
    expect(primera?.tipo).toBe('repregunta')
    if (primera?.tipo !== 'repregunta') return

    const segunda = decidirObjetos(spec, primera.estado, entrada('mal'))
    expect(segunda?.tipo).toBe('avanza')
    if (segunda?.tipo !== 'avanza') return
    expect(segunda.respuesta).toEqual({ tipo: 'relato', texto: 'mal', deAudio: false })
    expect(segunda.siguiente.id).toBe('quien_decidio')
  })

  it('un mensaje vacio en un relato no avanza ni se guarda', () => {
    expect(decidirObjetos(spec, ante('historia'), entrada('   '))?.tipo).toBe('no_entendido')
  })

  it('un reparto de un link viejo NO se guarda como el relato', () => {
    // Si `parsearListo` no corriera ANTES de la rama del paso pendiente, este mensaje
    // quedaria archivado como la historia que conto la persona.
    const d = decidirObjetos(spec, ante('historia'), entrada('Listo quien_decidio 60-20-20'))
    expect(d?.tipo).toBe('fuera_de_secuencia')
    if (d?.tipo !== 'fuera_de_secuencia') return
    expect(d.paso.id).toBe('quien_decidio')
    expect(d.pendiente.id).toBe('historia')   // sigue esperando la historia
  })
})

describe('decidirObjetos — reparto', () => {
  it('el reparto esperado avanza un paso y deja el siguiente listo', () => {
    const d = decidirObjetos(spec, ante('quien_decidio'), entrada('Listo quien_decidio 60-20-20'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.respuesta).toEqual({ tipo: 'reparto', reparto: { objeto: 'quien_decidio', porcentajes: [60, 20, 20] } })
    expect(d.siguiente.id).toBe('sentia_vs_esperaban')
    expect(d.estado.recibidos).toEqual(['quien_decidio'])
  })

  it('en un paso de reparto, un texto cualquiera reenvia el boton', () => {
    const d = decidirObjetos(spec, ante('quien_decidio'), entrada('ya lo hice'))
    expect(d).toEqual({ tipo: 'no_entendido', pendiente: QUIEN })
  })

  it('un `Listo` de algo que no es un reparto de este instrumento no se adivina', () => {
    expect(decidirObjetos(spec, ante('quien_decidio'), entrada('Listo historia 50-50'))?.tipo).toBe('no_entendido')
  })

  it('numeros de mas o de menos: no se registra un vector de largo equivocado', () => {
    // `quien_decidio` tiene 3 opciones. Un mensaje mutilado trae 2.
    expect(decidirObjetos(spec, ante('quien_decidio'), entrada('Listo quien_decidio 60-40'))?.tipo).toBe('no_entendido')
    expect(decidirObjetos(spec, ante('quien_decidio'), entrada('Listo quien_decidio 25-25-25-25'))?.tipo).toBe('no_entendido')
  })

  it('reintento del mismo reparto: registra, NO avanza dos pasos', () => {
    const primera = decidirObjetos(spec, ante('quien_decidio'), entrada('Listo quien_decidio 60-20-20'))
    expect(primera?.tipo).toBe('avanza')
    if (primera?.tipo !== 'avanza') return

    // La persona vuelve a mandar el mismo mensaje (reenvio, o toco dos veces el enlace).
    const segunda = decidirObjetos(spec, primera.estado, entrada('Listo quien_decidio 60-20-20'))
    expect(segunda?.tipo).toBe('fuera_de_secuencia')
    if (segunda?.tipo !== 'fuera_de_secuencia') return
    expect(segunda.repetido).toBe(true)
    expect(segunda.pendiente.id).toBe('sentia_vs_esperaban')
  })

  it('un link viejo registra pero NO retrocede la secuencia', () => {
    // Va en `semana` y le llega el reparto de `quien_decidio`, reabierto desde el chat.
    const estado = ante('semana', ['antiguedad', 'historia', 'quien_decidio', 'sentia_vs_esperaban'])
    const d = decidirObjetos(spec, estado, entrada('Listo quien_decidio 10-10-80'))
    expect(d?.tipo).toBe('fuera_de_secuencia')
    if (d?.tipo !== 'fuera_de_secuencia') return
    expect(d.paso.id).toBe('quien_decidio')            // el registro vale
    expect(d.reparto.porcentajes).toEqual([10, 10, 80])
    expect(d.pendiente.id).toBe('semana')              // y la secuencia se queda donde iba
  })

  it('un reparto posterior adelantado tambien registra sin mover el pendiente', () => {
    const d = decidirObjetos(spec, ante('quien_decidio'), entrada('Listo semana 2-2-2-2-2'))
    expect(d?.tipo).toBe('fuera_de_secuencia')
    if (d?.tipo !== 'fuera_de_secuencia') return
    expect(d.repetido).toBe(false)
    expect(d.pendiente.id).toBe('quien_decidio')
  })
})

describe('decidirObjetos — cierre y bordes', () => {
  it('el ultimo paso cierra la secuencia', () => {
    const d = decidirObjetos(spec, ante('cierre_narrativo'), entrada('Cambiaría haber hablado antes con mi jefe.'))
    expect(d?.tipo).toBe('cierra')
    if (d?.tipo !== 'cierra') return
    expect(d.estado.paso).toBe(spec.pasos.length)
    expect(pasoPendiente(spec, d.estado)).toBe(null)
  })

  it('la entrevista completa se recorre de punta a punta', () => {
    let estado = estadoInicialObjetos(ESTUDIO)
    const turnos: Array<[string, 'avanza' | 'cierra']> = [
      ['2', 'avanza'],                                                  // antiguedad
      ['Mi jefe me cambio el proyecto dos veces', 'avanza'],            // historia
      ['Listo quien_decidio 60-20-20', 'avanza'],
      ['Listo sentia vs esperaban 70-30', 'avanza'],
      ['Listo semana 4/2/1/2/1', 'avanza'],
      ['Listo preocupaciones 20-20-20-10-10-10-5-5', 'avanza'],
      ['Cambiaria haber hablado antes', 'cierra'],                      // cierre_narrativo
    ]
    for (const [texto, esperado] of turnos) {
      const d = decidirObjetos(spec, estado, entrada(texto))
      expect(d?.tipo, texto).toBe(esperado)
      if (d?.tipo === 'avanza' || d?.tipo === 'cierra') estado = d.estado
    }
    expect(estado.recibidos).toEqual([
      'antiguedad', 'historia', 'quien_decidio', 'sentia_vs_esperaban', 'semana',
      'preocupaciones', 'cierre_narrativo',
    ])
  })

  it('secuencia agotada con la sesion abierta: null (el flujo la cierra)', () => {
    expect(decidirObjetos(spec, estadoEn(spec.pasos.length), entrada('Listo semana 2-2-2-2-2'))).toBe(null)
  })

  it('un paso corrupto en el estado se trata como el primero, no revienta', () => {
    // `paso: -3` se trata como 0, que en este guion es un `bot`: el tramo inicial se dice y
    // la respuesta la contesta `antiguedad`.
    const d = decidirObjetos(spec, { ...ante('antiguedad'), paso: -3 }, entrada('1'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.paso.id).toBe('antiguedad')
    expect(d.estado.paso).toBe(indiceDe('historia'))
  })
})

// ---------------------------------------------------------------------------------------
// Los `bot`: texto del instrumento que el bot DICE y no espera respuesta.
//
// No son cortesia. "Yo no la interpreto" es la regla bajo la que la persona responde, "si
// subes uno, los demas ceden" es la instruccion de uso del objeto, y "Ahora salgamos de esa
// historia y hablemos de tu semana" es un CAMBIO DE MARCO: los tres repartos anteriores son
// sobre la situacion difIcil y `semana` es sobre la semana en general. Sin esa frase el dato
// de `semana` queda contaminado. Lo que estas pruebas protegen es que ninguno se PIERDA.
// ---------------------------------------------------------------------------------------

describe('pasos `bot`', () => {
  it('un `bot` sin texto invalida el spec', () => {
    for (const paso of [{ tipo: 'bot' }, { tipo: 'bot', texto: '  ' }]) {
      expect(leerSpecObjetos({ base_url: 'https://x.co', pasos: [paso, { tipo: 'relato', id: 'h', pregunta: 'x' }] }), JSON.stringify(paso)).toBe(null)
    }
  })

  it('tramoDesde: el tramo de apertura trae los dos `bot` y aterriza en el primer paso que espera', () => {
    const t = tramoDesde(spec, estadoInicialObjetos(ESTUDIO))
    expect(t.textos).toEqual([BOT_SALUDO, BOT_METODO])
    expect(t.paso?.id).toBe('antiguedad')
    // El estado queda apuntando al paso que espera, nunca a un `bot`.
    expect(t.estado.paso).toBe(indiceDe('antiguedad'))
  })

  it('tramoDesde no inventa textos donde no hay `bot`', () => {
    const t = tramoDesde(spec, ante('quien_decidio'))
    expect(t.textos).toEqual([])
    expect(t.paso?.id).toBe('quien_decidio')
  })

  it('la instruccion del objeto viaja al avanzar desde la historia', () => {
    const d = decidirObjetos(spec, ante('historia'), entrada('Mi jefe me cambio el proyecto dos veces'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.textos).toEqual([BOT_REGLA_OBJETO])
    expect(d.siguiente.id).toBe('quien_decidio')
  })

  it('EL CAMBIO DE MARCO viaja al pasar de la situacion a la semana', () => {
    // Es el caso que mas importa: sin este texto la persona sigue contestando `semana` sobre
    // la situacion puntual y el dato queda contaminado. Error de medicion, no estetica.
    const d = decidirObjetos(spec, ante('sentia_vs_esperaban'), entrada('Listo sentia_vs_esperaban 70-30'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.textos).toEqual([BOT_CAMBIO_DE_MARCO])
    expect(d.siguiente.id).toBe('semana')
  })

  it('entre dos repartos seguidos no hay texto que decir', () => {
    const d = decidirObjetos(spec, ante('quien_decidio'), entrada('Listo quien_decidio 60-20-20'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.textos).toEqual([])
  })

  it('NINGUN `bot` del guion se pierde ni se repite al recorrer la entrevista entera', () => {
    // La prueba de verdad: se recoge todo el texto que el flujo llegaria a enviar (el tramo de
    // apertura mas el de cada avance) y se compara con los `bot` del spec, en orden.
    const dichos: string[] = [...tramoDesde(spec, estadoInicialObjetos(ESTUDIO)).textos]
    let estado = tramoDesde(spec, estadoInicialObjetos(ESTUDIO)).estado
    const turnos = [
      '2',
      'Mi jefe me cambio el proyecto dos veces',
      'Listo quien_decidio 60-20-20',
      'Listo sentia vs esperaban 70-30',
      'Listo semana 4/2/1/2/1',
      'Listo preocupaciones 20-20-20-10-10-10-5-5',
      'Cambiaria haber hablado antes',
    ]
    for (const texto of turnos) {
      const d = decidirObjetos(spec, estado, entrada(texto))
      expect(d?.tipo, texto).toMatch(/^(avanza|cierra)$/)
      if (d?.tipo !== 'avanza' && d?.tipo !== 'cierra') return
      dichos.push(...d.textos)
      estado = d.estado
    }

    const delSpec = spec.pasos.filter((p) => p.tipo === 'bot').map((p) => (p as { texto: string }).texto)
    expect(dichos).toEqual(delSpec)
    expect(dichos).toEqual([BOT_SALUDO, BOT_METODO, BOT_REGLA_OBJETO, BOT_CAMBIO_DE_MARCO])
  })

  it('un guion que TERMINA en `bot` manda ese texto antes del cierre', () => {
    const s2 = leerSpecObjetos({
      base_url: 'https://x.co/a',
      pasos: [
        { tipo: 'relato', id: 'historia', pregunta: '¿Qué pasó?' },
        { tipo: 'bot', texto: 'Eso era todo lo que te quería preguntar.' },
      ],
    }) as SpecObjetos
    const d = decidirObjetos(s2, { modo: MODO_OBJETOS, study_id: 'x', paso: 0, recibidos: [] }, entrada('me fue bastante mal'))
    expect(d?.tipo).toBe('cierra')
    if (d?.tipo !== 'cierra') return
    expect(d.textos).toEqual(['Eso era todo lo que te quería preguntar.'])
  })

  it('un estado que quedo apuntando a un `bot` no traba la secuencia', () => {
    // Pasa si el spec se edita a mitad de una entrevista. `pasoPendiente` salta el `bot` para
    // encontrar a quien preguntar, y el avance se cuenta desde el paso RESPONDIDO: si se
    // contara desde `estado.paso`, la secuencia se quedaria un paso atras repitiendo texto.
    const estado = estadoEn(indiceDe('bot_7'), ['quien_decidio'])
    expect(pasoPendiente(spec, estado)?.id).toBe('semana')
    const d = decidirObjetos(spec, estado, entrada('Listo semana 2-2-2-2-2'))
    expect(d?.tipo).toBe('avanza')
    if (d?.tipo !== 'avanza') return
    expect(d.siguiente.id).toBe('preocupaciones')
    expect(d.textos).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------
// urlDelObjeto
// ---------------------------------------------------------------------------------------

describe('urlDelObjeto', () => {
  it('lleva obj, e, p y wa', () => {
    expect(urlDelObjeto('https://reframeit.metrik.com.co/adultos', ESTUDIO, 'preocupaciones', '573159509103'))
      .toBe('https://reframeit.metrik.com.co/adultos?obj=preocupaciones&e=cardumen-objetos-adultos&p=573159509103&wa=573159509103')
  })

  it('`e` va explicito: sin el, el POST de la pagina cae bajo el slug del instrumento completo', () => {
    expect(urlDelObjeto('https://x.co/adultos', ESTUDIO, 'semana', '57315')).toContain(`&e=${ESTUDIO}&`)
  })

  it('respeta la query que ya traiga la base_url', () => {
    expect(urlDelObjeto('https://x.co/adultos?v=2', ESTUDIO, 'semana', '57315'))
      .toBe('https://x.co/adultos?v=2&obj=semana&e=cardumen-objetos-adultos&p=57315&wa=57315')
  })

  it('escapa el telefono: un + sin escapar se lee como espacio del otro lado', () => {
    expect(urlDelObjeto('https://x.co/a', ESTUDIO, 'semana', '+57 315')).toContain('p=%2B57%20315&wa=%2B57%20315')
  })
})

// ---------------------------------------------------------------------------------------
// Catalogo y registro (cliente falso, mismo patron que miniweb.test.ts)
// ---------------------------------------------------------------------------------------

type Fila = Record<string, unknown>

function clienteFalso(opts: {
  triggers?: Fila[]
  estudios?: Fila[]
  respuestas?: Fila[]
  errorTrigger?: string
  errorRespuestas?: string
  insertados?: Fila[]
}) {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      const fuente = () => {
        if (tabla === 'cardumen_estudio_triggers') return opts.triggers ?? []
        if (tabla === 'cardumen_estudios') return opts.estudios ?? []
        return opts.respuestas ?? []
      }
      const q = {
        select() { return q },
        eq(col: string, val: unknown) {
          // `payload->>objeto` es la ruta con la que PostgREST filtra dentro del jsonb.
          if (col === 'payload->>objeto') {
            filtros.push((f) => (f.payload as Fila | undefined)?.objeto === val)
          } else {
            filtros.push((f) => f[col] === val)
          }
          return q
        },
        limit() {
          if (tabla === 'cardumen_respuestas' && opts.errorRespuestas) {
            return Promise.resolve({ data: null, error: { message: opts.errorRespuestas } })
          }
          return Promise.resolve({ data: fuente().filter((f) => filtros.every((p) => p(f))), error: null })
        },
        maybeSingle() {
          if (tabla === 'cardumen_estudio_triggers' && opts.errorTrigger) {
            return Promise.resolve({ data: null, error: { message: opts.errorTrigger } })
          }
          return Promise.resolve({ data: fuente().find((f) => filtros.every((p) => p(f))) ?? null, error: null })
        },
        insert(fila: Fila) {
          opts.insertados?.push(fila)
          return Promise.resolve({ data: null, error: null })
        },
      }
      return q
    },
  }
}

const FILA_ADULTOS = {
  estudio: ESTUDIO,
  nombre: 'Cardumen — entrevista por WhatsApp, adultos (piloto)',
  modo: MODO_OBJETOS,
  spec: SPEC_CRUDO,
  url: null,
  activo: true,
}

const catalogo = (estudios: Fila[] = [FILA_ADULTOS], extra: Partial<Parameters<typeof clienteFalso>[0]> = {}) =>
  clienteFalso({
    triggers: [
      { palabra: 'objetos adultos', estudio: ESTUDIO },
      { palabra: 'objetosadultos', estudio: ESTUDIO },
      // Las palabras vivas: `cardumen` es la demo de chat y `cardumen adultos` el
      // instrumento completo en modo miniweb. Ninguna la puede atender este bloque.
      { palabra: 'cardumen', estudio: 'navigate' },
      { palabra: 'cardumen adultos', estudio: 'cardumen-instrumento-adultos' },
    ],
    estudios: [
      ...estudios,
      { estudio: 'navigate', nombre: 'Navigate', modo: 'chat', spec: SPEC_CRUDO, url: null, activo: true },
      // La fila de miniweb lleva spec A PROPOSITO (en produccion es null): asi lo unico que
      // la mantiene fuera de este bloque es el `modo`.
      { estudio: 'cardumen-instrumento-adultos', nombre: 'Instrumento completo', modo: 'miniweb', spec: SPEC_CRUDO, url: 'https://reframeit.metrik.com.co/adultos', activo: true },
    ],
    ...extra,
  })

describe('resolverEstudioObjetosPorTrigger', () => {
  it('resuelve el estudio por su palabra y lee la secuencia', async () => {
    const r = await resolverEstudioObjetosPorTrigger(catalogo(), 'objetos adultos')
    expect(r?.estudio).toBe(ESTUDIO)
    expect(r?.spec.pasos).toHaveLength(11)
  })

  it('normaliza como el chat: mayusculas, espacios y puntuacion', async () => {
    for (const texto of ['  Objetos Adultos ', 'OBJETOS ADULTOS!', 'objetos adultos.']) {
      expect((await resolverEstudioObjetosPorTrigger(catalogo(), texto))?.estudio, texto).toBe(ESTUDIO)
    }
  })

  it('una fila de chat o de miniweb no la atiende el bloque de objetos', async () => {
    // Si esto deja de dar null, la demo viva de Grupo Progreso (`cardumen`) y el instrumento
    // completo que esta en evaluacion (`cardumen adultos`) cambian de conducta.
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), 'cardumen')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), 'cardumen adultos')).toBe(null)
  })

  it('palabra sin trigger, texto vacio, fila ausente o estudio apagado: null', async () => {
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), 'hola')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo(), '  ')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo([]), 'objetos adultos')).toBe(null)
    expect(await resolverEstudioObjetosPorTrigger(catalogo([{ ...FILA_ADULTOS, activo: false }]), 'objetos adultos')).toBe(null)
  })

  it('fila con spec inutilizable: null en vez de reventar el turno del webhook', async () => {
    expect(await resolverEstudioObjetosPorTrigger(catalogo([{ ...FILA_ADULTOS, spec: null }]), 'objetos adultos')).toBe(null)
  })

  it('un error de la consulta de triggers no tumba el webhook', async () => {
    const c = clienteFalso({ errorTrigger: '42703 column does not exist' })
    expect(await resolverEstudioObjetosPorTrigger(c, 'objetos adultos')).toBe(null)
  })
})

describe('cargarEstudioObjetos', () => {
  it('acepta la fila sembrada con base_url en el spec y url null', async () => {
    const r = await cargarEstudioObjetos(catalogo(), ESTUDIO)
    expect(r?.spec.base_url).toBe('https://reframeit.metrik.com.co/adultos')
  })
})

describe('hayRegistroDelObjeto', () => {
  const medido = { estudio: ESTUDIO, token: '57315', payload: { objeto: 'quien_decidio' } }

  it('ve la fila que dejo el POST de la pagina (ese es el vector autoritativo)', async () => {
    const c = clienteFalso({ respuestas: [medido] })
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57315', 'quien_decidio')).toBe(true)
  })

  it('no confunde otro paso, otro participante ni otro estudio', async () => {
    const c = clienteFalso({ respuestas: [medido] })
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57315', 'historia')).toBe(false)
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57999', 'quien_decidio')).toBe(false)
    expect(await hayRegistroDelObjeto(c, 'otro-estudio', '57315', 'quien_decidio')).toBe(false)
  })

  it('ante un error de la consulta dice que SI hay: un duplicado es peor que un hueco', async () => {
    // Si se guardara, el analisis tendria dos vectores del mismo paso sin saber cual es el
    // medido. Por eso el error se traduce en "no guardes".
    const c = clienteFalso({ errorRespuestas: '500' })
    expect(await hayRegistroDelObjeto(c, ESTUDIO, '57315', 'quien_decidio')).toBe(true)
  })
})

describe('guardarRespuestaDelPaso', () => {
  const guardar = async (paso: Parameters<typeof guardarRespuestaDelPaso>[3], respuesta: Parameters<typeof guardarRespuestaDelPaso>[4]) => {
    const insertados: Fila[] = []
    await guardarRespuestaDelPaso(clienteFalso({ insertados }), ESTUDIO, '57315', paso, respuesta)
    expect(insertados).toHaveLength(1)
    return insertados[0] as { estudio: string; token: string; payload: Fila }
  }

  it('reparto: marca el origen y la clave dice que NO es una medicion', async () => {
    const fila = await guardar(QUIEN, { tipo: 'reparto', reparto: { objeto: 'quien_decidio', porcentajes: [60, 20, 20] } })
    expect(fila.estudio).toBe(ESTUDIO)
    expect(fila.token).toBe('57315')
    expect(fila.payload.origen).toBe(ORIGEN_TEXTO)
    expect(fila.payload.modo).toBe('objeto_suelto')
    expect(fila.payload.objeto).toBe('quien_decidio')
    const r = fila.payload.respuesta as Fila
    expect(r.tipo).toBe('auto_significacion')
    expect(r.porcentajes).toEqual([60, 20, 20])
    // `vector_aproximado`, no `vector`: la clave tambien dice que no es una medicion.
    expect(r.vector_aproximado).toEqual([0.6, 0.2, 0.2])
    expect(r.vector).toBeUndefined()
  })

  it('relato: `micro_narrativa`, el texto crudo y el enunciado literal', async () => {
    const texto = 'Mi jefe me cambió el proyecto dos veces en la misma semana.'
    const fila = await guardar(HISTORIA, { tipo: 'relato', texto, deAudio: false })
    expect(fila.payload.origen).toBe(ORIGEN_WA)
    const r = fila.payload.respuesta as Fila
    expect(r.tipo).toBe('micro_narrativa')   // el tipo que usa el HTML del instrumento
    expect(r.texto).toBe(texto)              // VERBATIM
    expect(r.largo_caracteres).toBe(texto.length)
    expect(r.pregunta).toBe(HISTORIA.pregunta)
    expect(r.transcrito_de_audio).toBe(false)
    expect(r.audio).toBe(null)
  })

  it('relato de voz: la transcripcion queda dicha en la fila', async () => {
    const fila = await guardar(HISTORIA, { tipo: 'relato', texto: 'me cambiaron el proyecto', deAudio: true })
    const r = fila.payload.respuesta as Fila
    expect(r.transcrito_de_audio).toBe(true)
    expect(r.audio).toEqual({ origen: 'whatsapp_voz' })
  })

  it('opcion unica: `opcion_unica` con el literal del spec', async () => {
    const fila = await guardar(CHIPS, { tipo: 'chips', valor: '3 a 7 años' })
    expect(fila.payload.origen).toBe(ORIGEN_WA)
    const r = fila.payload.respuesta as Fila
    expect(r.tipo).toBe('opcion_unica')      // el tipo que usa el HTML del instrumento
    expect(r.valor).toBe('3 a 7 años')
    expect(r.pregunta).toBe(CHIPS.pregunta)
  })
})
