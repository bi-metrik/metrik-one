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
import type { Modelo, PedidoModelo, Salida, Traza } from '../tipos.ts';
import { sumarUso } from '../uso.ts';
import type { PrecioModelo } from '../uso.ts';
import { percentil, tipoDeTurno } from './calificar.ts';
import { CASOS_ONE, MUNDOS } from './casos-one.ts';
import type { CasoOne } from './casos-one.ts';

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
  const gastos = puerto.escrituras.filter((w) => w.tipo === 'gasto');
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

  const motivos: string[] = [];
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

async function correrPasos(e: EscenarioOne, caso: CasoOne): Promise<string[]> {
  const dicho: string[] = [];
  for (const p of caso.pasos) {
    if (p.escribe !== undefined) { await e.escribe(p.escribe); dicho.push(p.escribe); }
    else if (p.foto !== undefined) { await e.foto(p.foto); dicho.push(`(foto) ${p.foto}`); }
    else if (p.dicta !== undefined) { await e.dicta(p.dicta); dicho.push(`(audio) ${p.dicta}`); }
    else if (p.elige !== undefined) dicho.push((await e.elige(p.elige)).como);
    else if (p.toca !== undefined) {
      try {
        await e.toca(p.toca);
        dicho.push(`[toque: ${p.toca}]`);
      } catch {
        const t = p.oEscribe ?? 'sí';
        await e.escribe(t);
        dicho.push(`«${t}» (no había botón «${p.toca}»)`);
      }
    }
  }
  return dicho;
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

  const resultados: ResultadoOne[] = [];
  const md: string[] = [];
  const todas: Traza[] = [];
  for (const c of casos) {
    const negocios = c.negocios ?? MUNDOS[c.mundo] ?? [];
    const e = await escenarioOne({ modelo: modelo(), negocios, rol: c.rol ?? 'owner', reloj: () => performance.now(), config: { corteMs: corte } });
    for (const g of c.gastosHoy ?? []) {
      const neg = negocios.find((x) => x.codigo === g.negocio);
      e.puerto.gastos.push({ id: `previo-${e.puerto.gastos.length + 1}`, fecha: '2026-10-21', monto: g.monto, categoria: g.categoria, descripcion: g.descripcion, negocio: g.negocio, negocioId: neg?.id ?? null, soporte: false });
    }
    let error: string | undefined;
    let dicho: string[] = [];
    try { dicho = await correrPasos(e, c); } catch (err) { error = String(err).slice(0, 300); }
    const trazas = e.trazas();
    todas.push(...trazas);
    const r = calificarOne(c, e.pasos, e.puerto, trazas, error);
    resultados.push(r);
    md.push(transcripcion(c, r, dicho));
    console.log(JSON.stringify({ caso: c.id, exito: r.exito.ok, motivo: r.exito.motivo, daninas: r.daninas, regresion: r.regresion, caidos: r.caidos, error: r.error ?? null }));
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
    turnos_con_modelo: { n: conModelo.length, p50: percentil(conModelo, 50), p90: percentil(conModelo, 90) },
    por_tipo: Object.fromEntries([...new Set(lat.map((l) => l.tipo))].sort().map((k) => { const xs = lat.filter((l) => l.tipo === k).map((l) => l.ms); return [k, { n: xs.length, p50: percentil(xs, 50), p90: percentil(xs, 90) }]; })),
    uso,
  };
  await Deno.mkdir(salida, { recursive: true });
  await Deno.writeTextFile(`${salida}/resultados.json`, JSON.stringify({ tabla: t, resultados }, null, 2));
  const etiqueta = seco ? 'seco' : `${MODELO_HAIKU}${conRespaldo ? `, respaldo ${CONFIG_POR_DEFECTO.respaldo?.modelo} al corte de ${corte} ms` : ', sin respaldo'}`;
  await Deno.writeTextFile(`${salida}/transcripciones.md`, [
    `# Arnés del dominio ONE — ${etiqueta}`, '',
    `Casos: ${t.casos} · éxito ${t.exitos} (${Math.round((100 * t.exitos) / Math.max(1, t.casos))} %) · dañinas ${t.daninas} · regresiones ${t.regresiones.length}${t.regresiones.length ? ` (${t.regresiones.join(', ')})` : ''} · «no pude» ${t.caidos}`,
    `Turnos con modelo: n=${t.turnos_con_modelo.n} · p50 ${t.turnos_con_modelo.p50} ms · p90 ${t.turnos_con_modelo.p90} ms`,
    `Tokens: entrada ${uso.entrada} · salida ${uso.salida} · ${uso.llamados} llamados · ${uso.costo_usd === null ? `sin precio (${uso.sin_precio.join(', ')})` : `${uso.costo_usd.toFixed(4)} USD`}`,
    '', ...md,
  ].join('\n'));
  console.log(JSON.stringify({ tabla: t }));
}
