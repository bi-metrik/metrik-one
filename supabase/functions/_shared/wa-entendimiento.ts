// ============================================================
// Paso de entendimiento de la bandeja de WhatsApp — la ejecución
// ------------------------------------------------------------
// Las decisiones viven en `wa-entendimiento-reglas.ts` (puro, probado) y en la migración
// 20260928200000 (tabla `wa_bandeja_entendimientos`). Aquí se lee, se llama al modelo, se
// escribe y se contesta.
//
// Regla de este módulo: el crudo NO se toca. Lo que sale del modelo va a
// `wa_bandeja_entendimientos`; si el modelo falla, la entrega y sus mensajes siguen intactos y
// el paso se reintenta (hasta `MAX_INTENTOS`).
//
// Nada corre si el workspace no tiene `modules.bandeja_solicitudes_wa`.
// ============================================================

import { sendTextMessage } from './wa-respond.ts';
import { bandejaActiva } from './wa-bandeja-reglas.ts';
import { todayBogotaISO } from './bogota.ts';
import { aplanarBloques } from './niveles-solicitud.ts';
import {
  aplicarSumas,
  decidirContacto,
  esquemaDeSalida,
  fusionarSugeridos,
  huecos,
  instruccionesEntendimiento,
  interpretarRespuestaContacto,
  mayusculasDeViaje,
  mensajeAlComercial,
  palabrasDeBusqueda,
  resumenEntendido,
  MAX_PREGUNTAS,
  textoPreguntaContacto,
  validarSalida,
} from './wa-entendimiento-reglas.ts';
import type { CampoEntendible, ContactoCandidato, DecisionContacto, SalidaEntendida } from './wa-entendimiento-reglas.ts';
import {
  armarOpcionesNegocio,
  cargarEnExistente,
  codigoCompacto,
  interpretarRespuestaNegocio,
  mensajeCargaExistente,
  origenDeFrase,
  primerNombre,
  textoPreguntaNegocio,
  trazaCarga,
} from './wa-carga-reglas.ts';
import type { Conflicto, NegocioAbierto, OpcionNegocio } from './wa-carga-reglas.ts';
import type { SupabaseClient } from './types.ts';

/** El mismo proveedor y el mismo modelo base que ONE ya usa para leer mensajes (`wa-parse.ts`). */
const GEMINI_MODEL = Deno.env.get('GEMINI_ENTENDIMIENTO_MODEL') || Deno.env.get('GEMINI_PARSE_MODEL') || 'gemini-2.5-flash-lite';
const INTENT = 'bandeja_entendimiento';
const MAX_INTENTOS = 3;
const LOTE = 5;
/** Horas durante las cuales un texto del comercial cuenta como respuesta a «¿cuál contacto?». */
const HORAS_RESPUESTA_CONTACTO = 24;
const ORIGEN_POR_DEFECTO = 'contacto_directo';

type Fila = Record<string, unknown>;

async function enviar(phone: string, texto: string, workspaceId: string): Promise<boolean> {
  try {
    await sendTextMessage(phone, texto, { origen: 'bot', workspaceId, intent: INTENT });
    return true;
  } catch (err) {
    console.error(`[wa-entendimiento] no se pudo enviar a ${phone}:`, err);
    return false;
  }
}

async function actualizar(supabase: SupabaseClient, id: string, cambios: Fila): Promise<void> {
  const { error } = await supabase
    .from('wa_bandeja_entendimientos')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error(`[wa-entendimiento] no se pudo actualizar ${id}:`, error.message);
}

// ── Modelo ───────────────────────────────────────────────────────────────────

interface Lectura { json: unknown | null; finishReason: string | null; error: string | null }

/**
 * Llama al modelo con el esquema generado de la config. Verifica el MOTIVO DE TERMINACIÓN,
 * no solo que haya texto: media respuesta aceptada en silencio es un falso verde (§3 del diseño).
 */
