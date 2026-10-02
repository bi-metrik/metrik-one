// ============================================================
// La solicitud de viaje sin formulario — la ejecución (función `solicitud-texto`)
// ------------------------------------------------------------
// Diseño: `proyectos/trappvel/clarity/docs/diseno/noor-solicitud-sin-formulario-2026-10-02.md` §3.
//
// Un solo motor: lo pegado en la web pasa por las MISMAS funciones del bot (`wa-entendimiento.ts`:
// config de la línea, modelo, guardianes, deducciones, contacto, crear o cargar) y deja el MISMO
// rastro que un reenvío: entrega y mensajes en la bandeja (canal `web`), una fila en
// `wa_bandeja_entendimientos`, la marca con `entrega_id` y `fuente: 'web'`, la traza y la historia
// en la actividad. Lo único distinto es a quién se le contesta: aquí no se manda ningún WhatsApp,
// se devuelve lo que la pantalla pinta.
//
// Dos pasos, como «confirmar: siempre» del bot:
//   · `entenderTexto`: guarda la materia prima, llama al modelo, corre los guardianes y arma el
//     resumen (en un negocio que ya existe, la carga EN SECO). No escribe en ningún negocio;
//   · `cargarTexto`: con el «Cargar» de la persona, escribe con `crearNegocio` o
//     `escribirEnNegocioExistente`. Lo cargado queda SUGERIDO, igual que en el bot.
// ============================================================

import { todayBogotaISO } from './bogota.ts';
import { aplanarBloques } from './niveles-solicitud.ts';
import {
  aplicarSumas,
  conDeducciones,
  decidirContacto,
  esquemaDeSalida,
  huecos,
  instruccionesEntendimiento,
  nombreDeViaje,
  nombreEsLugar,
  pistasDelTexto,
  resumenEntendido,
} from './wa-entendimiento-reglas.ts';
import type { CampoEntendible, ContactoCandidato, SalidaEntendida } from './wa-entendimiento-reglas.ts';
import { cargarEnExistente, detectarCruce, origenDeFrase, sugeridosConDeducciones } from './wa-carga-reglas.ts';
import { entenderEntrega, textoParaModelo } from './wa-guardianes.ts';
import {
  aEntrega,
  bloquesDatosDelNegocio,
  candidatosDeContacto,
  CANAL_WEB,
  configDeLinea,
  crearNegocio,
  escribirEnNegocioExistente,
  GEMINI_MODEL,
  guardarClases,
  leerConModelo,
  leerMensajes,
  MAX_INTENTOS,
  nombreRel,
  salidaGuardada,
  viajesAbiertosDeLaBandeja,
} from './wa-entendimiento.ts';
import type { BloqueDelNegocio, MensajeCrudo } from './wa-entendimiento.ts';
import {
  filasDelResumen,
  MAX_LARGO_PEGADO,
  partirPegado,
  textoCargado,
  textoCruceWeb,
  textoDosViajesWeb,
  textoNadaNuevo,
  preguntasDeGuardianes,
  type FilaResumen,
  type PreguntaGuardian,
  type QuienEscribio,
} from './solicitud-texto-reglas.ts';
import type { SupabaseClient } from './types.ts';

type Fila = Record<string, unknown>;

/** Quién pide: el workspace de su perfil y su staff (el responsable del viaje, como en el bot). */
export interface Contexto {
  workspaceId: string;
  staffId: string | null;
}

export interface ContactoWeb {
  id: string;
  nombre: string | null;
  telefono: string | null;
  /** Sus viajes abiertos en la línea: «Lucía tiene abierto LISBOA MAR. ¿Es ese viaje o uno nuevo?». */
  viajes: Array<{ id: string; nombre: string }>;
}

/** «¿De quién es?» (solo negocio nuevo). El cliente no se adivina: sin uno exacto, se pregunta. */
export type ContactoDecision =
  | { tipo: 'unico'; contacto: ContactoWeb }
  | { tipo: 'varios'; opciones: ContactoWeb[]; nombre: string }
  | { tipo: 'ninguno'; nombre: string; telefono: string | null };

export type AvisoEntender =
  | { tipo: 'sin_solicitud'; texto: string }
  | { tipo: 'dos_viajes'; texto: string }
  | { tipo: 'cruce'; texto: string }
  | { tipo: 'nada_nuevo'; texto: string };

