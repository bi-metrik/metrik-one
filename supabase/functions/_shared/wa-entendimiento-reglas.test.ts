import { describe, expect, it } from 'vitest';
import {
  POR_DEFINIR,
  camposEntendibles,
  decidirContacto,
  esquemaDeSalida,
  fusionarSugeridos,
  huecos,
  interpretarRespuestaContacto,
  instruccionesEntendimiento,
  mayusculasDeViaje,
  mensajeAlComercial,
  resumenEntendido,
  aplicarSumas,
  conDeducciones,
  declaraNoDefinido,
  deducirCeros,
  diasNombrados,
  fechaDeViaje,
  fraseNombraElDia,
  fraseNombraNumero,
  leerEdades,
  textoPreguntaContacto,
  textoSaleDelMensaje,
  traePreferenciaConcreta,
  validarSalida,
  type CampoEntendible,
  type DecisionContacto,
} from './wa-entendimiento-reglas.ts';

// Config sintética con la forma de la solicitud de viaje (slugs y tipos, sin textos del cliente).
const FIELDS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde quieren viajar?' },
  { slug: 'destino_tipo', tipo: 'select', label: 'Alcance', opciones: [{ value: 'nacional' }, { value: 'internacional' }] },
  { slug: 'tipo_viaje', tipo: 'select', label: 'Tipo', nivel: 'deseable', opciones: [{ value: 'playa', label: 'Playa' }, { value: 'crucero' }] },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', no_cero: true, pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Viajan niños?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Viajan bebés?' },
  { slug: 'numero_pasajeros', tipo: 'numero', label: 'Pasajeros', suma_de: ['adultos', 'ninos', 'infantes'] },
  { slug: 'edades_menores', tipo: 'texto', label: 'Edades', nivel: 'minimo', pregunta: '¿Qué edad tiene cada niño?', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
  { slug: 'acomodacion', tipo: 'texto', label: 'Acomodación', nivel: 'deseable', pedir_si: { field: 'numero_pasajeros', al_menos: 6 } },
  { slug: 'permiso_salida_menores', tipo: 'select', label: 'Permiso', nivel: 'deseable', opciones: [{ value: 'tiene_permiso' }],
    pedir_si: [{ suma_de: ['ninos', 'infantes'], mayor_que: 0 }, { field: 'destino_tipo', value: 'internacional' }] },
  { slug: 'foto', tipo: 'imagen_clipboard', label: 'Foto' },
];

type PropValor = { properties: { valor: { enum?: string[] } } };
type Esquema = { properties: { valores: { properties: Record<string, PropValor>; required: string[] } } };
type Preguntar = Extract<DecisionContacto, { tipo: 'preguntar' }>;

const pd = { valor: POR_DEFINIR, frase: '' };
/** Salida del modelo con todo por definir salvo lo que se pase. */
function salida(valores: Record<string, { valor: string; frase: string }>, historia = 'Historia.') {
  const base: Record<string, unknown> = {};
  for (const f of camposEntendibles(FIELDS)) base[f.slug] = pd;
  return { historia, cliente: { nombre: '', telefono: '' }, valores: { ...base, ...valores } };
}

/** Lo que haría el paso completo con la salida: validar, sumar, huecos, mensaje. */
function procesar(texto: string, raw: unknown) {
  const s = validarSalida(raw, FIELDS, texto);
  const valores = aplicarSumas(FIELDS, Object.fromEntries(Object.entries(s.sugeridos).map(([k, v]) => [k, v.valor])));
  const h = huecos(FIELDS, valores);
  return { s, valores, h, msg: mensajeAlComercial({ resumen: resumenEntendido(FIELDS, valores), faltanMinimo: h.minimo.faltan, enlace: 'https://x/negocios/1' }) };
}

describe('el esquema sale de la config', () => {
  it('un objeto por campo entendible, vocabulario cerrado donde hay opciones', () => {
    const e = esquemaDeSalida(FIELDS) as Esquema;
    const props = e.properties.valores.properties;
    expect(Object.keys(props)).not.toContain('numero_pasajeros'); // derivado
    expect(Object.keys(props)).not.toContain('foto'); // no captura un dato del cliente
    expect(props.tipo_viaje.properties.valor.enum).toEqual(['playa', 'crucero', POR_DEFINIR]);
    expect(props.destino.properties.valor.enum).toBeUndefined();
    expect(e.properties.valores.required).toContain('edades_menores');
  });

  it('un campo nuevo en la config entra al esquema y a las instrucciones sin tocar código', () => {
    const con = [...FIELDS, { slug: 'motivo', tipo: 'texto', label: 'Motivo del viaje', nivel: 'deseable' } as CampoEntendible];
    expect(Object.keys((esquemaDeSalida(con) as Esquema).properties.valores.properties)).toContain('motivo');
    expect(instruccionesEntendimiento(con, '2026-09-28')).toContain('- motivo: Motivo del viaje');
  });

  it('las instrucciones piden «por definir», nunca «no»', () => {
    expect(instruccionesEntendimiento(FIELDS, '2026-09-28')).toContain(`valor = "${POR_DEFINIR}"`);
  });
});