async function leerConModelo(instrucciones: string, texto: string, esquema: unknown): Promise<Lectura> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return { json: null, finishReason: null, error: 'GEMINI_NO_KEY' };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instrucciones }] },
        contents: [{ role: 'user', parts: [{ text: texto }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema: esquema,
        },
      }),
    });
    if (!res.ok) return { json: null, finishReason: null, error: `GEMINI_HTTP_${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    const bloqueo = data.promptFeedback?.blockReason;
    if (bloqueo) return { json: null, finishReason: null, error: `GEMINI_BLOCKED: ${bloqueo}` };
    const finishReason: string | null = data.candidates?.[0]?.finishReason ?? null;
    if (finishReason !== 'STOP') {
      return { json: null, finishReason, error: `GEMINI_INCOMPLETO: finishReason ${finishReason ?? '(ausente)'}` };
    }
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!txt) return { json: null, finishReason, error: 'GEMINI_EMPTY' };
    try {
      return { json: JSON.parse(txt), finishReason, error: null };
    } catch {
      return { json: null, finishReason, error: 'GEMINI_JSON_INVALIDO' };
    }
  } catch (err) {
    return { json: null, finishReason: null, error: `GEMINI_RED: ${String(err).slice(0, 200)}` };
  }
}

// ── Config de la línea ───────────────────────────────────────────────────────

interface ConfigLinea {
  lineaId: string;
  etapaId: string;
  stage: string | null;
  bloques: Array<{ id: string; tipo: string | null; config_extra: Fila | null }>;
  fields: CampoEntendible[];
  slug: string;
  origen: string;
}

/**
 * La línea de la solicitud: `config_extra.bandeja_solicitudes.linea_id` del workspace, o su
 * `linea_activa_id` (la misma que usa `crearNegocio` sin línea). La etapa es la primera por
 * `orden`: la «Solicitud».
 */
async function lineaDeLaBandeja(
  supabase: SupabaseClient, workspaceId: string,
): Promise<{ lineaId: string; slug: string; cfg: Fila } | string> {
  const { data: ws, error } = await supabase
    .from('workspaces').select('slug, linea_activa_id, config_extra').eq('id', workspaceId).maybeSingle();
  if (error || !ws) return `no se pudo leer el workspace: ${error?.message ?? 'no existe'}`;
  const cfg = (ws.config_extra?.bandeja_solicitudes ?? {}) as Fila;
  const lineaId = (typeof cfg.linea_id === 'string' && cfg.linea_id) || ws.linea_activa_id;
  if (!lineaId) return 'sin línea: declara config_extra.bandeja_solicitudes.linea_id';
  return { lineaId, slug: ws.slug as string, cfg };
}

async function configDeLinea(supabase: SupabaseClient, workspaceId: string): Promise<ConfigLinea | string> {
  const l = await lineaDeLaBandeja(supabase, workspaceId);
  if (typeof l === 'string') return l;
  const { lineaId, cfg } = l;

  const { data: etapa } = await supabase
    .from('etapas_negocio').select('id, stage, linea_id')
    .eq('linea_id', lineaId).order('orden', { ascending: true }).limit(1).maybeSingle();
  if (!etapa) return `la línea ${lineaId} no tiene etapas`;

  const { data: bcs, error: e2 } = await supabase
    .from('bloque_configs').select('id, orden, config_extra, bloque_definitions(tipo)')
    .eq('etapa_id', etapa.id).eq('workspace_id', workspaceId).order('orden', { ascending: true });
  if (e2) return `no se pudieron leer los bloques: ${e2.message}`;
  const bloques = ((bcs ?? []) as Fila[]).map(b => ({
    id: b.id as string,
    tipo: ((b.bloque_definitions as Fila | null)?.tipo as string | undefined) ?? null,
    config_extra: (b.config_extra as Fila | null) ?? null,
  }));
  const { fields } = aplanarBloques(bloques.filter(b => b.tipo === 'datos').map(b => ({ fields: b.config_extra?.fields, data: null })));
  return {
    lineaId, etapaId: etapa.id, stage: etapa.stage ?? null, bloques,
    fields: fields as CampoEntendible[], slug: l.slug,
    origen: typeof cfg.origen === 'string' && cfg.origen ? cfg.origen : ORIGEN_POR_DEFECTO,
  };
}

// ── Contacto ─────────────────────────────────────────────────────────────────

/** Trae candidatos del workspace por teléfono y por palabras del nombre. La decisión es pura. */
async function candidatosDeContacto(
  supabase: SupabaseClient, workspaceId: string, clienteTexto: string | null, extraido: SalidaEntendida['cliente'],
): Promise<ContactoCandidato[]> {
  const out = new Map<string, ContactoCandidato>();
  const tel = String(clienteTexto ?? '').replace(/\D/g, '').slice(-10) || String(extraido.telefono ?? '').replace(/\D/g, '').slice(-10);
  if (tel.length >= 7) {
    const { data } = await supabase.from('contactos').select('id, nombre, telefono')
      .eq('workspace_id', workspaceId).ilike('telefono', `%${tel.slice(-7)}%`).limit(20);
    for (const c of (data ?? []) as ContactoCandidato[]) out.set(c.id, c);
  }
  for (const w of palabrasDeBusqueda(clienteTexto, extraido.nombre)) {
    const { data } = await supabase.from('contactos').select('id, nombre, telefono')
      .eq('workspace_id', workspaceId).ilike('nombre', `%${w}%`).limit(50);
    for (const c of (data ?? []) as ContactoCandidato[]) out.set(c.id, c);
  }
  return [...out.values()];
}

// ── Negocio ──────────────────────────────────────────────────────────────────

async function crearNegocio(
  supabase: SupabaseClient,
  p: {
    workspaceId: string; cfg: ConfigLinea; contactoId: string; entregaId: string;
    staffId: string | null; salida: SalidaEntendida;
  },
): Promise<{ negocioId: string; valores: Record<string, unknown> } | string> {
  const { data: contacto } = await supabase.from('contactos').select('nombre').eq('id', p.contactoId).maybeSingle();
  const destino = p.salida.sugeridos.destino?.valor;
  const nombre = [contacto?.nombre ?? 'Solicitud por WhatsApp', destino].filter(Boolean).join(' · ');

  const { data: neg, error } = await supabase.from('negocios').insert({
    workspace_id: p.workspaceId,
    nombre,
    linea_id: p.cfg.lineaId,
    contacto_id: p.contactoId,
    etapa_actual_id: p.cfg.etapaId,
    stage_actual: p.cfg.stage,
    estado: 'abierto',
    origen: p.cfg.origen,
  }).select('id').single();
  if (error || !neg) return `no se pudo crear el negocio: ${error?.message ?? 'sin fila'}`;
  const negocioId = neg.id as string;

  // Los bloques de la etapa, como los crea `crearNegocio`: defaults del campo y, en los
  // bloques `datos`, los valores sugeridos con su marca.
  const en = new Date().toISOString();
  let valores: Record<string, unknown> = {};
  const instancias = p.cfg.bloques.map(b => {
    const fields = (Array.isArray(b.config_extra?.fields) ? b.config_extra!.fields : []) as CampoEntendible[];
    let data: Record<string, unknown> = {};
    for (const f of fields) if (f.default !== undefined) data[f.slug] = f.default;
    if (b.tipo === 'datos') {
      data = fusionarSugeridos(data, fields, p.salida.sugeridos, { entrega_id: p.entregaId, en }).data;
      data = mayusculasDeViaje(fields, aplicarSumas(fields, data));
      valores = { ...data, ...valores };
    }
    return { negocio_id: negocioId, bloque_config_id: b.id, estado: 'pendiente', data };
  });
  if (instancias.length > 0) {
    const { error: eB } = await supabase.from('negocio_bloques').insert(instancias);
    if (eB) console.error(`[wa-entendimiento] negocio ${negocioId} sin bloques:`, eB.message);
  }

  // Responsable: quien reenvió. Mismo rol por área que `asignarResponsable`.
  if (p.staffId) {
    const { data: areas } = await supabase.from('staff_areas').select('area').eq('staff_id', p.staffId);
    const lista = ((areas ?? []) as Fila[]).map(a => a.area);
    const rol = lista.includes('comercial') ? 'comercial' : lista.includes('operaciones') ? 'operaciones' : null;
    const { error: eR } = await supabase.from('negocio_responsables')
      .upsert({ negocio_id: negocioId, staff_id: p.staffId, assigned_by: null, rol }, { onConflict: 'negocio_id,staff_id' });
    if (eR) console.error(`[wa-entendimiento] negocio ${negocioId} sin responsable:`, eR.message);
    else await supabase.from('negocios').update({ responsable_id: p.staffId }).eq('id', negocioId);
  }

  // La historia al timeline: es lo que se le lee al cliente para confirmar (§4.1).
  const { error: eA } = await supabase.from('activity_log').insert({
    workspace_id: p.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio_sistema',
    autor_id: p.staffId,
    contenido: `Solicitud entendida desde WhatsApp. Los datos llegan como sugeridos hasta que alguien los confirme.\n\n${p.salida.historia}`,
  });
  if (eA) console.error(`[wa-entendimiento] negocio ${negocioId} sin historia en el timeline:`, eA.message);

  return { negocioId, valores };
}

function enlaceNegocio(slug: string, negocioId: string): string {
  const base = (Deno.env.get('APP_BASE_DOMAIN') || 'metrikone.co').trim();
  return `https://${slug}.${base}/negocios/${negocioId}`;
}