export type RespuestaEntender =
  | { ok: false; error: 'sin_texto' | 'config' | 'negocio' | 'modelo' | 'base'; mensaje: string }
  | {
    ok: true;
    entendimientoId: string;
    /** Lo que va antes del resumen. `dos_viajes` corta: no se carga nada. */
    aviso: AvisoEntender | null;
    /** «Entendí: Lisboa, 2 adultos, 4 estrellas.» */
    resumen: string;
    filas: FilaResumen[];
    /** Lo que un guardián no cargó y se pregunta («No cargué la fecha: …»), por campo. */
    preguntas: PreguntaGuardian[];
    negocio: { id: string; nombre: string } | null;
    contacto: ContactoDecision | null;
  };

export type RespuestaCargar =
  | { ok: false; error: 'entendimiento' | 'negocio' | 'contacto' | 'base'; mensaje: string }
  | { ok: true; negocioId: string; cargados: number; faltanMinimo: number; mensaje: string };

async function actualizar(supabase: SupabaseClient, id: string, cambios: Fila): Promise<void> {
  const { error } = await supabase.from('wa_bandeja_entendimientos').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) console.error(`[solicitud-texto] no se pudo actualizar ${id}:`, error.message);
}

/** El negocio de la línea, abierto y del workspace, con lo que hace falta para cargar en él. */
async function negocioAbierto(supabase: SupabaseClient, workspaceId: string, negocioId: string): Promise<Fila | null> {
  const { data } = await supabase.from('negocios')
    .select('id, codigo, nombre, metadata, estado, linea_id, contacto_id, workspaces(slug), contactos(nombre), empresas(nombre)')
    .eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle();
  return data && (data as Fila).estado === 'abierto' ? (data as Fila) : null;
}

function nombreDelNegocio(neg: Fila): string {
  return nombreDeViaje({
    nombre: (neg.nombre as string | null) ?? null,
    cliente: nombreRel(neg.contactos) ?? nombreRel(neg.empresas),
    codigo: (neg.codigo as string | null) ?? null,
  });
}

/** Los viajes abiertos de la línea de la bandeja de cada contacto («¿Es ese viaje o uno nuevo?»). */
async function viajesDe(supabase: SupabaseClient, workspaceId: string, lineaId: string, ids: string[]): Promise<Map<string, Array<{ id: string; nombre: string }>>> {
  const out = new Map<string, Array<{ id: string; nombre: string }>>();
  if (ids.length === 0) return out;
  const { data } = await supabase.from('negocios').select('id, codigo, nombre, contacto_id, created_at')
    .eq('workspace_id', workspaceId).eq('linea_id', lineaId).eq('estado', 'abierto').in('contacto_id', ids)
    .order('created_at', { ascending: false }).limit(200);
  for (const n of (data ?? []) as Fila[]) {
    const k = n.contacto_id as string;
    out.set(k, [...(out.get(k) ?? []), { id: n.id as string, nombre: (n.nombre as string | null) || (n.codigo as string | null) || 'Viaje sin nombre' }]);
  }
  return out;
}

/**
 * La materia prima: una entrega web (nace cerrada, sin teléfono), sus mensajes con un id `web:` y
 * el entendimiento en `procesando`. Devuelve los mensajes como los lee el motor.
 */
