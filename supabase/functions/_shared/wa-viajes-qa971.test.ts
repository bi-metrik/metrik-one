/**
 * El QA de #971 con Gemini real, reproducido sin red: las propuestas de asignación que el modelo
 * devolvió en las corridas REALES (`__fixtures__/bandeja-qa971.json`, copiadas de las líneas
 * «[modelo propuso]» de qa971/resultados-*: 5 corridas por escenario F, 3 de C1m/D1m/D2m y las 10
 * del día) pasan por el código actual. Lo que tiene que pasar en TODAS: ningún mensaje queda en un
 * viaje que no es el suyo; lo dudoso queda sin asignar, con su texto y su motivo en el resumen, y un
 * «sí» no lo descarta en silencio.
 */
import { describe, expect, it } from 'vitest';
import fx from './__fixtures__/bandeja-qa971.json';
import {
  armarPlan,
  armarSegmentos,
  destinosNombrados,
  interpretarRespuestaPlan,
  MAX_LARGO_RESUMEN,
  rangos,
  sinAsignar,
  sinLugares,
  textoResumenPlan,
  validarAsignaciones,
  viajesNombrados,
  type DestinoPlan,
  type MensajeViaje,
  type PlanViajes,
  type ViajeAbierto,
} from './wa-viajes-reglas.ts';
import { CONFIG_BANDEJA_POR_DEFECTO, LLAVE_BANDEJA, decidirRuta, empiezaConPrefijoBot } from './wa-bandeja-reglas.ts';

type Msg = { en: string; texto: string; reenviado: boolean; tipo: string; encabezado: boolean; verdad: unknown; ruta?: string | null };
const CFG = { segundosBloque: 600, horasCajaActiva: 4 };
const MODULES = { [LLAVE_BANDEJA]: true };

/** Lo que entra a la entrega con la ruta de HOY (una pregunta escrita va al bot: F14b). */
function aEntrega(ms: ReadonlyArray<Msg>): { mensajes: MensajeViaje[]; alBot: Msg[] } {
  // La numeración es la del harness del QA, que ya mandaba los gastos al bot.
  const numerados = ms.filter(m => !(m.tipo === 'text' && !m.reenviado && empiezaConPrefijoBot(m.texto, ['gasto'])));
  const mensajes: MensajeViaje[] = [];
  const alBot: Msg[] = [];
  numerados.forEach((m, i) => {
    const ruta = decidirRuta({
      modules: MODULES, config: CONFIG_BANDEJA_POR_DEFECTO, tipo: m.tipo === 'sticker' ? 'sticker' : m.tipo, texto: m.texto,
      reenviado: m.reenviado, sesionBotEsperando: false, entregaAbierta: true, preguntaPendiente: false, esEncabezado: m.encabezado,
    });
    if (ruta === 'bot') alBot.push(m);
    else mensajes.push({ n: i + 1, cuerpo: m.texto, reenviado: m.reenviado, tipo: m.tipo === 'audio' ? 'audio' : m.tipo, en: m.en });
  });
  return { mensajes, alBot };
}

function proponer(viajes: ViajeAbierto[], mensajes: MensajeViaje[], modelo: unknown, cerrados: string[] = []): PlanViajes {
  const { segmentos, encabezados } = armarSegmentos(mensajes, viajes, CFG);
  const asignaciones = validarAsignaciones(modelo, mensajes, viajes);
  return armarPlan({ mensajes, viajes, segmentos, encabezados, asignaciones, codigosCerrados: new Set(cerrados), segundosBloque: CFG.segundosBloque });
}

