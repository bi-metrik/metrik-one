// ============================================================
// Arnés de conducta del asistente — el modelo real sobre las dos conversaciones del 22 y 28-oct (Deno), 2026-10-29
// ------------------------------------------------------------
// Uso (las llaves llegan por el entorno y nunca se imprimen; ver `conducta.sh`):
//   ANTHROPIC_API_KEY=… GEMINI_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/conducta.ts
//     --salida <dir> [--k 3] [--solo id1,id2]
// · Conversación: Claude Haiku 5.5 (como la bandeja en producción), sin respaldo. Extracción: Gemini con la llave de
//   PRUEBAS (`extraccionGemini`). La base es la de memoria; datos inventados (otra clienta, otro destino, otras fechas).
// · Lo que escribe el comercial es fijo (la conversación real, rehecha): mide lo que hace el bot con eso.
// · Calificación: las dañinas de siempre (`calificar`) y las cinco fallas del 28-oct, contadas en lo que salió:
//   reenvío perdido, «el cliente dice», pregunta repetida, campo de una opción trabado y propuesta larga.
// · Corre igual sobre `main` y sobre la rama: se compara el mismo script con el código de cada una.
// ============================================================

import { CONFIG_POR_DEFECTO } from '../config.ts';
import { escenario, reglamentoDePrueba } from '../escenario.ts';
import type { Escenario } from '../escenario.ts';
import { modeloGemini } from '../modelo-gemini.ts';
import { REGLAMENTO_ANEXO_A } from '../bandeja/reglamento-anexo-a.ts';
import { conPerfil } from '../bandeja/reglamento-perfil.ts';
import type { ContactoMem } from '../memoria.ts';
import { calificar } from './calificar.ts';
import { CAMPOS_ARNES } from './conjuntos.ts';
import type { CasoArnes, PasoGuion } from './conjuntos.ts';
import { extraccionGemini } from './extraccion-gemini.ts';
import { PRECIOS_312 } from './correr.ts';

const args = Deno.args;
const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const LLAVE_GEMINI = Deno.env.get('GEMINI_API_KEY') ?? '';
const K = Number(arg('--k') ?? 1);
const SALIDA = arg('--salida') ?? '.';

/** Una pregunta que no debe volver a salir después de que el comercial dio el dato (paso desde el que cuenta). */
interface Prohibida { desde: number; que: string; re: RegExp }
interface CasoConducta {
  id: string;
  titulo: string;
  contactos: ContactoMem[];
  pasos: PasoGuion[];
  prohibidas: Prohibida[];
  /** Lo que el viaje abierto en el caso tiene que tener al final (lo reenviado y lo escrito). */
  final: Record<string, unknown>;
  /** Solo dieron una ventana de fechas («entre el 21 de junio y el 4 de julio, lo proponemos»): ni salida ni regreso. */
  sinFechas?: boolean;
  /** Si al final del guion queda este botón (el modelo pidió una confirmación de más y el guion se corrió), se toca. */
  cierre?: string;
}

const PASOS_BONAIRE: PasoGuion[] = [
  { escribe: 'Nueva solicitud' },
  { escribe: 'Lina Prieto' },
  { escribe: 'No tengo aún correo o celular de Lina' },
  { escribe: '311 5550199 usemos este número temporal para poder avanzar' },
  { toca: 'Crear' },
  { reenvia: 'Bonaire entre el 12 de julio al 25 de julio' },
  { reenvia: 'Dos adultos' },
  { escribe: 'viaja desde Medellín' },
  { toca: 'Carla Comercial', oEscribe: 'Lo lleva Carla Comercial' },
  { toca: 'Sí, ábrelo' },
  { toca: 'Anotar' },
  { escribe: 'regreso puede ser un rango de fecha' },
  { escribe: 'entre el 12 de julio y el 25 de julio de 2027' },
  { toca: 'Anotar' },
  { escribe: 'sin niños y sin infantes' },
  { toca: 'Anotar' },
  { escribe: 'Hoteles 3, 4 y 5 estrellas' },
  { toca: 'Anotar' },
  { escribe: 'Categoría 3 y 4 estrellas' },
  { toca: 'Anotar' },
];

