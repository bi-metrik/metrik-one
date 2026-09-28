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
  mensajeAlComercial,
  resumenEntendido,
  aplicarSumas,
  textoPreguntaContacto,
  validarSalida,
  type CampoEntendible,
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
    const e = esquemaDeSalida(FIELDS) as { properties: { valores: { properties: Record<string, any>; required: string[] } } };
    const props = e.properties.valores.properties;
    expect(Object.keys(props)).not.toContain('numero_pasajeros'); // derivado
    expect(Object.keys(props)).not.toContain('foto'); // no captura un dato del cliente
    expect(props.tipo_viaje.properties.valor.enum).toEqual(['playa', 'crucero', POR_DEFINIR]);
    expect(props.destino.properties.valor.enum).toBeUndefined();
    expect(e.properties.valores.required).toContain('edades_menores');
  });

  it('un campo nuevo en la config entra al esquema y a las instrucciones sin tocar código', () => {
    const con = [...FIELDS, { slug: 'motivo', tipo: 'texto', label: 'Motivo del viaje', nivel: 'deseable' } as CampoEntendible];
    expect(Object.keys((esquemaDeSalida(con) as any).properties.valores.properties)).toContain('motivo');
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
    expect((r.data._sugeridos as any).destino).toEqual({ fuente: 'whatsapp', entrega_id: 'e1', frase: 'Punta Cana', en: meta.en });
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
    expect(textoPreguntaContacto(d as any)).toContain('Responde con el número, o escribe NUEVO');
  });

  it('ninguno: pregunta sin lista', () => {
    const d = decidirContacto({ clienteTexto: 'Luis Gómez', extraido: { nombre: null, telefono: null }, candidatos: [] });
    expect(d).toMatchObject({ tipo: 'preguntar', motivo: 'ninguno', opciones: [] });
    expect(textoPreguntaContacto(d as any)).toContain('No encontré a «Luis Gómez» en el directorio.');
  });

  it('la respuesta: número de la lista, NUEVO, un celular, o no se entiende', () => {
    expect(interpretarRespuestaContacto(' 2 ', [ana, ana2])).toEqual({ tipo: 'elegido', contacto_id: 'b' });
    expect(interpretarRespuestaContacto('3', [ana, ana2])).toEqual({ tipo: 'no_entendida' });
    expect(interpretarRespuestaContacto('Nuevo', [])).toEqual({ tipo: 'nuevo' });
    expect(interpretarRespuestaContacto('300 999 8877', [])).toEqual({ tipo: 'telefono', telefono: '3009998877' });
    expect(interpretarRespuestaContacto('la de siempre', [ana])).toEqual({ tipo: 'no_entendida' });
  });
});