describe('validar la salida del modelo', () => {
  const texto = 'Hola, somos 2 adultos para Punta Cana en noviembre';

  it('descarta lo que no tiene una frase del mensaje que lo sostenga', () => {
    const s = validarSalida(salida({
      destino: { valor: 'Punta Cana', frase: 'Punta Cana' },
      adultos: { valor: '2', frase: '2 adultos' },
      tipo_viaje: { valor: 'playa', frase: 'quieren playa' }, // no está en el texto
    }), FIELDS, texto);
    expect(Object.keys(s.sugeridos)).toEqual(['destino', 'adultos']);
    expect(s.sugeridos.adultos.valor).toBe(2);
    expect(s.descartados).toEqual([{ slug: 'tipo_viaje', motivo: 'sin frase del mensaje que lo sostenga' }]);
  });

  it('fuera de las opciones, fecha imposible o número raro: descartado', () => {
    const s = validarSalida(salida({
      tipo_viaje: { valor: 'montaña', frase: 'Punta Cana' },
      fecha_salida: { valor: '2026-11-31', frase: 'noviembre' },
      adultos: { valor: 'dos y medio', frase: '2 adultos' },
    }), FIELDS, texto);
    expect(s.sugeridos).toEqual({});
    expect(s.descartados.map(d => d.slug)).toEqual(['tipo_viaje', 'fecha_salida', 'adultos']);
  });

  it('una salida basura no rompe: todo queda por definir', () => {
    expect(validarSalida('no es json', FIELDS, texto).sugeridos).toEqual({});
    expect(validarSalida(null, FIELDS, texto).historia).toBe('');
  });
});

// Las tres entradas del encargo, con la salida que un modelo razonable devolvería.
describe('las tres entradas de prueba', () => {
  it('«Punta Cana, dos personas, noviembre»: faltan las fechas exactas', () => {
    const texto = 'Punta Cana, dos personas, noviembre';
    const r = procesar(texto, salida({
      destino: { valor: 'Punta Cana', frase: 'Punta Cana' },
      adultos: { valor: '2', frase: 'dos personas' },
    }));
    expect(r.h.minimo.faltan.map(f => f.slug)).toEqual(['fecha_salida', 'fecha_regreso', 'ninos', 'infantes']);
    // Máximo tres preguntas, en el orden de la config: las fechas van primero.
    expect(r.msg).toBe([
      'Entendí: Punta Cana, 2 adultos.',
      'Para empezar a cotizar me falta:',
      '1. ¿Qué día salen?',
      '2. ¿Qué día regresan?',
      '3. ¿Viajan niños?',
    ].join('\n'));
  });

  it('«17 adultos y 5 menores, destino de playa»: faltan destino, fechas y edades; acomodación y permiso son deseables', () => {
    const texto = 'Tatiana, somos 17 adultos y 5 menores y queremos un destino de playa, internacional';
    const r = procesar(texto, salida({
      adultos: { valor: '17', frase: '17 adultos' },
      ninos: { valor: '5', frase: '5 menores' },
      tipo_viaje: { valor: 'playa', frase: 'destino de playa' },
      destino_tipo: { valor: 'internacional', frase: 'internacional' },
    }));
    expect(r.valores.numero_pasajeros).toBe(22);
    expect(r.h.minimo.faltan.map(f => f.slug)).toEqual(['destino', 'fecha_salida', 'fecha_regreso', 'infantes', 'edades_menores']);
    expect(r.h.deseable.faltan.map(f => f.slug)).toEqual(['acomodacion', 'permiso_salida_menores']);
    expect(r.msg.split('\n').filter(l => /^\d\./.test(l))).toHaveLength(3);
    expect(r.msg).toContain('Entendí: 17 adultos, 5 niños.');
  });

  it('«2 pax Punta Cana del 15 al 20 de noviembre» (nota de voz): el rango da salida y regreso', () => {
    const texto = 'Tengo dos pasajeros para Punta Cana del 15 al 20 de noviembre';
    const r = procesar(texto, salida({
      destino: { valor: 'Punta Cana', frase: 'Punta Cana' },
      adultos: { valor: '2', frase: 'dos pasajeros' },
      fecha_salida: { valor: '2026-11-15', frase: 'del 15 al 20 de noviembre' },
      fecha_regreso: { valor: '2026-11-20', frase: 'del 15 al 20 de noviembre' },
    }));
    expect(r.msg.split('\n')[0]).toBe('Entendí: Punta Cana, 15-20 nov, 2 adultos.');
    expect(r.h.minimo.faltan.map(f => f.slug)).toEqual(['ninos', 'infantes']);
  });

  it('con el mínimo completo lo dice y manda el enlace', () => {
    const msg = mensajeAlComercial({ resumen: 'Madrid', faltanMinimo: [], enlace: 'https://t.metrikone.co/negocios/9' });
    expect(msg).toBe('Entendí: Madrid.\nYa está el mínimo para cotizar: https://t.metrikone.co/negocios/9');
  });
});

describe('fusionar sin pisar a una persona', () => {
  const meta = { entrega_id: 'e1', en: '2026-09-28T10:00:00Z' };
  const sug = { destino: { valor: 'Punta Cana', frase: 'Punta Cana' }, adultos: { valor: 2, frase: '2' }, ninos: { valor: 1, frase: '1 niño' } };

  it('escribe en vacío o sobre el default, y deja la marca con la frase', () => {
    const f = FIELDS.map(x => (x.slug === 'ninos' ? { ...x, default: 0 } : x));
    const r = fusionarSugeridos({ ninos: 0 }, f, sug, meta);
    expect(r.escritos).toEqual(['destino', 'adultos', 'ninos']);
    expect(r.data.ninos).toBe(1);
    expect((r.data._sugeridos as Record<string, unknown>).destino).toEqual({ fuente: 'whatsapp', entrega_id: 'e1', frase: 'Punta Cana', en: meta.en });
  });

  it('nunca pisa un valor escrito ni una corrección registrada', () => {
    const r = fusionarSugeridos({ destino: 'Cartagena', adultos: '', _ediciones: { adultos: { por_id: 's' } } }, FIELDS, sug, meta);
    expect(r.respetados).toEqual(['destino', 'adultos']);
    expect(r.data.destino).toBe('Cartagena');
    expect(Object.keys(r.data._sugeridos as object)).toEqual(['ninos']);
  });
});

