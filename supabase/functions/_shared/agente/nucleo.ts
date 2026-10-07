// ============================================================
// Núcleo conversacional — el turno (§3.1, §3.3, §3.5)
// ------------------------------------------------------------
// [modelo] loop de máximo 3 llamados (modo ANY): lecturas en paralelo; termina con `responder` o `proponer`.
// [código] los candados: `proponer` no escribe (el dominio arma el resumen con datos reales); `responder` pasa por el
// tema cerrado, los límites de Meta y el verificador. Un error de formato o del verificador vuelve al modelo UNA vez
// (un llamado extra); la segunda, sale la respuesta fija con las opciones vigentes.
// [código, sin modelo] el toque de una propuesta y el «sí» escrito solo: se ejecuta si la huella sigue vigente, una sola
// vez (candado por huella).
// Todo deja traza: llamados, tokens por modelo, herramientas, reglas, candados, verificador y tiempos.
// ============================================================

import type { ConfigAgente } from './config.ts';
import { fechaBogota, mensajeDelTurno, recortarResultado, sistema } from './contexto.ts';
import { CIERRAN, declaraciones } from './herramientas.ts';
import { consultar, fichasDeHerramienta, respuestaFija, temas, bloqueSiempre } from './reglamento.ts';
import { botonesPropuesta, opcionesDelModelo, renderizar } from './render.ts';
import { respaldoDe, verificar } from './verificador.ts';
import type {
  Almacen, ContextoDominio, Dominio, FilaConversacion, Mensaje, Modelo, Parte, Propuesta, Reglamento, Salida, Traza, UsoLlamado,
} from './tipos.ts';

export interface DepsTurno {
  modelo: Modelo;
  dominio: Dominio;
  reglamento: Reglamento;
  config: ConfigAgente;
  /** Hora de pared (para el estado). */
  ahoraMs: () => number;
  /** Reloj monotónico (para medir). */
  reloj: () => number;
}

export interface EntradaTurno {
  turnoId: string;
  filas: FilaConversacion[];
  nuevos: FilaConversacion[];
  ctx: ContextoDominio;
}

export interface SalidaTurno {
  salida: Salida | null;
  traza: Traza;
}

type PropuestaGuardada = NonNullable<Traza['propuesta']>;

// ── Propuestas ───────────────────────────────────────────────────────────────

/** Todas las propuestas de la conversación, en orden, con lo que pasó con cada una. */
export function propuestas(filas: FilaConversacion[]): Array<{ p: PropuestaGuardada; resultado: string | null; at: string }> {
  const out: Array<{ p: PropuestaGuardada; resultado: string | null; at: string }> = [];
  for (const f of filas) {
    if (f.traza?.propuesta) out.push({ p: f.traza.propuesta, resultado: null, at: f.created_at });
    const e = f.traza?.ejecucion;
    if (e && (e.resultado === 'ejecutada' || e.resultado === 'rechazada')) {
      const x = out.find((o) => o.p.huella === e.huella);
      if (x && !x.resultado) x.resultado = e.resultado;
    }
  }
  return out;
}

/** La propuesta vigente: la última, si nadie la ejecutó ni la rechazó. */
export function propuestaVigente(filas: FilaConversacion[]): PropuestaGuardada | null {
  const ps = propuestas(filas);
  const u = ps.at(-1);
  return u && !u.resultado ? u.p : null;
}

export async function huellaPropuesta(accion: string, datos: unknown, turnoId: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ accion, datos, turnoId })));
  return [...new Uint8Array(d)].slice(0, 6).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function salidaPropuesta(p: PropuestaGuardada, arriba?: string): Salida {
  return { tipo: 'botones', texto: [arriba, p.resumen].filter(Boolean).join('\n'), opciones: botonesPropuesta(p.huella, p.si, p.no) };
}

// ── El estado y el respaldo ──────────────────────────────────────────────────

