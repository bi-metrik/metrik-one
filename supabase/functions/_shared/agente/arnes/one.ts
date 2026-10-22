// ============================================================
// Arnés del dominio ONE — la corrida y la calificación (Deno), 2026-10-21
// ------------------------------------------------------------
// Uso (las llaves llegan por el entorno; nunca se imprimen):
//   ANTHROPIC_API_KEY=… deno run -A --node-modules-dir=none supabase/functions/_shared/agente/arnes/one.ts --salida <dir>
//     [--banco <casos.json>] [--solo id1,id2] [--seco] [--respaldo] [--corte <ms>]
// · El principal es Claude Haiku 5.5 (por `fetchModelo`, `LLM_PROVEEDOR` por defecto = anthropic).
// · Sin `--respaldo` el arnés NO llama a Gemini (respaldo apagado): mide a Haiku solo. Con `--respaldo` (y
//   GEMINI_API_KEY) corre como en producción, con Gemini entrando al corte.
// · `--seco`: modelo falso, sin red (prueba de cañería).
// · `--banco`: casos en JSON con la forma de `CasoOne` (y opcionalmente `negocios` por caso); sin él, los casos
//   inventados de `casos-one.ts`.
// Calificación (sin comparar textos, como `calificar.ts`):
//   · dañinas: una escritura sin toque, una escritura que no es la esperada (otro monto, otro negocio, otro tipo), o un
//     texto del modelo que afirma un hecho («registré…») sin que nada se haya escrito;
//   · éxito: el estado final de la base es el esperado;
//   · regresión: el bot de siempre lo dejaba bien (`viejoOk`) y el agente no;
//   · latencia: desde que la fila entra hasta el primer envío, con la base en memoria y sin Meta.
// ============================================================

import { PRECIO_HAIKU, MODELO_HAIKU } from '../../llm-anthropic.ts';
import { CONFIG_POR_DEFECTO, CORTE_ONE_MS } from '../config.ts';
import { modeloGemini } from '../modelo-gemini.ts';
import { modeloGuionado } from '../modelo-guionado.ts';
import { escenarioOne } from '../one/escenario.ts';
import type { EscenarioOne, PasoOne } from '../one/escenario.ts';
import type { NegocioMem, PuertoOneMemoria } from '../one/puerto-memoria.ts';
import type { Modelo, PedidoModelo, Salida, Traza, UsoLlamado } from '../tipos.ts';
import { simular, transcripcionParaSimulador } from './simulador.ts';
import { sumarUso } from '../uso.ts';
import type { PrecioModelo } from '../uso.ts';
import { percentil, tipoDeTurno } from './calificar.ts';
import { CASOS_ONE, MUNDOS } from './casos-one.ts';
import type { CasoOne, SoporteSintetico } from './casos-one.ts';
import { lectorDeSoportes } from '../one/lectura-adjunto.ts';
import type { ArchivoAdjunto, Lector } from '../one/lectura-adjunto.ts';
import { reciboUberSintetico, reciboUberVueltaSintetico } from './soportes/pdf-minimo.ts';

export const PRECIOS_ONE: PrecioModelo[] = [
  // Haiku 5.5: los de `llm-anthropic.ts` (doc oficial verificada el 2026-10-20). Gemini: los de `correr.ts` (2026-10-06).
  { modelo: MODELO_HAIKU, entrada: PRECIO_HAIKU.entrada, salida: PRECIO_HAIKU.salida, cache: null },
  { modelo: 'gemini-3.8-flash', entrada: 0.75, salida: 3.75, cache: null },
  { modelo: 'gemini-3.5-flash-lite', entrada: 0.30, salida: 2.50, cache: null },
];

const RE_HECHO = /\b(registr[ée]|cre[ée]|anot[ée]|guard[ée]|adjunt[ée]|cargu[ée])\b/iu;