async function guardarPegado(
  supabase: SupabaseClient, ctx: Contexto, partes: ReturnType<typeof partirPegado>, negocioId: string | null,
): Promise<{ entregaId: string; entId: string; crudos: MensajeCrudo[] } | string> {
  const ahora = Date.now();
  const iso = new Date(ahora).toISOString();
  const { data: entrega, error: e1 } = await supabase.from('wa_bandeja_entregas').insert({
    workspace_id: ctx.workspaceId, canal: CANAL_WEB, remitente_phone: null, remitente_staff_id: ctx.staffId,
    estado: 'con_cliente', abierta_at: iso, ultimo_mensaje_at: iso, n_mensajes: partes.length,
    cerrada_at: iso, motivo_cierre: 'web', cliente_respondido_at: iso,
  }).select('id').single();
  if (e1 || !entrega) return `no se pudo guardar la entrega: ${e1?.message ?? 'sin fila'}`;
  const entregaId = (entrega as Fila).id as string;

  // Un milisegundo entre mensajes: el orden del pegado es el orden de lectura (`ordenarPorEnvio`).
  const filas = partes.map((p, i) => {
    const en = new Date(ahora + i).toISOString();
    return {
      workspace_id: ctx.workspaceId, entrega_id: entregaId, wa_message_id: `web:${crypto.randomUUID()}`,
      remitente_phone: null, remitente_staff_id: ctx.staffId, tipo: 'text', papel: 'contenido',
      cuerpo: p.cuerpo, cuerpo_origen: 'texto', reenviado: p.reenviado, enviado_at: en, recibido_at: en,
    };
  });
  const { error: e2 } = await supabase.from('wa_bandeja_mensajes').insert(filas);
  if (e2) return `no se pudieron guardar los mensajes: ${e2.message}`;

  const { data: ent, error: e3 } = await supabase.from('wa_bandeja_entendimientos').insert({
    workspace_id: ctx.workspaceId, entrega_id: entregaId, segmento: 0, canal: CANAL_WEB, remitente_phone: null,
    remitente_staff_id: ctx.staffId, estado: 'procesando', intentos: 1,
    destino: negocioId ? 'existente' : 'nuevo', negocio_destino_id: negocioId,
  }).select('id').single();
  if (e3 || !ent) return `no se pudo guardar el entendimiento: ${e3?.message ?? 'sin fila'}`;

  const crudos = await leerMensajes(supabase, entregaId);
  if (typeof crudos === 'string') return crudos;
  return { entregaId, entId: (ent as Fila).id as string, crudos };
}

/**
 * «Entender»: guarda lo pegado, lo lee el modelo y lo pasan los guardianes. NO escribe en ningún
 * negocio. Con `negocioId`, la carga va en seco sobre lo que el negocio ya tiene (agrupa el resumen
 * y detecta el cruce). Sin él, decide el contacto como el bot y trae sus viajes abiertos.
 */