function estado(deps: DepsTurno, e: EntradaTurno): string[] {
  const vig = propuestaVigente(e.filas);
  return [
    `Ahora: ${fechaBogota(deps.ahoraMs())} (Bogotá).`,
    `Escribe: ${e.ctx.remitente.nombre} (${e.ctx.remitente.rol}).`,
    `Propuesta pendiente: ${vig ? `${vig.resumen.replace(/\n/g, ' · ')} — espera su toque` : 'ninguna'}.`,
    ...(deps.dominio.estado?.(e.ctx) ?? []),
  ];
}

/** Todo lo que respalda un dato del texto: la conversación, lo consultado, el estado y el reglamento. */
function fuentesDeRespaldo(e: EntradaTurno, extra: string[]): string[] {
  const f: string[] = [...extra];
  for (const x of e.filas) {
    if (x.texto) f.push(x.texto);
    for (const o of x.opciones ?? []) f.push(`${o.titulo} ${o.descripcion ?? ''}`);
    for (const h of x.traza?.herramientas ?? []) f.push(JSON.stringify(h.datos ?? ''));
    if (x.traza?.propuesta) f.push(x.traza.propuesta.resumen);
    for (const l of x.traza?.ejecucion?.lineas ?? []) f.push(l);
  }
  for (const r of e.ctx.resultadosPrevios) f.push(JSON.stringify(r.datos ?? ''));
  return f;
}

/** La respuesta fija de «no pude» con las opciones vigentes (la propuesta pendiente, si la hay). */
function caido(deps: DepsTurno, e: EntradaTurno): Salida {
  const t = respuestaFija(deps.reglamento, 'rf.modelo_caido');
  const vig = propuestaVigente(e.filas);
  return vig ? salidaPropuesta(vig, t) : { tipo: 'texto', texto: t };
}

// ── El turno del modelo ──────────────────────────────────────────────────────

