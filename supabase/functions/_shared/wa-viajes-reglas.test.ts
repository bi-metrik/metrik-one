/**
 * Varios viajes por encabezado (decisión de Mauricio, 2026-10-01: MANDA EL ENCABEZADO; el modelo
 * ya no propone a qué viaje va cada mensaje). Pruebas puras de la resolución de encabezados, los
 * segmentos, los sospechosos y la respuesta al resumen, más dos bancos:
 *   · el grupo F y C1m/D1m/D2m del QA de #971 (`bandeja-qa971.json`, mensajes del banco sintético);
 *   · el día sintético con encabezados (`bandeja-dia-encabezados.json`): 2 olvidados y 1 mal escrito.
 * Lo que tiene que pasar en todos: ningún mensaje se CARGA (sin decisión del comercial) en un viaje
 * que no es el suyo; lo dudoso sale para decidir con su texto y su motivo.
 */
import { describe, expect, it } from 'vitest';
import qa971 from './__fixtures__/bandeja-qa971.json';
import diaEnc from './__fixtures__/bandeja-dia-encabezados.json';
import {
  aplicarCambios,
  armarPlan,
  armarSegmentos,
  esSi,
  gruposDelPlan,
  interpretarRespuestaPlan,
  MAX_LARGO_RESUMEN,
  pendientes,
  rangos,
  resolverEncabezado,
  numeracion,
  sinLugares,
  textoResumenPlan,
  partesResumenPlan,
  distancia,
  pareceEncabezado,
  esFamiliarDe,
  noEsDelCliente,
  tieneEncabezados,
  viajesNombrados,
  type DestinoPlan,
  type MensajeViaje,
  type PlanViajes,
  type ViajeAbierto,
} from './wa-viajes-reglas.ts';
import { CONFIG_BANDEJA_POR_DEFECTO, LLAVE_BANDEJA, decidirRuta, empiezaConPrefijoBot, leerConfigBandeja } from './wa-bandeja-reglas.ts';

const CFG = { horasCajaActiva: 4 };
const V: ViajeAbierto[] = [
  { id: 'n11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA' },
  { id: 'n9', codigo: 'T1 26 9', cliente: 'LUISA MEJÍA', destino: 'SAN ANDRÉS' },
  { id: 'n8', codigo: 'T1 26 8', cliente: 'JORGE PÉREZ', destino: 'CARTAGENA' },
];
const t = (min: number) => new Date(Date.parse('2026-10-01T14:00:00Z') + min * 60_000).toISOString();
const m = (n: number, cuerpo: string, opts: { min?: number; escrito?: boolean } = {}): MensajeViaje =>
  ({ n, cuerpo, reenviado: !opts.escrito, tipo: 'text', en: t(opts.min ?? n) });
const enc = (n: number, cuerpo: string, min?: number) => m(n, cuerpo, { escrito: true, min });

function plan(ms: MensajeViaje[], viajes = V, cerrados: string[] = []): { plan: PlanViajes; conEncabezados: boolean } {
  const { segmentos, encabezados } = armarSegmentos(ms, viajes, CFG);
  return { plan: armarPlan({ mensajes: ms, viajes, segmentos, encabezados, codigosCerrados: new Set(cerrados) }), conEncabezados: tieneEncabezados(segmentos) };
}
const codigo = (d: DestinoPlan | null) => (d ? (d.tipo === 'existente' ? d.codigo : `NUEVO ${d.cliente}`) : null);
const resumenDe = (p: PlanViajes) => p.mensajes.map(x => [x.n, codigo(x.destino), x.sospecha ? 'sospecha' : x.destino ? 'carga' : 'decidir']);

describe('config', () => {
  it('modo_viajes es uno | encabezado; «mixto» ya no existe y cae a uno; segundos_bloque se fue', () => {
    expect(leerConfigBandeja({ bandeja_solicitudes: { modo_viajes: 'encabezado' } }).modoViajes).toBe('encabezado');
    expect(leerConfigBandeja({ bandeja_solicitudes: { modo_viajes: 'mixto' } }).modoViajes).toBe('uno');
    expect('segundosBloque' in leerConfigBandeja({})).toBe(false);
  });
});