describe('el contacto: exacto o se pregunta', () => {
  const ana = { id: 'a', nombre: 'ANA MARÍA PÉREZ', telefono: '+57 300 111 2233' };
  const ana2 = { id: 'b', nombre: 'Ana Maria Perez', telefono: null };
  const anaG = { id: 'c', nombre: 'ANA MARIA PEREZ GOMEZ', telefono: '3004445566' };

  it('uno por teléfono: se une', () => {
    const d = decidirContacto({ clienteTexto: 'Es Ana, 3001112233', extraido: { nombre: null, telefono: null }, candidatos: [ana, ana2, anaG] });
    expect(d).toMatchObject({ tipo: 'unico', por: 'telefono', contacto: { id: 'a' } });
  });

  it('uno con el nombre idéntico (sin tildes ni mayúsculas): se une', () => {
    const d = decidirContacto({ clienteTexto: 'Ana María Pérez Gómez', extraido: { nombre: null, telefono: null }, candidatos: [ana, anaG] });
    expect(d).toMatchObject({ tipo: 'unico', por: 'nombre', contacto: { id: 'c' } });
  });

  it('dos idénticos: pregunta con los dos', () => {
    const d = decidirContacto({ clienteTexto: 'ana maria perez', extraido: { nombre: null, telefono: null }, candidatos: [ana, ana2, anaG] });
    expect(d).toMatchObject({ tipo: 'preguntar', motivo: 'varios' });
    expect(d.tipo === 'preguntar' && d.opciones.map(o => o.id)).toEqual(['a', 'b']);
  });

  it('un parecido NUNCA une: se ofrece y se pregunta', () => {
    const d = decidirContacto({ clienteTexto: 'Ana Pérez', extraido: { nombre: null, telefono: null }, candidatos: [ana, anaG] });
    expect(d).toMatchObject({ tipo: 'preguntar', motivo: 'ninguno' });
    expect(d.tipo === 'preguntar' && d.opciones.map(o => o.id)).toEqual(['a', 'c']);
    expect(textoPreguntaContacto(d as Preguntar)).toContain('Responde con el número, o escribe NUEVO');
  });

  it('ninguno: pregunta sin lista', () => {
    const d = decidirContacto({ clienteTexto: 'Luis Gómez', extraido: { nombre: null, telefono: null }, candidatos: [] });
    expect(d).toMatchObject({ tipo: 'preguntar', motivo: 'ninguno', opciones: [] });
    expect(textoPreguntaContacto(d as Preguntar)).toContain('No encontré a «Luis Gómez» en el directorio.');
  });

  it('la respuesta: número de la lista, NUEVO, un celular, o no se entiende', () => {
    expect(interpretarRespuestaContacto(' 2 ', [ana, ana2])).toEqual({ tipo: 'elegido', contacto_id: 'b' });
    expect(interpretarRespuestaContacto('3', [ana, ana2])).toEqual({ tipo: 'no_entendida' });
    expect(interpretarRespuestaContacto('Nuevo', [])).toEqual({ tipo: 'nuevo', nombre: null });
    expect(interpretarRespuestaContacto('300 999 8877', [])).toEqual({ tipo: 'telefono', telefono: '3009998877' });
    expect(interpretarRespuestaContacto('la de siempre', [ana])).toEqual({ tipo: 'no_entendida' });
  });
});

describe('mayúsculas del bloque de viaje', () => {
  it('el texto sugerido entra en mayúscula, como lo guarda la pantalla; los correos no', () => {
    const r = mayusculasDeViaje(FIELDS, { destino: 'Punta Cana', edades_menores: 'a@b.co', adultos: 2 });
    expect(r).toEqual({ destino: 'PUNTA CANA', edades_menores: 'a@b.co', adultos: 2 });
    expect(mayusculasDeViaje([{ slug: 'destino', tipo: 'texto' }], { destino: 'x' })).toEqual({ destino: 'x' });
  });
});

// ── Correcciones del 2026-10-01 (simulación del chat de Punta Cana y QA sobre main) ─────────