export async function turnoDelModelo(deps: DepsTurno, e: EntradaTurno): Promise<SalidaTurno> {
  const t0 = deps.reloj();
  const { reglamento: r, config: c, dominio: d } = deps;
  const traza: Traza = {
    tipo: 'modelo', bot: d.bot, reglamento: { id: r.id, version: r.version, huella: r.huella },
    llamados: 0, uso: [], herramientas: [], candados: [], verificador: [], reglas_usadas: [], ms_modelo: 0, ms_herramientas: 0,
  };
  const est = estado(deps, e);
  const sis = sistema(r, c);
  const usuario = mensajeDelTurno({ estado: est, filas: e.filas, nuevos: e.nuevos, quien: e.ctx.remitente.nombre });
  const decl = declaraciones(d, r);
  const todas = decl.map((x) => x.name);
  const mensajes: Mensaje[] = [{ role: 'user', parts: [{ text: usuario }] }];
  const resultadosTurno: string[] = [];
  const respaldoFijo = [usuario, bloqueSiempre(r)];
  let presupuesto = c.topes.llamados;
  let correccionUsada = false;
  const fin = (salida: Salida | null, extra: Partial<Traza> = {}): SalidaTurno => ({ salida, traza: { ...traza, ...extra, salida } });

  while (traza.llamados! < presupuesto) {
    const restante = c.topes.turnoMs - (deps.reloj() - t0);
    if (restante < 500) return fin(caido(deps, e), { error: 'tope de tiempo del turno' });
    const ultimo = traza.llamados! >= presupuesto - 1;
    const tm = deps.reloj();
    const res = await deps.modelo.llamar({
      sistema: sis.texto, mensajes, herramientas: decl, permitidas: ultimo ? CIERRAN : todas, timeoutMs: restante,
    });
    traza.ms_modelo! += Math.round(deps.reloj() - tm);
    traza.llamados!++;
    traza.uso!.push(...res.usos);
    if (!res.ok) return fin(caido(deps, e), { error: `modelo: ${res.motivo}` });
    mensajes.push(res.mensaje);

    const llamadas = res.mensaje.parts.filter((p): p is Parte & { functionCall: NonNullable<Parte['functionCall']> } => !!p.functionCall);
    const lecturas = llamadas.filter((p) => !CIERRAN.includes(p.functionCall.name));
    const cierres = llamadas.filter((p) => CIERRAN.includes(p.functionCall.name));

    if (lecturas.length) {
      const th = deps.reloj();
      const respuestas = await Promise.all(lecturas.map(async (p) => {
        const nombre = p.functionCall.name;
        const args = p.functionCall.args ?? {};
        const ti = deps.reloj();
        let r2: { ok: boolean; datos: unknown; error?: string; privado?: unknown };
        try {
          if (nombre === 'consultar_reglas') {
            const x = consultar(r, args);
            r2 = { ok: true, datos: x };
            traza.reglas_usadas!.push(...(Array.isArray(args.ids) ? args.ids.map(String) : []));
          } else if (d.lecturas.some((l) => l.name === nombre)) {
            r2 = await d.leer(nombre, args, e.ctx);
          } else {
            r2 = { ok: false, datos: null, error: `No existe la herramienta «${nombre}». Usa: ${todas.join(', ')}.` };
          }
        } catch (err) {
          r2 = { ok: false, datos: null, error: `No pude consultar ahora (${String(err).slice(0, 80)}). No digas que no existe: di que no pudiste revisar.` };
        }
        const reglas = fichasDeHerramienta(r, nombre);
        const datos = recortarResultado(r2.datos);
        traza.herramientas!.push({ nombre, args, ok: r2.ok, datos, ...(r2.privado !== undefined ? { privado: r2.privado } : {}), error: r2.error, ms: Math.round(deps.reloj() - ti) });
        // Lo que se leyó en este turno también respalda la propuesta del mismo turno.
        e.ctx.resultadosPrevios.push({ herramienta: nombre, args, datos: r2.datos, privado: r2.privado });
        resultadosTurno.push(JSON.stringify(datos ?? ''));
        const response = r2.ok ? { ok: true, resultado: datos, ...(reglas.length ? { reglas } : {}) } : { ok: false, error: r2.error };
        return { functionResponse: { name: nombre, response, ...(p.functionCall.id ? { id: p.functionCall.id } : {}) } } as Parte;
      }));
      // Un cierre en el mismo llamado que una lectura no vio su resultado: no sale.
      for (const p of cierres) {
        respuestas.push({ functionResponse: { name: p.functionCall.name, response: { ok: false, error: 'No se envió: primero mira el resultado de las consultas de este mismo llamado.' }, ...(p.functionCall.id ? { id: p.functionCall.id } : {}) } });
      }
      traza.ms_herramientas! += Math.round(deps.reloj() - th);
      mensajes.push({ role: 'user', parts: respuestas });
      continue;
    }

    const cierre = cierres[0];
    if (!cierre) return fin(caido(deps, e), { error: 'el modelo no llamó ninguna herramienta' });
    const nombre = cierre.functionCall.name;
    const args = (cierre.functionCall.args ?? {}) as Record<string, unknown>;
    if (Array.isArray(args.reglas_usadas)) traza.reglas_usadas!.push(...args.reglas_usadas.map(String));
    const devolver = (error: string) => {
      mensajes.push({ role: 'user', parts: [{ functionResponse: { name: nombre, response: { ok: false, error }, ...(cierre.functionCall.id ? { id: cierre.functionCall.id } : {}) } }] });
    };

    if (nombre === 'proponer') {
      const accion = String(args.accion ?? '');
      const datos = (args.datos && typeof args.datos === 'object' ? args.datos : {}) as Record<string, unknown>;
      const th = deps.reloj();
      const p = d.acciones.includes(accion)
        ? await d.proponer(accion, datos, e.ctx)
        : { ok: false as const, error: `Acción desconocida. Usa una de: ${d.acciones.join(', ')}.`, candado: 'accion_desconocida' };
      traza.ms_herramientas! += Math.round(deps.reloj() - th);
      traza.herramientas!.push({ nombre, args, ok: p.ok, ...(p.ok ? { datos: p.propuesta.resumen } : { error: p.error }), ms: Math.round(deps.reloj() - th) });
      if (!p.ok) {
        traza.candados!.push({ candado: p.candado, detalle: p.error });
        devolver(p.error);
        continue;
      }
      const huella = await huellaPropuesta(accion, p.propuesta.datos, e.turnoId);
      const guardada: PropuestaGuardada = { ...p.propuesta, huella, args_modelo: { accion, datos } };
      return fin(salidaPropuesta(guardada), { propuesta: guardada, tema: 'propuesta' });
    }

    // responder
    const tema = String(args.tema ?? '');
    traza.tema = tema;
    if (tema === 'fuera' || !temas(r).includes(tema)) {
      if (tema !== 'fuera') traza.candados!.push({ candado: 'tema_cerrado', detalle: `tema «${tema}» fuera de la lista` });
      const t = respuestaFija(r, 'rf.fuera_de_tema');
      return fin({ tipo: 'texto', texto: t }, { respuesta_fija: 'rf.fuera_de_tema' });
    }
    const texto = String(args.texto ?? '').trim();
    const opciones = opcionesDelModelo(args.opciones);
    const render = renderizar(texto, opciones, { turno: e.turnoId.slice(0, 8), topeTexto: c.topes.texto, final: correccionUsada });
    if (!render.ok) {
      correccionUsada = true;
      presupuesto = Math.max(presupuesto, traza.llamados! + 1);
      traza.candados!.push({ candado: 'formato_meta', detalle: render.error });
      devolver(render.error);
      continue;
    }
    const aVerificar = [render.salida.texto, ...('opciones' in render.salida ? render.salida.opciones.map((o) => `${o.titulo}. ${o.descripcion ?? ''}`) : [])].join('\n');
    const motivos = texto ? verificar(aVerificar, respaldoDe([...respaldoFijo, ...fuentesDeRespaldo(e, resultadosTurno)])) : ['texto vacío'];
    if (motivos.length) {
      traza.verificador!.push({ motivo: motivos.join('; '), texto: aVerificar });
      if (!correccionUsada) {
        correccionUsada = true;
        presupuesto = Math.max(presupuesto, traza.llamados! + 1);
        devolver(`No se envió porque: ${motivos.join('; ')}. Escríbelo otra vez sin eso (los hechos los escribe el sistema; los datos tienen que salir de la conversación o de una herramienta).`);
        continue;
      }
      return fin(caido(deps, e), { respuesta_fija: 'rf.modelo_caido', error: 'verificador' });
    }
    return fin(render.salida);
  }
  return fin(caido(deps, e), { error: 'tope de llamados sin respuesta' });
}