export async function entenderTexto(
  supabase: SupabaseClient, ctx: Contexto,
  p: { texto: string; quien: QuienEscribio; negocioId?: string | null; contactoId?: string | null },
): Promise<RespuestaEntender> {
  const texto = String(p.texto ?? '').slice(0, MAX_LARGO_PEGADO);
  const partes = partirPegado(texto, p.quien);
  if (partes.length === 0) return { ok: false, error: 'sin_texto', mensaje: 'No hay texto que leer.' };

  const cfg = await configDeLinea(supabase, ctx.workspaceId);
  if (typeof cfg === 'string') return { ok: false, error: 'config', mensaje: cfg };

  // Negocio existente: sus bloques de datos con su config (la de la línea DE ESE negocio).
  let neg: Fila | null = null;
  let bloques: BloqueDelNegocio[] = [];
  if (p.negocioId) {
    neg = await negocioAbierto(supabase, ctx.workspaceId, p.negocioId);
    if (!neg) return { ok: false, error: 'negocio', mensaje: 'Ese viaje ya no está abierto.' };
    const b = await bloquesDatosDelNegocio(supabase, p.negocioId);
    if (typeof b === 'string') return { ok: false, error: 'base', mensaje: b };
    bloques = b;
  }
  const { fields: fNeg, valores: yaTiene } = aplanarBloques(bloques.map(b => ({ fields: b.fields, data: b.data })));
  const campos = neg ? (fNeg as CampoEntendible[]) : cfg.fields;

  const g = await guardarPegado(supabase, ctx, partes, p.negocioId ?? null);
  if (typeof g === 'string') return { ok: false, error: 'base', mensaje: g };
  const { entregaId, entId, crudos } = g;

  const mensajes = aEntrega(crudos);
  const lectura = await leerConModelo(
    neg ? instruccionesEntendimiento(campos, todayBogotaISO(), yaTiene) : instruccionesEntendimiento(campos, todayBogotaISO()),
    `Mensajes:\n${textoParaModelo(mensajes)}`,
    esquemaDeSalida(campos),
  );
  if (lectura.error || lectura.json === null) {
    // La web no reintenta sola: la persona tiene su texto y el botón «Reintentar». Con los intentos
    // agotados, el cron tampoco la toma (además filtra el canal).
    await actualizar(supabase, entId, {
      estado: 'error', error: lectura.error, finish_reason: lectura.finishReason, modelo: GEMINI_MODEL, intentos: MAX_INTENTOS,
    });
    return { ok: false, error: 'modelo', mensaje: 'No pude leerlo ahora. Tu texto sigue aquí: inténtalo otra vez.' };
  }

  const e = entenderEntrega(lectura.json, campos, mensajes, { hoyISO: todayBogotaISO(), ...(neg ? { conocidos: yaTiene } : {}) });
  await guardarClases(supabase, crudos, mensajes, e.clases);
  const meta = { entrega_id: entregaId, en: new Date().toISOString(), origenDe: (f: string) => origenDeFrase(f, crudos), fuente: CANAL_WEB } as const;
  let salida: SalidaEntendida = {
    ...e.salida,
    sugeridos: neg
      ? sugeridosConDeducciones(bloques.map(b => ({ fields: b.fields, data: b.data })), e.salida.sugeridos, meta)
      : conDeducciones(campos, e.salida.sugeridos),
  };

  // Un «cliente» que es un lugar no es un nombre (N9, como el bot).
  if (!neg) {
    const lugares = [salida.sugeridos.destino?.valor, ...((await viajesAbiertosDeLaBandeja(supabase, ctx.workspaceId)) ?? []).map(v => v.destino)];
    if (nombreEsLugar(salida.cliente.nombre, lugares)) salida = { ...salida, cliente: { ...salida.cliente, nombre: null } };
  }

  const valores = aplicarSumas(campos, { ...(neg ? yaTiene : {}), ...Object.fromEntries(Object.entries(salida.sugeridos).map(([k, v]) => [k, v.valor])) });
  await actualizar(supabase, entId, {
    linea_id: (neg?.linea_id as string | null) ?? cfg.lineaId, historia: salida.historia, sugeridos: salida.sugeridos,
    descartados: salida.descartados, cliente: salida.cliente, huecos: huecos(campos, valores), modelo: GEMINI_MODEL,
    finish_reason: lectura.finishReason, error: null, estado: 'por_confirmar',
  });

  // El resumen: en un negocio existente, la carga en seco agrupa (nuevo, choca, ya estaba).
  let filas: FilaResumen[];
  if (neg) {
    const vistos = new Set<string>();
    const acc = {
      escritos: [] as string[], iguales: [] as string[],
      actualizados: [] as ReturnType<typeof cargarEnExistente>['actualizados'],
      conflictos: [] as ReturnType<typeof cargarEnExistente>['conflictos'],
    };
    for (const b of bloques) {
      const r = cargarEnExistente(b.data, b.fields, salida.sugeridos, meta, vistos);
      acc.escritos.push(...r.escritos);
      acc.actualizados.push(...r.actualizados);
      acc.conflictos.push(...r.conflictos);
      acc.iguales.push(...r.iguales);
    }
    filas = filasDelResumen(campos, salida.sugeridos, acc);
  } else {
    filas = filasDelResumen(campos, salida.sugeridos);
  }
  const resumenTxt = resumenEntendido(campos, Object.fromEntries(filas.map(f => [f.slug, salida.sugeridos[f.slug]?.valor])));
  const resumen = `Entendí: ${resumenTxt || filas.map(f => f.legible).join(', ') || 'nada que cargar'}.`;
  const preguntas = preguntasDeGuardianes(campos, salida.descartados);

  // Los avisos, en el orden del bot: N5 corta; N4 y el cruce se pueden pasar con un toque.
  let aviso: AvisoEntender | null = null;
  if (e.solicitudes.length >= 2) {
    await actualizar(supabase, entId, { estado: 'descartada', error: 'dos solicitudes en un pegado (N5): se pide pegar cada una por separado' });
    aviso = { tipo: 'dos_viajes', texto: textoDosViajesWeb(e.solicitudes) };
  } else if (!e.haySolicitud) {
    aviso = { tipo: 'sin_solicitud', texto: 'No vi una solicitud de viaje en este texto. No cargué nada.' };
  } else if (neg) {
    const cruces = detectarCruce({
      destinoNegocio: yaTiene.destino, destinoMensajes: salida.sugeridos.destino?.valor,
      clienteNegocio: nombreRel(neg.contactos) ?? nombreRel(neg.empresas), clienteMensajes: e.sePresenta,
    });
    if (cruces.length > 0) aviso = { tipo: 'cruce', texto: textoCruceWeb(cruces, nombreDelNegocio(neg)) };
    else if (!filas.some(f => f.grupo !== 'ya_estaba')) aviso = { tipo: 'nada_nuevo', texto: textoNadaNuevo(nombreDelNegocio(neg)) };
  }

  // ¿De quién es? Solo negocio nuevo. Con un contacto dado (se llegó desde su ficha), es ese.
  let contacto: ContactoDecision | null = null;
  if (!neg && aviso?.tipo !== 'dos_viajes') {
    contacto = await decidirDeQuien(supabase, ctx, cfg.lineaId, salida, p.contactoId ?? null);
  }

  return {
    ok: true, entendimientoId: entId, aviso, resumen, filas, preguntas,
    negocio: neg ? { id: neg.id as string, nombre: nombreDelNegocio(neg) } : null,
    contacto,
  };
}

