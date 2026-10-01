/**
 * Los guardianes de la parte 2 del encargo (N1, N3, N4, N5, N6, N7, N8, N9 y el guardián de frase)
 * contra los grupos A4, B, C y D del plan de QA, con la salida del modelo GRABADA
 * (`__fixtures__/bandeja-banco-bcd.json`). Cada escenario trae una o más salidas (corridas): TODAS
 * tienen que cumplir la verdad de terreno.
 *
 * La config sale de ejecutar en PGlite el SQL PROVISIONAL de Trappvel sobre el bloque SINTÉTICO
 * (`solicitud-viaje-sintetica.json`, escrito a mano), como la prueba del chat de Punta Cana: nada
 * copiado de producción.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import banco from './__fixtures__/bandeja-banco-bcd.json';
import sintetica from '../../../src/lib/negocios/__fixtures__/solicitud-viaje-sintetica.json';
import {
  aplicarSumas,
  conDeducciones,
  fusionarSugeridos,
  huecos,
  mayusculasDeViaje,
  mensajeAlComercial,
  resumenEntendido,
  textoPreguntaContacto,
  interpretarRespuestaContacto,
  validarSalida,
  textoSaleDelMensaje,
  TEXTO_PIDE_NOMBRE,
  type CampoEntendible,
} from './wa-entendimiento-reglas.ts';
import {
  clasesDeMensajes,
  entenderEntrega,
  guardianPasajeros,
  haySolicitud,
  numerosDeGrupoPorMensaje,
  solicitudesDistintas,
  textoDosViajes,
  textoParaModelo,
  textoSinSolicitud,
  totalesDeclarados,
  type MensajeEntrega,
} from './wa-guardianes.ts';
import { detectarCruce, textoAvisoCruce } from './wa-carga-reglas.ts';
import { CONFIG_BANDEJA_POR_DEFECTO, LLAVE_BANDEJA, decidirRuta, leerConfigBandeja, type EntradaRuta } from './wa-bandeja-reglas.ts';

const RAIZ = path.resolve(__dirname, '../../..');
const SQLS = [
  'sql/trappvel/2026-09-28_solicitud-minimo-deseable-PROVISIONAL.sql',
  'sql/trappvel/2026-10-01_opciones-no-definido-PROVISIONAL.sql',
].map(f => readFileSync(path.join(RAIZ, f), 'utf8'));
const ID = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';

let db: PGlite;
let FIELDS: CampoEntendible[];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.bloque_configs (id uuid primary key, slug text, config_extra jsonb)`);
  await db.query(`insert into public.bloque_configs values ($1, 'condiciones_del_viaje', $2)`, [ID, { label: 'x', fields: sintetica }]);
  for (const sql of SQLS) await db.exec(sql);
  const r = await db.query<{ fields: CampoEntendible[] }>(`select config_extra->'fields' as fields from public.bloque_configs where id = $1`, [ID]);
  FIELDS = r.rows[0].fields;
}, 30_000);
afterAll(async () => { await db.close(); });

type Verdad = {
  campos?: Record<string, { eq?: unknown; vacio?: boolean; contiene?: string[]; unoDe?: unknown[] }>;
  prohibido?: string[];
  haySolicitud?: boolean;
  sinCampos?: boolean;
  solicitudes?: number;
  mensaje?: string;
  clases?: Record<string, string>;
  pregunta?: string[];
};

function aMensajes(ms: ReadonlyArray<{ texto: string; reenviado: boolean; origen: string }>): MensajeEntrega[] {
  return ms.map((m, i) => ({ n: i + 1, cuerpo: m.texto, reenviado: m.reenviado, tipo: 'text', origen: m.origen }));
}

/** Lo que haría `entenderNuevo` + `crearNegocio` + `mensajeAlComercial`, sin base ni WhatsApp. */
function correr(salida: unknown, mensajes: MensajeEntrega[]) {
  const e = entenderEntrega(salida, FIELDS, mensajes, { hoyISO: banco.hoy });
  const sug = conDeducciones(FIELDS, e.salida.sugeridos);
  let d: Record<string, unknown> = {};
  d = fusionarSugeridos(d, FIELDS, sug, { entrega_id: 'e', en: 'x' }).data;
  d = mayusculasDeViaje(FIELDS, aplicarSumas(FIELDS, d));
  const h = huecos(FIELDS, d);
  const msg = mensajeAlComercial({
    resumen: resumenEntendido(FIELDS, d), faltanMinimo: h.minimo.faltan, enlace: 'https://x/n', descartados: e.salida.descartados.map(x => x.slug),
  });
  return { e, data: d, msg };
}

