import { describe, expect, it } from 'vitest';

/**
 * Las reglas nuevas tras la prueba en vivo del 2026-10-01 (informe:
 * proyectos/trappvel/clarity/qa/bandeja-wa/vivo-2026-10-01.md), una por una y sin I/O. La secuencia
 * de punta a punta está en `wa-bandeja-vivo.test.ts`. Datos sintéticos.
 *
 * Mutaciones: ver el encabezado de `wa-bandeja-vivo.test.ts` y el informe del PR.
 */
import {
  CONFIG_BANDEJA_POR_DEFECTO,
  LLAVE_BANDEJA,
  decidirRuta,
  esCancelar,
  hayQueEsperarEnVuelo,
  leerConfigBandeja,
  momentoDelMensaje,
  ordenarPorEnvio,
  quitarPrefijoConsulta,
  salidaDeLaSesion,
} from './wa-bandeja-reglas';
import {
  conMesEnLaPregunta,
  edadesLegibles,
  fraseCierraMenores,
  leerEdades,
  nombreViajeNuevo,
  normalizarLugar,
  opcionPorCifra,
  pistasDelTexto,
  rangosDeDinero,
  resumenEntendido,
  validarSalida,
  type CampoEntendible,
} from './wa-entendimiento-reglas';
import {
  armarPlan,
  armarSegmentos,
  esRisa,
  esRuidoEscrito,
  nombreDeViaje,
  pareceRespuesta,
  partesResumenPlan,
  resolverEncabezado,
  respuestaAlEncabezado,
  type MensajeViaje,
  type ViajeAbierto,
} from './wa-viajes-reglas';

import { elegirFallida, leerReintentar, textoFallaEntendimiento, textoReintentarSinElegir, textoTandaDescartada } from './wa-bandeja-reglas';
import { interpretarRespuestaNegocio } from './wa-carga-reglas';
import { esSiNoCorto, interpretarRespuestaPlan } from './wa-viajes-reglas';

// ── A1 · ruteo ───────────────────────────────────────────────────────────────