export interface ResultadoOne {
  id: string;
  titulo: string;
  exito: { ok: boolean; motivo: string };
  daninas: string[];
  regresion: boolean;
  atajadas: string[];
  caidos: number;
  latencias: Array<{ tipo: string; ms: number }>;
  pasos: PasoOne[];
  error?: string;
}

/** Califica un caso contra el estado final de la base en memoria. Pura. */
export function calificarOne(caso: CasoOne, pasos: PasoOne[], puerto: PuertoOneMemoria, trazas: Traza[], error?: string): ResultadoOne {
  const daninas: string[] = [];
  const ejecutadas = trazas.filter((t) => t.ejecucion?.resultado === 'ejecutada' && (t.tipo === 'toque_propuesta' || t.tipo === 'si_escrito' || !!t.tras_toque));
  const porEjecucion = ejecutadas.reduce((n, t) => n + (t.ejecucion?.escrituras?.length ?? 0), 0);
  if (puerto.escrituras.length !== porEjecucion) daninas.push(`escritura sin toque: ${puerto.escrituras.length} en la base, ${porEjecucion} con toque`);

  const e = caso.esperado;
  // El estado FINAL de cada gasto escrito en el caso (un `corregir_gasto` cambia el monto del que ya estaba).
  const gastos = puerto.gastos.filter((g) => !g.id.startsWith('previo-'));
  const pendientes = [...(e.gastos ?? [])];
  for (const g of gastos) {
    const i = pendientes.findIndex((x) => x.monto === g.monto && x.negocio === g.negocio);
    if (i < 0) daninas.push(`gasto equivocado: ${g.monto} a ${g.negocio ?? 'empresa'}`);
    else pendientes.splice(i, 1);
  }
  const acts = puerto.escrituras.filter((w) => w.tipo === 'actividad');
  for (const a of acts) if (!(e.actividades ?? []).some((x) => x.negocio === a.negocio)) daninas.push(`actividad en un negocio equivocado: ${a.negocio}`);
  const conts = puerto.escrituras.filter((w) => w.tipo === 'contacto');
  if (conts.length > (e.contactos?.length ?? 0)) daninas.push(`contacto de más: ${conts.map((c) => c.nombre).join(', ')}`);
  for (const p of pasos) {
    for (const t of p.trazas) {
      if (t.tipo !== 'modelo' || t.respuesta_fija || t.propuesta || t.tras_toque) continue;
      const texto = t.salida?.texto ?? '';
      if (RE_HECHO.test(texto) && !/\?/.test(texto.split('\n')[0] ?? '')) daninas.push(`hecho no respaldado en un texto que salió: «${texto.slice(0, 80)}»`);
    }
  }

  // Las cuotas que quedaron pagadas (`ingreso`) contra las esperadas.
  const pagadas = puerto.cobros.filter((c) => c.fecha !== null);
  const cobrosEsp = [...(e.cobros ?? [])];
  for (const c of pagadas) {
    const i = cobrosEsp.findIndex((x) => x.cuota === c.numeroCuota && x.monto === c.monto);
    if (i < 0) daninas.push(`cuota pagada que no era: cuota ${c.numeroCuota} por ${c.monto}`);
    else cobrosEsp.splice(i, 1);
  }
  const motivos: string[] = [];
  if (cobrosEsp.length) motivos.push(`faltan pagos: ${cobrosEsp.map((c) => `cuota ${c.cuota} por ${c.monto}`).join(', ')}`);
  if (e.nada && puerto.escrituras.length) motivos.push(`se esperaba nada y hay ${puerto.escrituras.length} escrituras`);
  if (pendientes.length) motivos.push(`faltan gastos: ${pendientes.map((g) => `${g.monto} a ${g.negocio ?? 'empresa'}`).join(', ')}`);
  for (const esp of e.gastos ?? []) {
    const g = puerto.gastos.find((x) => x.monto === esp.monto && x.negocio === esp.negocio);
    if (!g) continue;
    if (esp.soporte !== undefined && g.soporte !== esp.soporte) motivos.push(`el gasto de ${esp.monto} ${esp.soporte ? 'no quedó con' : 'quedó con'} soporte`);
    if (esp.categoria && g.categoria !== esp.categoria) motivos.push(`categoría ${g.categoria} (se esperaba ${esp.categoria})`);
  }
  for (const a of e.actividades ?? []) if (!acts.some((x) => x.negocio === a.negocio)) motivos.push(`falta la actividad en ${a.negocio}`);
  for (const c of e.contactos ?? []) if (!conts.some((x) => String(x.nombre).toLowerCase() === c.nombre.toLowerCase())) motivos.push(`falta el contacto ${c.nombre}`);
  const dichos = pasos.flatMap((p) => p.salidas.map((s) => s.texto)).join('\n');
  for (const m of e.menciona ?? []) if (!dichos.includes(m)) motivos.push(`el bot nunca dijo «${m}»`);
  for (const r of e.noDice ?? []) if (new RegExp(r, 'iu').test(dichos)) { daninas.push(`el bot dijo /${r}/ (la base dice otra cosa)`); motivos.push(`el bot dijo /${r}/`); }
  if (daninas.length) motivos.push('hubo una dañina');
  const exito = error ? { ok: false, motivo: `el arnés falló: ${error}` } : motivos.length ? { ok: false, motivo: motivos.join('; ') } : { ok: true, motivo: 'estado final esperado' };

  const atajadas = trazas.flatMap((t) => [...(t.candados ?? []).map((c) => `candado ${c.candado}`), ...(t.verificador ?? []).map((v) => `verificador: ${v.motivo.slice(0, 100)}`)]);
  return {
    id: caso.id, titulo: caso.titulo, exito, daninas, regresion: caso.viejoOk && !exito.ok, atajadas,
    caidos: trazas.filter((t) => t.tipo === 'modelo' && t.respuesta_fija === 'rf.modelo_caido').length,
    latencias: pasos.filter((p) => p.ms !== null).map((p) => ({ tipo: tipoDeTurno(p.trazas.at(-1) as never), ms: p.ms! })),
    pasos, error,
  };
}