async function cerrarConNegocio(
  supabase: SupabaseClient,
  ent: Fila,
  cfg: ConfigLinea,
  contactoId: string,
  salida: SalidaEntendida,
): Promise<void> {
  const r = await crearNegocio(supabase, {
    workspaceId: ent.workspace_id as string, cfg, contactoId, entregaId: ent.entrega_id as string,
    staffId: (ent.remitente_staff_id as string | null) ?? null, salida,
  });
  if (typeof r === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: r, contacto_id: contactoId });
    return;
  }
  const h = huecos(cfg.fields, r.valores);
  const msg = mensajeAlComercial({
    // El resumen con lo que el comercial dijo, no con la mayúscula del bloque.
    resumen: resumenEntendido(cfg.fields, { ...r.valores, ...Object.fromEntries(Object.entries(salida.sugeridos).map(([k, v]) => [k, v.valor])) }),
    faltanMinimo: h.minimo.faltan,
    enlace: enlaceNegocio(cfg.slug, r.negocioId),
  });
  const ok = await enviar(ent.remitente_phone as string, msg, ent.workspace_id as string);
  await actualizar(supabase, ent.id as string, {
    estado: 'negocio_creado', contacto_id: contactoId, negocio_id: r.negocioId, huecos: h,
    respuesta_enviada_at: ok ? new Date().toISOString() : null, error: ok ? null : 'envio fallido',
  });
}

function salidaGuardada(ent: Fila): SalidaEntendida {
  return {
    historia: (ent.historia as string) ?? '',
    cliente: (ent.cliente as SalidaEntendida['cliente']) ?? { nombre: null, telefono: null },
    sugeridos: (ent.sugeridos as SalidaEntendida['sugeridos']) ?? {},
    descartados: (ent.descartados as SalidaEntendida['descartados']) ?? [],
  };
}

async function preguntarContacto(supabase: SupabaseClient, ent: Fila, d: Extract<DecisionContacto, { tipo: 'preguntar' }>) {
  const ok = await enviar(ent.remitente_phone as string, textoPreguntaContacto(d), ent.workspace_id as string);
  await actualizar(supabase, ent.id as string, {
    estado: 'esperando_contacto', contacto_opciones: d.opciones, contacto_nombre: d.nombre,
    pregunta_contacto_at: ok ? new Date().toISOString() : null, respuesta_contacto: null, error: ok ? null : 'envio fallido',
  });
}

// ── Una entrega ──────────────────────────────────────────────────────────────