describe('banco A4, B, C, D con la salida del modelo grabada', () => {
  for (const esc of banco.escenarios) {
    esc.salidas.forEach((salida, i) => {
      it(`${esc.id} · ${esc.titulo} (corrida ${i + 1})`, () => {
        const v = esc.verdad as Verdad;
        const mensajes = aMensajes(esc.mensajes);
        const { e, data, msg } = correr(salida, mensajes);
        for (const [slug, c] of Object.entries(v.campos ?? {})) {
          const val = data[slug];
          if (c.vacio) expect(val, slug).toBeUndefined();
          if (c.eq !== undefined) expect(val, slug).toBe(c.eq);
          if (c.unoDe) expect(c.unoDe, `${slug} = ${String(val)}`).toContain(val ?? null);
          for (const x of c.contiene ?? []) expect(String(val ?? ''), slug).toContain(x);
        }
        // Lo prohibido no aparece en ningún campo, ni en la historia, ni en el mensaje del bot.
        const todo = [JSON.stringify(data), e.salida.historia, msg].join('\n').toLowerCase();
        for (const p of v.prohibido ?? []) expect(todo, `«${p}»`).not.toContain(p.toLowerCase());
        if (v.haySolicitud !== undefined) expect(e.haySolicitud).toBe(v.haySolicitud);
        if (v.sinCampos) expect(e.salida.sugeridos).toEqual({});
        if (v.solicitudes !== undefined) expect(e.solicitudes.length).toBe(v.solicitudes);
        if (v.mensaje) expect(textoDosViajes(e.solicitudes)).toContain(v.mensaje);
        for (const [n, c] of Object.entries(v.clases ?? {})) expect(e.clases[Number(n)]).toBe(c);
        // Todo campo del mínimo que un guardián tiró entra en las preguntas del bot.
        for (const slug of v.pregunta ?? []) {
          const f = FIELDS.find(x => x.slug === slug)!;
          expect(msg, slug).toContain(String(f.pregunta));
        }
      });
    });
  }
});

describe('N7 · la historia es extractiva', () => {
  const B5 = banco.escenarios.find(x => x.id === 'B5')!;

  it('B5 en cinco corridas: ni el juicio ni su paráfrasis llegan a la historia', () => {
    const mensajes = aMensajes(B5.mensajes);
    for (let i = 0; i < 5; i++) {
      for (const s of B5.salidas) {
        const h = entenderEntrega(s, FIELDS, mensajes, { hoyISO: banco.hoy }).salida.historia.toLowerCase();
        expect(h).not.toMatch(/taca|queja|cr[ií]tica/);
        expect(h).toContain('«queremos ir a santa marta');
      }
    }
  });

  it('la prosa del modelo se ignora; solo quedan citas que están en lo que el cliente reenvió', () => {
    const ms = aMensajes([{ texto: 'queremos Cartagena en enero', reenviado: true, origen: 'texto' }]);
    const e = entenderEntrega({ historia: 'Una familia encantadora y algo exigente…', citas: ['queremos Cartagena', 'una familia exigente'], valores: {} }, FIELDS, ms);
    expect(e.salida.historia).toBe('El cliente dijo:\n«queremos Cartagena»');
  });

  it('una nota escrita por el comercial nunca se cita, aunque el modelo la clasifique como del cliente', () => {
    const ms = aMensajes([{ texto: 'tengo dos pasajeros para Punta Cana', reenviado: false, origen: 'transcripcion' }]);
    const e = entenderEntrega({ mensajes: [{ n: 1, clase: 'cliente' }], citas: ['tengo dos pasajeros para Punta Cana'], valores: {} }, FIELDS, ms);
    expect(e.salida.historia).toBe('');
  });
});