describe('A1 · con la bandeja encendida, manda la bandeja', () => {
  const ruta = (p: Partial<Parameters<typeof decidirRuta>[0]>) => decidirRuta({
    modules: { [LLAVE_BANDEJA]: true }, config: CONFIG_BANDEJA_POR_DEFECTO, tipo: 'text', texto: 'Hola, queremos ir a Cartagena',
    reenviado: false, sesionBotEsperando: false, ...p,
  });

  it('todo lo escrito va a la bandeja: con o sin tanda, una pregunta, un «listo», un «cancelar» sin sesión', () => {
    for (const texto of ['Hola, queremos ir a Cartagena', '¿cuánto vendimos en septiembre?', 'listo', 'cancelar', 'ok gracias', 'nuevo Laura']) {
      expect(ruta({ texto }), texto).toBe('bandeja');
    }
  });

  it('las dos excepciones: un prefijo del bot («gasto», «bot») y una conversación del bot a medias', () => {
    expect(ruta({ texto: 'gasto 20000 taxi' })).toBe('bot');
    expect(ruta({ texto: 'bot ¿cuánto vendimos en septiembre?' })).toBe('bot');
    expect(ruta({ texto: 'Bot: cartera' })).toBe('bot');
    expect(ruta({ texto: 'bote para Cartagena' })).toBe('bandeja');
    expect(ruta({ sesionBotEsperando: true, texto: 'taxi' })).toBe('bot');
    expect(ruta({ sesionBotEsperando: true, tipo: 'image', texto: '' })).toBe('bot');
  });

  it('aun con la conversación a medias, «cancelar» o un encabezado la cortan', () => {
    expect(ruta({ sesionBotEsperando: true, texto: 'cancelar', salidaDeSesion: 'cancelar' })).toBe('bandeja');
    expect(ruta({ sesionBotEsperando: true, texto: 'nuevo Sofía', salidaDeSesion: 'encabezado' })).toBe('bandeja');
  });

  it('qué corta la conversación: «cancelar» solo, un encabezado por nombre, un código salvo cuando el bot espera un código', () => {
    expect(salidaDeLaSesion({ texto: 'Cancelar', encabezado: null, estadoSesion: 'awaiting_image' })).toBe('cancelar');
    expect(salidaDeLaSesion({ texto: 'cancelar el gasto', encabezado: null, estadoSesion: 'awaiting_image' })).toBeNull();
    expect(salidaDeLaSesion({ texto: 'nuevo Sofía', encabezado: 'nombre', estadoSesion: 'awaiting_selection' })).toBe('encabezado');
    expect(salidaDeLaSesion({ texto: 'D 26 1', encabezado: 'codigo', estadoSesion: 'awaiting_selection' })).toBeNull();
    expect(salidaDeLaSesion({ texto: 'D 26 1', encabezado: 'codigo', estadoSesion: 'awaiting_image' })).toBe('encabezado');
    expect(salidaDeLaSesion({ texto: 'listo', encabezado: null, estadoSesion: 'awaiting_selection' })).toBeNull();
    expect([esCancelar('¡Cancelar!'), esCancelar('salir'), esCancelar('cancelado')]).toEqual([true, true, false]);
  });

  it('el prefijo de consulta es configurable, se suma a los del bot y se quita antes de que el bot lea', () => {
    expect(CONFIG_BANDEJA_POR_DEFECTO.prefijosBot).toEqual(['gasto', 'bot']);
    const c = leerConfigBandeja({ bandeja_solicitudes: { prefijos_bot: ['gasto'], prefijos_consulta: ['one'] } });
    expect([c.prefijosBot, c.prefijosConsulta]).toEqual([['gasto', 'one'], ['one']]);
    expect(quitarPrefijoConsulta('bot ¿cuánto vendimos?', ['bot'])).toBe('¿cuánto vendimos?');
    expect(quitarPrefijoConsulta('Bot: cartera de octubre', ['bot'])).toBe('cartera de octubre');
    expect(quitarPrefijoConsulta('gasto 20000 taxi', ['bot'])).toBeNull();
    expect(quitarPrefijoConsulta('bot', ['bot'])).toBeNull();
  });

  it('se espera a los mensajes en camino solo con un cierre, o con un escrito sin forma de respuesta y una pregunta pendiente', () => {
    const base = { escrito: true, esEncabezado: false, esCierre: false, hayAbierta: false, hayPregunta: true, pareceRespuesta: false };
    expect(hayQueEsperarEnVuelo(base)).toBe(true);
    expect(hayQueEsperarEnVuelo({ ...base, pareceRespuesta: true })).toBe(false);
    expect(hayQueEsperarEnVuelo({ ...base, hayPregunta: false })).toBe(false);
    expect(hayQueEsperarEnVuelo({ ...base, hayAbierta: true })).toBe(false);
    expect(hayQueEsperarEnVuelo({ ...base, esEncabezado: true })).toBe(false);
    expect(hayQueEsperarEnVuelo({ ...base, escrito: false })).toBe(false);
    expect(hayQueEsperarEnVuelo({ ...base, hayPregunta: false, hayAbierta: true, esCierre: true })).toBe(true);
  });

  it('forma de respuesta: sí/no, número, código, nuevo, celular, una corrección, algo corto; un pedido largo no', () => {
    for (const t of ['sí', 'Si', 'ok', '👍', 'no', '2', 'T1 26 9', 'NUEVO Marta Gómez', '300 555 1234', 'descartar', 'el 3 es de Luisa', 'dejar el 2', 'Laura Prueba']) {
      expect(pareceRespuesta(t), t).toBe(true);
    }
    for (const t of ['Hola, queremos ir a Cartagena del 12 al 16 de diciembre, somos 2 adultos y 1 niño de 7 años', 'Quiero un viaje para puntacana y curasao', 'somos 2 adultos y 1 niño de 7, del 12 al 16 de diciembre de 2026']) {
      expect(pareceRespuesta(t), t).toBe(false);
    }
  });

  it('el orden de la tanda es el de envío (hora de Meta) si es fresca; si no, el de llegada', () => {
    const enc = { id: 'enc', enviado_at: '2026-10-01T19:29:39Z', recibido_at: '2026-10-01T19:29:45Z' };
    const esc = { id: 'esc', enviado_at: '2026-10-01T19:29:42Z', recibido_at: '2026-10-01T19:29:43Z' };
    expect(ordenarPorEnvio([esc, enc]).map(m => m.id)).toEqual(['enc', 'esc']);
    // Una hora de Meta de hace días (un reenvío con la hora del original): manda la llegada.
    const viejo = { id: 'viejo', enviado_at: '2026-09-28T10:00:00Z', recibido_at: '2026-10-01T19:29:50Z' };
    expect(ordenarPorEnvio([viejo, enc]).map(m => m.id)).toEqual(['enc', 'viejo']);
    expect(momentoDelMensaje({ enviado_at: null, recibido_at: '2026-10-01T19:29:43Z' })).toBe(Date.parse('2026-10-01T19:29:43Z'));
  });
});