/** El resumen muestra cada mensaje sin asignar con su texto y su motivo. */
function resumenMarcaLosDudosos(plan: PlanViajes, mensajes: MensajeViaje[]) {
  const r = textoResumenPlan(plan, mensajes);
  expect(r.length).toBeLessThanOrEqual(MAX_LARGO_RESUMEN);
  for (const m of sinAsignar(plan)) expect(r, `el ${m.n} no aparece marcado`).toMatch(new RegExp(`\\n   ${m.n} «[^\\n]*\\(${(m.motivo ?? '').slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  // Y un «sí» no lo descarta en silencio.
  if (sinAsignar(plan).length > 0) expect(interpretarRespuestaPlan('sí', plan, []).tipo).toBe('no_entendida');
}

describe('grupo F y C1m/D1m/D2m con las propuestas reales del modelo (5 y 3 corridas)', () => {
  for (const e of fx.f) {
    it(`${e.id} · ${e.titulo}`, () => {
      const viajes = e.viajes as ViajeAbierto[];
      const msgs = e.mensajes as Msg[];
      const { mensajes, alBot } = aEntrega(msgs);
      for (const m of alBot) expect(m.verdad, `«${m.texto}» no debía ir al bot`).toEqual(['bot']);
      const gastos = msgs.filter(x => x.tipo === 'text' && !x.reenviado && empiezaConPrefijoBot(x.texto, ['gasto']));
      for (const m of msgs.filter(x => JSON.stringify(x.verdad) === '["bot"]')) expect([...alBot, ...gastos], `«${m.texto}» tenía que ir al bot`).toContain(m);
      const porN = new Map(mensajes.map(m => [m.n, msgs.filter(x => !(x.tipo === 'text' && !x.reenviado && empiezaConPrefijoBot(x.texto, ['gasto'])))[m.n - 1]]));
      e.modelos.forEach((modelo, corrida) => {
        const plan = proponer(viajes, mensajes, modelo, e.cerrados);
        for (const m of plan.mensajes) {
          if (!m.destino) continue;
          const permitido = (porN.get(m.n)?.verdad as string[] | null) ?? [];
          const dest = m.destino.tipo === 'existente' ? m.destino.negocio_id : `nuevo:${String(m.destino.cliente ?? '').toLowerCase()}`;
          const ok = permitido.some(p => p === dest || p === 'nuevo:*' && dest.startsWith('nuevo:') || (p.startsWith('nuevo:') && dest.startsWith(p)));
          expect(ok, `corrida ${corrida + 1}: el ${m.n} «${porN.get(m.n)?.texto}» quedó en ${dest} (vale: ${permitido.join(' | ')})`).toBe(true);
        }
        resumenMarcaLosDudosos(plan, mensajes);
      });
    });
  }
});

describe('el día sintético con las 10 corridas reales del modelo', () => {
  const nombre = (d: DestinoPlan) => (d.tipo === 'existente' ? d.codigo : `NUEVO ${d.cliente}`);
  for (let corrida = 0; corrida < 10; corrida++) {
    it(`corrida ${corrida + 1}: ningún mensaje en un viaje que no es el suyo, nada perdido en silencio`, () => {
      let bien = 0;
      for (const [k, ent] of fx.dia.entregas.entries()) {
        const msgs = ent.mensajes as Msg[];
        const { mensajes } = aEntrega(msgs);
        const plan = proponer(ent.viajes as ViajeAbierto[], mensajes, ent.modelos[corrida]);
        for (const m of plan.mensajes) {
          const ver = msgs[m.n - 1];
          if (!m.destino) continue;
          expect(nombre(m.destino), `E${k + 1} m${m.n} «${ver.texto}»`).toBe(ver.verdad);
          bien++;
        }
        resumenMarcaLosDudosos(plan, mensajes);
      }
      // Lo que se asigna, se asigna bien; y no se asigna nada por cercanía. Piso de lo que queda.
      expect(bien).toBeGreaterThanOrEqual(15);
    });
  }

  it('el resumen de un día entero en una sola entrega sigue mostrando cada dudoso, en menos de 4.096 caracteres', () => {
    const todos = fx.dia.entregas.flatMap(e => e.mensajes) as Msg[];
    const { mensajes } = aEntrega(todos);
    const viajes = fx.dia.entregas[1].viajes as ViajeAbierto[];
    const plan = proponer(viajes, mensajes, { asignaciones: [] });
    expect(mensajes.length).toBeGreaterThan(25);
    resumenMarcaLosDudosos(plan, mensajes);
    expect(textoResumenPlan(plan, mensajes)).toMatch(/\(\d+ mensajes: [\d, -]+\)/);
  });
});

describe('las piezas (pruebas puras)', () => {
  const V: ViajeAbierto[] = [
    { id: 'n9', codigo: 'T1 26 9', cliente: 'LUISA MEJÍA', destino: 'SAN ANDRÉS' },
    { id: 'n21', codigo: 'T1 26 21', cliente: 'ANDRÉS GIL', destino: null },
    { id: 'n8', codigo: 'T1 26 8', cliente: 'JORGE PÉREZ', destino: 'CARTAGENA' },
    { id: 'n11', codigo: 'T1 26 11', cliente: 'CAROLINA RUIZ', destino: 'PUNTA CANA' },
  ];
  const D = V.map(v => ({ tipo: 'existente', negocio_id: v.id, codigo: v.codigo, cliente: v.cliente }) as DestinoPlan);
  const t = (min: number) => new Date(Date.parse('2026-10-01T14:00:00Z') + min * 60_000).toISOString();
  const m = (n: number, cuerpo: string, min = n, reenviado = true): MensajeViaje => ({ n, cuerpo, reenviado, tipo: 'text', en: t(min) });

  it('9 · un nombre no hace match con un destino de los viajes abiertos («Isla Margarita» no es Margarita López)', () => {
    const W: ViajeAbierto[] = [{ id: 'a', codigo: 'T1 26 30', cliente: 'MARGARITA LÓPEZ', destino: null }, { id: 'b', codigo: 'T1 26 31', cliente: 'PEDRO', destino: 'ISLA MARGARITA' }];
    const DW = W.map(v => ({ tipo: 'existente', negocio_id: v.id, codigo: v.codigo, cliente: v.cliente }) as DestinoPlan);
    expect(viajesNombrados('queremos ir a Isla Margarita', DW, W)).toEqual([]);
    expect(viajesNombrados('soy Margarita', DW, W).map(d => d.cliente)).toEqual(['MARGARITA LÓPEZ']);
    // Y «San Andrés» aunque ningún viaje abierto vaya a San Andrés.
    expect(viajesNombrados('para San Andrés', DW.concat([{ tipo: 'existente', negocio_id: 'c', codigo: 'T1 26 32', cliente: 'ANDRÉS GIL' }]), W)).toEqual([]);
  });

  it('9 · «San Andrés» no nombra a Andrés Gil; «soy Andrés» sí', () => {
    expect(sinLugares('Buenas Tati, para San Andrés serían del 20', V)).toBe('buenas tati para serian del 20');
    expect(viajesNombrados('Buenas Tati, para San Andrés serían del 20', D, V)).toEqual([]);
    expect(viajesNombrados('Hola! soy Andrés otra vez', D, V).map(d => d.cliente)).toEqual(['ANDRÉS GIL']);
  });

  it('8 · el destino solo no es evidencia; nombrar el destino de otro viaje vuelve dudoso el mensaje de una caja', () => {
    expect(destinosNombrados('llevar a mi mamá a Cartagena', V)).toEqual(['cartagena']);
    const ms = [m(1, 'Carolina', 0, false), m(2, 'Hotel 5 estrellas'), m(3, 'Hola, para Cartagena somos 4 adultos'), m(4, 'del 8 al 12 de noviembre')];
    const plan = proponer(V, ms, { asignaciones: [{ n: 3, viaje: 'T1 26 8', evidencia: 'Cartagena' }] });
    expect(plan.mensajes.map(x => [x.n, x.destino ? (x.destino as { codigo: string }).codigo : null])).toEqual([[2, 'T1 26 11'], [3, null], [4, null]]);
    expect(plan.mensajes[1].motivo).toContain('habla de CARTAGENA y T1 26 11 va a PUNTA CANA');
  });

  it('7 · silencio, un mensaje de dos viajes o datos que chocan dentro de la caja: lo que sigue es dudoso', () => {
    const silencio = proponer(V, [m(1, 'Carolina', 0, false), m(2, 'somos 3 adultos', 1), m(3, 'salimos de Cali', 30)], { asignaciones: [] });
    expect(silencio.mensajes[1]).toMatchObject({ destino: null, motivo: expect.stringContaining('después de un silencio') });
    const varios = proponer(V, [m(1, 'Carolina', 0, false), m(2, 'lo de Carolina y lo de Jorge'), m(3, 'salimos de Barranquilla')], { asignaciones: [] });
    expect(varios.mensajes.map(x => x.destino)).toEqual([null, null]);
    const choque = proponer(V, [m(1, 'Carolina', 0, false), m(2, 'salimos el 28 de diciembre'), m(3, 'nosotros mejor del 20 al 24 de noviembre'), m(4, 'Vamos 2 adultos')], { asignaciones: [] });
    expect(choque.mensajes.map(x => x.destino ? 'C' : x.motivo?.slice(0, 20))).toEqual(['C', 'dice otras fechas qu', 'viene después de un ']);
    const saludo = proponer(V, [m(1, 'Carolina', 0, false), m(2, 'Hola Tati, todo incluido'), m(3, 'Hola Tati, buenas tardes')], { asignaciones: [] });
    expect(saludo.mensajes.map(x => x.destino ? 'C' : 'duda')).toEqual(['C', 'duda']);
  });

  it('10 · el «sí» no se acepta con mensajes sin asignar; «descartar los sin asignar» los descarta a la vista', () => {
    const plan = proponer(V, [m(1, 'Hola'), m(2, 'soy Carolina')], { asignaciones: [] });
    expect(sinAsignar(plan).map(x => x.n)).toEqual([]);
    const conSuelto = proponer(V, [m(1, 'soy Carolina'), m(2, 'soy Jorge'), m(3, 'somos 4')], { asignaciones: [] });
    expect(interpretarRespuestaPlan('sí', conSuelto, V)).toMatchObject({ tipo: 'no_entendida', aviso: expect.stringContaining('Antes del sí') });
    expect(interpretarRespuestaPlan('descartar los sin asignar', conSuelto, V)).toEqual({ tipo: 'corregir', cambios: [{ ns: [3], a: 'descartar' }] });
  });

  it('11 · una pregunta escrita con la tanda abierta va al bot; una respuesta pendiente o un reenvío, no', () => {
    const base = { modules: MODULES, config: CONFIG_BANDEJA_POR_DEFECTO, tipo: 'text', sesionBotEsperando: false, entregaAbierta: true };
    expect(decidirRuta({ ...base, texto: '¿cuánto vendimos en septiembre?', reenviado: false, preguntaPendiente: false })).toBe('bot');
    expect(decidirRuta({ ...base, texto: '¿el 4?', reenviado: false, preguntaPendiente: true })).toBe('bandeja');
    expect(decidirRuta({ ...base, texto: '¿el vuelo incluye maleta?', reenviado: true, preguntaPendiente: false })).toBe('bandeja');
    expect(decidirRuta({ ...base, texto: 'ojo, la señora quiere piscina', reenviado: false, preguntaPendiente: false })).toBe('bandeja');
  });

  it('13 · los rangos del resumen compacto', () => {
    expect(rangos([9, 2, 3, 4, 6, 10])).toBe('2-4, 6, 9-10');
  });
});