describe('regla 1: un mes, una ventana, una duración o una fecha pasada no son una fecha', () => {
  const HOY = '2026-10-01';
  type V = { valor: string; frase: string };
  const fecha = (texto: string, sal: V, reg?: V, conocidos?: Record<string, unknown>) =>
    validarSalida(salida({ fecha_salida: sal, ...(reg ? { fecha_regreso: reg } : {}) }), FIELDS, texto, { hoyISO: HOY, conocidos });

  it('pasa: «del 15 al 20 de noviembre» da el 15 aunque el mes aparezca una sola vez', () => {
    const t = 'del 15 al 20 de noviembre';
    const s = fecha(t, { valor: '2026-11-15', frase: t }, { valor: '2026-11-20', frase: t });
    expect(s.sugeridos.fecha_salida.valor).toBe('2026-11-15');
    expect(s.sugeridos.fecha_regreso.valor).toBe('2026-11-20');
    expect(s.descartados).toEqual([]);
  });

  it('pasa: el día escrito con letras (transcripción de audio)', () => {
    const t = 'salimos el quince de diciembre y volvemos el treinta y uno';
    const s = fecha(t, { valor: '2026-12-15', frase: t }, { valor: '2026-12-31', frase: t });
    expect(Object.keys(s.sugeridos)).toEqual(['fecha_salida', 'fecha_regreso']);
  });

  it.each([
    ['«diciembre» → 1-dic', 'Queremos ir en diciembre', '2026-12-01'],
    ['«diciembre» → 31-dic', 'Queremos ir en diciembre', '2026-12-31'],
    ['«la segunda semana de enero»', 'la segunda semana de enero', '2027-01-08'],
    ['«en vacaciones»', 'en vacaciones de mitad de año', '2027-06-15'],
    ['«puente festivo del 12 de octubre» → 10-oct', 'el puente festivo del 12 de octubre', '2026-10-10'],
    ['una duración: «20 días en mayo»', 'queremos ir 20 días en mayo', '2027-05-20'],
    ['un plazo relativo: «en 15 días»', 'nos vamos en 15 días', '2026-10-16'],
    ['una duración con letras: «quince días»', 'unos quince días en enero', '2027-01-15'],
  ])('no pasa: %s', (_n, texto, valor) => {
    const s = fecha(texto, { valor, frase: texto });
    expect(s.sugeridos).toEqual({});
    expect(s.descartados[0].slug).toBe('fecha_salida');
    expect(s.descartados[0].motivo).toContain('un mes o una ventana no es una fecha');
  });

  it('una fecha pasada sin año en la frase se lleva a la próxima vez que ocurre', () => {
    const t = 'salimos el 5 de septiembre';
    expect(fecha(t, { valor: '2026-09-05', frase: t }).sugeridos.fecha_salida.valor).toBe('2027-09-05');
    // El modelo devolvió un año viejo («el 20 de diciembre» → 2024-12-20).
    const t2 = 'el 20 de diciembre';
    expect(fecha(t2, { valor: '2024-12-20', frase: t2 }).sugeridos.fecha_salida.valor).toBe('2026-12-20');
  });

  it('no pasa: una fecha pasada con el año dicho en la frase', () => {
    const t = 'viajamos el 20 de diciembre de 2024';
    const s = fecha(t, { valor: '2024-12-20', frase: t });
    expect(s.sugeridos).toEqual({});
    expect(s.descartados).toEqual([{ slug: 'fecha_salida', motivo: 'fecha pasada: 2024-12-20' }]);
  });

  it('no pasa: a más de 18 meses', () => {
    const t = 'el 10 de mayo de 2028';
    expect(fecha(t, { valor: '2028-05-10', frase: t }).descartados).toEqual([{ slug: 'fecha_salida', motivo: 'a más de 18 meses: 2028-05-10' }]);
    const t2 = 'el 10 de marzo de 2028';
    expect(fecha(t2, { valor: '2028-03-10', frase: t2 }).sugeridos.fecha_salida.valor).toBe('2028-03-10');
  });

  it('el regreso que cruza el año no es pasado: «del 27 de diciembre al 2 de enero»', () => {
    const t = 'Pensábamos del 27 de diciembre al 2 de enero';
    const s = fecha(t, { valor: '2026-12-27', frase: t }, { valor: '2026-01-02', frase: t });
    expect(s.sugeridos.fecha_regreso.valor).toBe('2027-01-02');
  });

  it('no pasa: un regreso antes de la salida, la de este mensaje o la que ya estaba', () => {
    // Mismo mes y antes del día de salida: es un error, no otro año.
    const t = 'salimos el 20 de diciembre y volvemos el 10 de diciembre';
    const s = fecha(t, { valor: '2026-12-20', frase: t }, { valor: '2026-12-10', frase: t });
    expect(s.sugeridos.fecha_regreso).toBeUndefined();
    expect(s.descartados).toEqual([{ slug: 'fecha_regreso', motivo: 'el regreso (2026-12-10) queda antes de la salida (2026-12-20)' }]);
    const t2 = 'volvemos el 10 de diciembre';
    const solo = validarSalida(salida({ fecha_regreso: { valor: '2026-12-10', frase: t2 } }), FIELDS, t2, { hoyISO: HOY, conocidos: { fecha_salida: '2026-12-20' } });
    expect(solo.sugeridos).toEqual({});
  });

  it('las instrucciones lo piden también al modelo', () => {
    const i = instruccionesEntendimiento(FIELDS, HOY);
    expect(i).toContain('Un mes («diciembre»)');
    expect(i).toContain('nunca pongas el primer o el último día del mes');
    expect(i).toContain('Una duración o un plazo');
  });
});

