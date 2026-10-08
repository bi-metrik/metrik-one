// ============================================================
// Núcleo conversacional — el turno (§3.1, §3.3, §3.5)
// ------------------------------------------------------------
// [modelo] loop de máximo 3 llamados (modo ANY): lecturas en paralelo; termina con `responder` o `proponer`.
// [código] los candados: `proponer` no escribe (el dominio arma el resumen con datos reales); `responder` pasa por el
// tema cerrado, los límites de Meta y el verificador. Un error de formato o del verificador vuelve al modelo UNA vez
// (un llamado extra); la segunda, sale la respuesta fija con las opciones vigentes.
// [código, sin modelo] el toque de una propuesta y el «sí» escrito solo: se ejecuta si la huella sigue vigente, una sola
// vez (candado por huella).
// [modelo, después del hecho] si el dominio lo pide (`trasEjecutar` con `seguir`), el modelo tiene un turno para seguir
// (`seguirTrasToque`): propone lo que el hecho destrabó, pregunta lo que falta o llama `terminar`. Sale en el mismo
// mensaje que la confirmación, debajo de ella; si el modelo falla, sale solo la confirmación.
// Todo deja traza: llamados, tokens por modelo, herramientas, reglas, candados, verificador y tiempos.
// ============================================================

import type { ConfigAgente } from './config.ts';
import { fechaBogota, mensajeDelTurno, recortarResultado, sistema } from './contexto.ts';
import { CIERRAN, declaraciones } from './herramientas.ts';
import { consultar, fichasDeHerramienta, respuestaFija, temas, bloqueSiempre } from './reglamento.ts';
import { META, botonesPropuesta, cortarEnPalabra, opcionesDelModelo, renderizar } from './render.ts';
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
  /** El turno sigue a un hecho que la persona acaba de confirmar con un toque (`seguirTrasToque`). */
  tras?: { lineas: string[]; origen: 'toque_propuesta' | 'si_escrito' };
}

export interface SalidaTurno {
  salida: Salida | null;
  traza: Traza;
  /** El hecho se ejecutó y el dominio pide un turno del modelo para seguir (`seguirTrasToque`). */
  seguir?: boolean;
}

/** Cierra el turno que sigue a un hecho sin decir nada más (la persona ya tiene la confirmación). */
export const TERMINAR = 'terminar';

const DECLARACION_TERMINAR = {
  name: TERMINAR,
  description: 'Solo en el turno que sigue a un hecho confirmado: no queda nada que proponer ni que preguntar. El sistema deja la confirmación sola.',
  parameters: { type: 'object', properties: { reglas_usadas: { type: 'array', items: { type: 'string' } } } },
};

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

/**
 * El mensaje de botones de una propuesta: lo de `arriba` (una respuesta del modelo o una respuesta fija) y debajo el
 * resumen fijo del código. El cuerpo de botones de Meta va hasta 1024 caracteres: si no cabe, se corta lo de arriba
 * (nunca el resumen, que es lo que se confirma). Pura.
 */
export function salidaPropuesta(p: Pick<PropuestaGuardada, 'huella' | 'resumen' | 'si' | 'no'>, arriba?: string | null): Salida {
  const cabe = META.cuerpoBotones - [...p.resumen].length - 1;
  const sinRepetir = arriba ? sinLineasDelResumen(arriba, p.resumen) : '';
  const a = sinRepetir && cabe >= 20 ? cortarEnPalabra(sinRepetir, cabe) : '';
  return { tipo: 'botones', texto: [a, p.resumen].filter(Boolean).join('\n'), opciones: botonesPropuesta(p.huella, p.si, p.no) };
}

const comparable = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/**
 * Lo de arriba sin las líneas que ya dice el resumen: en vivo, el modelo escribió en `texto` la misma pregunta del
 * resumen («¿Lo anoto en …?») y salió dos veces. Pura.
 */
export function sinLineasDelResumen(arriba: string, resumen: string): string {
  const delResumen = new Set(resumen.split('\n').map(comparable).filter(Boolean));
  return arriba.split('\n').filter((l) => !delResumen.has(comparable(l))).join('\n').trim();
}