describe('encabezados: resolución determinista contra los viajes abiertos', () => {
  it.each([
    ['T1 26 9', 'n9', 'codigo'], ['t1-26-9', 'n9', 'codigo'], ['Carolina', 'n11', 'nombre'], ['cliente Jorge', 'n8', 'nombre'],
    ['Carolina Ruiz', 'n11', 'nombre'], ['Ruiz Carolina', 'n11', 'nombre'],
  ])('exacto: «%s» → %s (%s) cambia la caja', (texto, id, por) => {
    expect(resolverEncabezado(texto, V)).toMatchObject({ tipo: 'viaje', viaje: { id }, por });
  });

  it.each([
    ['Carlina', 'n11', 'nombre'], ['la de punta cana', 'n11', 'destino'], ['Ruiz', 'n11', 'apellido'], ['Mejía', 'n9', 'apellido'],
  ])('aproximado: «%s» → %s (%s) no cambia la caja solo: se pregunta', (texto, id, por) => {
    expect(resolverEncabezado(texto, V)).toMatchObject({ tipo: 'aproximado', viaje: { id }, por });
  });

  it('nuevo, ambiguo, código desconocido; y lo que no es encabezado', () => {
    expect(resolverEncabezado('nuevo Luisa San Andrés', V)).toEqual({ tipo: 'nuevo', cliente: 'Luisa San Andrés' });
    expect(resolverEncabezado('Carolina', [...V, { id: 'n14', codigo: 'T1 26 14', cliente: 'CAROLINA PÉREZ', destino: 'CANCÚN' }])).toMatchObject({ tipo: 'ambiguo' });
    expect(resolverEncabezado('T1 26 3', V)).toEqual({ tipo: 'codigo_desconocido', codigo: 'T1263' });
    for (const x of ['Carolina quiere 5 estrellas', 'son 3 adultos', 'ok']) expect(resolverEncabezado(x, V), x).toBeNull();
  });
});

describe('manda el encabezado', () => {
  it('F1: cada encabezado fija el viaje de lo que sigue; sin sospechas, un «sí» carga', () => {
    const r = plan([enc(1, 'Carolina'), m(2, 'salimos el 28 de diciembre'), m(3, 'somos 3 adultos'), enc(4, 'T1 26 9'), m(5, 'Buenas Tati, para San Andrés del 20 al 24 de noviembre'), m(6, 'Vamos 2 adultos')]);
    expect(resumenDe(r.plan)).toEqual([[2, 'T1 26 11', 'carga'], [3, 'T1 26 11', 'carga'], [5, 'T1 26 9', 'carga'], [6, 'T1 26 9', 'carga']]);
    expect(interpretarRespuestaPlan('sí', r.plan, V)).toEqual({ tipo: 'si' });
  });

  it('sin encabezados la tanda es un viaje: no hay reparto (se pregunta «¿A qué viaje van?»)', () => {
    expect(plan([m(1, 'Hola, soy Carolina'), m(40, 'Buenas, habla Luisa')]).conEncabezados).toBe(false);
  });

  it('lo que llega antes del primer encabezado, con la caja vencida o bajo un encabezado ambiguo queda para decidir', () => {
    const r = plan([m(1, 'del 28 de diciembre'), enc(2, 'Carolina'), m(3, 'somos 3 adultos'), m(4, 'hotel 4 estrellas', { min: 400 })]);
    expect(resumenDe(r.plan)).toEqual([[1, null, 'decidir'], [3, 'T1 26 11', 'carga'], [4, null, 'decidir']]);
  });

  it('F9: nombrar a otro cliente no es sospecha («Luisa me recomendó» sigue siendo de Carolina)', () => {
    const r = plan([enc(1, 'Carolina'), m(2, 'Luisa me recomendó con ustedes'), m(3, 'queremos ir en diciembre')]);
    expect(resumenDe(r.plan)).toEqual([[2, 'T1 26 11', 'carga'], [3, 'T1 26 11', 'carga']]);
  });
});