async function entender(supabase: SupabaseClient, ent: Fila): Promise<void> {
  const workspaceId = ent.workspace_id as string;

  const { data: entrega } = await supabase.from('wa_bandeja_entregas')
    .select('cliente_texto, negocio_opciones').eq('id', ent.entrega_id).maybeSingle();
  const { data: msgs, error: eM } = await supabase.from('wa_bandeja_mensajes')
    .select('cuerpo, cuerpo_origen').eq('entrega_id', ent.entrega_id).eq('papel', 'contenido').order('recibido_at', { ascending: true });
  if (eM) {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: `no se pudieron leer los mensajes: ${eM.message}` });
    return;
  }
  const mensajes = (msgs ?? []) as MensajeCrudo[];
  const texto = mensajes.map(m => String(m.cuerpo ?? '').trim()).filter(Boolean).join('\n---\n');
  if (!texto) {
    await actualizar(supabase, ent.id as string, { estado: 'descartada', error: 'la entrega no tiene texto (solo media sin pie)' });
    return;
  }

  // ¿A qué viaje va? Con la pregunta vieja (`negocio_opciones` nula) la respuesta es el
  // cliente y el camino es el de siempre: negocio nuevo.
  const opciones = Array.isArray(entrega?.negocio_opciones) ? (entrega!.negocio_opciones as OpcionNegocio[]) : null;
  let clienteTexto: string | null = entrega?.cliente_texto ?? null;
  if (opciones) {
    const respuesta = String(ent.respuesta_negocio ?? entrega?.cliente_texto ?? '');
    const r = interpretarRespuestaNegocio(respuesta, opciones);
    if (r.tipo === 'no_entendida') {
      await volverAPreguntarNegocio(supabase, ent, opciones, `No entendí «${respuesta.slice(0, 40)}».`);
      return;
    }
    let negocioId: string | null = r.tipo === 'existente' ? r.negocio_id : null;
    if (r.tipo === 'codigo') {
      negocioId = await negocioAbiertoPorCodigo(supabase, workspaceId, r.codigo);
      if (!negocioId) {
        await volverAPreguntarNegocio(supabase, ent, opciones, `No encontré un viaje abierto con el código «${respuesta.slice(0, 20)}».`);
        return;
      }
    }
    if (negocioId) {
      await actualizar(supabase, ent.id as string, { destino: 'existente', negocio_destino_id: negocioId });
      await cargarEnNegocioExistente(supabase, ent, negocioId, texto, mensajes, opciones);
      return;
    }
    // NUEVO: lo que escribió después («NUEVO Marta Gómez») es el cliente.
    clienteTexto = r.tipo === 'nuevo' ? r.cliente : null;
    await actualizar(supabase, ent.id as string, { destino: 'nuevo' });
  }

  const cfg = await configDeLinea(supabase, workspaceId);
  if (typeof cfg === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: cfg });
    return;
  }

  const lectura = await leerConModelo(
    instruccionesEntendimiento(cfg.fields, todayBogotaISO()),
    `El comercial dice que el cliente es: ${clienteTexto ?? '(no lo dijo)'}\n\nMensajes:\n${texto}`,
    esquemaDeSalida(cfg.fields),
  );
  if (lectura.error || lectura.json === null) {
    await actualizar(supabase, ent.id as string, {
      estado: 'error', error: lectura.error, finish_reason: lectura.finishReason, modelo: GEMINI_MODEL,
    });
    return;
  }

  const salida = validarSalida(lectura.json, cfg.fields, texto);
  const valores = aplicarSumas(cfg.fields, Object.fromEntries(Object.entries(salida.sugeridos).map(([k, v]) => [k, v.valor])));
  await actualizar(supabase, ent.id as string, {
    linea_id: cfg.lineaId, historia: salida.historia, sugeridos: salida.sugeridos, descartados: salida.descartados,
    cliente: salida.cliente, huecos: huecos(cfg.fields, valores), modelo: GEMINI_MODEL, finish_reason: lectura.finishReason, error: null,
  });

  const candidatos = await candidatosDeContacto(supabase, workspaceId, clienteTexto, salida.cliente);
  const d = decidirContacto({ clienteTexto, extraido: salida.cliente, candidatos });
  if (d.tipo === 'unico') {
    await cerrarConNegocio(supabase, ent, cfg, d.contacto.id, salida);
  } else {
    await preguntarContacto(supabase, ent, d);
  }
}

// ── «¿A qué viaje van?» ──────────────────────────────────────────────────────

type MensajeCrudo = { cuerpo: string | null; cuerpo_origen: string | null };

/** Una relación embebida de PostgREST, venga como objeto o como lista. */
function relUno(v: unknown): Fila | null {
  const x = Array.isArray(v) ? v[0] : v;
  return x && typeof x === 'object' ? (x as Fila) : null;
}

function nombreRel(v: unknown): string | null {
  const n = relUno(v)?.nombre;
  return typeof n === 'string' && n.trim() !== '' ? n : null;
}

/**
 * Arma la lista de «¿A qué viaje van?» para una entrega recién cerrada. Devuelve `null` si no
 * se pudo (sin línea, error de lectura): quien llama hace la pregunta vieja y la entrega sigue
 * el camino de antes.
 */