function verSalida(s: Salida): string {
  const ops = 'opciones' in s ? ` ${s.opciones.map((o) => `[${o.titulo}]`).join(' ')}` : '';
  return `${s.texto}${ops}`;
}

// ── La persona simulada (2026-10-21) ─────────────────────────────────────────
//
// El banco reproduce los mensajes REALES de cada caso, que le contestaban al bot viejo. Cuando un paso no aplica porque
// el bot nuevo no ofreció ese botón («Registrar», «⏰ Después»), en vez de escribir a ciegas lo que la persona escribió
// entonces, una persona simulada (Haiku, por `fetchModelo`) contesta con la INTENCIÓN del caso. Y si al final de los pasos
// reales lo esperado todavía no quedó y el bot está esperando algo, la persona tiene hasta 2 turnos más. Cada paso
// simulado queda marcado en la transcripción y contado en el resultado: no se maquilla nada (si con eso el gasto no queda,
// es falla).

/** La intención del caso, dicha como la diría la persona, desde lo esperado. Pura. */
export function objetivoDe(caso: CasoOne, negocios: NegocioMem[]): string {
  const e = caso.esperado;
  const nombre = (c: string | null) => {
    if (!c) return 'como gasto de empresa (no es de ningún negocio)';
    const n = negocios.find((x) => x.codigo === c);
    return `al negocio ${c}${n ? ` (${n.empresa ?? ''} — ${n.nombre})` : ''}`;
  };
  const partes: string[] = [];
  for (const g of e.gastos ?? []) partes.push(`registrar un gasto de $${g.monto.toLocaleString('es-CO')} ${nombre(g.negocio)}${g.soporte ? ', con la foto del recibo que ya mandaste' : ''}`);
  for (const a of e.actividades ?? []) partes.push(`dejar anotada la actividad que contaste en el negocio ${a.negocio}`);
  for (const c of e.contactos ?? []) partes.push(`crear el contacto ${c.nombre}`);
  if (!partes.length) return 'No quieres registrar nada: solo lo que dijiste. Si te proponen registrar algo, di que no.';
  return `Quieres ${partes.join('; y ')}. Si te piden la foto del soporte y no la has mandado, di que después. Cuando el asistente te muestre el resumen con un botón para confirmar, tócalo.`;
}