describe('sospechosos dentro de una caja (lo único que queda de la inferencia)', () => {
  it.each([
    ['dos viajes', [m(2, 'Lo de Carolina va para el 15 y lo de Jorge para el 8', { escrito: true }), m(3, 'hotel 4 estrellas')], [[2, null, 'sospecha'], [3, 'T1 26 11', 'sospecha']]],
    ['otro destino', [m(2, 'hotel 5 estrellas'), m(3, 'Hola, para Cartagena somos 4 adultos')], [[2, 'T1 26 11', 'carga'], [3, 'T1 26 11', 'sospecha']]],
    ['se presenta como otra persona', [m(2, 'hotel 5 estrellas'), m(3, 'Hola Tati, soy Andrés, quiero cotizar')], [[2, 'T1 26 11', 'carga'], [3, 'T1 26 11', 'sospecha']]],
    ['saluda a mitad', [m(2, 'hotel 5 estrellas'), m(3, 'Hola Tati, buenas tardes')], [[2, 'T1 26 11', 'carga'], [3, 'T1 26 11', 'sospecha']]],
    ['choca en fechas y en adultos (F4b)', [m(2, 'del 28 de diciembre al 3 de enero, somos 3 adultos'), m(3, 'nosotros mejor del 20 al 24 de noviembre'), m(4, 'Vamos 2 adultos')], [[2, 'T1 26 11', 'carga'], [3, 'T1 26 11', 'sospecha'], [4, 'T1 26 11', 'sospecha']]],
  ])('%s', (_n, msgs, esperado) => {
    expect(resumenDe(plan([enc(1, 'Carolina'), ...msgs]).plan)).toEqual(esperado);
  });

  it('lo que sigue a un sospechoso también, hasta que un mensaje vuelva a nombrar a la clienta', () => {
    const r = plan([enc(1, 'Carolina'), m(2, 'Hola Tati, soy Andrés'), m(3, 'del 5 al 10 de diciembre'), m(4, 'soy Carolina otra vez, hotel 5 estrellas'), m(5, 'con desayuno')]);
    expect(resumenDe(r.plan)).toEqual([[2, 'T1 26 11', 'sospecha'], [3, 'T1 26 11', 'sospecha'], [4, 'T1 26 11', 'carga'], [5, 'T1 26 11', 'carga']]);
  });

  it('«San Andrés» no es Andrés Gil', () => {
    const W = [...V, { id: 'n21', codigo: 'T1 26 21', cliente: 'ANDRÉS GIL', destino: null }];
    const D = W.map(v => ({ tipo: 'existente', negocio_id: v.id, codigo: v.codigo, cliente: v.cliente }) as DestinoPlan);
    expect(sinLugares('para San Andrés serían del 20', W)).toBe('para serian del 20');
    expect(viajesNombrados('para San Andrés serían del 20', D, W)).toEqual([]);
  });
});

describe('la respuesta al resumen', () => {
  const r = plan([enc(1, 'Carolina'), m(2, 'hotel 5 estrellas'), m(3, 'Hola Tati, soy Andrés'), m(4, 'Lo de Carolina y lo de Jorge'), m(5, 'somos 2')]).plan;

  it('el «sí» no vale con algo por decidir', () => {
    expect(pendientes(r).map(x => x.n)).toEqual([3, 4, 5]);
    expect(interpretarRespuestaPlan('sí', r, V)).toMatchObject({ tipo: 'no_entendida', aviso: expect.stringContaining('Antes del sí') });
  });

  it('dejar, mover y descartar; después, sí', () => {
    // Numeración del resumen sin el encabezado: el 1 es «hotel 5 estrellas» (prueba en vivo del 2026-10-01).
    const res = interpretarRespuestaPlan('dejar el 4; mover el 2 a Jorge; descartar el 3', r, V);
    expect(res.tipo).toBe('corregir');
    const p2 = aplicarCambios(r, (res as { cambios: never }).cambios);
    expect(pendientes(p2)).toEqual([]);
    expect(gruposDelPlan(p2).map(g => [codigo(g.destino), g.mensajes])).toEqual([['T1 26 11', [2, 5]], ['T1 26 8', [3]]]);
    expect(interpretarRespuestaPlan('sí', p2, V)).toEqual({ tipo: 'si' });
  });

  it('«dejar todos» deja los sospechosos; uno de dos viajes no se deja ni se mueve, solo se descarta', () => {
    const dejar = interpretarRespuestaPlan('dejar todos', r, V);
    expect(dejar).toEqual({ tipo: 'corregir', cambios: [{ ns: [3, 5], a: 'dejar' }] });
    expect(interpretarRespuestaPlan('dejar el 3', r, V)).toMatchObject({ tipo: 'no_entendida', aviso: expect.stringContaining('El 3 habla de dos viajes') });
    expect(interpretarRespuestaPlan('descartar los pendientes', r, V)).toEqual({ tipo: 'corregir', cambios: [{ ns: [3, 4, 5], a: 'descartar' }] });
  });

  it.each(['sí', 'Si', 'dale', 'confirmo'])('«%s» es sí', x => expect(esSi(x)).toBe(true));
  it.each(['ok pero falta uno', 'sí no', 'ok', '', '👍'])('«%s» NO es sí', x => expect(esSi(x)).toBe(false));
});