export async function armarPreguntaNegocio(
  supabase: SupabaseClient, entregaId: string, workspaceId: string, nMensajes: number,
): Promise<{ texto: string; opciones: OpcionNegocio[] } | null> {
  const l = await lineaDeLaBandeja(supabase, workspaceId);
  if (typeof l === 'string') {
    console.error(`[wa-entendimiento] sin lista de viajes para ${entregaId}: ${l}`);
    return null;
  }
  const { data: ent } = await supabase.from('wa_bandeja_entregas')
    .select('remitente_staff_id').eq('id', entregaId).maybeSingle();
  const staffId = (ent?.remitente_staff_id as string | null) ?? null;

  // Todos los abiertos de la línea: el propuesto puede ser de otro comercial. Del más
  // reciente al más viejo; 500 alcanza para una agencia (el techo de PostgREST es 1.000).
  const { data: negs, error } = await supabase.from('negocios')
    .select('id, codigo, nombre, created_at, contacto_id, empresa_id, responsable_id, contactos(nombre), empresas(nombre)')
    .eq('workspace_id', workspaceId).eq('linea_id', l.lineaId).eq('estado', 'abierto')
    .order('created_at', { ascending: false }).limit(500);
  if (error) {
    console.error('[wa-entendimiento] no se pudieron leer los negocios abiertos:', error.message);
    return null;
  }
  const filas = (negs ?? []) as Fila[];
  const ids = filas.map(n => n.id as string);

  const suyos = new Set<string>();
  if (staffId && ids.length > 0) {
    for (const n of filas) if (n.responsable_id === staffId) suyos.add(n.id as string);
    const { data: resp } = await supabase.from('negocio_responsables').select('negocio_id')
      .eq('staff_id', staffId).in('negocio_id', ids);
    for (const r of (resp ?? []) as Fila[]) suyos.add(r.negocio_id as string);
  }

  // El destino sale del bloque de la solicitud (slug `destino`).
  const destinos = new Map<string, string>();
  if (ids.length > 0) {
    const { data: bl } = await supabase.from('negocio_bloques').select('negocio_id, destino:data->>destino')
      .in('negocio_id', ids.slice(0, 200)).not('data->>destino', 'is', null);
    for (const b of (bl ?? []) as Fila[]) {
      const d = typeof b.destino === 'string' ? b.destino.trim() : '';
      if (d && !destinos.has(b.negocio_id as string)) destinos.set(b.negocio_id as string, d);
    }
  }

  const { data: msgs } = await supabase.from('wa_bandeja_mensajes')
    .select('cuerpo').eq('entrega_id', entregaId).eq('papel', 'contenido');
  const texto = ((msgs ?? []) as Fila[]).map(m => String(m.cuerpo ?? '')).join('\n');

  const abiertos: NegocioAbierto[] = filas.map(n => ({
    id: n.id as string,
    codigo: (n.codigo as string | null) ?? null,
    cliente: nombreRel(n.contactos) ?? nombreRel(n.empresas) ?? ((n.nombre as string | null) ?? null),
    cliente_id: (n.contacto_id as string | null) ?? (n.empresa_id as string | null) ?? null,
    destino: destinos.get(n.id as string) ?? null,
    created_at: n.created_at as string,
    del_remitente: suyos.has(n.id as string),
  }));
  const opciones = armarOpcionesNegocio(abiertos, texto);
  return { texto: textoPreguntaNegocio({ nMensajes, opciones }), opciones };
}

async function volverAPreguntarNegocio(supabase: SupabaseClient, ent: Fila, opciones: OpcionNegocio[], aviso: string): Promise<void> {
  const ok = await enviar(ent.remitente_phone as string, textoPreguntaNegocio({ nMensajes: 0, opciones, aviso }), ent.workspace_id as string);
  await actualizar(supabase, ent.id as string, {
    estado: 'esperando_negocio', respuesta_negocio: null, respuesta_negocio_at: null,
    pregunta_negocio_at: ok ? new Date().toISOString() : null, error: ok ? null : 'envio fallido',
  });
}

/** Un código que no estaba en la lista: se busca entre los abiertos del workspace. */
async function negocioAbiertoPorCodigo(supabase: SupabaseClient, workspaceId: string, codigo: string): Promise<string | null> {
  const { data } = await supabase.from('negocios').select('id, codigo')
    .eq('workspace_id', workspaceId).eq('estado', 'abierto').not('codigo', 'is', null).limit(1000);
  const hallados = ((data ?? []) as Fila[]).filter(n => codigoCompacto(n.codigo as string) === codigo);
  return hallados.length === 1 ? (hallados[0].id as string) : null;
}

// ── Cargar en un negocio que ya existe ───────────────────────────────────────

interface BloqueDelNegocio {
  id: string;
  data: Record<string, unknown>;
  updated_at: string | null;
  fields: CampoEntendible[];
}

/**
 * Los bloques `datos` del negocio con su config, en el orden de las etapas y de los bloques.
 * Un espejo (`compartido_con_origen`) no se escribe: su dato vive en la fila del origen.
 */
async function bloquesDatosDelNegocio(supabase: SupabaseClient, negocioId: string): Promise<BloqueDelNegocio[] | string> {
  const { data, error } = await supabase.from('negocio_bloques')
    .select('id, data, updated_at, bloque_configs(orden, config_extra, bloque_definitions(tipo), etapas_negocio(orden))')
    .eq('negocio_id', negocioId);
  if (error) return `no se pudieron leer los bloques del negocio: ${error.message}`;
  const filas = ((data ?? []) as Fila[]).map(b => {
    const bc = relUno(b.bloque_configs) ?? {};
    const ce = (bc.config_extra ?? {}) as Fila;
    return {
      id: b.id as string,
      data: (b.data ?? {}) as Record<string, unknown>,
      updated_at: (b.updated_at as string | null) ?? null,
      tipo: (relUno(bc.bloque_definitions)?.tipo as string | undefined) ?? null,
      espejo: ce.compartido_con_origen === true,
      fields: (Array.isArray(ce.fields) ? ce.fields : []) as CampoEntendible[],
      ordenEtapa: Number(relUno(bc.etapas_negocio)?.orden ?? 0),
      orden: Number(bc.orden ?? 0),
    };
  });
  return filas
    .filter(b => b.tipo === 'datos' && !b.espejo && b.fields.length > 0)
    .sort((a, b) => a.ordenEtapa - b.ordenEtapa || a.orden - b.orden)
    .map(({ id, data: d, updated_at, fields }) => ({ id, data: d, updated_at, fields }));
}

/**
 * Escribe la `data` nueva de un bloque solo si nadie la cambió desde que se leyó (misma
 * `updated_at`). Si alguien guardó entre tanto, se relee y se vuelve a fusionar una vez: lo
 * que la persona escribió gana. Devuelve la data que quedó escrita (o `null` si no se pudo).
 */
