// ============================================================
// ¿Quién es el cliente? — la ejecución (consultas y escrituras)
// ------------------------------------------------------------
// Las decisiones viven en `wa-cliente-reglas.ts` (puro, probado). Aquí:
//   · se consulta la base: la llave con `buscar_contacto_duplicado` (la regla de SOENA, sin cambios) y el
//     nombre con `buscar_clientes_por_nombre` (todo el directorio, también clientes sin viajes abiertos);
//   · se crea un contacto SOLO con el guardián: con una llave (decisión de Mauricio del 2026-10-05), después de
//     volver a buscarla justo antes del `insert` (entre la pregunta y el «sí» pudo crearlo otra puerta), y si la
//     búsqueda falla, no se crea («error al comprobar ≠ permiso para crear»);
//   · se completa la llave que le falte a un contacto que ya existe, sin pisar nada y sin quitársela a otro;
//   · se crea (o se reusa) la empresa espejo de la persona natural, con la misma regla de la app
//     (`src/lib/negocios/crear-negocio.ts`, «Persona natural: auto-crear empresa vinculada al contacto»).
// ============================================================

import { hibridoDelWorkspace } from './wa-hibrido.ts';
import {
  claveDeLlave, claveDeNombre, directorioDesde, digitosCelular, nombreEnElDirectorio, nombreIdentico, resolverCliente, resolverConDirectorio,
  tieneLlave, tramosDelNombre,
} from './wa-cliente-reglas.ts';
import { normalizarNombre } from './wa-entendimiento-reglas.ts';
import type { Directorio, FichaCliente, Llave, ResolucionCliente } from './wa-cliente-reglas.ts';
import { armarSegmentos, nombreDelViajeNuevo } from './wa-viajes-reglas.ts';
import type { DestinoNuevo, MensajeViaje, PlanViajes, ViajeAbierto } from './wa-viajes-reglas.ts';
import type { SupabaseClient } from './types.ts';

type Fila = Record<string, unknown>;