// ── A2 · ceros en menores ────────────────────────────────────────────────────

describe('A2 · un 0 en niños o infantes solo con una frase que lo cierre', () => {
  it.each([
    ['somos 4', 4], ['somos 2 adultos', 2], ['somos 3 adultos', 3], ['2 adultos', 2], ['somos dos', 2],
  ])('«%s» no cierra', (frase, adultos) => {
    expect(fraseCierraMenores(frase, adultos)).toBe(false);
  });
  it.each([
    ['sin niños', 2], ['solo adultos', 3], ['no van niños', 2], ['mi esposo y yo', 2], ['vamos los dos', 2],
  ])('«%s» cierra', (frase, adultos) => {
    expect(fraseCierraMenores(frase, adultos)).toBe(true);
  });

  it('«somos 4» con adultos = 4 no deduce ceros (escenario 4); «mi esposo y yo» sí', () => {
    const FIELDS = [
      { slug: 'adultos', tipo: 'numero', label: 'Adultos' }, { slug: 'ninos', tipo: 'numero', label: 'Niños' },
      { slug: 'infantes', tipo: 'numero', label: 'Infantes' },
    ] as CampoEntendible[];
    const con = (texto: string, frase: string, n: string) => validarSalida({ valores: { adultos: { valor: n, frase } } }, FIELDS, texto).sugeridos;
    expect(con('queremos ir a San Andrés en diciembre, somos 4', 'somos 4', '4')).not.toHaveProperty('ninos');
    expect(con('Queremos conocer Bariloche, somos 3 adultos', 'somos 3 adultos', '3')).not.toHaveProperty('infantes');
    expect(con('Mi esposo y yo, a Cartagena', 'Mi esposo y yo', '2')).toMatchObject({ ninos: { valor: 0 }, infantes: { valor: 0 } });
  });
});

// ── A4 · presupuesto en el borde ─────────────────────────────────────────────