describe('N3 · quién habla', () => {
  it('el pie de un pago, una promoción y una nota sobre el cliente no son del cliente', () => {
    const ms = aMensajes([
      { texto: 'abono reserva Cartagena', reenviado: true, origen: 'pie_de_foto' },
      { texto: 'CANCÚN desde $3.2M por persona, aplican condiciones', reenviado: true, origen: 'texto' },
      { texto: 'ojo, la señora es muy exigente', reenviado: false, origen: 'texto' },
      { texto: 'queremos ir en diciembre', reenviado: true, origen: 'texto' },
      { texto: '', reenviado: true, origen: 'texto' },
    ]);
    expect(clasesDeMensajes({}, ms)).toEqual({ 1: 'tercero', 2: 'tercero', 3: 'comercial', 4: 'cliente', 5: 'ruido' });
  });

  it('A2: la nota de voz propia que relata la solicitud sí es del cliente (llena campos)', () => {
    const ms = aMensajes([{ texto: 'tengo dos pasajeros para Punta Cana del 15 al 20 de noviembre', reenviado: false, origen: 'transcripcion' }]);
    expect(clasesDeMensajes({ mensajes: [{ n: 1, clase: 'cliente' }] }, ms)).toEqual({ 1: 'cliente' });
  });

  it('el modelo ve los mensajes numerados y quién los mandó', () => {
    const ms = aMensajes([{ texto: 'hola', reenviado: true, origen: 'texto' }, { texto: 'ojo', reenviado: false, origen: 'transcripcion' }]);
    expect(textoParaModelo(ms)).toBe('[1] (reenviado) hola\n[2] (escrito por el comercial, nota de voz) ojo');
  });
});