async function decidirDeQuien(
  supabase: SupabaseClient, ctx: Contexto, lineaId: string, salida: SalidaEntendida, contactoId: string | null,
): Promise<ContactoDecision> {
  let candidatos: ContactoCandidato[];
  if (contactoId) {
    const { data } = await supabase.from('contactos').select('id, nombre, telefono').eq('id', contactoId).eq('workspace_id', ctx.workspaceId).maybeSingle();
    candidatos = data ? [data as ContactoCandidato] : [];
  } else {
    candidatos = await candidatosDeContacto(supabase, ctx.workspaceId, null, salida.cliente);
  }
  const d = contactoId && candidatos.length === 1
    ? { tipo: 'unico' as const, contacto: candidatos[0], por: 'nombre' as const }
    : decidirContacto({ clienteTexto: null, extraido: salida.cliente, candidatos });
  const ids = d.tipo === 'unico' ? [d.contacto.id] : d.opciones.map(o => o.id);
  const viajes = await viajesDe(supabase, ctx.workspaceId, lineaId, ids);
  const web = (c: ContactoCandidato): ContactoWeb => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, viajes: viajes.get(c.id) ?? [] });
  if (d.tipo === 'unico') return { tipo: 'unico', contacto: web(d.contacto) };
  if (d.opciones.length > 0) return { tipo: 'varios', opciones: d.opciones.map(web), nombre: d.nombre || salida.cliente.nombre || '' };
  return { tipo: 'ninguno', nombre: salida.cliente.nombre ?? '', telefono: salida.cliente.telefono ?? null };
}

/**
 * «Cargar»: escribe lo entendido (menos las filas que la persona quitó) como SUGERIDO. En un negocio
 * que ya existe no pisa lo de una persona (conflicto); en uno nuevo, crea el contacto si hace falta
 * y el viaje con el nombre automático, como el bot.
 */