describe('el resumen', () => {
  it('R2: cada mensaje CARGADO va en su línea con sus primeras palabras; con 60 mensajes se parte en varios de hasta 3.800', () => {
    const ms = [enc(1, 'Carolina'), ...Array.from({ length: 60 }, (_, i) => m(i + 2, i % 10 === 5 ? 'Hola Tati, soy Andrés, una pregunta larga sobre el hotel y el traslado' : `mensaje número ${i + 2} con algo de texto del cliente`))];
    const r = plan(ms).plan;
    const partes = partesResumenPlan(r, ms);
    expect(partes.length).toBeGreaterThan(1);
    for (const p of partes) expect(p.length).toBeLessThanOrEqual(MAX_LARGO_RESUMEN);
    const todo = partes.join('\n');
    for (const x of r.mensajes) expect(todo, `el ${x.n}`).toContain(`\n   ${x.n - 1} «`); // sin contar el encabezado
    expect(partes[partes.length - 1]).toContain('No cargué nada todavía');
    expect(partes[0].startsWith('(1/')).toBe(true);
    expect(rangos([9, 2, 3, 4, 6, 10])).toBe('2-4, 6, 9-10');
  });

  it('R2 (F4c del QA v3): el encabezado olvidado sin señales cae en la caja, pero el resumen muestra esos mensajes uno por uno', () => {
    const ms = [enc(1, 'Carolina'), m(2, 'Ya hablé con mi esposo: salimos el 28 de diciembre y volvemos el 3 de enero'),
      m(3, 'Somos 3 adultos y 2 niños de 9 y 4 años'), m(4, 'el hotel con desayuno porfa'), m(5, 'salimos de Medellín')];
    const txt = textoResumenPlan(plan(ms).plan, ms);
    expect(txt).toContain('   3 «el hotel con desayuno porfa»');
    expect(txt).toContain('   4 «salimos de Medellín»');
  });
});

/** Lo que se cargaría con un «sí» directo (sin decidir nada): ningún mensaje en un viaje ajeno. */
function cargaSinDecidir(p: PlanViajes) {
  return p.mensajes.filter(x => x.destino && !x.sospecha && !x.descartado);
}