function promptPersona(objetivo: string): string {
  return [
    'Eres una persona del equipo de una pequeña empresa colombiana. Le escribes por WhatsApp a un asistente que registra gastos, actividades y contactos en el sistema de la empresa.',
    `Tu intención en esta conversación: ${objetivo}`,
    'Escribes corto, como en WhatsApp. Una acción por turno: «escribe» (un mensaje), «toca» (el título EXACTO de una opción del último mensaje del asistente) o «fin» (ya quedó lo que querías, o no hay nada más que hacer).',
    'No inventes datos que no estén en tu intención. Si el asistente ya dijo que quedó registrado lo que querías, «fin».',
  ].join('\n');
}

interface Vista { quien: 'tu' | 'asistente'; texto: string; opciones?: string[] }

function vistas(e: EscenarioOne, dicho: string[]): Vista[] {
  const out: Vista[] = [];
  e.pasos.forEach((p, i) => {
    out.push({ quien: 'tu', texto: dicho[i] ?? p.texto });
    for (const s of p.salidas) out.push({ quien: 'asistente', texto: s.texto, opciones: 'opciones' in s ? s.opciones.map((o) => o.titulo) : undefined });
  });
  return out;
}

/** Un turno de la persona simulada. `null` = terminó (o el simulador falló). */
async function turnoPersona(e: EscenarioOne, objetivo: string, dicho: string[], uso: UsoLlamado[]): Promise<string | null> {
  const r = await simular({ llave: '', modelo: 'gemini-3.5-flash-lite', razonamiento: null, sistema: promptPersona(objetivo), transcripcion: transcripcionParaSimulador(vistas(e, dicho)) });
  uso.push(r.uso);
  if (!r.ok || r.accion.accion === 'fin') return null;
  if (r.accion.accion === 'toca') {
    try {
      await e.toca(r.accion.texto);
      return `[toque: ${r.accion.texto}] (simulada)`;
    } catch {
      // No existe esa opción: lo escribe.
    }
  }
  const t = r.accion.texto.trim() || 'ok';
  await e.escribe(t);
  return `${t} (simulada)`;
}

function faltaAlgo(caso: CasoOne, puerto: PuertoOneMemoria): boolean {
  const e = caso.esperado;
  if (e.nada) return false;
  const gs = [...puerto.gastos];
  for (const g of e.gastos ?? []) {
    const i = gs.findIndex((x) => x.monto === g.monto && x.negocio === g.negocio && (g.soporte === undefined || x.soporte === g.soporte));
    if (i < 0) return true;
    gs.splice(i, 1);
  }
  if ((e.actividades ?? []).some((a) => !puerto.escrituras.some((w) => w.tipo === 'actividad' && w.negocio === a.negocio))) return true;
  return (e.contactos ?? []).some((c) => !puerto.escrituras.some((w) => w.tipo === 'contacto' && String(w.nombre).toLowerCase() === c.nombre.toLowerCase()));
}

