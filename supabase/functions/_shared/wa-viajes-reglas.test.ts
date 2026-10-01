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
  sinLugares,
  textoResumenPlan,
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
    ['T1 26 9', 'n9', 'codigo'], ['t1-26-9', 'n9', 'codigo'], ['Carolina', 'n11', 'nombre'], ['Carlina', 'n11', 'nombre'],
    ['la de punta cana', 'n11', 'destino'], ['cliente Jorge', 'n8', 'nombre'],
  ])('«%s» → %s (%s)', (texto, id, por) => {
    expect(resolverEncabezado(texto, V)).toMatchObject({ tipo: 'viaje', viaje: { id }, por });
  });

  it('nuevo, ambiguo, código desconocido; y lo que no es encabezado', () => {
    expect(resolverEncabezado('nuevo Luisa San Andrés', V)).toEqual({ tipo: 'nuevo', cliente: 'Luisa San Andrés' });
    expect(resolverEncabezado('Carolina', [...V, { id: 'n14', codigo: 'T1 26 14', cliente: 'CAROLINA PÉREZ', destino: 'CANCÚN' }])).toMatchObject({ tipo: 'ambiguo' });
    expect(resolverEncabezado('T1 26 3', V)).toEqual({ tipo: 'codigo_desconocido', codigo: 'T1263' });
    for (const x of ['Carolina quiere 5 estrellas', 'son 3 adultos', 'ok', 'Lusia']) expect(resolverEncabezado(x, V), x).toBeNull();
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
    const res = interpretarRespuestaPlan('dejar el 5; mover el 3 a Jorge; descartar el 4', r, V);
    expect(res.tipo).toBe('corregir');
    const p2 = aplicarCambios(r, (res as { cambios: never }).cambios);
    expect(pendientes(p2)).toEqual([]);
    expect(gruposDelPlan(p2).map(g => [codigo(g.destino), g.mensajes])).toEqual([['T1 26 11', [2, 5]], ['T1 26 8', [3]]]);
    expect(interpretarRespuestaPlan('sí', p2, V)).toEqual({ tipo: 'si' });
  });

  it('«dejar todos» deja los sospechosos; uno de dos viajes no se deja ni se mueve, solo se descarta', () => {
    const dejar = interpretarRespuestaPlan('dejar todos', r, V);
    expect(dejar).toEqual({ tipo: 'corregir', cambios: [{ ns: [3, 5], a: 'dejar' }] });
    expect(interpretarRespuestaPlan('dejar el 4', r, V)).toMatchObject({ tipo: 'no_entendida', aviso: expect.stringContaining('habla de dos viajes') });
    expect(interpretarRespuestaPlan('descartar los pendientes', r, V)).toEqual({ tipo: 'corregir', cambios: [{ ns: [3, 4, 5], a: 'descartar' }] });
  });

  it.each(['sí', 'Si', 'dale', 'confirmo'])('«%s» es sí', x => expect(esSi(x)).toBe(true));
  it.each(['ok pero falta uno', 'sí no', 'ok', '', '👍'])('«%s» NO es sí', x => expect(esSi(x)).toBe(false));
});

describe('el resumen', () => {
  it('muestra cada sospechoso con su texto y su motivo, y no pasa de 3.800 caracteres aunque sean 60 mensajes', () => {
    const ms = [enc(1, 'Carolina'), ...Array.from({ length: 60 }, (_, i) => m(i + 2, i % 10 === 5 ? 'Hola Tati, soy Andrés, una pregunta larga sobre el hotel y el traslado' : `mensaje número ${i + 2} con algo de texto del cliente`))];
    const r = plan(ms).plan;
    const txt = textoResumenPlan(r, ms);
    expect(txt.length).toBeLessThanOrEqual(MAX_LARGO_RESUMEN);
    for (const x of pendientes(r)) expect(txt).toContain(`\n   ${x.n} «`);
    expect(rangos([9, 2, 3, 4, 6, 10])).toBe('2-4, 6, 9-10');
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

describe('el día sintético CON encabezados (2 olvidados, 1 mal escrito)', () => {
  const nombre = (d: DestinoPlan) => (d.tipo === 'existente' ? d.codigo : `NUEVO ${d.cliente}`);
  it('ningún mensaje se carga en un viaje ajeno sin pasar por el comercial; cuenta las preguntas del día', () => {
    let decisiones = 0;
    let cargados = 0;
    const porEntrega: number[] = [];
    for (const e of diaEnc.entregas) {
      const ms: MensajeViaje[] = e.mensajes.map((x, i) => ({ n: i + 1, cuerpo: x.texto, reenviado: x.reenviado, tipo: x.tipo, en: x.en }));
      const r = plan(ms, e.viajes as ViajeAbierto[]);
      expect(r.conEncabezados).toBe(true);
      for (const c of cargaSinDecidir(r.plan)) {
        expect(nombre(c.destino!), `«${e.mensajes[c.n - 1].texto}»`).toBe(e.mensajes[c.n - 1].verdad);
        cargados++;
      }
      const p = pendientes(r.plan).length;
      porEntrega.push(p);
      decisiones += p;
      const txt = textoResumenPlan(r.plan, ms);
      for (const x of pendientes(r.plan)) expect(txt).toContain(`\n   ${x.n} «`);
    }
    // El número que pidió Mauricio: 6 resúmenes (uno por entrega) y estas decisiones de mensaje.
    expect({ resumenes: diaEnc.entregas.length, decisiones, porEntrega, cargados }).toMatchSnapshot();
  });
});