async function escribirBloque(
  supabase: SupabaseClient,
  b: BloqueDelNegocio,
  fusionar: (d: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<Record<string, unknown> | null> {
  let data = b.data;
  let marca = b.updated_at;
  for (let intento = 0; intento < 2; intento++) {
    const nueva = fusionar(data);
    if (!nueva) return data;
    let q = supabase.from('negocio_bloques').update({ data: nueva, updated_at: new Date().toISOString() }).eq('id', b.id);
    q = marca ? q.eq('updated_at', marca) : q.is('updated_at', null);
    const { data: hecho, error } = await q.select('id');
    if (error) {
      console.error(`[wa-entendimiento] no se pudo escribir el bloque ${b.id}:`, error.message);
      return null;
    }
    if ((hecho ?? []).length > 0) return nueva;
    const { data: re } = await supabase.from('negocio_bloques').select('data, updated_at').eq('id', b.id).maybeSingle();
    if (!re) return null;
    data = (re.data ?? {}) as Record<string, unknown>;
    marca = (re.updated_at as string | null) ?? null;
  }
  console.error(`[wa-entendimiento] el bloque ${b.id} cambió dos veces mientras se cargaba; no se escribió`);
  return null;
}

async function cargarEnNegocioExistente(
  supabase: SupabaseClient,
  ent: Fila,
  negocioId: string,
  texto: string,
  mensajes: ReadonlyArray<MensajeCrudo>,
  opciones: OpcionNegocio[],
): Promise<void> {
  const workspaceId = ent.workspace_id as string;
  const { data: neg } = await supabase.from('negocios')
    .select('id, codigo, estado, linea_id, contacto_id, workspaces(slug)')
    .eq('id', negocioId).eq('workspace_id', workspaceId).maybeSingle();
  if (!neg || neg.estado !== 'abierto') {
    await volverAPreguntarNegocio(supabase, ent, opciones, 'Ese viaje ya no está abierto.');
    return;
  }
  const bloques = await bloquesDatosDelNegocio(supabase, negocioId);
  if (typeof bloques === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: bloques });
    return;
  }
  // Los campos y lo que ya tiene, con la config de la línea DE ESE negocio.
  const { fields, valores: yaTiene } = aplanarBloques(bloques.map(b => ({ fields: b.fields, data: b.data })));
  const campos = fields as CampoEntendible[];

  const lectura = await leerConModelo(
    instruccionesEntendimiento(campos, todayBogotaISO(), yaTiene),
    `Viaje ${neg.codigo ?? ''} (ya existe).\n\nMensajes:\n${texto}`,
    esquemaDeSalida(campos),
  );
  if (lectura.error || lectura.json === null) {
    await actualizar(supabase, ent.id as string, {
      estado: 'error', error: lectura.error, finish_reason: lectura.finishReason, modelo: GEMINI_MODEL,
    });
    return;
  }
  const salida = validarSalida(lectura.json, campos, texto);
  await actualizar(supabase, ent.id as string, {
    linea_id: neg.linea_id ?? null, historia: salida.historia, sugeridos: salida.sugeridos, descartados: salida.descartados,
    cliente: salida.cliente, modelo: GEMINI_MODEL, finish_reason: lectura.finishReason, error: null,
  });

  // Cada bloque con lo suyo. Un slug repetido en dos bloques se queda con el primero.
  const meta = { entrega_id: ent.entrega_id as string, en: new Date().toISOString(), origenDe: (f: string) => origenDeFrase(f, mensajes) };
  const vistos = new Set<string>();
  const escritos: Array<{ slug: string; valor: unknown }> = [];
  const conflictos: Conflicto[] = [];
  const despues: Array<{ fields: unknown; data: unknown }> = [];
  for (const b of bloques) {
    const vistosAntes = new Set(vistos);
    for (const f of b.fields) vistos.add(f.slug);
    let r = cargarEnExistente(b.data, b.fields, salida.sugeridos, meta, new Set(vistosAntes));
    const quedo = await escribirBloque(supabase, b, d => {
      r = cargarEnExistente(d, b.fields, salida.sugeridos, meta, new Set(vistosAntes));
      return r.escritos.length > 0 || r.conflictos.length > 0 ? r.data : null;
    });
    if (quedo) {
      escritos.push(...r.escritos.map(s => ({ slug: s, valor: r.data[s] })));
      conflictos.push(...r.conflictos);
    }
    despues.push({ fields: b.fields, data: quedo ?? b.data });
  }

  const h = huecos(campos, aplicarSumas(campos, aplanarBloques(despues).valores));

  // La traza y la historia se AGREGAN a la actividad del negocio: nada se reemplaza.
  let quien = '';
  if (ent.remitente_staff_id) {
    const { data: st } = await supabase.from('staff').select('full_name').eq('id', ent.remitente_staff_id).maybeSingle();
    quien = primerNombre((st?.full_name as string | null) ?? null);
  }
  const { error: eA } = await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio_sistema',
    autor_id: (ent.remitente_staff_id as string | null) ?? null,
    contenido: trazaCarga({
      quien, fechaISO: todayBogotaISO(), escritos: escritos.map(e => e.slug), conflictos, fields: campos, historia: salida.historia,
    }),
  });
  if (eA) console.error(`[wa-entendimiento] negocio ${negocioId} sin traza en la actividad:`, eA.message);

  const wsSlug = (relUno((neg as Fila).workspaces)?.slug as string | undefined) ?? '';
  const msg = mensajeCargaExistente({
    codigo: (neg.codigo as string | null) ?? null, fields: campos, escritos, conflictos,
    faltanMinimo: h.minimo.faltan, enlace: enlaceNegocio(wsSlug, negocioId), maxPreguntas: MAX_PREGUNTAS,
  });
  const ok = await enviar(ent.remitente_phone as string, msg, workspaceId);
  await actualizar(supabase, ent.id as string, {
    estado: 'negocio_actualizado', negocio_id: negocioId, destino: 'existente', negocio_destino_id: negocioId,
    contacto_id: (neg.contacto_id as string | null) ?? null, huecos: h,
    cargados: escritos.map(e => e.slug), conflictos,
    respuesta_enviada_at: ok ? new Date().toISOString() : null, error: ok ? null : 'envio fallido',
  });
}