describe('N1 · pasajeros', () => {
  const s = (sug: Record<string, { valor: number | string; frase: string }>) => ({ historia: '', cliente: { nombre: null, telefono: null }, sugeridos: sug, descartados: [] });

  it('los cortes de edad salen de la config', () => {
    const cfg = leerConfigBandeja({ bandeja_solicitudes: { edad_infante_menor_de: 3, edad_adulto_desde: 18 } });
    expect([cfg.edadInfanteMenorDe, cfg.edadAdultoDesde]).toEqual([3, 18]);
    // Al revés no vale ninguno; sin config, no hay cortes en el código (QA de #971 v5, C10).
    expect(leerConfigBandeja({ bandeja_solicitudes: { edad_infante_menor_de: 5, edad_adulto_desde: 3 } }).edadAdultoDesde).toBeNull();
    expect([leerConfigBandeja({ bandeja_solicitudes: {} }).edadInfanteMenorDe, leerConfigBandeja(null).edadAdultoDesde]).toEqual([null, null]);
    expect(leerConfigBandeja({ bandeja_solicitudes: { edad_adulto_desde: 12 } }).edadAdultoDesde).toBe(12);
    // Con adulto desde 18, «2 y 12» son un infante… no: 2 < 3 infante, 12 niño.
    const r = guardianPasajeros(s({ ninos: { valor: 2, frase: 'los niños' }, edades_menores: { valor: '2, 12', frase: 'los niños tienen 2 y 12' } }),
      'los niños tienen 2 y 12', { infanteMenorDe: 3, adultoDesde: 18 });
    expect([r.sugeridos.ninos?.valor, r.sugeridos.infantes]).toEqual([1, undefined]);
  });

  it('C10 (QA de #971 v5): sin cortes en la config, la edad justo en el borde se pregunta; con ellos, se decide', () => {
    const sug = () => s({ adultos: { valor: 2, frase: 'Vamos 2 adultos' }, ninos: { valor: 2, frase: 'los niños' }, edades_menores: { valor: '2, 12', frase: 'los niños tienen 2 y 12' } });
    const fuente = 'Vamos 2 adultos a San Andrés y los niños tienen 2 y 12';
    // Sin config: el de 12 no pasa a adulto callado.
    const sin = guardianPasajeros(sug(), fuente);
    expect([sin.sugeridos.adultos?.valor, sin.sugeridos.ninos, sin.sugeridos.infantes]).toEqual([2, undefined, undefined]);
    expect(sin.descartados.find(d => d.slug === 'ninos')?.motivo).toContain('justo en un corte que la config no define');
    // Con los cortes de Trappvel en la config (SQL provisional): 3 adultos, 1 niño, 0 infantes.
    const con = guardianPasajeros(sug(), fuente, { infanteMenorDe: 2, adultoDesde: 12 });
    expect([con.sugeridos.adultos?.valor, con.sugeridos.ninos?.valor, con.sugeridos.infantes?.valor]).toEqual([3, 1, 0]);
    // Solo el borde que falta se pregunta: con el de adulto configurado y el de infante no, «2» sigue sin decidirse.
    const medio = guardianPasajeros(sug(), fuente, { infanteMenorDe: null, adultoDesde: 12 });
    expect(medio.sugeridos.ninos).toBeUndefined();
    // Lejos de los bordes, nada cambia: «9 y 4» son dos niños con o sin config.
    const lejos = guardianPasajeros(s({ ninos: { valor: 2, frase: '2 niños' }, edades_menores: { valor: '9, 4', frase: 'tienen 9 y 4' } }), 'tienen 9 y 4');
    expect(lejos.sugeridos.ninos?.valor).toBe(2);
  });

  it('C10: el SQL provisional de Trappvel deja los dos cortes y conserva el resto de la config', async () => {
    const pg = new PGlite();
    await pg.exec(`create table public.workspaces (id uuid primary key, config_extra jsonb)`);
    await pg.query(`insert into public.workspaces values ('cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc', $1)`, [{ bandeja_solicitudes: { modo_viajes: 'uno' } }]);
    const sql = readFileSync(path.join(RAIZ, 'sql/trappvel/2026-10-01_cortes-de-edad-PROVISIONAL.sql'), 'utf8');
    await pg.exec(sql);
    await pg.exec(sql); // idempotente
    const r = await pg.query<{ c: unknown }>(`select config_extra as c from public.workspaces`);
    const cfg = leerConfigBandeja(r.rows[0].c);
    expect([cfg.edadInfanteMenorDe, cfg.edadAdultoDesde, cfg.modoViajes]).toEqual([2, 12, 'uno']);
    await pg.close();
  });

  it('C10: infantes = 0 no se deduce con un niño de 2 justos si la config no trae el corte de infante', () => {
    const f = (slug: string) => ({ slug, label: slug, type: 'text' } as unknown as CampoEntendible);
    const campos = [f('ninos'), f('infantes'), f('edades_menores')];
    const sug = { ninos: { valor: 1, frase: '1 niño' }, edades_menores: { valor: '2', frase: 'de 2' } };
    expect(conDeducciones(campos, sug).infantes).toBeUndefined();
    expect(conDeducciones(campos, sug, 2).infantes?.valor).toBe(0);
    expect(conDeducciones(campos, { ...sug, edades_menores: { valor: '5', frase: 'de 5' } }).infantes?.valor).toBe(0);
  });

  it('los totales y los números de grupo', () => {
    expect(totalesDeclarados('Somos 4 con los niños')).toEqual([4]);
    expect(totalesDeclarados('somos 2 adultos y 2 niños')).toEqual([]);
    expect(totalesDeclarados('en total 6 personas')).toEqual([6]);
    expect(numerosDeGrupoPorMensaje('somos 4 adultos\n---\nsomos 5, va mi hermano')).toEqual([[4], [5]]);
  });

  it('la suma no puede pasar el total declarado', () => {
    const r = guardianPasajeros(s({ adultos: { valor: 3, frase: '3 adultos' }, ninos: { valor: 2, frase: '2 niños' } }), 'en total 4 personas: 3 adultos y 2 niños');
    expect(r.sugeridos).toEqual({});
    expect(r.descartados[0].motivo).toContain('pasa el total que dijo el cliente (4)');
  });
});