describe('banco del QA de #971 (mensajes reales del banco; el modelo ya no asigna)', () => {
  const MODULES = { [LLAVE_BANDEJA]: true };
  for (const e of qa971.f) {
    it(`${e.id} · ${e.titulo}`, () => {
      const msgs = e.mensajes.filter(x => !(x.tipo === 'text' && !x.reenviado && empiezaConPrefijoBot(x.texto, ['gasto'])));
      const entrega = msgs.flatMap((x, i) => decidirRuta({
        modules: MODULES, config: CONFIG_BANDEJA_POR_DEFECTO, tipo: x.tipo, texto: x.texto, reenviado: x.reenviado,
        sesionBotEsperando: false, entregaAbierta: true, preguntaPendiente: false, esEncabezado: x.encabezado,
      }) === 'bot' ? [] : [{ x, ms: { n: i + 1, cuerpo: x.texto, reenviado: x.reenviado, tipo: x.tipo, en: x.en } as MensajeViaje }]);
      const r = plan(entrega.map(y => y.ms), e.viajes as ViajeAbierto[], e.cerrados);
      if (!r.conEncabezados) return; // la tanda es un viaje: se pregunta como en modo uno
      for (const c of cargaSinDecidir(r.plan)) {
        const verdad = (entrega.find(y => y.ms.n === c.n)!.x.verdad as string[] | null) ?? [];
        const id = c.destino!.tipo === 'existente' ? c.destino!.negocio_id : 'nuevo:*';
        expect(verdad.some(v => v === id || (v.startsWith('nuevo') && id === 'nuevo:*')), `${c.n} «${entrega.find(y => y.ms.n === c.n)!.x.texto}» → ${id}`).toBe(true);
      }
    });
  }
});

describe('el día sintético del QA v3 CON encabezados (2 olvidados, «Lusia», «habla Marta, la esposa de Jorge»)', () => {
  const nombre = (d: DestinoPlan) => (d.tipo === 'existente' ? d.codigo : `NUEVO ${d.cliente}`);
  // QA de #971 v5: un encabezado aproximado («Lusia», «la de cancún») no cambia la caja solo; el
  // bot pregunta en el acto «¿Cambias a…? sí/no». Se cuenta el día sin respuesta y con el «sí».
  it.each([['sin respuesta', false], ['con «sí» a cada «¿Cambias a…?»', true]])('ningún mensaje se carga en un viaje ajeno sin pasar por el comercial; cuenta las preguntas del día (%s)', (_t, contesta) => {
    let decisiones = 0;
    let cargados = 0;
    let preguntasEnElActo = 0;
    const porEntrega: number[] = [];
    for (const e of diaEnc.entregas) {
      const viajes = e.viajes as ViajeAbierto[];
      const crudos = e.mensajes.flatMap(x => {
        const r = !x.reenviado && x.tipo === 'text' ? resolverEncabezado(x.texto, viajes) : null;
        if (r?.tipo === 'aproximado') preguntasEnElActo++;
        return r?.tipo === 'aproximado' && contesta ? [x, { ...x, texto: 'sí', verdad: null }] : [x];
      });
      const ms: MensajeViaje[] = crudos.map((x, i) => ({ n: i + 1, cuerpo: x.texto, reenviado: x.reenviado, tipo: x.tipo, en: x.en }));
      const r = plan(ms, viajes);
      if (!r.conEncabezados) {
        // Una tanda sin encabezado es un viaje: una pregunta («¿A qué viaje van?»).
        porEntrega.push(1);
        decisiones += 1;
        continue;
      }
      for (const c of cargaSinDecidir(r.plan)) {
        // Lo que no es de ningún cliente (promoción, pago, la nota «tacaña») puede ir en la caja: el entendimiento no lo usa.
        if (crudos[c.n - 1].verdad !== null) expect(nombre(c.destino!), `«${crudos[c.n - 1].texto}»`).toBe(crudos[c.n - 1].verdad);
        cargados++;
      }
      const p = pendientes(r.plan).length;
      porEntrega.push(p);
      decisiones += p;
      const txt = textoResumenPlan(r.plan, ms);
      const { visible } = numeracion(r.plan);
      for (const x of pendientes(r.plan)) expect(txt).toContain(`\n   ${visible(x.n)} «`);
    }
    // El número que pidió Mauricio: un resumen o una pregunta por entrega, y estas decisiones de mensaje.
    expect({ resumenes: diaEnc.entregas.length, preguntasEnElActo, decisiones, porEntrega, cargados }).toMatchSnapshot();
  });
});