/** El comercial contestó «¿cuál contacto?». */
async function resolverRespuesta(supabase: SupabaseClient, ent: Fila): Promise<void> {
  const workspaceId = ent.workspace_id as string;
  const opciones = (ent.contacto_opciones ?? []) as ContactoCandidato[];
  const r = interpretarRespuestaContacto(String(ent.respuesta_contacto ?? ''), opciones);
  const salida = salidaGuardada(ent);

  if (r.tipo === 'no_entendida') {
    await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: opciones.length > 1 ? 'varios' : 'ninguno', opciones, nombre: (ent.contacto_nombre as string) ?? '' });
    return;
  }

  const cfg = await configDeLinea(supabase, workspaceId);
  if (typeof cfg === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: cfg });
    return;
  }

  if (r.tipo === 'elegido') {
    await cerrarConNegocio(supabase, ent, cfg, r.contacto_id, salida);
    return;
  }

  if (r.tipo === 'telefono') {
    // Con el celular se vuelve a decidir: puede aparecer uno exacto, o se pregunta otra vez.
    const candidatos = await candidatosDeContacto(supabase, workspaceId, r.telefono, salida.cliente);
    const d = decidirContacto({ clienteTexto: `${ent.contacto_nombre ?? ''} ${r.telefono}`, extraido: salida.cliente, candidatos });
    if (d.tipo === 'unico') await cerrarConNegocio(supabase, ent, cfg, d.contacto.id, salida);
    else await crearContactoYNegocio(supabase, ent, cfg, salida, r.telefono);
    return;
  }

  await crearContactoYNegocio(supabase, ent, cfg, salida, salida.cliente.telefono);
}

/** NUEVO: el comercial pidió crearlo. Nombre en mayúsculas, como el resto del directorio. */
async function crearContactoYNegocio(
  supabase: SupabaseClient, ent: Fila, cfg: ConfigLinea, salida: SalidaEntendida, telefono: string | null,
): Promise<void> {
  const nombre = String(ent.contacto_nombre || salida.cliente.nombre || '').trim();
  if (!nombre) {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: 'no hay nombre para crear el contacto' });
    return;
  }
  const { data, error } = await supabase.from('contactos')
    .insert({ workspace_id: ent.workspace_id, nombre: nombre.toUpperCase(), telefono: telefono || null })
    .select('id').single();
  if (error || !data) {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: `no se pudo crear el contacto: ${error?.message ?? ''}` });
    return;
  }
  await cerrarConNegocio(supabase, ent, cfg, data.id as string, salida);
}

// ── El cron ──────────────────────────────────────────────────────────────────

async function workspacesActivos(supabase: SupabaseClient, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from('workspaces').select('id, modules').in('id', ids);
  return new Set(((data ?? []) as Fila[]).filter(w => bandejaActiva(w.modules as Fila)).map(w => w.id as string));
}

/**
 * Lo que corre el cron cada minuto (acción `bandeja_entendimiento` de `wa-alerts`):
 *   1. entregas `con_cliente` sin entendimiento → se reclaman y se entienden;
 *   2. entendimientos en error con intentos disponibles → se reintentan;
 *   3. respuestas a «¿cuál contacto?» → se resuelven.
 */