describe('N4 · sin solicitud no se crea nada', () => {
  it('sin un mensaje del cliente con un dato, no hay solicitud', () => {
    expect(haySolicitud({ historia: '', cliente: { nombre: null, telefono: null }, sugeridos: {}, descartados: [] }, { 1: 'cliente' })).toBe(false);
    expect(haySolicitud({ historia: '', cliente: { nombre: null, telefono: null }, sugeridos: { destino: { valor: 'X', frase: 'x' } }, descartados: [] }, { 1: 'ruido' })).toBe(false);
    expect(textoSinSolicitud(4)).toContain('No vi una solicitud de viaje en estos 4 mensajes');
  });
});

describe('N5 · dos solicitudes', () => {
  it('frases que no están en los mensajes no cuentan; la misma frase con dos destinos es un viaje', () => {
    const t = 'Punta Cana o Curazao';
    expect(solicitudesDistintas({ solicitudes: [{ destino: 'A', frase: 'inventada' }, { destino: 'B', frase: 'otra' }] }, t)).toEqual([]);
    expect(solicitudesDistintas({ solicitudes: [{ destino: 'Punta Cana', frase: t }, { destino: 'Curazao', frase: t }] }, t)).toEqual([]);
  });
});

describe('N6 · viaje equivocado', () => {
  it('C1: los mensajes de Punta Cana no se cargan en el viaje de Jorge a Cartagena sin aviso', () => {
    const cruces = detectarCruce({ destinoNegocio: 'CARTAGENA', destinoMensajes: 'Punta Cana', clienteNegocio: 'JORGE PÉREZ', clienteMensajes: null });
    expect(cruces).toEqual([{ que: 'destino', enNegocio: 'CARTAGENA', enMensajes: 'Punta Cana' }]);
    expect(textoAvisoCruce({ codigo: 'T1 26 8', cliente: 'JORGE PÉREZ', destino: 'CARTAGENA', cruces }))
      .toBe('Estos mensajes hablan de Punta Cana y T1 26 8 es de JORGE PÉREZ a CARTAGENA. No cargué nada.\n¿Seguro que van ahí? Responde SÍ para cargarlos igual, o el número o el código del viaje correcto, o NUEVO y el nombre del cliente.');
  });

  it('el mismo destino escrito distinto, o una fecha que cambia, no es un cruce', () => {
    expect(detectarCruce({ destinoNegocio: 'PUNTA CANA', destinoMensajes: 'punta cana', clienteNegocio: 'CAROLINA RUIZ', clienteMensajes: 'Carolina' })).toEqual([]);
    expect(detectarCruce({ destinoNegocio: 'EUROPA: MADRID, PARÍS Y ROMA', destinoMensajes: 'Madrid', clienteNegocio: null, clienteMensajes: null })).toEqual([]);
    expect(detectarCruce({ destinoNegocio: null, destinoMensajes: 'Aruba', clienteNegocio: 'ANA', clienteMensajes: 'Luis Gómez' })).toEqual([{ que: 'cliente', enNegocio: 'ANA', enMensajes: 'Luis Gómez' }]);
  });
});