const PASOS_JAMAICA: PasoGuion[] = [
  { escribe: 'Nueva solicitud' },
  { escribe: 'Se llama Andrés Quintero\nQuiere viajar a Jamaica o Barbados' },
  { reenvia: 'Hola, queremos ir con mi esposa y el niño al Caribe, nos sugieren Jamaica o Barbados porque no hay riesgo de huracanes. Sería como para la última semana de noviembre o primera de diciembre.' },
  { escribe: 'Usuario @aquintero77' },
  { escribe: 'Es un cliente referido' },
  { toca: 'Crear' },
  { escribe: 'Ahorita te digo quién lo manejará, sigamos avanzando' },
  { escribe: 'Quiere plan todo incluido, y viajar 6 días 5 noches' },
  { toca: 'Carla Comercial', oEscribe: 'Lo lleva Carla Comercial' },
  { toca: 'Sí, ábrelo' },
  { toca: 'Anotar' },
  { escribe: 'Es flexible para viajar a finales de noviembre o primeros días de diciembre' },
  { escribe: 'Es para 2 adultos y 1 niño menor de 11 años' },
  { escribe: 'Solo rango sin fecha exacta' },
  { escribe: 'Viajan desde Bogotá\nLa fecha puede ser 26 noviembre\nCategoría hotel 4 o 5 estrellas' },
  { escribe: '5 estrellas' },
  { toca: 'Anotar' },
  { escribe: 'Niño tiene 2 años' },
  { toca: 'Anotar' },
];

// La conversación de Mauricio con la mano derecha (29-oct, 17:18, viaje E1 26 1), rehecha con otra clienta: dos dudas de
// la extracción volvieron en los tres turnos de anotar aunque las contestó.
const PASOS_GUZMAN: PasoGuion[] = [
  { escribe: 'Hola, vamos a crear un nuevo viaje para la señora Rincón, es un viaje para dos adultos, le vamos a dar un rango de fechas o sea fechas móviles para que por favor propongamos entre el 21 de junio y el 4 de julio del otro año, entre esas dos fechas lo que salga mejor, la mejor tarifa posible. Van solos, van sin niños, quieren hoteles de entre tres y cuatro estrellas, veamos qué opciones le podemos ofrecer entre esas dos categorías. Dime qué más hace falta.' },
  { escribe: 'Es Marta Rincón con celular 3155550142.' },
  { toca: 'Crear' },
  { escribe: 'Asígneselo a Beto Ventas, por favor.', },
  { toca: 'Sí, ábrelo' },
  { escribe: 'Propongamos algunos hoteles de tres estrellas y otros de cuatro estrellas, las dos opciones, y que ella elija' },
  { escribe: 'Ella quiere viajar a Curazao. Saldría desde Bogotá. La fecha de salida y la de regreso las tenemos que proponer nosotros. Te doy el margen, entre el 21 de junio y el 4 de julio. Y la categoría del hotel tres o cuatro estrellas, proponerle las dos categorías.' },
  { toca: 'Anotar' },
];

// 30-oct (Edgar, Trappvel): el pedido se escribe ANTES de crear al cliente; tras «Crear» el modelo abría el viaje sin
// `desde` y el pedido se perdía (2 de 3 corridas, igual en main).
const PASOS_PEDIDO_PRIMERO: PasoGuion[] = [
  { escribe: 'Hola, necesito cotizar un viaje para dos adultos a Curazao, salen el 21 de junio de 2027 y regresan el 28 de junio' },
  { escribe: 'Es Marta Rincón con celular 3155550142' },
  { toca: 'Crear' },
  { toca: 'Carla Comercial', oEscribe: 'Lo lleva Carla Comercial' },
  { toca: 'Sí, ábrelo' },
  { toca: 'Anotar' },
];

export const CASOS_CONDUCTA: CasoConducta[] = [
  {
    id: 'k-bonaire', titulo: 'Reenvíos antes de abrir, rango del regreso y «3, 4 y 5 estrellas» (28-oct)',
    contactos: [], pasos: PASOS_BONAIRE,
    prohibidas: [
      // Los adultos llegaron reenviados en el paso 7 (índice 6).
      { desde: 6, que: 'adultos', re: /cu[aá]ntos adultos|n[uú]mero de adultos/i },
      { desde: 6, que: 'fechas', re: /(reenv[ií]a|p[aá]same|me (las )?(pasas|das)).{0,40}fechas|fecha de salida\?/i },
      // El rango del regreso lo dijo en el paso 13 (índice 12).
      { desde: 13, que: 'rango del regreso', re: /(regreso|regresar).{0,80}\?/i },
      // Las categorías las dio en el paso 17 (índice 16): se puede preguntar a lo más una vez (se cuenta aparte).
      { desde: 19, que: 'categoría', re: /categor[ií]a.{0,80}\?/i },
    ],
    final: { adultos: 2 },
  },
  {
    id: 'k-jamaica', titulo: 'Edad del niño y «4 o 5 estrellas» → «5 estrellas» (22-oct)',
    contactos: [], pasos: PASOS_JAMAICA,
    prohibidas: [
      { desde: 16, que: 'categoría', re: /categor[ií]a.{0,80}\?|4 o 5 estrellas.{0,40}\?/i },
      { desde: 18, que: 'edad del niño', re: /edad.{0,60}\?|a[ñn]os tiene/i },
    ],
    final: { adultos: 2, ninos: 1, categoria_hotel: '5' },
  },
  {
    id: 'k-guzman', titulo: 'Ventana de fechas que propone la agencia y «3 o 4 estrellas, las dos» (29-oct, mano derecha)',
    contactos: [], pasos: PASOS_GUZMAN,
    prohibidas: [
      // La ventana y las categorías las dijo en el primer mensaje: no se preguntan ni se fija una fecha.
      { desde: 0, que: 'fechas', re: /(fecha|salida|regreso|rango).{0,80}\?/i },
      { desde: 0, que: 'categoría', re: /(categor[ií]a|estrellas).{0,80}\?/i },
    ],
    final: { adultos: 2, categoria_hotel: '3' },
    sinFechas: true,
  },
  {
    id: 'k-pedido-primero', titulo: 'Pedido escrito antes de crear al cliente → abrir el viaje (30-oct)',
    contactos: [], pasos: PASOS_PEDIDO_PRIMERO,
    prohibidas: [{ desde: 0, que: 'adultos', re: /cu[aá]ntos adultos|n[uú]mero de adultos|cu[aá]ntas personas/i }],
    final: { adultos: 2 },
    cierre: 'Anotar',
  },
];