describe('A4 · presupuesto en el borde de dos rangos', () => {
  const campo = (labels: string[]): CampoEntendible => ({
    slug: 'presupuesto', tipo: 'select', label: 'Presupuesto', nivel: 'deseable', pregunta: '¿Cuánto tienen pensado invertir?',
    opciones: labels.map((label, i) => ({ value: `o${i}`, label })),
  } as CampoEntendible);

  it('gana la etiqueta que INCLUYE la cifra como límite', () => {
    const hasta = rangosDeDinero(campo(['Hasta 8M', 'Más de 8M']))!;
    expect(opcionPorCifra(hasta, '8 millones en total')).toEqual({ valor: 'o0' });
    const desde = rangosDeDinero(campo(['Menos de 8M', '8M a 12M', 'Más de 12M']))!;
    expect(opcionPorCifra(desde, '8 millones en total')).toEqual({ valor: 'o1' });
    expect(opcionPorCifra(desde, 'unos 12 millones')).toEqual({ valor: 'o1' });
    expect(rangosDeDinero(campo(['Hasta $5 millones', 'Desde $5 millones']))).toEqual([
      { value: 'o0', min: -Infinity, max: 5, label: 'Hasta $5 millones' }, { value: 'o1', min: 5, max: Infinity, label: 'Desde $5 millones' },
    ]);
  });

  it('si las dos la incluyen, se pregunta el campo aunque sea deseable; si el negocio ya lo tiene, no', () => {
    const f = campo(['Entre $5 y $8 millones', 'Entre $8 y $12 millones']);
    const texto = 'El presupuesto es de unos 8 millones en total';
    const raw = { valores: { presupuesto: { valor: 'o0', frase: texto } } };
    const s = validarSalida(raw, [f], texto);
    expect(s.sugeridos.presupuesto).toBeUndefined();
    expect(s.descartados[0].pregunta).toBe('¿Cuánto tienen pensado invertir? (dijeron 8 millones: queda justo entre «Entre $5 y $8 millones» y «Entre $8 y $12 millones»)');
    expect(validarSalida(raw, [f], texto, { conocidos: { presupuesto: 'o1' } }).descartados[0].pregunta).toBeUndefined();
    // Una cifra que no cabe en ninguno no se pregunta por borde.
    expect(validarSalida({ valores: { presupuesto: { valor: 'o0', frase: 'unos 30 millones' } } }, [f], 'unos 30 millones').descartados[0].pregunta).toBeUndefined();
  });
});

// ── A5 · detalles ────────────────────────────────────────────────────────────