describe('N8 · ningún mensaje queda sin respuesta (regla 5 de decidirRuta)', () => {
  const ENC = { [LLAVE_BANDEJA]: true };
  const e = (p: Partial<EntradaRuta>): EntradaRuta => ({
    modules: ENC, config: CONFIG_BANDEJA_POR_DEFECTO, tipo: 'text', texto: '¿cuánto vendimos en septiembre?', reenviado: false, sesionBotEsperando: false, ...p,
  });

  it('B2: la consulta escrita sin tanda abierta ni pregunta pendiente va al bot de siempre', () => {
    expect(decidirRuta(e({ entregaAbierta: false, preguntaPendiente: false }))).toBe('bot');
    expect(decidirRuta(e({ texto: '¿cuánto me deben?', entregaAbierta: false, preguntaPendiente: false }))).toBe('bot');
    expect(decidirRuta(e({ texto: 'gasté 25.000 en taxi', entregaAbierta: false, preguntaPendiente: false }))).toBe('bot');
  });

  it('el orden de las reglas: reenvío, sesión del bot y prefijo antes que la regla 5', () => {
    expect(decidirRuta(e({ reenviado: true, entregaAbierta: false, preguntaPendiente: false }))).toBe('bandeja');
    expect(decidirRuta(e({ sesionBotEsperando: true, entregaAbierta: true }))).toBe('bot');
    expect(decidirRuta(e({ texto: 'gasto 20000 taxi', entregaAbierta: true }))).toBe('bot');
  });

  it('dentro de una tanda, con una pregunta pendiente o si es encabezado, se queda en la bandeja', () => {
    expect(decidirRuta(e({ entregaAbierta: true }))).toBe('bandeja');
    expect(decidirRuta(e({ texto: '2', entregaAbierta: false, preguntaPendiente: true }))).toBe('bandeja');
    expect(decidirRuta(e({ texto: 'Carolina', entregaAbierta: false, preguntaPendiente: false, esEncabezado: true }))).toBe('bandeja');
    // Una nota de voz propia (A2) abre tanda: la regla 5 es solo para texto.
    expect(decidirRuta(e({ tipo: 'audio', texto: '', entregaAbierta: false, preguntaPendiente: false }))).toBe('bandeja');
  });

  it('sin saber el contexto (error de lectura) se comporta como antes', () => {
    expect(decidirRuta(e({}))).toBe('bandeja');
  });
});

describe('N9 · NUEVO sin nombre pide el nombre', () => {
  it('la pregunta pide el nombre y «NUEVO Marta Gómez» lo trae', () => {
    expect(textoPreguntaContacto({ tipo: 'preguntar', motivo: 'ninguno', opciones: [], nombre: '' })).toBe(TEXTO_PIDE_NOMBRE);
    expect(interpretarRespuestaContacto('NUEVO Marta Gómez', [])).toEqual({ tipo: 'nuevo', nombre: 'Marta Gómez' });
    expect(interpretarRespuestaContacto('nuevo', [])).toEqual({ tipo: 'nuevo', nombre: null });
  });
});

describe('guardián de frase', () => {
  it('todo valor necesita su frase en los mensajes del CLIENTE; la de una promoción no sirve', () => {
    const ms = aMensajes([
      { texto: 'PUNTA CANA desde $2.5M, todo incluido', reenviado: true, origen: 'texto' },
      { texto: 'queremos ir en diciembre', reenviado: true, origen: 'texto' },
    ]);
    const e = entenderEntrega({ valores: { plan_alimentacion: { valor: 'todo_incluido', frase: 'todo incluido' } } }, FIELDS, ms);
    expect(e.salida.sugeridos).toEqual({});
    expect(e.salida.descartados).toEqual([{ slug: 'plan_alimentacion', motivo: 'sin frase del mensaje que lo sostenga' }]);
  });

  it('las deducciones llevan su regla anotada en lugar de la frase', () => {
    const ms = aMensajes([{ texto: 'Mi esposo y yo, a Cartagena', reenviado: true, origen: 'texto' }]);
    const e = entenderEntrega({ valores: { adultos: { valor: '2', frase: 'Mi esposo y yo' } } }, FIELDS, ms);
    expect(e.salida.sugeridos.ninos).toMatchObject({ valor: 0, deduccion: expect.stringContaining('ningún mensaje nombra menores') });
    expect(e.salida.sugeridos.infantes?.deduccion).toBeTruthy();
  });

  it('un texto redactado no entra; uno normalizado sí', () => {
    expect(textoSaleDelMensaje('Playas de arena blanca y aguas cristalinas', 'queremos playa')).toBe(false);
    expect(textoSaleDelMensaje('Bogotá', 'saliendo de bgta')).toBe(true);
  });

  it('validarSalida sin `citables` deja la historia vacía (nunca la prosa del modelo)', () => {
    expect(validarSalida({ historia: 'prosa', valores: {} }, FIELDS, 'x').historia).toBe('');
  });
});