interface Medida {
  id: string; corrida: number; daninas: string[]; error?: string;
  reenvioPerdido: boolean; clienteDice: number; repetidas: string[]; trabado: boolean;
  propuestas: number; propuestasLargas: number; maxPropuesta: number; reenviame: number; fechaInventada: boolean; final: Record<string, unknown>; transcripcion: string[]; diagnostico: string[];
}

async function tocarOEscribir(e: Escenario, titulo: string, oEscribe = 'sí'): Promise<string> {
  try { await e.toca(titulo); return `[toque: ${titulo}]`; } catch { await e.escribe(oEscribe); return `«${oEscribe}» (no había botón «${titulo}»)`; }
}

/** Una propuesta (con botones) es larga si pasa de 8 líneas o 450 caracteres (en vivo llegaron a 14 líneas). */
const LARGA = (t: string) => t.split('\n').length > 8 || t.length > 450;

async function correrCaso(c: CasoConducta, corrida: number): Promise<Medida> {
  const reglamento = await reglamentoDePrueba(conPerfil(REGLAMENTO_ANEXO_A));
  const modelo = modeloGemini({ llave: '', principal: CONFIG_POR_DEFECTO.principal, respaldo: null, corteMs: CONFIG_POR_DEFECTO.corteMs, haiku: true });
  const e = await escenario({ modelo, contactos: structuredClone(c.contactos), viajes: [], reglamento, reloj: () => performance.now(), campos: CAMPOS_ARNES, extraer: extraccionGemini(LLAVE_GEMINI) });
  const transcripcion: string[] = [];
  const salidasPorPaso: string[][] = [];
  const diagnostico: string[] = [];
  let cargasVistas = 0;
  let error: string | undefined;
  try {
    for (const p of c.pasos) {
      const antes = e.mensajero.enviados.length;
      if (p.escribe !== undefined) { await e.escribe(p.escribe); transcripcion.push(`> ${p.escribe}`); }
      else if (p.reenvia !== undefined) { await e.reenvia(p.reenvia); transcripcion.push(`> (reenvío) ${p.reenvia}`); }
      else if (p.toca !== undefined) transcripcion.push(`> ${await tocarOEscribir(e, p.toca, p.oEscribe)}`);
      const nuevas = e.mensajero.enviados.slice(antes).map((x) => x.salida);
      salidasPorPaso.push(nuevas.map((s) => s.texto));
      for (const s of nuevas) transcripcion.push(`< ${s.texto.replace(/\n/g, '\n  ')}${'opciones' in s ? `  ${s.opciones.map((o) => `[${o.titulo}]`).join(' ')}` : ''}`);
      // Para diagnosticar: lo que llamó el modelo y lo que recibió cada lectura de este paso.
      for (const t of e.pasos.at(-1)?.trazas ?? []) {
        for (const h of t.herramientas ?? []) diagnostico.push(`paso ${salidasPorPaso.length}: ${h.nombre} ${JSON.stringify(h.args).slice(0, 300)}${h.error ? ` → ${h.error.slice(0, 200)}` : ''}`);
        if (t.propuesta?.args_modelo) diagnostico.push(`paso ${salidasPorPaso.length}: proponer ${JSON.stringify(t.propuesta.args_modelo).slice(0, 300)}`);
      }
      for (const cg of e.puerto.cargas.slice(cargasVistas)) diagnostico.push(`paso ${salidasPorPaso.length}: lectura ${JSON.stringify(cg)}`);
      cargasVistas = e.puerto.cargas.length;
    }
    for (let n = 0; c.cierre && n < 2; n++) {
      const antes = e.mensajero.enviados.length;
      try { await e.toca(c.cierre); } catch { break; }
      transcripcion.push(`> [toque de cierre: ${c.cierre}]`);
      for (const s of e.mensajero.enviados.slice(antes).map((x) => x.salida)) transcripcion.push(`< ${s.texto.replace(/\n/g, '\n  ')}`);
    }
  } catch (err) { error = String(err).slice(0, 300); }

  const r = calificar({ id: c.id, conjunto: 1, titulo: c.titulo, contactos: c.contactos, viajes: [], esperado: () => ({ ok: true }) } as unknown as CasoArnes, e.pasos, e.puerto, e.pasos.flatMap((p) => p.trazas), PRECIOS_312, error);
  const todas = salidasPorPaso.flat();
  const repetidas: string[] = [];
  for (const q of c.prohibidas) {
    const n = salidasPorPaso.slice(q.desde + 1).flat().filter((t) => q.re.test(t)).length;
    if (n > 0) repetidas.push(`${q.que} ×${n}`);
  }
  const viaje = e.puerto.viajes.find((v) => v.abierto && e.puerto.escrituras.some((w) => w.tipo === 'viaje' && w.codigo === v.codigo));
  const final = viaje ? { ...viaje.datos } : {};
  delete (final as Record<string, unknown>)._sugeridos;
  const reenvioPerdido = !viaje || Object.entries(c.final).some(([k, v]) => k === 'adultos' && final[k] !== v);
  const propuestas = e.mensajero.enviados.map((x) => x.salida).filter((s) => s.tipo === 'botones' && /¿(Lo anoto|Cargo esto|Cargo)/.test(s.texto)).map((s) => s.texto);
  return {
    id: c.id, corrida, daninas: r.daninas, ...(error ? { error } : {}),
    reenvioPerdido,
    clienteDice: todas.filter((t) => /el cliente (dice|dijo|menciona)/i.test(t)).length,
    repetidas,
    trabado: Object.entries(c.final).some(([k, v]) => k === 'categoria_hotel' && final[k] !== v) || (c.id === 'k-bonaire' && !final.categoria_hotel),
    propuestas: propuestas.length, propuestasLargas: propuestas.filter(LARGA).length, maxPropuesta: Math.max(0, ...propuestas.map((t) => t.length)),
    reenviame: todas.filter((t) => /Reenv[ií]ame lo que te escribi/.test(t)).length,
    fechaInventada: !!c.sinFechas && (!!final.fecha_salida || !!final.fecha_regreso || propuestas.some((t) => /• Fecha de (salida|regreso):/.test(t))),
    final, transcripcion, diagnostico,
  };
}