describe('A5 · lo que se le muestra al comercial', () => {
  it('las edades van con su etiqueta, y «1.5», «1,5» y «1 y medio» son año y medio', () => {
    expect(leerEdades('7, 1.5')).toEqual([7, 1.5]);
    expect(leerEdades('7 y 1 y medio')).toEqual([7, 1.5]);
    expect(leerEdades('1,5')).toEqual([1.5]);
    expect(leerEdades('9, 4')).toEqual([9, 4]);
    expect(edadesLegibles('7, 1.5')).toBe('niño: 7 años; bebé: 1,5 años');
    expect(edadesLegibles('9, 4')).toBe('niños: 9 y 4 años');
    expect(edadesLegibles('1')).toBe('bebé: 1 año');
    const FIELDS = [
      { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo' },
      { slug: 'edades_menores', tipo: 'texto', label: 'Edades de los niños e infantes', nivel: 'minimo' },
      { slug: 'acomodacion', tipo: 'texto', label: 'Acomodación', nivel: 'minimo' },
    ] as CampoEntendible[];
    expect(resumenEntendido(FIELDS, { adultos: 5, edades_menores: '7, 1.5', acomodacion: '2, 3' })).toBe('5 adultos, niño: 7 años; bebé: 1,5 años, acomodación: 2, 3');
    expect(resumenEntendido(FIELDS, { edades_menores: '8 meses' })).toBe('edades de los niños e infantes: 8 meses');
  });

  it('los lugares se escriben bien', () => {
    expect(normalizarLugar('PUNTACANA Y CURASAO')).toBe('Punta Cana y Curazao');
    expect(normalizarLugar('puntacana y curasao')).toBe('Punta Cana y Curazao');
    expect(normalizarLugar('san andres')).toBe('San Andrés');
    expect(normalizarLugar('Europa: MADRID, PARIS y roma')).toBe('Europa: Madrid, París y Roma');
    expect(normalizarLugar('villa del rosario')).toBe('Villa del Rosario');
    expect(normalizarLugar('Bogotá')).toBe('Bogotá');
  });

  it('la pregunta de la salida recuerda el mes que dijeron', () => {
    expect(conMesEnLaPregunta([{ slug: 'fecha_salida', pregunta: '¿Qué día salen?' }, { slug: 'adultos', pregunta: '¿Cuántos?' }], 11))
      .toEqual([{ slug: 'fecha_salida', pregunta: '¿Qué día salen? (dijeron diciembre)' }, { slug: 'adultos', pregunta: '¿Cuántos?' }]);
    expect(conMesEnLaPregunta([{ slug: 'fecha_salida', pregunta: '¿Qué día salen?' }], null)[0].pregunta).toBe('¿Qué día salen?');
  });

  it('las risas y los acuses: el resumen no numera risas; una tanda de solo acuses no se pregunta', () => {
    expect([esRisa('jajaja'), esRisa('😂😂'), esRisa('Jejeje'), esRisa('ok'), esRisa('jaja sí')]).toEqual([true, true, true, false, false]);
    expect([esRuidoEscrito('ok gracias'), esRuidoEscrito('👍'), esRuidoEscrito('hola'), esRuidoEscrito('2 adultos'), esRuidoEscrito('Bogotá')]).toEqual([true, true, true, false, false]);
  });
});

// ── B · los viajes se nombran como la agencia los recuerda ───────────────────

describe('B · el nombre del negocio', () => {
  const V: ViajeAbierto[] = [
    { id: 'n5', codigo: 'M1 26 5', cliente: 'CAROLINA RUIZ', destino: 'EUROPA', nombre: 'Europa 2 días' },
    { id: 'n4', codigo: 'M1 26 4', cliente: 'JUAN PRUEBA', destino: 'ARMENIA', nombre: 'ARMENIA 2N' },
    { id: 'n3', codigo: 'M1 26 3', cliente: 'PEDRO PRUEBA', destino: 'ARMENIA', nombre: 'ARMENIA 2N' },
    { id: 'l1', codigo: 'L 26 1', cliente: 'LAURA PRUEBA2', destino: 'CARTAGENA', nombre: 'CARTAGENA DIC 12-16' },
  ];

  it('formato: «nombre · cliente (código)»; el cliente no se repite si el nombre ya lo trae', () => {
    expect(nombreDeViaje(V[0])).toBe('Europa 2 días · Carolina Ruiz (M1 26 5)');
    expect(nombreDeViaje({ nombre: 'DIEGO PRUEBA2 · puntacana y curasao', cliente: 'DIEGO PRUEBA2', codigo: 'D 26 1' })).toBe('DIEGO PRUEBA2 · puntacana y curasao (D 26 1)');
    expect(nombreDeViaje({ nombre: null, cliente: 'Marta Gómez', codigo: 'T1 26 3' })).toBe('Marta Gómez (T1 26 3)');
    expect(nombreDeViaje({ nombre: 'Aruba', cliente: null, codigo: null })).toBe('Aruba');
  });

  it('el nombre como encabezado: exacto (sin tildes ni espacios) → viaje; repetido → pregunta cuál; aproximado → «¿Cambias a…?»', () => {
    expect(resolverEncabezado('europa 2 dias', V)).toMatchObject({ tipo: 'viaje', viaje: { id: 'n5' }, por: 'negocio' });
    expect(resolverEncabezado('Cartagena dic 12-16', V)).toMatchObject({ tipo: 'viaje', viaje: { id: 'l1' } });
    expect(resolverEncabezado('ARMENIA 2N', V)).toMatchObject({ tipo: 'ambiguo', candidatos: [{ id: 'n4' }, { id: 'n3' }] });
    expect(resolverEncabezado('Europa 2 dia', V)).toMatchObject({ tipo: 'aproximado', viaje: { id: 'n5' }, por: 'negocio' });
    expect(resolverEncabezado('M1 26 4', V)).toMatchObject({ tipo: 'viaje', viaje: { id: 'n4' }, por: 'codigo' });
    expect(respuestaAlEncabezado(resolverEncabezado('M1 26 4', V))).toBe('📌 ARMENIA 2N · Juan Prueba (M1 26 4)');
    expect(respuestaAlEncabezado(resolverEncabezado('ARMENIA 2N', V), 'ARMENIA 2N')).toBe(
      '¿Cuál viaje? «ARMENIA 2N» puede ser:\n- ARMENIA 2N · Juan Prueba (M1 26 4)\n- ARMENIA 2N · Pedro Prueba (M1 26 3)\nEscribe su código. Hasta entonces no asigno lo que sigue.',
    );
    // Un contenido corto que comparte palabras con un nombre largo no es encabezado.
    expect(resolverEncabezado('2 adultos', [{ id: 'p', codigo: 'P1 26 1', cliente: null, destino: null, nombre: 'PRUEBA Cancun 12-17 nov 2 adultos' }])).toBeNull();
  });

  it('error 6: «Lusia Prueba2» (apellido exacto, otro nombre de pila) pregunta en vez de escaparse', () => {
    expect(resolverEncabezado('Lusia Prueba2', V)).toMatchObject({ tipo: 'aproximado', viaje: { id: 'l1' }, por: 'apellido' });
    expect(resolverEncabezado('hola Prueba2', V)).toBeNull();
  });

  it('el nombre de un viaje nuevo: destino y mes o duración; sin destino, provisional', () => {
    expect(nombreViajeNuevo({ destino: 'Cartagena', salida: '2026-12-12', regreso: '2026-12-16' })).toEqual({ nombre: 'CARTAGENA DIC 12-16', provisional: false });
    expect(nombreViajeNuevo({ destino: 'Cartagena', salida: '2026-12-28', regreso: '2027-01-03' }).nombre).toBe('CARTAGENA DIC 28-ENE 3');
    expect(nombreViajeNuevo({ destino: 'san andres', mes: 11 }).nombre).toBe('SAN ANDRÉS DIC');
    expect(nombreViajeNuevo({ destino: 'Armenia', duracion: '2N' }).nombre).toBe('ARMENIA 2N');
    expect(nombreViajeNuevo({ destino: 'puntacana y curasao' }).nombre).toBe('PUNTA CANA Y CURAZAO');
    expect(nombreViajeNuevo({ cliente: 'LAURA PRUEBA' })).toEqual({ nombre: 'Viaje de Laura Prueba', provisional: true });
    expect(pistasDelTexto('queremos ir a San Andrés en diciembre, somos 4')).toEqual({ mes: 11, duracion: null });
    expect(pistasDelTexto('Europa 20 días en mayo')).toEqual({ mes: 4, duracion: '20D' });
    expect(pistasDelTexto('Armenia 2 noches')).toEqual({ mes: null, duracion: '2N' });
  });

  it('el resumen nombra cada viaje existente con el formato, y los ejemplos usan un número que está', () => {
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'Europa 2 días', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:00Z' },
      { n: 2, cuerpo: 'somos 2 adultos', reenviado: true, tipo: 'text', en: '2026-10-01T10:00:10Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, V, { horasCajaActiva: 4 });
    const texto = partesResumenPlan(armarPlan({ mensajes: ms, viajes: V, segmentos, encabezados }), ms).join('\n');
    expect(texto).toContain('1) Europa 2 días · Carolina Ruiz (M1 26 5) — 1 mensaje');
    expect(texto).toContain('corrige: «el 1 es de Luisa», «descartar el 1»');
  });

  it('error 11: tras un «no» a «¿Cambias a…?» sin nada después, no se pide «de qué viaje es»', () => {
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'Laura Prueva2', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:00Z' },
      { n: 2, cuerpo: 'no', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:05Z' },
      { n: 3, cuerpo: 'nuevo Pedro Prueba2', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:10Z' },
      { n: 4, cuerpo: 'queremos ir a San Andrés en diciembre, somos 4', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:15Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, V, { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes: V, segmentos, encabezados });
    expect(plan.avisos).toEqual([]);
  });
});

// ── Segunda vuelta en vivo (vivo-2026-10-01-v2.md) ───────────────────────────


describe('v2 · las respuestas', () => {
  it('«¿A qué viaje van?»: número, código, nombre del negocio o del cliente de la lista, NUEVO, DESCARTAR', () => {
    const ops = [
      { id: 'p', codigo: 'P 26 2', cliente: 'PEDRO PRUEBA5', destino: null, nombre: 'SAN ANDRÉS DIC' },
      { id: 'm', codigo: 'M 26 2', cliente: 'MATEO PRUEBA5', destino: null, nombre: 'BARILOCHE JUL 3-10' },
    ];
    expect(interpretarRespuestaNegocio('2', ops)).toEqual({ tipo: 'existente', negocio_id: 'm' });
    expect(interpretarRespuestaNegocio('p 26 2', ops)).toEqual({ tipo: 'existente', negocio_id: 'p' });
    expect(interpretarRespuestaNegocio('San Andrés dic', ops)).toEqual({ tipo: 'existente', negocio_id: 'p' });
    expect(interpretarRespuestaNegocio('Mateo Prueba5', ops)).toEqual({ tipo: 'existente', negocio_id: 'm' });
    expect(interpretarRespuestaNegocio('nuevo Valeria Prueba5', ops)).toEqual({ tipo: 'nuevo', cliente: 'Valeria Prueba5' });
    expect(interpretarRespuestaNegocio('DESCARTAR', ops)).toEqual({ tipo: 'descartar' });
    expect(interpretarRespuestaNegocio('sí', ops)).toEqual({ tipo: 'no_entendida' });
  });

  it('un «sí» o un «no» cortos: hasta cuatro palabras', () => {
    expect(['sí', 'no', 'Si', 'no señora', '👍', 'sí, así es'].map(esSiNoCorto)).toEqual([true, true, true, true, true, true]);
    expect(['sí pero falta la mamá', 'Lusia Prueba5', 'si claro que si vamos todos'].map(esSiNoCorto)).toEqual([false, false, false]);
  });

  it('«el N es de …» elige lo exacto del resumen antes que un viaje a un error de distancia', () => {
    const viajes: ViajeAbierto[] = [{ id: 'm2', codigo: 'M 26 1', cliente: 'MATEO PRUEBA2', destino: 'BARILOCHE', nombre: 'BARILOCHE JUL' }];
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'nuevo Mateo Prueba5', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:00Z' },
      { n: 2, cuerpo: 'Queremos conocer Bariloche', reenviado: true, tipo: 'text', en: '2026-10-01T10:00:05Z' },
      { n: 3, cuerpo: 'nuevo Andrea Prueba5', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:10Z' },
      { n: 4, cuerpo: 'Presupuesto 8 millones', reenviado: true, tipo: 'text', en: '2026-10-01T10:00:15Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, viajes, { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes, segmentos, encabezados });
    expect(interpretarRespuestaPlan('el 2 es de Mateo Prueba5', plan, viajes)).toEqual({ tipo: 'corregir', cambios: [{ ns: [4], a: { tipo: 'nuevo', cliente: 'Mateo Prueba5' } }] });
    expect(interpretarRespuestaPlan('el 2 es de BARILOCHE JUL', plan, viajes)).toMatchObject({ tipo: 'corregir', cambios: [{ a: { negocio_id: 'm2' } }] });
    expect(interpretarRespuestaPlan('el 2 es de M 26 1', plan, viajes)).toMatchObject({ tipo: 'corregir', cambios: [{ a: { negocio_id: 'm2' } }] });
    expect(interpretarRespuestaPlan('el 2 es de Mateo Prueba2', plan, viajes)).toMatchObject({ tipo: 'corregir', cambios: [{ a: { negocio_id: 'm2' } }] });
  });

  it('«el N es de …» prefiere el viaje que ya está en el resumen cuando el nombre se repite afuera', () => {
    const viajes: ViajeAbierto[] = [
      { id: 'm2', codigo: 'M 26 2', cliente: 'MATEO PRUEBA5', destino: 'BARILOCHE', nombre: 'BARILOCHE JUL 3-10' },
      { id: 'm9', codigo: 'M 26 9', cliente: 'MATEO PRUEBA5', destino: 'EUROPA', nombre: 'EUROPA 2 DÍAS' },
    ];
    const ms: MensajeViaje[] = [
      { n: 1, cuerpo: 'M 26 2', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:00Z' },
      { n: 2, cuerpo: 'Queremos conocer Bariloche', reenviado: true, tipo: 'text', en: '2026-10-01T10:00:05Z' },
      { n: 3, cuerpo: 'nuevo Andrea Prueba5', reenviado: false, tipo: 'text', en: '2026-10-01T10:00:10Z' },
      { n: 4, cuerpo: 'somos 3 adultos', reenviado: true, tipo: 'text', en: '2026-10-01T10:00:15Z' },
    ];
    const { segmentos, encabezados } = armarSegmentos(ms, viajes, { horasCajaActiva: 4 });
    const plan = armarPlan({ mensajes: ms, viajes, segmentos, encabezados });
    expect(interpretarRespuestaPlan('el 2 es de Mateo Prueba5', plan, viajes)).toMatchObject({ tipo: 'corregir', cambios: [{ ns: [4], a: { negocio_id: 'm2' } }] });
  });

  it('N5: «2 maletas grandes» nombra «Maleta de bodega» (singular o plural)', () => {
    const equipaje = { slug: 'equipaje', tipo: 'select', label: 'Equipaje', nivel: 'deseable', opciones: [
      { value: 'personal', label: 'Solo artículo personal' }, { value: 'mano', label: 'Maleta de mano' }, { value: 'bodega', label: 'Maleta de bodega' },
    ] } as CampoEntendible;
    const texto = 'Van a llevar 2 maletas grandes cada uno';
    expect(validarSalida({ valores: { equipaje: { valor: 'bodega', frase: texto } } }, [equipaje], texto).sugeridos).toEqual({ equipaje: { valor: 'bodega', frase: texto } });
    expect(validarSalida({ valores: { equipaje: { valor: 'personal', frase: texto } } }, [equipaje], texto).sugeridos).toEqual({});
  });
});

describe('v2 · fallas del entendimiento, REINTENTAR y «cancelar»', () => {
  it('los avisos', () => {
    expect(textoFallaEntendimiento('primero', 'Laura Prueba4', 'Laura Prueba4')).toBe('No pude procesar los mensajes de Laura Prueba4 por un problema técnico; los reintento solo.');
    expect(textoFallaEntendimiento('agotado', 'CARTAGENA DIC · Laura (L 26 3)', 'L 26 3')).toBe('No pude cargar CARTAGENA DIC · Laura (L 26 3). Los mensajes quedan guardados; escribe REINTENTAR L 26 3');
    expect(textoTandaDescartada('Laura Prueba5', 2)).toBe('Descarté la tanda de Laura Prueba5 (2 mensajes). No cargué nada.');
    expect(textoTandaDescartada('Tanda de las 18:51', 1)).toBe('Descarté la tanda de las 18:51 (1 mensaje). No cargué nada.');
  });

  it('REINTENTAR: la palabra, y cuál carga', () => {
    expect([leerReintentar('REINTENTAR L 26 3'), leerReintentar('reintentar'), leerReintentar('reintentarlo'), leerReintentar('hola')]).toEqual(['L 26 3', '', null, null]);
    const f = [{ id: 'a', referencias: ['CARTAGENA DIC 12-16 · Laura Prueba4 (L 26 3)', 'L 26 3'] }, { id: 'b', referencias: ['Diego Prueba4'] }];
    expect(elegirFallida('l 26 3', f)).toEqual({ tipo: 'una', id: 'a' });
    expect(elegirFallida('Diego Prueba4', f)).toEqual({ tipo: 'una', id: 'b' });
    expect(elegirFallida('laura', f)).toEqual({ tipo: 'una', id: 'a' });
    expect(elegirFallida('prueba4', f)).toEqual({ tipo: 'varias' });
    expect(elegirFallida('', f)).toEqual({ tipo: 'varias' });
    expect(elegirFallida('', [f[1]])).toEqual({ tipo: 'una', id: 'b' });
    expect(elegirFallida('Pedro', f)).toEqual({ tipo: 'ninguna' });
    expect(textoReintentarSinElegir('', [])).toBe('No tengo ninguna carga fallida para reintentar.');
  });
});