/**
 * QA de #971 (modo uno, Gemini real). Cada salida grabada copia lo que el log de la corrida 1
 * registró (qa971/resultados-uno/<esc>.txt: clases, valores, cliente); la frase de cada valor es el
 * fragmento del mensaje que lo sostiene, porque el log no guarda la salida cruda.
 */
describe('QA de #971 · modo uno', () => {
  it('A3 · «un destino de playa» no es un destino: queda vacío y la preferencia va a requisitos', () => {
    const ms = aMensajes([{ texto: 'Hola! Somos 17 personas, 4 menores, queremos un destino de playa', reenviado: true, origen: 'texto' }]);
    // Log: [clases] {"1":"cliente"} · [ONE · valores] {"destino":"PLAYA","tipo_viaje":"playa","ninos":4,…}
    const grabada = { mensajes: [{ n: 1, clase: 'cliente' }], valores: {
      destino: { valor: 'Playa', frase: 'un destino de playa' }, tipo_viaje: { valor: 'playa', frase: 'destino de playa' }, ninos: { valor: '4', frase: '4 menores' },
    } };
    const { data, e } = correr(grabada, ms);
    expect(data.destino).toBeUndefined();
    expect(data.tipo_viaje).toBe('playa');
    expect(data.requisitos_especiales).toBe('UN DESTINO DE PLAYA');
    expect(e.salida.descartados.find(d => d.slug === 'destino')?.motivo).toContain('es una opción de');
  });

  it('A2 · la nota de voz propia que relata la solicitud es contenido; solo se excluyen los juicios', () => {
    const ms = aMensajes([{ texto: 'Tengo dos pasajeros para Punta Cana del 15 al 20 de noviembre', reenviado: false, origen: 'transcripcion' }]);
    // Log: [clases] {"1":"comercial"} · [haySolicitud] false · «No vi una solicitud de viaje en este mensaje».
    const grabada = { mensajes: [{ n: 1, clase: 'comercial' }], valores: {
      destino: { valor: 'Punta Cana', frase: 'para Punta Cana' },
      fecha_salida: { valor: '2026-11-15', frase: 'del 15 al 20 de noviembre' }, fecha_regreso: { valor: '2026-11-20', frase: 'del 15 al 20 de noviembre' },
      adultos: { valor: '2', frase: 'dos pasajeros' },
    } };
    const { data, e } = correr(grabada, ms);
    expect(e.clases[1]).toBe('cliente');
    expect(e.haySolicitud).toBe(true);
    expect(data).toMatchObject({ destino: 'PUNTA CANA', fecha_salida: '2026-11-15', fecha_regreso: '2026-11-20', adultos: 2 });
    // El juicio sí se excluye, aunque venga en nota de voz.
    const juicio = aMensajes([{ texto: 'ojo, esta señora es muy tacaña', reenviado: false, origen: 'transcripcion' }]);
    expect(clasesDeMensajes({ mensajes: [{ n: 1, clase: 'cliente' }] }, juicio)[1]).toBe('comercial');
  });

  it('C5 · «pta cana» llena el destino aunque el modelo marque el mensaje como ruido', () => {
    const ms = aMensajes([
      { texto: 'pta cana', reenviado: true, origen: 'texto' }, { texto: '2 adlts y 1 niño d 5', reenviado: true, origen: 'texto' },
      { texto: 'saliendo de bgta', reenviado: true, origen: 'texto' },
    ]);
    // Log: [clases] {"1":"ruido","2":"cliente","3":"cliente"} · destino descartado «sin frase del mensaje».
    const grabada = { mensajes: [{ n: 1, clase: 'ruido' }, { n: 2, clase: 'cliente' }, { n: 3, clase: 'cliente' }], valores: {
      destino: { valor: 'Punta Cana', frase: 'pta cana' }, ciudad_origen: { valor: 'Bogotá', frase: 'saliendo de bgta' },
    } };
    const { data, e } = correr(grabada, ms);
    expect(e.clases[1]).toBe('cliente');
    expect(data.destino).toBe('PUNTA CANA');
    // Un «jajaja» sin ningún valor sigue siendo ruido.
    expect(clasesDeMensajes({ mensajes: [{ n: 1, clase: 'ruido' }], valores: {} }, aMensajes([{ texto: 'jajaja', reenviado: true, origen: 'texto' }]))[1]).toBe('ruido');
  });

  it('E2a · un marcador del prompt nunca llega a un valor: sin nombre, el bot pide el nombre', () => {
    const ms = aMensajes([{ texto: 'Hola, queremos ir a Cartagena del 4 al 8 de diciembre, somos 2 adultos', reenviado: true, origen: 'texto' }]);
    // Log: «No encontré a «(no lo dijo)» en el directorio.»
    const e = entenderEntrega({ cliente: { nombre: '(no lo dijo)', telefono: '' }, valores: {} }, FIELDS, ms);
    expect(e.salida.cliente.nombre).toBeNull();
    expect(textoPreguntaContacto({ tipo: 'preguntar', motivo: 'ninguno', opciones: [], nombre: e.salida.cliente.nombre ?? '' })).toBe(TEXTO_PIDE_NOMBRE);
  });

  it('N6 · el nombre que se compara sale de quien se presenta en un mensaje del cliente, nunca del código ni de «Tati»', () => {
    const f1 = aMensajes([{ texto: 'Ya hablé con mi esposo: salimos el 28 de diciembre y volvemos el 3 de enero', reenviado: true, origen: 'texto' }]);
    // Log F1: «Estos mensajes hablan de Viaje T1 26 11 y T1 26 11 es de CAROLINA RUIZ…» (23 de 23 falsos en F).
    const e1 = entenderEntrega({ cliente: { nombre: 'Viaje T1 26 11' }, valores: {} }, FIELDS, f1);
    expect([e1.salida.cliente.nombre, e1.sePresenta]).toEqual([null, null]);
    expect(detectarCruce({ destinoNegocio: 'PUNTA CANA', destinoMensajes: null, clienteNegocio: 'CAROLINA RUIZ', clienteMensajes: e1.sePresenta })).toEqual([]);
    // Log del día: «Estos mensajes hablan de Tati y T1 26 9 es de LUISA MEJÍA…»
    const dia = aMensajes([{ texto: 'Buenas Tati, para San Andrés serían del 20 al 24 de noviembre', reenviado: true, origen: 'texto' }]);
    const e2 = entenderEntrega({ cliente: { nombre: 'Tati' }, valores: {} }, FIELDS, dia);
    expect(e2.sePresenta).toBeNull();
    // Quien sí se presenta cuenta; y si no es el cliente del negocio, el aviso es verdadero.
    const andres = aMensajes([{ texto: 'Hola, soy Andrés Gil, me pasó tu número Luisa, quiero cotizar Cancún', reenviado: true, origen: 'texto' }]);
    const e3 = entenderEntrega({ valores: {} }, FIELDS, andres);
    expect(e3.sePresenta).toBe('Andrés Gil');
    expect(detectarCruce({ destinoNegocio: null, destinoMensajes: null, clienteNegocio: 'CAROLINA RUIZ', clienteMensajes: e3.sePresenta })).toHaveLength(1);
  });
});