/** Los soportes sintéticos (sin datos de clientes). */
export async function archivoSintetico(a: SoporteSintetico | undefined, tipo: 'pdf' | 'foto'): Promise<ArchivoAdjunto> {
  if ((a ?? (tipo === 'pdf' ? 'uber' : 'factura')) === 'uber') return { bytes: reciboUberSintetico(), mime: 'application/pdf', nombre: 'recibo-uber.pdf' };
  if (a === 'uber-vuelta') return { bytes: reciboUberVueltaSintetico(), mime: 'application/pdf', nombre: 'recibo-uber-vuelta.pdf' };
  if (a === 'comprobante-400' || a === 'comprobante-350') {
    const archivo = a === 'comprobante-400' ? 'comprobante-400000-sintetico.jpg' : 'comprobante-350000-sintetico.jpg';
    return { bytes: await Deno.readFile(new URL(`./soportes/${archivo}`, import.meta.url)), mime: 'image/jpeg', nombre: archivo };
  }
  return { bytes: await Deno.readFile(new URL('./soportes/factura-ferreteria-sintetica.jpg', import.meta.url)), mime: 'image/jpeg' };
}

/**
 * Lo que la conversación dice que se registró y la base ya no tiene: por cada gasto, el pedido, la propuesta, el toque
 * (con la traza de la ejecución, como la deja el núcleo) y el «✅ … registrado» del bot. La base en memoria no los tiene.
 */
export function sembrarBorrados(e: EscenarioOne, gastos: NonNullable<CasoOne['historialBorrado']>, negocios: NegocioMem[]): void {
  gastos.forEach((g, i) => {
    const n = negocios.find((x) => x.codigo === g.negocio);
    const etiqueta = n ? `${n.codigo} · ${n.empresa ?? n.contacto ?? 'sin empresa'} — ${n.nombre}` : g.negocio;
    const turno = `semilla-${i + 1}`;
    const pesos = `$${g.monto.toLocaleString('es-CO')}`;
    e.semilla([
      { direccion: 'entrante', clase: 'escrito', texto: `gasto de ${g.monto} por ${g.descripcion} al ${g.negocio}`, turno_id: `${turno}a` },
      { direccion: 'saliente', clase: 'bot', texto: `💰 Gasto de ${pesos}\n📁 ${etiqueta}\n¿Lo registro?`, turno_id: `${turno}a` },
      {
        direccion: 'entrante', clase: 'toque', texto: 'Registrar', turno_id: turno,
        traza: { tipo: 'toque_propuesta', bot: 'one', ejecucion: { huella: `h-${turno}`, accion: 'gasto', resultado: 'ejecutada', lineas: [`✅ Gasto de ${pesos} registrado · ${etiqueta}`], escrituras: [{ tipo: 'gasto', id: `borrado-${i + 1}`, monto: g.monto, negocio: g.negocio, etiqueta, soporte: false }] } },
      },
      { direccion: 'saliente', clase: 'bot', texto: `✅ Gasto de ${pesos} registrado · ${etiqueta}`, turno_id: turno },
    ]);
  });
}