describe('regla 2: una opción «no definido» solo si el cliente lo dice', () => {
  const CAMPOS: CampoEntendible[] = [
    { slug: 'presupuesto', tipo: 'select', label: 'Presupuesto', opciones: [
      { value: '12m_20m', label: 'Entre $12 y $20 millones' },
      { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true },
    ] },
    { slug: 'categoria_hotel', tipo: 'select', label: 'Hotel', opciones: [
      { value: '4', label: '4 estrellas' }, { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true },
    ] },
  ];
  const leer = (texto: string, valores: Record<string, { valor: string; frase: string }>) =>
    validarSalida({ historia: '', valores }, CAMPOS, texto);

  it.each([
    ['«¿cuánto sale?» no es declarar presupuesto', 'Más o menos cuánto sale??'],
    ['una pregunta sin signo de cierre', '¿y el precio'],
    ['una frase sin negación ni indiferencia', 'queremos algo bonito'],
  ])('no pasa: %s', (_n, frase) => {
    const s = leer(frase, { presupuesto: { valor: 'sin_definir', frase } });
    expect(s.sugeridos).toEqual({});
    expect(s.descartados[0].motivo).toContain('«no definido» sin que el cliente lo diga');
  });

  it.each([
    ['«no tenemos presupuesto»', 'presupuesto', 'sin_definir', 'la verdad no tenemos presupuesto todavía'],
    ['«el que sea»', 'categoria_hotel', 'sin_preferencia', 'el hotel el que sea'],
    ['«nos da igual»', 'categoria_hotel', 'sin_preferencia', 'de hotel nos da igual'],
    ['«lo que tú nos recomiendes»', 'categoria_hotel', 'sin_preferencia', 'lo que tú nos recomiendes'],
  ])('pasa: %s', (_n, slug, valor, frase) => {
    expect(leer(frase, { [slug]: { valor, frase } }).sugeridos[slug]?.valor).toBe(valor);
  });

  it('una opción normal no pide declaración, y sin la marca en la config todo sigue como antes', () => {
    expect(leer('unos quince millones', { presupuesto: { valor: '12m_20m', frase: 'unos quince millones' } }).sugeridos.presupuesto.valor).toBe('12m_20m');
    const sinMarca = CAMPOS.map(c => ({ ...c, opciones: c.opciones!.map(o => ({ value: o.value, label: o.label })) }));
    expect(validarSalida({ valores: { presupuesto: { valor: 'sin_definir', frase: 'cuánto sale?' } } }, sinMarca, 'cuánto sale?').sugeridos.presupuesto.valor).toBe('sin_definir');
  });

  it('el modelo ve qué opción es de este tipo', () => {
    expect(instruccionesEntendimiento(CAMPOS, '2026-10-01')).toContain('sin_definir (Aún no tiene presupuesto definido; solo si el cliente lo dice)');
    expect(declaraNoDefinido('¿no tienen algo más barato?')).toBe(false);
  });
});

describe('regla 3: el mínimo tiene que poder cerrarse (infantes deducido)', () => {
  it('pasa: 2 niños de 9 y 4 años → infantes 0 sugerido, con la deducción anotada', () => {
    expect(deducirCeros(FIELDS, { ninos: 2, edades_menores: '9, 4' })).toEqual({
      infantes: { valor: 0, frase: '', deduccion: 'Edades 9, 4: ninguno de los 2 niños es menor de 2 años' },
    });
    expect(deducirCeros(FIELDS, { ninos: '1', edades_menores: '7 AÑOS' }).infantes.deduccion).toBe('Edades 7: el niño no es menor de 2 años');
  });

  it.each([
    ['«somos 4» sin edades', { adultos: 2, ninos: 2 }],
    ['menos edades que niños', { ninos: 3, edades_menores: '9 y 4' }],
    ['alguno menor de 2 años', { ninos: 2, edades_menores: '9 y 1' }],
    ['edades en meses', { ninos: 2, edades_menores: '9 años y 8 meses' }],
    ['edades con letras (no se adivina)', { ninos: 2, edades_menores: 'nueve y cuatro' }],
    ['infantes ya tiene valor', { ninos: 2, edades_menores: '9, 4', infantes: 1 }],
    ['sin niños', { ninos: 0, edades_menores: '' }],
  ])('no pasa: %s', (_n, valores) => {
    expect(deducirCeros(FIELDS, valores as Record<string, unknown>)).toEqual({});
  });

  it('sin los campos del bloque de viaje no deduce nada', () => {
    expect(deducirCeros(FIELDS.filter(f => f.slug !== 'edades_menores'), { ninos: 2, edades_menores: '9, 4' })).toEqual({});
  });

  it('en un negocio nuevo entra como un sugerido más y cierra el mínimo', () => {
    const texto = 'Somos 2 adultos y 2 niños de 9 y 4 años, a Madrid del 15 al 20 de noviembre';
    const s = validarSalida(salida({
      destino: { valor: 'Madrid', frase: 'a Madrid' },
      fecha_salida: { valor: '2026-11-15', frase: 'del 15 al 20 de noviembre' },
      fecha_regreso: { valor: '2026-11-20', frase: 'del 15 al 20 de noviembre' },
      adultos: { valor: '2', frase: '2 adultos' },
      ninos: { valor: '2', frase: '2 niños' },
      edades_menores: { valor: '9, 4', frase: 'de 9 y 4 años' },
    }), FIELDS, texto, { hoyISO: '2026-10-01' });
    const sug = conDeducciones(FIELDS, s.sugeridos);
    expect(sug.infantes).toMatchObject({ valor: 0, frase: '' });
    const valores = aplicarSumas(FIELDS, Object.fromEntries(Object.entries(sug).map(([k, v]) => [k, v.valor])));
    expect(huecos(FIELDS, valores).minimo.faltan).toEqual([]);
    const r = fusionarSugeridos({}, FIELDS, sug, { entrega_id: 'e1', en: 'x' });
    expect((r.data._sugeridos as Record<string, { deduccion?: string }>).infantes.deduccion).toContain('Edades 9, 4');
  });

  it('un 0 del modelo sí necesita frase; el prompt ya no enseña a deducir 0 bebés de «los dos niños»', () => {
    const i = instruccionesEntendimiento(FIELDS, '2026-10-01');
    expect(i).not.toContain('da 0 bebés');
    expect(i).toContain('No pongas 0 en niños ni en bebés salvo que el mensaje lo diga');
    expect(validarSalida(salida({ ninos: { valor: '0', frase: '' } }), FIELDS, 'somos 4').sugeridos).toEqual({});
  });
});