describe('QA de #971 v3', () => {
  const W: ViajeAbierto[] = [...V, { id: 'n21', codigo: 'T1 26 21', cliente: 'ANDRÉS GIL', destino: 'CANCÚN' }];

  describe('R1 · encabezados casi exactos (Damerau/OSA: una transposición es un error)', () => {
    it.each([['Lusia', 'n9'], ['Carlina', 'n11'], ['Jorje', 'n8']])('«%s» → %s, aproximado (QA v5: se pregunta)', (texto, id) => {
      expect(resolverEncabezado(texto, W)).toMatchObject({ tipo: 'aproximado', viaje: { id } });
    });
    it('«Luisa Mejia» (nombre + apellido, sin tilde) es exacto', () => {
      expect(resolverEncabezado('Luisa Mejia', W)).toMatchObject({ tipo: 'viaje', viaje: { id: 'n9' } });
    });

    it('la distancia: transposición 1, sustitución 1, dos cambios 2', () => {
      expect([distancia('lusia', 'luisa'), distancia('jorje', 'jorge'), distancia('carlina', 'carolina'), distancia('lsuia', 'luisa')]).toEqual([1, 1, 1, 2]);
    });

    it('dos candidatos a la misma distancia: pregunta; uno exacto y otro a uno: gana el exacto', () => {
      const X: ViajeAbierto[] = [{ id: 'a', codigo: 'T1 26 40', cliente: 'MARTA LÓPEZ', destino: null }, { id: 'b', codigo: 'T1 26 41', cliente: 'MARIA PÉREZ', destino: null }];
      expect(resolverEncabezado('Marya', X)).toMatchObject({ tipo: 'ambiguo' });
      expect(resolverEncabezado('Marta', X)).toMatchObject({ tipo: 'viaje', viaje: { id: 'a' } });
      const Y: ViajeAbierto[] = [{ id: 'a', codigo: 'T1 26 40', cliente: 'LUISA LÓPEZ', destino: null }, { id: 'b', codigo: 'T1 26 41', cliente: 'LUSIA PÉREZ', destino: null }];
      expect(resolverEncabezado('Lusia', Y)).toMatchObject({ tipo: 'viaje', viaje: { id: 'b' } });
      const Z: ViajeAbierto[] = [{ id: 'a', codigo: 'T1 26 40', cliente: 'LUISA LÓPEZ', destino: null }, { id: 'b', codigo: 'T1 26 41', cliente: 'LUSIAA PÉREZ', destino: null }];
      expect(resolverEncabezado('Lusia', Z)).toMatchObject({ tipo: 'ambiguo' });
    });

    it('F5h del QA v3: «Lusia» ya no deja los mensajes de Luisa en la caja de Carolina; van a Luisa solo con el «sí» (QA v5)', () => {
      const base = [enc(1, 'Carolina', 0), m(2, 'Ya hablé con mi esposo: salimos el 28 de diciembre y volvemos el 3 de enero'), enc(3, 'Lusia', 1),
        m(4, 'el hotel con desayuno porfa'), m(5, 'salimos de Medellín')];
      // Sin respuesta: lo que sigue queda sin asignar, con aviso.
      const sin = plan(base).plan;
      expect(resumenDe(sin)).toEqual([[2, 'T1 26 11', 'carga'], [4, null, 'decidir'], [5, null, 'decidir']]);
      expect(sin.avisos.join(' ')).toContain('«Lusia» puede ser LUISA MEJÍA · T1 26 9 y no me contestaste');
      // «sí» (aunque llegue después de los reenvíos): la caja es de Luisa. El «sí» no es contenido.
      const si = plan([...base, enc(6, 'sí', 6)]).plan;
      expect(resumenDe(si)).toEqual([[2, 'T1 26 11', 'carga'], [4, 'T1 26 9', 'carga'], [5, 'T1 26 9', 'carga']]);
      expect([si.encabezados, si.avisos]).toEqual([[1, 3, 6], []]);
      // «no»: sin asignar, con aviso.
      const no = plan([...base, enc(6, 'no', 6)]).plan;
      expect(resumenDe(no)).toEqual([[2, 'T1 26 11', 'carga'], [4, null, 'decidir'], [5, null, 'decidir']]);
      expect(no.avisos.join(' ')).toContain('Dijiste que «Lusia» no es LUISA MEJÍA · T1 26 9');
      // Un «sí» bajo un encabezado EXACTO es contenido (no hay nada que confirmar).
      expect(resumenDe(plan([enc(1, 'Carolina'), m(2, 'sí')]).plan)).toEqual([[2, 'T1 26 11', 'carga']]);
    });
  });

  describe('corte de caja: un escrito corto que parece encabezado y no se resuelve', () => {
    // Las 32 de la prueba aparte del QA v4 (qa971v4/cortos.ts), contra los mismos 4 viajes abiertos.
    const CORTOS = ['ya', 'va', 'este también', 'del mismo', 'el mismo', 'ese mismo', 'también', 'igual', 'otro', 'otra más', 'sigue',
      'mismo cliente', 'ok', 'dale', 'listo ya', 'Gracias', 'bueno', 'Ah ok', 'aquí va', 'mira', 'ojo', 'urgente', 'confirmado', 'ese es',
      'de ella', 'su esposo', 'Lusia', 'Caro', 'Carlos', 'Jorje', 'Andres', 'Luisa?'];

    it('QA v4: de los 32 escritos cortos, solo «Caro» (parecido a un nombre, sin resolver) corta la caja; los nombres casi exactos resuelven', () => {
      const efecto = (c: string) => resolverEncabezado(c, W) ? 'encabezado' : pareceEncabezado(c, W) ? 'corta' : 'contenido';
      const r = Object.fromEntries(CORTOS.map(c => [c, efecto(c)]));
      expect(Object.entries(r).filter(([, e]) => e === 'corta').map(([c]) => c)).toEqual(['Caro']);
      expect(Object.entries(r).filter(([, e]) => e === 'encabezado').map(([c]) => c)).toEqual(['Lusia', 'Jorje', 'Andres']);
    });

    it.each([['Lsuia', true], ['T1 26 99', true], ['Pedro', false], ['Jorge?', false], ['son 3 adultos', false], ['jajaja', false]])('«%s» parece encabezado: %s', (t2, si) => {
      expect(pareceEncabezado(t2, W)).toBe(si);
    });

    it('«este también» y «del mismo» dentro de una caja no la cortan (F16b y F16c del QA v4)', () => {
      for (const corto of ['este también', 'del mismo']) {
        const ms = [enc(1, 'Carolina'), m(2, 'salimos el 28 de diciembre'), enc(3, corto), m(4, 'somos 3 adultos')];
        expect(resumenDe(plan(ms, W).plan).map(x => x[2]), corto).toEqual(['carga', 'carga', 'carga']);
      }
    });

    it('lo que sigue queda sin asignar hasta el próximo encabezado, con aviso; nunca hereda la caja anterior', () => {
      const ms = [enc(1, 'Carolina'), m(2, 'hotel 5 estrellas'), enc(3, 'Lsuia'), m(4, 'el hotel con desayuno porfa'), m(5, 'salimos de Medellín'), enc(6, 'Jorge'), m(7, 'somos 4')];
      const r = plan(ms).plan;
      expect(resumenDe(r)).toEqual([[2, 'T1 26 11', 'carga'], [4, null, 'decidir'], [5, null, 'decidir'], [7, 'T1 26 8', 'carga']]);
      expect(r.avisos.join('\n')).toContain('No reconocí el encabezado «Lsuia»');
      expect(r.encabezados).toEqual([1, 3, 6]);
    });

    it('una tanda con solo un escrito no reconocido es un viaje, como sin encabezados', () => {
      expect(plan([enc(1, 'Caro'), m(2, 'hola')]).conEncabezados).toBe(false);
    });
  });

  describe('falsos sospechosos', () => {
    it('«habla Marta, la esposa de Jorge» bajo «Jorge» no es otra persona ni contagia la caja (día, 4 de 5 falsos)', () => {
      expect(esFamiliarDe('Hola Tati, habla Marta, la esposa de Jorge', 'JORGE PÉREZ')).toBe(true);
      const ms = [enc(1, 'Jorge'), m(2, 'Hola Tati, habla Marta, la esposa de Jorge'), m(3, 'El niño tiene 7 años y ya tiene registro civil'),
        m(4, 'Queremos plan todo incluido también'), m(5, 'Presupuesto como 8 millones')];
      expect(resumenDe(plan(ms).plan).map(x => x[2])).toEqual(['carga', 'carga', 'carga', 'carga']);
      // Alguien que se presenta sin relación con el titular sigue siendo sospechoso.
      const otro = [enc(1, 'Jorge'), m(2, 'Hola Tati, habla Marta, quiero cotizar')];
      expect(resumenDe(plan(otro).plan)[0][2]).toBe('sospecha');
    });

    it('una promoción marcada no contagia al mensaje siguiente de Luisa (día, 1 de 5 falsos)', () => {
      expect(noEsDelCliente('PUNTA CANA desde $2.5M, salidas 5 y 12 de diciembre, todo incluido ✈️')).toBe(true);
      expect(noEsDelCliente('jajaja gracias')).toBe(true);
      expect(noEsDelCliente('Mira esto que vi, ¿ustedes tienen algo así para San Andrés?')).toBe(false);
      const ms = [enc(1, 'Luisa'), m(2, 'Mejor maleta de mano, viajamos ligeros'), m(3, 'PUNTA CANA desde $2.5M, salidas 5 y 12 de diciembre, todo incluido ✈️'),
        m(4, 'Mira esto que vi, ¿ustedes tienen algo así para San Andrés?')];
      expect(resumenDe(plan(ms).plan)).toEqual([[2, 'T1 26 9', 'carga'], [3, 'T1 26 9', 'sospecha'], [4, 'T1 26 9', 'carga']]);
    });
  });
});