function cel4De(telefono: unknown): string | null {
  const d = String(telefono ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : null;
}

function viajeDe(v: unknown): { codigo: string | null; nombre: string | null } {
  const x = (v && typeof v === 'object' ? v : {}) as Fila;
  return { codigo: (x.codigo as string | null) ?? null, nombre: (x.nombre as string | null) ?? null };
}

/** Los dueños de una llave (`buscar_contacto_duplicado`), con sus viajes para mostrarlos. `null`: la consulta falló. */
export async function fichasPorLlave(supabase: SupabaseClient, workspaceId: string, llave: Llave): Promise<FichaCliente[] | null> {
  const { data, error } = await supabase.rpc('buscar_contacto_duplicado', {
    p_workspace_id: workspaceId,
    p_telefono: llave.celular ?? null,
    p_email: llave.correo ?? null,
    p_usuario_whatsapp: llave.usuario ?? null,
  });
  if (error) {
    console.error('[wa-cliente] no se pudo buscar la llave:', error.message);
    return null;
  }
  const filas = (Array.isArray(data) ? data : []) as Fila[];
  if (filas.length === 0) return [];
  const ids = filas.map(f => f.id as string);
  // Los viajes son para mostrarlo («un viaje abierto: Miami»); si esa lectura falla, se muestra sin ellos.
  const { data: negs } = await supabase.from('negocios').select('contacto_id, codigo, nombre, estado, created_at')
    .eq('workspace_id', workspaceId).in('contacto_id', ids).limit(200);
  const delContacto = (id: string) => ((negs ?? []) as Fila[]).filter(n => n.contacto_id === id)
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  return filas.map(f => {
    const ns = delContacto(f.id as string);
    const cerrado = ns.find(n => n.estado !== 'abierto');
    return {
      id: f.id as string,
      nombre: String(f.nombre ?? ''),
      cel4: cel4De(f.telefono),
      correo: !!String(f.email ?? '').trim(),
      usuario: !!String(f.usuario_whatsapp ?? '').trim(),
      abiertos: ns.filter(n => n.estado === 'abierto').map(viajeDe),
      cerrado: cerrado ? viajeDe(cerrado) : null,
    };
  });
}

/** Los contactos que se llaman como `nombre` o se le parecen, en todo el directorio. `null`: la consulta falló. */
export async function fichasPorNombre(supabase: SupabaseClient, workspaceId: string, nombre: string): Promise<FichaCliente[] | null> {
  const { data, error } = await supabase.rpc('buscar_clientes_por_nombre', { p_workspace_id: workspaceId, p_texto: nombre });
  if (error) {
    console.error('[wa-cliente] no se pudo buscar el nombre:', error.message);
    return null;
  }
  return ((Array.isArray(data) ? data : []) as Fila[]).map(f => ({
    id: f.id as string,
    nombre: String(f.nombre ?? ''),
    cel4: (f.cel4 as string | null) ?? null,
    correo: f.tiene_correo === true,
    usuario: f.tiene_usuario === true,
    abiertos: (Array.isArray(f.abiertos) ? f.abiertos : []).map(viajeDe),
    cerrado: f.cerrado ? viajeDe(f.cerrado) : null,
    exacto: f.exacto === true,
  }));
}

/** El directorio de unos nombres y unas llaves (cada uno consultado una vez). */
export async function directorioPara(
  supabase: SupabaseClient, workspaceId: string, p: { nombres: ReadonlyArray<string>; llaves: ReadonlyArray<Llave> },
): Promise<Directorio> {
  const nombres = new Map<string, FichaCliente[] | null>();
  const llaves = new Map<string, FichaCliente[] | null>();
  // Cada nombre y sus tramos (noveno control: el cliente se busca también por la parte del escrito que es su nombre).
  for (const n of p.nombres.flatMap(x => [x, ...tramosDelNombre(x)])) {
    const k = claveDeNombre(n);
    if (k && !nombres.has(k)) nombres.set(k, await fichasPorNombre(supabase, workspaceId, n));
  }
  for (const l of p.llaves) {
    if (!tieneLlave(l)) continue;
    const k = claveDeLlave(l);
    if (!llaves.has(k)) llaves.set(k, await fichasPorLlave(supabase, workspaceId, l));
  }
  const dir = directorioDesde(nombres, llaves);
  // El parecido por contención (hallazgo 8) solo con el bot híbrido del workspace.
  return await hibridoDelWorkspace(supabase, workspaceId) ? { ...dir, contiene: true } : dir;
}

/** ¿Quién es el cliente? Con la base, en el acto (§3.2). */
export async function resolverClienteEnBase(
  supabase: SupabaseClient, workspaceId: string,
  p: { nombre: string | null | undefined; llave: Llave | null | undefined; descartadas?: string[]; otraPersona?: boolean },
): Promise<ResolucionCliente> {
  const nombre = String(p.nombre ?? '').trim();
  const dir = await directorioPara(supabase, workspaceId, { nombres: nombre && !p.otraPersona ? [nombre] : [], llaves: tieneLlave(p.llave) ? [p.llave] : [] });
  return resolverConDirectorio(dir, { nombre, llave: p.llave, descartadas: p.descartadas, otraPersona: p.otraPersona });
}

/**
 * El directorio de una tanda: los nombres de sus viajes nuevos y las llaves que escribió el comercial. Se arma
 * con una pasada de `armarSegmentos` sin directorio (los nombres y las llaves no dependen de él).
 */
export async function directorioDeLaTanda(
  supabase: SupabaseClient, workspaceId: string, mensajes: ReadonlyArray<MensajeViaje>, viajes: ReadonlyArray<ViajeAbierto>,
  cfg: { horasCajaActiva: number; equipo?: ReadonlyArray<string> },
): Promise<Directorio> {
  const { segmentos } = armarSegmentos(mensajes, viajes, cfg);
  const nombres: string[] = [];
  const llaves: Llave[] = [];
  const porN = new Map(mensajes.map(m => [m.n, m]));
  for (const sg of segmentos) {
    if (sg.encabezado?.resolucion.tipo !== 'nuevo') continue;
    const n = nombreDelViajeNuevo(sg);
    if (n) nombres.push(n);
    // Décimo control (hallazgo 8): sin nombre, la respuesta escrita a «¿Para qué cliente es?» puede traerlo con un verbo o
    // una fórmula delante. Se buscan sus tramos (los dos primeros escritos cortos de la caja) para leerla con el directorio.
    else {
      const escritos = sg.mensajes.map(k => porN.get(k)).filter(m => !!m && !m.reenviado && m.cuerpo.trim().split(/\s+/).length <= 10).slice(0, 2);
      for (const m of escritos) nombres.push(m!.cuerpo);
    }
    if (tieneLlave(sg.cliente?.llave)) llaves.push(sg.cliente!.llave!);
  }
  return directorioPara(supabase, workspaceId, { nombres, llaves });
}

/** El directorio de los viajes nuevos de un plan que todavía no se resolvieron. */
export async function directorioDelPlan(supabase: SupabaseClient, workspaceId: string, plan: PlanViajes): Promise<Directorio> {
  const nuevos = plan.mensajes.map(m => m.destino).filter((d): d is DestinoNuevo => !!d && d.tipo === 'nuevo' && !d.contacto && !d.falta);
  return directorioPara(supabase, workspaceId, {
    nombres: nuevos.filter(d => !!d.cliente && !d.otraPersona && !d.elegido).map(d => d.cliente!),
    llaves: nuevos.filter(d => tieneLlave(d.llave)).map(d => d.llave!),
  });
}

// ── Escribir ────────────────────────────────────────────────────────────────

export type ResultadoCrear =
  | { tipo: 'creado'; id: string }
  /** No se creó: la resolución dice por qué (la llave ya es de alguien, falta la llave, varios). */
  | { tipo: 'no_creado'; resolucion: ResolucionCliente }
  | { tipo: 'error'; motivo: string };

/**
 * Crea un contacto, SOLO con el guardián (§3.2 paso 4 y la regla V20 del diseño):
 *   · sin llave no se crea (decisión 1): `no_creado` con `pedir_llave`;
 *   · la llave se vuelve a buscar justo antes del `insert`; si ya es de alguien, no se crea (el dueño con el mismo
 *     nombre es `existente`; con otro nombre, `llave_de_otro`);
 *   · si la búsqueda falla, no se crea.
 * El nombre va en mayúsculas, como el resto del directorio; las llaves, en su columna.
 */
export async function crearContactoConGuardian(
  supabase: SupabaseClient, workspaceId: string, p: { nombre: string; llave: Llave | null | undefined },
): Promise<ResultadoCrear> {
  const dado = String(p.nombre ?? '').trim();
  if (!dado) return { tipo: 'no_creado', resolucion: { tipo: 'sin_nombre', llave: p.llave ?? null } };
  // Noveno control (hallazgo 1): justo antes de crear, el nombre se vuelve a mirar contra el directorio por sus tramos.
  // Si un tramo es exacto el de alguien, no se crea (es ese, o se pregunta cuál); si arranca con una fórmula que no es
  // de nadie, se pregunta el nombre.
  const dirNombre = await directorioPara(supabase, workspaceId, { nombres: [dado], llaves: [] });
  const leido = nombreEnElDirectorio(dado, dirNombre);
  if (leido.dudoso) return { tipo: 'no_creado', resolucion: tieneLlave(p.llave) ? { tipo: 'sin_nombre', llave: p.llave } : { tipo: 'sin_nombre' } };
  const nombre = leido.nombre;
  if (normalizarNombre(nombre) !== normalizarNombre(dado)) {
    const fichas = (dirNombre.porNombre(nombre) ?? []).filter(f => nombreIdentico(nombre, f.nombre));
    if (fichas.length > 0) return { tipo: 'no_creado', resolucion: resolverCliente({ nombre, llave: null, porNombre: fichas }) };
  }
  if (!tieneLlave(p.llave)) return { tipo: 'no_creado', resolucion: { tipo: 'pedir_llave', nombre } };
  const duenos = await fichasPorLlave(supabase, workspaceId, p.llave);
  if (duenos === null) return { tipo: 'error', motivo: 'no se pudo comprobar si la llave ya es de alguien: no se crea el contacto' };
  if (duenos.length > 0) return { tipo: 'no_creado', resolucion: resolverCliente({ nombre, llave: p.llave, porLlave: duenos, porNombre: [] }) };
  const { data, error } = await supabase.from('contactos').insert({
    workspace_id: workspaceId,
    nombre: nombre.toUpperCase(),
    telefono: p.llave.celular ?? null,
    email: p.llave.correo ?? null,
    usuario_whatsapp: p.llave.usuario ?? null,
  }).select('id').single();
  if (error || !data) return { tipo: 'error', motivo: `no se pudo crear el contacto: ${error?.message ?? 'sin fila'}` };
  return { tipo: 'creado', id: data.id as string };
}

/**
 * Completa en un contacto que ya existe la llave que le falta (§3.2 paso 5): nunca reemplaza un dato que ya
 * está, y no agrega una llave que ya es de otro contacto (lo dice). Devuelve los avisos para el comercial.
 */
export async function completarLlave(
  supabase: SupabaseClient, workspaceId: string, contactoId: string, llave: Llave | null | undefined,
): Promise<string[]> {
  if (!tieneLlave(llave)) return [];
  const { data: c, error } = await supabase.from('contactos').select('id, nombre, telefono, email, usuario_whatsapp')
    .eq('id', contactoId).eq('workspace_id', workspaceId).maybeSingle();
  if (error || !c) return [];
  const avisos: string[] = [];
  const campos: Array<{ col: 'telefono' | 'email' | 'usuario_whatsapp'; valor: string | null | undefined; sola: Llave; dice: string }> = [
    { col: 'telefono', valor: llave.celular, sola: { celular: llave.celular }, dice: 'el celular' },
    { col: 'email', valor: llave.correo, sola: { correo: llave.correo }, dice: 'el correo' },
    { col: 'usuario_whatsapp', valor: llave.usuario, sola: { usuario: llave.usuario }, dice: 'el usuario' },
  ];
  for (const f of campos) {
    if (!f.valor) continue;
    const actual = c[f.col] as string | null | undefined;
    // Ya tiene ese dato (igual o distinto): no se toca.
    if (actual !== null && actual !== undefined && String(actual).trim() !== '') continue;
    const duenos = await fichasPorLlave(supabase, workspaceId, f.sola);
    if (duenos === null) continue;
    const otro = duenos.find(d => d.id !== contactoId);
    if (otro) {
      avisos.push(`No le agregué ${f.dice} a ${c.nombre}: ya es de ${otro.nombre}.`);
      continue;
    }
    const q = supabase.from('contactos').update({ [f.col]: f.col === 'telefono' ? digitosCelular(f.valor) ?? f.valor : f.valor })
      .eq('id', contactoId).eq('workspace_id', workspaceId);
    // Solo si sigue vacío en este instante: una edición a mano entre tanto gana.
    const { error: eU } = await (actual === null || actual === undefined ? q.is(f.col, null) : q.eq(f.col, actual));
    if (eU) console.error(`[wa-cliente] no se pudo completar ${f.col} de ${contactoId}:`, eU.message);
  }
  return avisos;
}

/**
 * La empresa espejo de una persona natural, como la crea la app al crear un negocio: si el contacto ya tiene una
 * empresa vinculada, esa; si no, una con su nombre (`tipo_persona: natural`, CC; el código lo pone el trigger).
 * Si falla, el negocio se crea igual sin empresa (como hace la app) y queda en el log.
 */
export async function empresaEspejo(supabase: SupabaseClient, workspaceId: string, contactoId: string): Promise<string | null> {
  const { data: ya } = await supabase.from('empresas').select('id').eq('workspace_id', workspaceId).eq('contacto_id', contactoId).limit(1).maybeSingle();
  if (ya?.id) return ya.id as string;
  const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).maybeSingle();
  const { data: nueva, error } = await supabase.from('empresas').insert({
    workspace_id: workspaceId,
    nombre: String(c?.nombre ?? '').trim() || 'Persona Natural',
    tipo_persona: 'natural',
    contacto_id: contactoId,
    tipo_documento: 'CC',
    codigo: '', // el trigger lo genera
  }).select('id').single();
  if (error || !nueva) {
    console.error(`[wa-cliente] sin empresa espejo para el contacto ${contactoId}:`, error?.message ?? 'sin fila');
    return null;
  }
  return nueva.id as string;
}