describe('QA de #969 · 3: el 0 en niños o bebés solo si la frase cierra quiénes viajan', () => {
  const leer = (texto: string, valores: Record<string, { valor: string; frase: string }>) =>
    validarSalida(salida(valores), FIELDS, texto, { hoyISO: '2026-10-01' });

  it('C11 «Somos 4 con los niños» no da infantes 0 (falló 3/3 en la rama)', () => {
    const t = 'Somos 4 con los niños, queremos ir a Cartagena';
    const s = leer(t, {
      adultos: { valor: '2', frase: 'Somos 4 con los niños' },
      ninos: { valor: '2', frase: 'Somos 4 con los niños' },
      infantes: { valor: '0', frase: 'Somos 4 con los niños' },
    });
    expect(s.sugeridos.infantes).toBeUndefined();
    expect(s.descartados).toContainEqual({ slug: 'infantes', motivo: 'un 0 que la frase no cierra: «Somos 4 con los niños»' });
  });

  it('A1 tanda 1 «somos mi esposo, yo y los dos niños» no da 0 bebés', () => {
    const t = 'Queremos ir en diciembre, somos mi esposo, yo y los dos niños';
    const s = leer(t, {
      adultos: { valor: '2', frase: 'somos mi esposo, yo' },
      infantes: { valor: '0', frase: 'somos mi esposo, yo y los dos niños' },
    });
    expect(s.sugeridos.infantes).toBeUndefined();
  });

  it.each([
    ['«sin niños»', 'vamos mi esposo y yo, sin niños', 'sin niños', '2'],
    ['«solo adultos»', 'al final van solo adultos, somos 3', 'van solo adultos', '3'],
    ['«somos dos» con 2 adultos', 'somos dos, a Cartagena', 'somos dos', '2'],
    ['«no van los niños»', 'esta vez no van los niños', 'no van los niños', '2'],
    ['«mi esposo y yo» con 2 adultos (QA de #969 v2, A4)', 'Mi esposo y yo queremos Europa', 'Mi esposo y yo', '2'],
    ['«vamos los dos»', 'vamos los dos a Cartagena', 'vamos los dos', '2'],
  ])('pasa: %s', (_n, texto, frase, adultos) => {
    const s = leer(texto, { adultos: { valor: adultos, frase: texto }, ninos: { valor: '0', frase }, infantes: { valor: '0', frase } });
    expect(s.sugeridos.ninos?.valor).toBe(0);
    expect(s.sugeridos.infantes?.valor).toBe(0);
  });

  it.each([
    ['«somos 3» con 2 adultos', 'somos 3', 'somos 3', '2'],
    ['«somos 2 y los niños»', 'somos 2 y los niños', 'somos 2 y los niños', '2'],
  ])('no pasa: %s', (_n, texto, frase, adultos) => {
    const s = leer(texto, { adultos: { valor: adultos, frase: texto }, ninos: { valor: '0', frase } });
    expect(s.sugeridos.ninos).toBeUndefined();
  });

  it('la deducción determinista sigue cerrando infantes con todas las edades ≥ 2', () => {
    const t = 'somos 2 adultos y 2 niños de 9 y 4 años';
    const s = leer(t, {
      adultos: { valor: '2', frase: '2 adultos' }, ninos: { valor: '2', frase: '2 niños' },
      edades_menores: { valor: '9, 4', frase: 'de 9 y 4 años' },
    });
    expect(conDeducciones(FIELDS, s.sugeridos).infantes).toMatchObject({ valor: 0, frase: '' });
  });
});