/** JSON con las llaves ordenadas: `jsonb` no guarda el orden, así que dos datos iguales pueden volver distintos. Pura. */
function estable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${estable(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** ¿Es la misma propuesta (misma acción, mismos datos resueltos por el código) que la pendiente? Pura. */
export function mismaPropuesta(a: Pick<Propuesta, 'accion' | 'datos'>, b: Pick<Propuesta, 'accion' | 'datos'>): boolean {
  return a.accion === b.accion && estable(a.datos) === estable(b.datos);
}

// ── El estado y el respaldo ──────────────────────────────────────────────────

function estado(deps: DepsTurno, e: EntradaTurno): string[] {
  const vig = propuestaVigente(e.filas);
  return [
    `Ahora: ${fechaBogota(deps.ahoraMs())} (Bogotá).`,
    `Escribe: ${e.ctx.remitente.nombre} (${e.ctx.remitente.rol}).`,
    `Propuesta pendiente: ${vig ? `${vig.resumen.replace(/\n/g, ' · ')} — espera su toque` : 'ninguna'}.`,
    ...(deps.dominio.estado?.(e.ctx) ?? []),
    ...(e.tras ? [
      `Acaba de quedar hecho, con el toque de ${e.ctx.remitente.nombre}: ${e.tras.lineas.join(' ')} La confirmación ya la escribe el sistema: no la repitas.`,
      `Este turno es para seguir: si en la conversación quedó algo que ${e.ctx.remitente.nombre} pidió y que este paso destrabó, propón lo siguiente con \`proponer\` o pregunta lo que falte. Si no queda nada, llama \`${TERMINAR}\`.`,
    ] : []),
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

/**
 * Lo que respalda una AFIRMACIÓN de hecho («está registrada…», «ya quedó guardada…»): lo que devolvieron las
 * herramientas en este turno y las escrituras confirmadas con un toque (sus líneas y lo que escribieron). No la
 * conversación: que el comercial lo haya dicho no quiere decir que esté en el viaje.
 */
function fuentesDeHechos(e: EntradaTurno, resultadosTurno: string[]): string[] {
  const f: string[] = [...resultadosTurno];
  for (const x of e.filas) {
    const ej = x.traza?.ejecucion;
    if (ej?.resultado !== 'ejecutada') continue;
    f.push(...(ej.lineas ?? []));
    if (ej.escrituras?.length) f.push(JSON.stringify(ej.escrituras));
  }
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
  const decl = [...declaraciones(d, r), ...(e.tras ? [DECLARACION_TERMINAR] : [])];
  const todas = decl.map((x) => x.name);
  const cierran = e.tras ? [...CIERRAN, TERMINAR] : CIERRAN;
  // Tras un hecho, lo que no sea seguir (falla, tema fuera, `terminar`) deja la confirmación sola: el hecho ya ocurrió.
  const soloHecho: Salida | null = e.tras ? { tipo: 'texto', texto: e.tras.lineas.join('\n') } : null;
  const caer = (): Salida => soloHecho ?? caido(deps, e);
  const conHecho = (s: Salida): Salida => (e.tras ? { ...s, texto: [...e.tras.lineas, s.texto].filter(Boolean).join('\n') } : s);
  let termino = false;
  const mensajes: Mensaje[] = [{ role: 'user', parts: [{ text: usuario }] }];
  const resultadosTurno: string[] = [];
  const respaldoFijo = [usuario, bloqueSiempre(r)];
  let presupuesto = c.topes.llamados;
  let correccionUsada = false;
  const fin = (salida: Salida | null, extra: Partial<Traza> = {}): SalidaTurno => {
    const t: Traza = { ...traza, ...extra, salida };
    if (e.tras) {
      t.tras_toque = { origen: e.tras.origen, resultado: t.propuesta ? 'propuesta' : termino ? 'terminar' : salida === soloHecho ? 'solo_hecho' : 'respuesta' };
      if (salida === soloHecho) t.respuesta_fija = 'rf.hecho';
    }
    return { salida, traza: t };
  };

  while (traza.llamados! < presupuesto) {
    const restante = c.topes.turnoMs - (deps.reloj() - t0);
    if (restante < 500) return fin(caer(), { error: 'tope de tiempo del turno' });
    const ultimo = traza.llamados! >= presupuesto - 1;
    const tm = deps.reloj();
    const res = await deps.modelo.llamar({
      sistema: sis.texto, mensajes, herramientas: decl, permitidas: ultimo ? cierran : todas, timeoutMs: restante,
    });
    traza.ms_modelo! += Math.round(deps.reloj() - tm);
    traza.llamados!++;
    traza.uso!.push(...res.usos);
    if (!res.ok) return fin(caer(), { error: `modelo: ${res.motivo}` });
    mensajes.push(res.mensaje);

    const llamadas = res.mensaje.parts.filter((p): p is Parte & { functionCall: NonNullable<Parte['functionCall']> } => !!p.functionCall);
    const lecturas = llamadas.filter((p) => !cierran.includes(p.functionCall.name));
    const cierres = llamadas.filter((p) => cierran.includes(p.functionCall.name));

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
    if (!cierre) return fin(caer(), { error: 'el modelo no llamó ninguna herramienta' });
    const nombre = cierre.functionCall.name;
    const args = (cierre.functionCall.args ?? {}) as Record<string, unknown>;
    if (Array.isArray(args.reglas_usadas)) traza.reglas_usadas!.push(...args.reglas_usadas.map(String));
    const devolver = (error: string) => {
      mensajes.push({ role: 'user', parts: [{ functionResponse: { name: nombre, response: { ok: false, error }, ...(cierre.functionCall.id ? { id: cierre.functionCall.id } : {}) } }] });
    };

    if (nombre === TERMINAR) {
      termino = true;
      return fin(soloHecho);
    }

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
      // La respuesta que va arriba del resumen (opcional): mismo tope y mismo verificador que `responder`.
      let arriba: string | null = null;
      const texto = String(args.texto ?? '').trim();
      if (texto) {
        const render = renderizar(texto, [], { turno: e.turnoId.slice(0, 8), topeTexto: c.topes.texto, final: correccionUsada });
        if (!render.ok) {
          correccionUsada = true;
          presupuesto = Math.max(presupuesto, traza.llamados! + 1);
          traza.candados!.push({ candado: 'formato_meta', detalle: render.error });
          devolver(`${render.error} (el \`texto\` de \`proponer\`)`);
          continue;
        }
        const motivos = verificar(render.salida.texto, respaldoDe([...respaldoFijo, ...fuentesDeRespaldo(e, resultadosTurno), p.propuesta.resumen]), respaldoDe(fuentesDeHechos(e, resultadosTurno)));
        if (motivos.length) {
          traza.verificador!.push({ motivo: motivos.join('; '), texto: render.salida.texto });
          if (!correccionUsada) {
            correccionUsada = true;
            presupuesto = Math.max(presupuesto, traza.llamados! + 1);
            devolver(`No se envió porque el \`texto\`: ${motivos.join('; ')}. Vuelve a llamar \`proponer\` con el texto sin eso (los hechos los escribe el sistema; los datos tienen que salir de la conversación o de una herramienta).`);
            continue;
          }
          // Segunda vez: el texto no sale; la propuesta (que arma el código con datos reales) sí.
        } else {
          arriba = render.salida.texto;
        }
      }
      // Candado: la misma propuesta que ya está pendiente no se arma de nuevo. Se reenvía LA PENDIENTE (misma huella,
      // con sus botones) y arriba la respuesta del modelo o una línea fija: en vivo, el texto suelto dejaba los botones
      // muy arriba en el chat.
      const vig = propuestaVigente(e.filas);
      if (vig && mismaPropuesta(vig, p.propuesta)) {
        traza.candados!.push({ candado: 'propuesta_repetida', detalle: `${accion}: igual a la pendiente ${vig.huella}` });
        return fin(salidaPropuesta(vig, arriba ?? TEXTO_PROPUESTA_PENDIENTE), { tema: 'propuesta', ...(arriba ? {} : { respuesta_fija: 'propuesta_pendiente' }) });
      }
      const huella = await huellaPropuesta(accion, p.propuesta.datos, e.turnoId);
      const guardada: PropuestaGuardada = { ...p.propuesta, huella, args_modelo: { accion, datos } };
      // Tras un hecho, la confirmación va primero y la propuesta debajo, en el mismo mensaje (si no cabe, se corta lo
      // del modelo, no la confirmación ni el resumen).
      const encima = e.tras ? [...e.tras.lineas, arriba].filter(Boolean).join('\n') : arriba;
      return fin(salidaPropuesta(guardada, encima), { propuesta: guardada, tema: 'propuesta' });
    }

    // responder
    const tema = String(args.tema ?? '');
    traza.tema = tema;
    if (tema === 'fuera' || !temas(r).includes(tema)) {
      if (tema !== 'fuera') traza.candados!.push({ candado: 'tema_cerrado', detalle: `tema «${tema}» fuera de la lista` });
      if (soloHecho) return fin(soloHecho);
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
    const motivos = texto ? verificar(aVerificar, respaldoDe([...respaldoFijo, ...fuentesDeRespaldo(e, resultadosTurno)]), respaldoDe(fuentesDeHechos(e, resultadosTurno))) : ['texto vacío'];
    if (motivos.length) {
      traza.verificador!.push({ motivo: motivos.join('; '), texto: aVerificar });
      if (!correccionUsada) {
        correccionUsada = true;
        presupuesto = Math.max(presupuesto, traza.llamados! + 1);
        devolver(`No se envió porque: ${motivos.join('; ')}. Escríbelo otra vez sin eso (los hechos los escribe el sistema; los datos tienen que salir de la conversación o de una herramienta).`);
        continue;
      }
      return fin(caer(), { respuesta_fija: soloHecho ? 'rf.hecho' : 'rf.modelo_caido', error: 'verificador' });
    }
    return fin(conHecho(render.salida));
  }
  return fin(caer(), { error: 'tope de llamados sin respuesta' });
}

// ── El toque de una propuesta (y el «sí» escrito solo), sin modelo ────────────

export const TEXTO_YA_HECHO = 'Eso ya quedó hecho.';
export const TEXTO_SIN_VIGENTE = 'Ese botón ya no está vigente: no hice nada.';
/** Cuando el modelo repite la propuesta pendiente sin decir nada más: va arriba de la pendiente reenviada. No afirma nada. */
export const TEXTO_PROPUESTA_PENDIENTE = 'Esto sigue esperando tu toque:';
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
    const ejecucion = {
      huella: toque.huella, accion: vig.accion, resultado: 'ejecutada' as const, lineas: h.lineas, escrituras: h.escrituras, nombrados: h.nombrados, consumidos: h.consumidos,
    };
    // Lo que ya se puede proponer con lo dicho (abrir un viaje → anotar lo que el comercial ya contó de él).
    let sig: Awaited<ReturnType<NonNullable<Dominio['trasEjecutar']>>> = null;
    try {
      sig = deps.dominio.trasEjecutar ? await deps.dominio.trasEjecutar(vig, h, toque.huella, e.ctx) : null;
    } catch (err) {
      console.error('[agente] tras ejecutar:', err);
    }
    if (sig?.propuesta) {
      const p = sig.propuesta;
      const huella = await huellaPropuesta(p.accion, p.datos, e.turnoId);
      const nueva: PropuestaGuardada = { ...p, huella, args_modelo: { accion: p.accion, datos: { viaje: p.datos.codigo }, origen: 'tras_ejecutar' } };
      return salida(salidaPropuesta(nueva, sig.lineas.join('\n')), { ...ejecucion, lineas: sig.lineas }, { respuesta_fija: 'rf.hecho', propuesta: nueva });
    }
    const lineas = sig?.lineas ?? h.lineas;
    const r = salida({ tipo: 'texto', texto: lineas.join('\n') }, { ...ejecucion, lineas }, { respuesta_fija: 'rf.hecho' });
    return sig?.seguir ? { ...r, seguir: true } : r;
  } catch (err) {
    await deps.almacen.soltarCandado(clave);
    return salida({ tipo: 'texto', texto: TEXTO_NO_PUDE }, { huella: toque.huella, accion: vig.accion, resultado: 'error' }, { error: String(err).slice(0, 200) });
  }
}

/**
 * El turno del modelo que sigue a un toque ejecutado (`toque.seguir`): la conversación ya con el hecho (el cliente creado
 * es una ficha vista, la propuesta ya no está pendiente) y el estado diciendo qué acaba de pasar. El modelo decide si
 * sigue; la salida es una sola: la confirmación arriba y lo que él siga debajo, o la confirmación sola. La traza es de
 * tipo `modelo` (cuenta en el uso del mes) y conserva la `ejecucion` del toque, que es la que cierra la propuesta tocada.
 */
export async function seguirTrasToque(deps: DepsTurno, e: EntradaTurno, toque: SalidaTurno): Promise<SalidaTurno> {
  const ej = toque.traza.ejecucion;
  if (!toque.seguir || !ej || ej.resultado !== 'ejecutada') return toque;
  const origen = toque.traza.tipo === 'si_escrito' ? 'si_escrito' : 'toque_propuesta';
  // La fila que guardará la traza del toque es la última nueva: con el hecho puesto, la conversación es la de después.
  const conHecho = e.nuevos.at(-1)?.id;
  const filas = e.filas.map((f) => (f.id === conHecho ? { ...f, traza: toque.traza } : f));
  const ctx: ContextoDominio = { ...e.ctx, conversacion: filas, resultadosPrevios: [...e.ctx.resultadosPrevios] };
  const m = await turnoDelModelo(deps, { ...e, filas, ctx, tras: { lineas: ej.lineas ?? [], origen } });
  return {
    salida: m.salida,
    traza: {
      ...m.traza,
      tipo: 'modelo',
      ejecucion: ej,
      ms_herramientas: (m.traza.ms_herramientas ?? 0) + (toque.traza.ms_herramientas ?? 0),
    },
  };
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