describe('QA de #971 v4', () => {
  it('1 · la nota del comercial no vuelve a salir: ni su texto ni una paráfrasis, cargada o por decidir', () => {
    const conCaja = [enc(1, 'Luisa'), m(2, 'Mejor maleta de mano'), m(3, 'ojo, esta señora es muy tacaña y se queja de todo', { escrito: true })];
    const sinCaja = [m(1, 'ojo, esta señora es muy tacaña y se queja de todo', { escrito: true }), enc(2, 'Luisa'), m(3, 'Mejor maleta de mano')];
    for (const ms of [conCaja, sinCaja]) {
      const todo = partesResumenPlan(plan(ms).plan, ms).join('\n').toLowerCase();
      expect(todo).not.toMatch(/taca|queja|ojo, esta/);
      expect(todo).toContain('(nota del comercial, no se guarda)');
    }
  });

  it('3 · el prefijo «(k/n) » se reserva antes de partir: ninguna línea se corta y el cierre y la ⚠ llegan completos (corte.ts del QA v4)', () => {
    const W1: ViajeAbierto[] = [{ id: 'n11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA' }];
    let partidos = 0;
    for (let extra = 0; extra < 200; extra++) {
      const ms: MensajeViaje[] = [enc(1, 'Carolina', 0)];
      for (let i = 0; i < 95 + (extra % 40); i++) {
        const cuerpo = i === 40 ? 'Hola Tati, soy Andrés, quiero cotizar' : `${'x'.repeat(5 + (extra % 37))} mensaje`;
        ms.push({ n: i + 2, cuerpo, reenviado: true, tipo: 'text', en: new Date(Date.parse('2026-10-01T14:00:00Z') + (i + 1) * 1000).toISOString() });
      }
      const p = plan(ms, W1).plan;
      const partes = partesResumenPlan(p, ms);
      if (partes.length < 2) continue;
      partidos++;
      for (const parte of partes) expect(parte.length).toBeLessThanOrEqual(MAX_LARGO_RESUMEN);
      const lineas = partes.map(x => x.replace(/^\(\d+\/\d+\) /, '')).join('\n').split('\n');
      for (const x of p.mensajes.filter(y => y.destino)) {
        expect(lineas.some(l => new RegExp(`^   ${x.n - 1} «.*»${x.sospecha ? ' ⚠' : ''}$`).test(l)), `${extra}: línea del ${x.n}`).toBe(true);
      }
      expect(partes[partes.length - 1].endsWith('descarta todo.')).toBe(true);
    }
    expect(partidos).toBeGreaterThan(50);
  });
});