if (import.meta.main) {
  if (!Deno.env.get('ANTHROPIC_API_KEY') || !LLAVE_GEMINI) { console.error('Faltan ANTHROPIC_API_KEY o GEMINI_API_KEY en el entorno.'); Deno.exit(2); }
  const solo = arg('--solo')?.split(',');
  const casos = CASOS_CONDUCTA.filter((c) => !solo || solo.includes(c.id));
  await Deno.mkdir(SALIDA, { recursive: true });
  const medidas: Medida[] = [];
  for (const c of casos) {
    for (let k = 1; k <= K; k++) {
      const m = await correrCaso(c, k);
      medidas.push(m);
      const { transcripcion, final, diagnostico, ...corto } = m;
      console.log(JSON.stringify(corto));
      await Deno.writeTextFile(`${SALIDA}/${c.id}-${k}.md`, [`# ${c.titulo} (corrida ${k})`, '', '```', ...transcripcion, '```', '', `Final: ${JSON.stringify(final)}`, '', '## Diagnóstico', '', '```', ...diagnostico, '```'].join('\n'));
    }
  }
  const suma = (f: (m: Medida) => number) => medidas.reduce((n, m) => n + f(m), 0);
  const resumen = {
    corridas: medidas.length,
    daninas: suma((m) => m.daninas.length),
    errores: suma((m) => (m.error ? 1 : 0)),
    reenvio_perdido: suma((m) => (m.reenvioPerdido ? 1 : 0)),
    cliente_dice: suma((m) => m.clienteDice),
    preguntas_repetidas: suma((m) => m.repetidas.length),
    trabado: suma((m) => (m.trabado ? 1 : 0)),
    reenviame: suma((m) => m.reenviame),
    fecha_inventada: suma((m) => (m.fechaInventada ? 1 : 0)),
    propuestas: suma((m) => m.propuestas),
    propuestas_largas: suma((m) => m.propuestasLargas),
    max_propuesta: Math.max(0, ...medidas.map((m) => m.maxPropuesta)),
  };
  console.log(JSON.stringify({ resumen }));
  await Deno.writeTextFile(`${SALIDA}/resumen.json`, JSON.stringify({ resumen, medidas: medidas.map(({ transcripcion: _t, diagnostico: _d, ...m }) => m) }, null, 2));
}