export async function cargarTexto(
  supabase: SupabaseClient, ctx: Contexto,
  p: {
    entendimientoId: string;
    quitar?: string[];
    contacto?: { tipo: 'existente'; id: string } | { tipo: 'nuevo'; nombre: string; telefono?: string | null } | null;
    negocio?: { tipo: 'existente'; id: string } | { tipo: 'nuevo' } | null;
  },
): Promise<RespuestaCargar> {
  const { data: ent } = await supabase.from('wa_bandeja_entendimientos').select('*')
    .eq('id', p.entendimientoId).eq('workspace_id', ctx.workspaceId).eq('canal', CANAL_WEB).maybeSingle();
  if (!ent || (ent as Fila).estado !== 'por_confirmar') {
    return { ok: false, error: 'entendimiento', mensaje: 'Este texto ya se cargó o se descartó. Vuelve a pegarlo.' };
  }
  const fila = ent as Fila;
  const guardada = salidaGuardada(fila);
  const quitar = new Set(p.quitar ?? []);
  const salida: SalidaEntendida = { ...guardada, sugeridos: Object.fromEntries(Object.entries(guardada.sugeridos).filter(([k]) => !quitar.has(k))) };
  const crudos = await leerMensajes(supabase, fila.entrega_id as string);
  if (typeof crudos === 'string') return { ok: false, error: 'base', mensaje: crudos };

  const negocioDestino = (fila.negocio_destino_id as string | null) ?? (p.negocio?.tipo === 'existente' ? p.negocio.id : null);

  if (negocioDestino) {
    const neg = await negocioAbierto(supabase, ctx.workspaceId, negocioDestino);
    if (!neg) return { ok: false, error: 'negocio', mensaje: 'Ese viaje ya no está abierto.' };
    const bloques = await bloquesDatosDelNegocio(supabase, negocioDestino);
    if (typeof bloques === 'string') return { ok: false, error: 'base', mensaje: bloques };
    const meta = { entrega_id: fila.entrega_id as string, en: new Date().toISOString(), origenDe: (f: string) => origenDeFrase(f, crudos), fuente: CANAL_WEB } as const;
    const c = await escribirEnNegocioExistente(supabase, {
      workspaceId: ctx.workspaceId, negocioId: negocioDestino, neg, bloques, salida, meta, crudos, staffId: ctx.staffId, canal: CANAL_WEB,
    });
    const cargados = c.escritos.length + c.actualizados.length;
    await actualizar(supabase, fila.id as string, {
      estado: 'negocio_actualizado', negocio_id: negocioDestino, destino: 'existente', negocio_destino_id: negocioDestino,
      contacto_id: (neg.contacto_id as string | null) ?? null, huecos: c.h,
      cargados: [...c.escritos.map(e => e.slug), ...c.actualizados.map(a => a.slug)], conflictos: c.conflictos, descartados: c.descartadosTodos,
    });
    return { ok: true, negocioId: negocioDestino, cargados, faltanMinimo: c.h.minimo.faltan.length, mensaje: textoCargado(cargados, c.h.minimo.faltan.length) };
  }

  // Negocio nuevo: el cliente lo decidió la persona en «¿De quién es?».
  const cfg = await configDeLinea(supabase, ctx.workspaceId);
  if (typeof cfg === 'string') return { ok: false, error: 'base', mensaje: cfg };
  let contactoId: string;
  if (p.contacto?.tipo === 'existente') {
    const { data: c } = await supabase.from('contactos').select('id').eq('id', p.contacto.id).eq('workspace_id', ctx.workspaceId).maybeSingle();
    if (!c) return { ok: false, error: 'contacto', mensaje: 'Ese cliente no está en ONE.' };
    contactoId = p.contacto.id;
  } else if (p.contacto?.tipo === 'nuevo' && p.contacto.nombre.trim()) {
    // Nombre en mayúsculas, como el resto del directorio y como lo crea el bot.
    const { data: c, error } = await supabase.from('contactos')
      .insert({ workspace_id: ctx.workspaceId, nombre: p.contacto.nombre.trim().toUpperCase(), telefono: p.contacto.telefono?.trim() || null })
      .select('id').single();
    if (error || !c) return { ok: false, error: 'contacto', mensaje: `No se pudo crear el cliente: ${error?.message ?? ''}` };
    contactoId = (c as Fila).id as string;
  } else {
    return { ok: false, error: 'contacto', mensaje: 'Falta decir de quién es la solicitud.' };
  }

  const pistas = pistasDelTexto(crudos.map(m => String(m.cuerpo ?? '')).join('\n'));
  const r = await crearNegocio(supabase, {
    workspaceId: ctx.workspaceId, cfg, contactoId, entregaId: fila.entrega_id as string, staffId: ctx.staffId, salida, pistas, canal: CANAL_WEB,
  });
  if (typeof r === 'string') {
    await actualizar(supabase, fila.id as string, { estado: 'error', error: r, contacto_id: contactoId, intentos: MAX_INTENTOS });
    return { ok: false, error: 'base', mensaje: 'No se pudo crear el viaje. Inténtalo otra vez.' };
  }
  const h = huecos(cfg.fields, r.valores);
  const cargados = Object.keys(salida.sugeridos).filter(k => r.valores[k] !== undefined && r.valores[k] !== null && r.valores[k] !== '').length;
  await actualizar(supabase, fila.id as string, {
    estado: 'negocio_creado', destino: 'nuevo', contacto_id: contactoId, negocio_id: r.negocioId, huecos: h,
    cargados: Object.keys(salida.sugeridos),
  });
  return { ok: true, negocioId: r.negocioId, cargados, faltanMinimo: h.minimo.faltan.length, mensaje: textoCargado(cargados, h.minimo.faltan.length) };
}

/** «Descartar»: lo pegado queda en la bandeja como descartado. Nada se carga. */
export async function descartarTexto(supabase: SupabaseClient, ctx: Contexto, p: { entendimientoId: string }): Promise<{ ok: boolean }> {
  const { data } = await supabase.from('wa_bandeja_entendimientos')
    .update({ estado: 'descartada', error: 'descartado en la web por quien lo pegó', updated_at: new Date().toISOString() })
    .eq('id', p.entendimientoId).eq('workspace_id', ctx.workspaceId).eq('canal', CANAL_WEB).eq('estado', 'por_confirmar').select('id');
  return { ok: (data ?? []).length > 0 };
}