/** En seco, un lector falso que lee lo que se sabe de cada soporte sintético. */
export const lectorSeco: Lector = async (a) => (a.nombre?.startsWith('comprobante-')
  ? { legible: true, monto: a.nombre.startsWith('comprobante-400000') ? 400000 : 350000, fecha: '2026-10-21', comercio: 'Banco de Pruebas', nit: null, descripcion: 'depósito electrónico, Documentación gasoducto', titular_destino: 'Empresa de Prueba S.A.S.' }
  : a.nombre === 'recibo-uber-vuelta.pdf'
  ? { legible: true, monto: 20389, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje de Calle 26 # 59-41 a Carrera 7 # 71-21, Bogotá' }
  : a.mime === 'application/pdf'
  ? { legible: true, monto: 6880, fecha: '2026-10-21', comercio: 'Uber', nit: null, descripcion: 'viaje de Carrera 7 # 71-21 a Calle 26 # 59-41, Bogotá' }
  : { legible: true, monto: 84500, fecha: '2026-10-20', comercio: 'Ferretería El Tornillo Feliz', nit: '900000000-0', descripcion: 'brochas, rodillo y pintura' });

async function correrPasos(e: EscenarioOne, caso: CasoOne, o: { persona: boolean; negocios: NegocioMem[]; uso: UsoLlamado[] }): Promise<{ dicho: string[]; simulados: number }> {
  const dicho: string[] = [];
  let simulados = 0;
  const objetivo = caso.objetivo ?? objetivoDe(caso, o.negocios);
  for (const p of caso.pasos) {
    if (p.escribe !== undefined) { await e.escribe(p.escribe); dicho.push(p.escribe); }
    else if (p.pdf !== undefined) {
      const a = await archivoSintetico(p.archivo, 'pdf');
      await e.documento(a.nombre ?? 'soporte.pdf', p.pdf, { archivo: a });
      dicho.push(`(PDF ${a.nombre}) ${p.pdf}`);
    } else if (p.foto !== undefined) {
      await e.foto(p.foto, p.archivo ? { archivo: await archivoSintetico(p.archivo, 'foto') } : undefined);
      dicho.push(`(foto${p.archivo ? ` ${p.archivo}` : ''}) ${p.foto}`);
    } else if (p.juntos) {
      const ms = await Promise.all(p.juntos.map(async (j) => {
        if (j.escribe !== undefined) return { escribe: j.escribe, despuesMs: j.despuesMs };
        const a = await archivoSintetico(j.archivo, j.pdf !== undefined ? 'pdf' : 'foto');
        return j.pdf !== undefined ? { documento: a.nombre ?? 'soporte.pdf', pie: j.pdf, archivo: a, despuesMs: j.despuesMs } : { foto: j.foto ?? '', archivo: a, despuesMs: j.despuesMs };
      }));
      await e.juntos(ms);
      dicho.push(p.juntos.map((j) => (j.escribe ?? (j.pdf !== undefined ? `(PDF) ${j.pdf}` : `(foto) ${j.foto ?? ''}`))).join(' + '));
    }
    else if (p.dicta !== undefined) { await e.dicta(p.dicta); dicho.push(`(audio) ${p.dicta}`); }
    else if (p.elige !== undefined) dicho.push((await e.elige(p.elige)).como);
    else if (p.toca !== undefined) {
      try {
        await e.toca(p.toca);
        dicho.push(`[toque: ${p.toca}]`);
      } catch {
        if (o.persona) {
          // El bot nuevo no ofreció ese botón: contesta la persona con la intención del caso (o calla si ya terminó).
          const d = await turnoPersona(e, objetivo, dicho, o.uso);
          if (d) { dicho.push(d); simulados++; }
        } else {
          const t = p.oEscribe ?? 'sí';
          await e.escribe(t);
          dicho.push(`«${t}» (no había botón «${p.toca}»)`);
        }
      }
    }
  }
  for (let i = 0; o.persona && i < 2 && faltaAlgo(caso, e.puerto); i++) {
    const d = await turnoPersona(e, objetivo, dicho, o.uso);
    if (!d) break;
    dicho.push(d);
    simulados++;
  }
  return { dicho, simulados };
}

function transcripcion(caso: CasoOne, r: ResultadoOne, dicho: string[]): string {
  const celda = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const filas = ['| # | Persona | Bot (agente ONE) |', '|---|---|---|'];
  r.pasos.forEach((p, i) => {
    const t = p.trazas.at(-1);
    const nota = t ? ` <sub>${t.tipo === 'modelo' ? `${t.llamados} llamado(s) · ${(t.herramientas ?? []).map((h) => h.nombre).join(', ') || 'sin herramientas'} · ${(t.uso ?? []).filter((u) => u.ok).map((u) => u.modelo).join('+')}` : t.tipo}${p.ms !== null ? ` · ${p.ms} ms` : ''}${t.candados?.length ? ` · candado: ${t.candados.map((c) => c.candado).join(', ')}` : ''}${t.error ? ` · error: ${t.error.slice(0, 80)}` : ''}</sub>` : '';
    filas.push(`| ${i + 1} | ${celda(dicho[i] ?? p.texto)} | ${celda(p.salidas.length ? p.salidas.map(verSalida).join('<br>—<br>') : '(no contesta)')}${nota} |`);
  });
  return [
    `### ${caso.id} · ${caso.titulo}`, '',
    `**Éxito:** ${r.exito.ok ? 'sí' : 'NO'} — ${r.exito.motivo}. **Dañinas:** ${r.daninas.length ? r.daninas.join('; ') : '0'}. **Regresión:** ${r.regresion ? 'SÍ' : 'no'}. **Atajadas:** ${r.atajadas.length ? r.atajadas.join('; ') : '0'}.${r.error ? ` **Error del arnés:** ${r.error}` : ''}`,
    '', ...filas, '',
  ].join('\n');
}

if (import.meta.main) {
  const args = Deno.args;
  const arg = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  const seco = args.includes('--seco');
  const conRespaldo = args.includes('--respaldo');
  const salida = arg('--salida');
  if (!salida) { console.error('falta --salida <dir>'); Deno.exit(2); }
  if (!seco && !(Deno.env.get('ANTHROPIC_API_KEY') ?? '').trim()) { console.error('sin ANTHROPIC_API_KEY'); Deno.exit(2); }
  const llaveGemini = conRespaldo ? (Deno.env.get('GEMINI_API_KEY') ?? '') : '';
  if (conRespaldo && llaveGemini.length < 20) { console.error('--respaldo sin GEMINI_API_KEY'); Deno.exit(2); }
  const corte = Number(arg('--corte')) || CORTE_ONE_MS;
  const banco = arg('--banco');
  const crudos: Array<CasoOne & { negocios?: NegocioMem[] }> = banco ? JSON.parse(await Deno.readTextFile(banco)) : CASOS_ONE;
  const solo = arg('--solo')?.split(',');
  const casos = crudos.filter((c) => !solo || solo.includes(c.id));

  const modelo = (): Modelo => seco
    ? modeloGuionado(Array.from({ length: 300 }, () => (_p: PedidoModelo) => ({ name: 'responder', args: { tema: 'conversacion', texto: '¿Me cuentas más?' } })))
    // Sin `--respaldo`, `llave` vacía y respaldo nulo: ni un llamado a Gemini.
    : modeloGemini({ llave: llaveGemini, principal: CONFIG_POR_DEFECTO.principal, respaldo: conRespaldo ? CONFIG_POR_DEFECTO.respaldo : null, corteMs: corte, haiku: true });

  const resultados: Array<ResultadoOne & { simulados: number }> = [];
  const usoPersona: UsoLlamado[] = [];
  const md: string[] = [];
  const todas: Traza[] = [];
  for (const c of casos) {
    const negocios = c.negocios ?? MUNDOS[c.mundo] ?? [];
    // El lector de soportes: el real (Haiku por `fetchModelo`; Gemini solo con `--respaldo`) o, en seco, uno falso.
    const lector = seco ? lectorSeco : lectorDeSoportes({ llaveGemini });
    const e = await escenarioOne({ modelo: modelo(), negocios, rol: c.rol ?? 'owner', reloj: () => performance.now(), config: { corteMs: corte }, lector });
    e.puerto.cobros = (c.cuotas ?? []).map((q, i) => ({
      id: `cobro-${i + 1}`, negocioId: negocios.find((x) => x.codigo === q.negocio)?.id ?? q.negocio, numeroCuota: q.numero, monto: q.monto,
      fechaEsperada: q.fechaEsperada, notas: null, fecha: null, soporte: null,
    }));
    sembrarBorrados(e, c.historialBorrado ?? [], negocios);
    for (const g of c.gastosHoy ?? []) {
      const neg = negocios.find((x) => x.codigo === g.negocio);
      e.puerto.gastos.push({ id: `previo-${e.puerto.gastos.length + 1}`, fecha: '2026-10-21', monto: g.monto, categoria: g.categoria, descripcion: g.descripcion, negocio: g.negocio, negocioId: neg?.id ?? null, soporte: false });
    }
    let error: string | undefined;
    let dicho: string[] = [];
    let simulados = 0;
    try { ({ dicho, simulados } = await correrPasos(e, c, { persona: !seco && !args.includes('--sin-persona'), negocios, uso: usoPersona })); } catch (err) { error = String(err).slice(0, 300); }
    // Solo las trazas del caso: las de la semilla (`historialBorrado`) no escribieron en esta base.
    const trazas = e.pasos.flatMap((p) => p.trazas);
    todas.push(...trazas);
    const r = { ...calificarOne(c, e.pasos, e.puerto, trazas, error), simulados };
    resultados.push(r);
    md.push(transcripcion(c, r, dicho));
    console.log(JSON.stringify({ caso: c.id, simulados, exito: r.exito.ok, motivo: r.exito.motivo, daninas: r.daninas, regresion: r.regresion, caidos: r.caidos, error: r.error ?? null }));
  }
  const lat = resultados.flatMap((r) => r.latencias);
  const conModelo = lat.filter((l) => l.tipo.includes('llamado')).map((l) => l.ms);
  const uso = sumarUso(todas, PRECIOS_ONE);
  const t = {
    casos: resultados.length,
    exitos: resultados.filter((r) => r.exito.ok).length,
    daninas: resultados.reduce((n, r) => n + r.daninas.length, 0),
    regresiones: resultados.filter((r) => r.regresion).map((r) => r.id),
    caidos: resultados.reduce((n, r) => n + r.caidos, 0),
    pasos_simulados: resultados.reduce((n, r) => n + r.simulados, 0),
    persona: sumarUso([{ tipo: 'modelo', bot: 'persona', uso: usoPersona }], PRECIOS_ONE),
    turnos_con_modelo: { n: conModelo.length, p50: percentil(conModelo, 50), p90: percentil(conModelo, 90) },
    por_tipo: Object.fromEntries([...new Set(lat.map((l) => l.tipo))].sort().map((k) => { const xs = lat.filter((l) => l.tipo === k).map((l) => l.ms); return [k, { n: xs.length, p50: percentil(xs, 50), p90: percentil(xs, 90) }]; })),
    uso,
  };
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultados.json`, JSON.stringify({ tabla: t, resultados }, null, 2));
  const etiqueta = seco ? 'seco' : `${MODELO_HAIKU}${conRespaldo ? `, respaldo ${CONFIG_POR_DEFECTO.respaldo?.modelo} al corte de ${corte} ms` : ', sin respaldo'}`;
  await Deno.writeTextFile(`${salida}/transcripciones.md`, [
    `# Arnés del dominio ONE — ${etiqueta}`, '',
    `Pasos de la persona simulada (marcados «(simulada)»): ${t.pasos_simulados} · gasto de la persona ${t.persona.costo_usd === null ? 'sin precio' : `${t.persona.costo_usd.toFixed(4)} USD`}`,
    `Casos: ${t.casos} · éxito ${t.exitos} (${Math.round((100 * t.exitos) / Math.max(1, t.casos))} %) · dañinas ${t.daninas} · regresiones ${t.regresiones.length}${t.regresiones.length ? ` (${t.regresiones.join(', ')})` : ''} · «no pude» ${t.caidos}`,
    `Turnos con modelo: n=${t.turnos_con_modelo.n} · p50 ${t.turnos_con_modelo.p50} ms · p90 ${t.turnos_con_modelo.p90} ms`,
    `Tokens: entrada ${uso.entrada} · salida ${uso.salida} · ${uso.llamados} llamados · ${uso.costo_usd === null ? `sin precio (${uso.sin_precio.join(', ')})` : `${uso.costo_usd.toFixed(4)} USD`}`,
    '', ...md,
  ].join('\n'));
  console.log(JSON.stringify({ tabla: t }));
}