export async function procesarEntendimientos(supabase: SupabaseClient): Promise<{ entendidas: number; respuestas: number }> {
  let entendidas = 0;
  let respuestas = 0;

  // 1. Nuevas. El reclamo es el INSERT (entrega_id es único): dos corridas no toman la misma.
  const { data: entregas } = await supabase.from('wa_bandeja_entregas')
    .select('id, workspace_id, remitente_phone, remitente_staff_id')
    .eq('estado', 'con_cliente').order('cliente_respondido_at', { ascending: true }).limit(50);
  const lista = (entregas ?? []) as Fila[];
  if (lista.length > 0) {
    const { data: ya } = await supabase.from('wa_bandeja_entendimientos').select('entrega_id').in('entrega_id', lista.map(e => e.id));
    const tomadas = new Set(((ya ?? []) as Fila[]).map(e => e.entrega_id as string));
    const activos = await workspacesActivos(supabase, [...new Set(lista.map(e => e.workspace_id as string))]);
    for (const e of lista.filter(x => !tomadas.has(x.id as string) && activos.has(x.workspace_id as string)).slice(0, LOTE)) {
      const { data: fila } = await supabase.from('wa_bandeja_entendimientos').upsert({
        workspace_id: e.workspace_id, entrega_id: e.id, remitente_phone: e.remitente_phone,
        remitente_staff_id: e.remitente_staff_id, estado: 'procesando', intentos: 1,
      }, { onConflict: 'entrega_id', ignoreDuplicates: true }).select('*').maybeSingle();
      if (!fila) continue;
      await entender(supabase, fila);
      entendidas++;
    }
  }

  // 2. Reintentos del modelo.
  const { data: fallidas } = await supabase.from('wa_bandeja_entendimientos').select('*')
    .eq('estado', 'error').lt('intentos', MAX_INTENTOS).is('negocio_id', null).is('contacto_id', null).limit(LOTE);
  const activosF = await workspacesActivos(supabase, [...new Set(((fallidas ?? []) as Fila[]).map(e => e.workspace_id as string))]);
  for (const f of ((fallidas ?? []) as Fila[]).filter(x => activosF.has(x.workspace_id as string))) {
    const { data: fila } = await supabase.from('wa_bandeja_entendimientos')
      .update({ estado: 'procesando', intentos: (f.intentos as number) + 1, updated_at: new Date().toISOString() })
      .eq('id', f.id).eq('estado', 'error').select('*').maybeSingle();
    if (!fila) continue;
    await entender(supabase, fila);
    entendidas++;
  }

  // 3. Respuestas a «¿cuál contacto?».
  const { data: conRespuesta } = await supabase.from('wa_bandeja_entendimientos').select('*')
    .eq('estado', 'esperando_contacto').not('respuesta_contacto', 'is', null).limit(LOTE);
  const activosR = await workspacesActivos(supabase, [...new Set(((conRespuesta ?? []) as Fila[]).map(e => e.workspace_id as string))]);
  for (const r of ((conRespuesta ?? []) as Fila[]).filter(x => activosR.has(x.workspace_id as string))) {
    const { data: fila } = await supabase.from('wa_bandeja_entendimientos')
      .update({ estado: 'procesando', updated_at: new Date().toISOString() })
      .eq('id', r.id).eq('estado', 'esperando_contacto').select('*').maybeSingle();
    if (!fila) continue;
    await resolverRespuesta(supabase, fila);
    respuestas++;
  }

  // 4. Respuestas a la re-pregunta «¿A qué viaje van?»: se vuelve a entender con la respuesta.
  const { data: conViaje } = await supabase.from('wa_bandeja_entendimientos').select('*')
    .eq('estado', 'esperando_negocio').not('respuesta_negocio', 'is', null).limit(LOTE);
  const activosV = await workspacesActivos(supabase, [...new Set(((conViaje ?? []) as Fila[]).map(e => e.workspace_id as string))]);
  for (const r of ((conViaje ?? []) as Fila[]).filter(x => activosV.has(x.workspace_id as string))) {
    const { data: fila } = await supabase.from('wa_bandeja_entendimientos')
      .update({ estado: 'procesando', updated_at: new Date().toISOString() })
      .eq('id', r.id).eq('estado', 'esperando_negocio').select('*').maybeSingle();
    if (!fila) continue;
    await entender(supabase, fila);
    respuestas++;
  }

  return { entendidas, respuestas };
}

/** Las dos preguntas que el paso de entendimiento puede dejar abiertas, con sus columnas. */
const PENDIENTES = [
  { estado: 'esperando_negocio', pregunta: 'pregunta_negocio_at', respuesta: 'respuesta_negocio', en: 'respuesta_negocio_at', papel: 'respuesta_negocio' },
  { estado: 'esperando_contacto', pregunta: 'pregunta_contacto_at', respuesta: 'respuesta_contacto', en: 'respuesta_at', papel: 'respuesta_contacto' },
] as const;

/**
 * ¿Este texto del comercial es la respuesta a una pregunta del paso de entendimiento («¿A qué
 * viaje van?» repetida, o «¿cuál contacto?»)? Lo llama la bandeja ANTES de registrar el
 * mensaje como contenido: sin esto, la respuesta abriría una entrega nueva. Solo cuenta un
 * texto escrito (no reenviado), sin entrega abierta del mismo remitente y dentro de las 24
 * horas de la pregunta. Devuelve `true` si lo tomó.
 */
export async function tomarRespuestaContacto(
  supabase: SupabaseClient,
  p: { workspaceId: string; phone: string; texto: string; wamid: string; enviadoAt: string | null },
): Promise<boolean> {
  const desde = new Date(Date.now() - HORAS_RESPUESTA_CONTACTO * 3600_000).toISOString();
  let pend: Fila | null = null;
  let cual: (typeof PENDIENTES)[number] | null = null;
  for (const k of PENDIENTES) {
    const { data } = await supabase.from('wa_bandeja_entendimientos')
      .select('id, entrega_id, remitente_staff_id')
      .eq('workspace_id', p.workspaceId).eq('remitente_phone', p.phone).eq('estado', k.estado)
      .is(k.respuesta, null).gte(k.pregunta, desde)
      .order(k.pregunta, { ascending: false }).limit(1).maybeSingle();
    if (data) {
      pend = data as Fila;
      cual = k;
      break;
    }
  }
  if (!pend || !cual) return false;

  const { data: abierta } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', p.workspaceId).eq('remitente_phone', p.phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (abierta) return false;

  // El crudo se guarda igual que todo lo demás de la bandeja, con su papel.
  const { error: eIns } = await supabase.from('wa_bandeja_mensajes').insert({
    workspace_id: p.workspaceId, entrega_id: pend.entrega_id, wa_message_id: p.wamid,
    remitente_phone: p.phone, remitente_staff_id: pend.remitente_staff_id ?? null,
    tipo: 'text', papel: cual.papel, cuerpo: p.texto, cuerpo_origen: 'texto', enviado_at: p.enviadoAt,
  });
  if (eIns && !String(eIns.message).includes('duplicate')) {
    console.error('[wa-entendimiento] no se pudo guardar la respuesta:', eIns.message);
  }
  if (eIns && String(eIns.message).includes('duplicate')) return true; // Meta reintentó: ya se tomó.

  await actualizar(supabase, pend.id as string, { [cual.respuesta]: p.texto, [cual.en]: new Date().toISOString() });
  return true;
}