describe('QA de #969 · 1: la indiferencia solo cuenta si viene sola', () => {
  const HOTEL: CampoEntendible = { slug: 'categoria_hotel', tipo: 'select', label: 'Categoría de hotel', opciones: [
    { value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: '5', label: '5 estrellas' },
    { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true },
  ] };
  const PRESUPUESTO: CampoEntendible = { slug: 'presupuesto', tipo: 'select', label: 'Presupuesto', opciones: [
    { value: 'menos_3m', label: 'Menos de $3 millones' }, { value: '12m_20m', label: 'Entre $12 y $20 millones' },
    { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true },
  ] };
  // El mensaje exacto de la tanda 3 del chat de Punta Cana (audio de la cliente).
  const AUDIO = 'Hola Tati, mira, hablé con mi esposo y mejor del 28 de diciembre al 3 de enero, porque él sale a vacaciones el 27. Queremos todo incluido, hotel cuatro o cinco estrellas, lo que tú nos recomiendes, y de presupuesto tenemos unos quince millones por todo.';

  it.each([
    ['con la frase entera', 'hotel cuatro o cinco estrellas, lo que tú nos recomiendes'],
    ['con solo la indiferencia como frase', 'lo que tú nos recomiendes'],
  ])('A1 T3 «cuatro o cinco estrellas, lo que tú nos recomiendes» NO es «sin preferencia» (%s)', (_n, frase) => {
    const s = validarSalida({ historia: '', valores: { categoria_hotel: { valor: 'sin_preferencia', frase } } }, [HOTEL], AUDIO);
    expect(s.sugeridos).toEqual({});
    expect(s.descartados[0].motivo).toContain('«no definido» junto a una preferencia concreta');
    // Con el campo vacío el mínimo NO se da por completo: el bot pregunta la categoría.
    expect(huecos([{ ...HOTEL, nivel: 'minimo', pregunta: '¿De qué categoría?' }], {}).minimo.faltan.map(f => f.slug)).toEqual(['categoria_hotel']);
  });

  it('lo concreto sí entra: «4» con la frase de las estrellas', () => {
    const s = validarSalida({ historia: '', valores: { categoria_hotel: { valor: '4', frase: 'hotel cuatro o cinco estrellas' } } }, [HOTEL], AUDIO);
    expect(s.sugeridos.categoria_hotel.valor).toBe('4');
  });

  it.each([
    ['«el que sea» solo', 'el hotel, el que sea', HOTEL, 'sin_preferencia'],
    ['«lo que tú nos recomiendes» solo', 'Lo que tú nos recomiendes', HOTEL, 'sin_preferencia'],
    ['«no tenemos presupuesto» solo', 'la verdad no tenemos presupuesto todavía', PRESUPUESTO, 'sin_definir'],
  ])('la indiferencia sola sigue valiendo: %s', (_n, texto, campo, valor) => {
    expect(validarSalida({ historia: '', valores: { [campo.slug]: { valor, frase: texto } } }, [campo], texto).sugeridos[campo.slug]?.valor).toBe(valor);
  });

  it('«no tenemos presupuesto fijo, unos 3 millones» trae un número: no es «sin definir»', () => {
    const t = 'no tenemos presupuesto fijo, unos 3 millones';
    expect(validarSalida({ historia: '', valores: { presupuesto: { valor: 'sin_definir', frase: t } } }, [PRESUPUESTO], t).sugeridos).toEqual({});
  });

  it('las palabras que comparten todas las opciones no cuentan como preferencia', () => {
    expect(traePreferenciaConcreta(HOTEL, 'un hotel de muchas estrellas, el que sea')).toBe(false);
    expect(traePreferenciaConcreta(PRESUPUESTO, 'menos de lo que cuesta, el que sea')).toBe(true);
  });
});