// ── El toque de una propuesta (y el «sí» escrito solo), sin modelo ────────────

export const TEXTO_YA_HECHO = 'Eso ya quedó hecho.';
export const TEXTO_SIN_VIGENTE = 'Ese botón ya no está vigente: no hice nada.';
export const TEXTO_NO_PUDE = 'No pude hacerlo ahora: no se escribió nada. Toca de nuevo en un rato.';

/** «sí» escrito solo, sin más palabras (como en #1056). Pura. */
export function esSiSolo(texto: string | null | undefined): boolean {
  const t = String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  return t === 'si';
}

export async function toqueDePropuesta(
  deps: Omit<DepsTurno, 'modelo'> & { almacen: Pick<Almacen, 'tomarCandado' | 'soltarCandado'> },
  e: EntradaTurno,
  toque: { huella: string; si: boolean },
  tipo: 'toque_propuesta' | 'si_escrito' = 'toque_propuesta',
): Promise<SalidaTurno> {
  const t0 = deps.reloj();
  const base: Traza = { tipo, bot: deps.dominio.bot, reglamento: { id: deps.reglamento.id, version: deps.reglamento.version, huella: deps.reglamento.huella } };
  const ps = propuestas(e.filas);
  const esta = ps.find((x) => x.p.huella === toque.huella);
  const vig = propuestaVigente(e.filas);
  const salida = (s: Salida, ejecucion: Traza['ejecucion'], extra: Partial<Traza> = {}): SalidaTurno =>
    ({ salida: s, traza: { ...base, ...extra, ejecucion, salida: s, ms_herramientas: Math.round(deps.reloj() - t0) } });

  if (!esta) {
    return vig
      ? salida(salidaPropuesta(vig, respuestaFija(deps.reglamento, 'rf.toque_viejo')), { huella: toque.huella, resultado: 'vieja' })
      : salida({ tipo: 'texto', texto: TEXTO_SIN_VIGENTE }, { huella: toque.huella, resultado: 'vieja' });
  }
  if (esta.resultado) {
    return salida({ tipo: 'texto', texto: esta.resultado === 'ejecutada' ? TEXTO_YA_HECHO : respuestaFija(deps.reglamento, 'rf.no_hice_nada') }, { huella: toque.huella, resultado: 'repetida' });
  }
  if (!vig || vig.huella !== toque.huella) {
    return vig
      ? salida(salidaPropuesta(vig, respuestaFija(deps.reglamento, 'rf.toque_viejo')), { huella: toque.huella, resultado: 'vieja' })
      : salida({ tipo: 'texto', texto: TEXTO_SIN_VIGENTE }, { huella: toque.huella, resultado: 'vieja' });
  }
  if (!toque.si) {
    return salida({ tipo: 'texto', texto: respuestaFija(deps.reglamento, 'rf.no_hice_nada') }, { huella: toque.huella, accion: vig.accion, resultado: 'rechazada' });
  }
  // La tanda cambió desde que se armó: se vuelve a armar con los mismos datos del modelo y se muestra la de ahora.
  if (deps.dominio.sigueVigente && !deps.dominio.sigueVigente(vig, e.ctx)) {
    const a = vig.args_modelo;
    const p = await deps.dominio.proponer(String(a.accion), (a.datos ?? {}) as Record<string, unknown>, e.ctx);
    if (!p.ok) return salida({ tipo: 'texto', texto: TEXTO_SIN_VIGENTE }, { huella: toque.huella, resultado: 'vieja' }, { candados: [{ candado: p.candado, detalle: p.error }] });
    const huella = await huellaPropuesta(String(a.accion), p.propuesta.datos, e.turnoId);
    const nueva: PropuestaGuardada = { ...p.propuesta, huella, args_modelo: a };
    return salida(salidaPropuesta(nueva, respuestaFija(deps.reglamento, 'rf.toque_viejo')), { huella: toque.huella, resultado: 'vieja' }, { propuesta: nueva });
  }
  // Una sola vez por huella, aunque lleguen dos toques a la vez.
  const clave = `agente:propuesta:${toque.huella}`;
  if (!(await deps.almacen.tomarCandado(clave, 7 * 24 * 3600))) {
    return salida({ tipo: 'texto', texto: TEXTO_YA_HECHO }, { huella: toque.huella, resultado: 'repetida' });
  }
  try {
    const h = await deps.dominio.ejecutar(vig, e.ctx);
    return salida({ tipo: 'texto', texto: h.lineas.join('\n') }, {
      huella: toque.huella, accion: vig.accion, resultado: 'ejecutada', lineas: h.lineas, escrituras: h.escrituras, nombrados: h.nombrados, consumidos: h.consumidos,
    }, { respuesta_fija: 'rf.hecho' });
  } catch (err) {
    await deps.almacen.soltarCandado(clave);
    return salida({ tipo: 'texto', texto: TEXTO_NO_PUDE }, { huella: toque.huella, accion: vig.accion, resultado: 'error' }, { error: String(err).slice(0, 200) });
  }
}

/** Para la traza de uso: los tokens del turno sumados por modelo. Pura. */
export function usoPorModelo(usos: UsoLlamado[]): Record<string, { llamados: number; entrada: number; salida: number; razonamiento: number; cache: number }> {
  const out: Record<string, { llamados: number; entrada: number; salida: number; razonamiento: number; cache: number }> = {};
  for (const u of usos) {
    const x = out[u.modelo] ??= { llamados: 0, entrada: 0, salida: 0, razonamiento: 0, cache: 0 };
    x.llamados++;
    x.entrada += u.entrada; x.salida += u.salida; x.razonamiento += u.razonamiento; x.cache += u.cache;
  }
  return out;
}

export type { Propuesta, Reglamento };