describe('QA de #969 · 2: lo que escribe la agencia, lo que depende de menores y el texto redactado', () => {
  const CAMPOS: CampoEntendible[] = [
    ...FIELDS,
    { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos' },
    { slug: 'presentacion_destino', tipo: 'texto', label: 'Presentación del destino', lo_llena: 'agencia' },
  ];
  const A4 = 'Mi esposo y yo queremos Europa 20 días en mayo: Madrid, París y Roma';
  const PARRAFO = 'Madrid, París y Roma son tres de las ciudades más emblemáticas de Europa, llenas de historia, arte y gastronomía.';

  it('(a) un campo con `lo_llena: "agencia"` no está en el esquema, ni en el prompt, ni se acepta', () => {
    expect(camposEntendibles(CAMPOS).map(f => f.slug)).not.toContain('presentacion_destino');
    expect(Object.keys((esquemaDeSalida(CAMPOS) as Esquema).properties.valores.properties)).not.toContain('presentacion_destino');
    expect(instruccionesEntendimiento(CAMPOS, '2026-10-01')).not.toContain('presentacion_destino');
    const s = validarSalida({ historia: '', valores: { presentacion_destino: { valor: PARRAFO, frase: 'Madrid, París y Roma' } } }, CAMPOS, A4);
    expect(s.sugeridos).toEqual({});
  });

  it('(b) A4: el permiso de salida de menores no se llena en un viaje sin niños', () => {
    const base = {
      destino_tipo: { valor: 'internacional', frase: 'Europa' },
      adultos: { valor: '2', frase: 'Mi esposo y yo' },
      permiso_salida_menores: { valor: 'tiene_permiso', frase: 'Mi esposo y yo' },
    };
    // Sin niños sabidos (el 0 de «mi esposo y yo» no pasa el guardián), y con un 0 declarado.
    for (const extra of [{}, { ninos: { valor: '0', frase: 'sin niños' } }]) {
      const texto = `${A4}, sin niños`;
      const s = validarSalida(salida({ ...base, ...extra }), FIELDS, texto, { hoyISO: '2026-10-01' });
      expect(s.sugeridos.permiso_salida_menores).toBeUndefined();
      expect(s.descartados).toContainEqual({ slug: 'permiso_salida_menores', motivo: 'solo aplica si viajan menores, y no se sabe que viajen' });
    }
  });

  it('(b) con niños (de este mensaje o de lo que el negocio ya tiene) el permiso sí entra', () => {
    const t = 'los niños viajan con papá y mamá a Cancún';
    const v = { destino_tipo: { valor: 'internacional', frase: 'Cancún' }, permiso_salida_menores: { valor: 'tiene_permiso', frase: 'los niños viajan con papá y mamá' } };
    expect(validarSalida(salida({ ...v, ninos: { valor: '2', frase: 'los niños' } }), FIELDS, t).sugeridos.permiso_salida_menores?.valor).toBe('tiene_permiso');
    expect(validarSalida(salida(v), FIELDS, t, { conocidos: { ninos: 2 } }).sugeridos.permiso_salida_menores?.valor).toBe('tiene_permiso');
  });

  it('(b) las edades de los menores siguen entrando con los niños', () => {
    const t = '2 niños de 9 y 4 años';
    const s = validarSalida(salida({ ninos: { valor: '2', frase: '2 niños' }, edades_menores: { valor: '9, 4', frase: 'de 9 y 4 años' } }), FIELDS, t);
    expect(s.sugeridos.edades_menores?.valor).toBe('9, 4');
  });

  it('(c) un texto redactado por el modelo no entra aunque traiga una frase real', () => {
    const s = validarSalida({ historia: '', valores: { requisitos_especiales: { valor: PARRAFO, frase: 'Madrid, París y Roma' } } }, CAMPOS, A4);
    expect(s.sugeridos).toEqual({});
    expect(s.descartados[0].motivo).toContain('el texto no sale de los mensajes');
  });

  it('(c) normalizar sí vale: «bgta» → BOGOTÁ, «pta cana» → PUNTA CANA, las ciudades tal cual', () => {
    expect(textoSaleDelMensaje('Bogotá', 'saliendo de bgta')).toBe(true);
    expect(textoSaleDelMensaje('Punta Cana', 'pta cana')).toBe(true);
    expect(textoSaleDelMensaje('Madrid, París y Roma', A4)).toBe(true);
    expect(textoSaleDelMensaje('ya tienen pasaporte', 'Los niños viajan con nosotros dos, ya tienen pasaporte')).toBe(true);
    expect(textoSaleDelMensaje(PARRAFO, A4)).toBe(false);
  });
});

describe('regla 4 (apoyo): para cambiar un número, la frase tiene que decirlo', () => {
  it.each([
    ['o sea seríamos 3 adultos', 3, true],
    ['seríamos tres', 3, true],
    ['al final van solo adultos', 0, true],
    ['sin niños', 0, true],
    ['va un niño', 1, true],
    ['hablé con mi esposo', 2, false],
    ['se suma mi suegra', 3, false],
    ['somos 13', 3, false],
  ])('«%s» dice %i: %s', (frase, n, esperado) => {
    expect(fraseNombraNumero(frase, n)).toBe(esperado);
  });

  it('el cliente que se corrige: el modelo debe devolver lo último que dijo', () => {
    expect(instruccionesEntendimiento(FIELDS, '2026-10-01')).toContain('devuelve lo ÚLTIMO que dijo');
  });
});

describe('las piezas de los guardianes', () => {
  it('días nombrados: dígitos y letras, sin años ni duraciones', () => {
    expect(diasNombrados('del 15 al 20 de noviembre de 2026').sort((a, b) => a - b)).toEqual([15, 20]);
    expect(diasNombrados('el primero de diciembre')).toEqual([1]);
    expect(diasNombrados('20 días en mayo')).toEqual([]);
    expect(diasNombrados('dos semanas en enero')).toEqual([]);
    expect(fraseNombraElDia('15/11', '2026-11-15')).toBe(true);
  });

  it('las edades: dígitos sí, meses no', () => {
    expect(leerEdades('9 AÑOS Y 4 AÑOS')).toEqual([9, 4]);
    expect(leerEdades('9, 6 y 1')).toEqual([9, 6, 1]);
    expect(leerEdades('8 meses')).toBeNull();
    expect(leerEdades('')).toBeNull();
  });

  it('fechaDeViaje directo: hoy vale; sin año, la próxima vez que existe; con año pasado, se descarta', () => {
    expect(fechaDeViaje('2026-10-01', 'el 1', '2026-10-01')).toEqual({ valor: '2026-10-01' });
    expect(fechaDeViaje('2024-02-29', 'el 29 de febrero', '2026-10-01')).toEqual({ valor: '2028-02-29' });
    expect(fechaDeViaje('2024-02-29', 'el 29 de febrero de 2024', '2026-10-01')).toEqual({ motivo: 'fecha pasada: 2024-02-29' });
  });
});

describe('QA de #971 · R1: el año lo pone el código, no el modelo', () => {
  // Salida grabada de la corrida real (qa971/resultados-f/F1.txt y dbg.ts, flash-lite, temp 0.1):
  // al cargar en un negocio existente el modelo devolvió 2027-12-28 y 2027-01-03 para este mensaje.
  const T = 'Ya hablé con mi esposo: salimos el 28 de diciembre y volvemos el 3 de enero';
  const grabada = { valores: {
    fecha_salida: { valor: '2027-12-28', frase: 'salimos el 28 de diciembre' },
    fecha_regreso: { valor: '2027-01-03', frase: 'volvemos el 3 de enero' },
  } };

  it('la salida va a la próxima ocurrencia y el regreso de enero cae en el año siguiente', () => {
    const s = validarSalida(grabada, FIELDS, T, { hoyISO: '2026-10-01', conocidos: { destino: 'PUNTA CANA' } });
    expect(s.sugeridos.fecha_salida?.valor).toBe('2026-12-28');
    expect(s.sugeridos.fecha_regreso?.valor).toBe('2027-01-03');
    expect(s.descartados).toEqual([]);
  });

  it('el regreso solo, con la salida ya en el negocio, también va con ella', () => {
    const t = 'volvemos el 3 de enero';
    const s = validarSalida({ valores: { fecha_regreso: { valor: '2026-01-03', frase: t } } }, FIELDS, t, { hoyISO: '2026-10-01', conocidos: { fecha_salida: '2026-12-28' } });
    expect(s.sugeridos.fecha_regreso?.valor).toBe('2027-01-03');
  });

  it('si la frase dice el año, manda la frase', () => {
    const t = 'salimos el 28 de diciembre de 2027';
    expect(validarSalida({ valores: { fecha_salida: { valor: '2027-12-28', frase: t } } }, FIELDS, t, { hoyISO: '2026-10-01' }).sugeridos.fecha_salida?.valor).toBe('2027-12-28');
  });
});
