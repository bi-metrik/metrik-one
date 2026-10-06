// ============================================================
// Paso de entendimiento de la bandeja de WhatsApp — la ejecución
// ------------------------------------------------------------
// Las decisiones viven en `wa-entendimiento-reglas.ts`, `wa-guardianes.ts`, `wa-carga-reglas.ts`
// y `wa-viajes-reglas.ts` (puros, probados) y en las migraciones de la bandeja. Aquí se lee, se
// llama al modelo, se escribe y se contesta.
//
// Regla de este módulo: el crudo NO se toca. Lo que sale del modelo va a
// `wa_bandeja_entendimientos`; si el modelo falla, la entrega y sus mensajes siguen intactos y
// el paso se reintenta (hasta `MAX_INTENTOS`).
//
// Varios viajes (2026-10-01): con `modo_viajes = encabezado` y encabezados en la tanda, la entrega
// se reparte por mensaje según el encabezado (`wa_bandeja_entregas.plan_viajes`), el comercial
// decide los sospechosos y confirma, y cada viaje corre el entendimiento y la carga por separado
// en su propia fila (`segmento` 1, 2…). Sin encabezados, la tanda es un viaje, como siempre.
//
// Nada corre si el workspace no tiene `modules.bandeja_solicitudes_wa`.
// ============================================================

import { sendTextMessage } from './wa-respond.ts';
import { anotarConsultaPendiente, anotarFoco, pedidosDeLaCarga, leerConversacion, viajeEnFoco } from './wa-foco.ts';
import { enviarConBotones } from './wa-enviar-botones.ts';
import { textoRedactado } from './wa-redaccion.ts';
import type { PedidoRedaccion } from './wa-redaccion.ts';
import {
  botonesSiNo, idBoton, TEXTO_BOTONES_APARTE, TEXTO_BOTONES_APARTE_SIN_CARGAR, TITULO_CARGAR, TITULO_DESCARTAR, TITULO_NO_ES, TITULO_SI_CARGARLOS,
  TITULO_SI_CREALO, TITULO_SI_ES,
} from './wa-botones-bandeja.ts';
import type { BotonBandeja } from './wa-botones-bandeja.ts';
import { bandejaActiva, elegirFallida, leerConfigBandeja, momentoDelMensaje, ordenarPorEnvio, textoFallaEntendimiento, textoReintentarSinElegir } from './wa-bandeja-reglas.ts';
import type { ConfigBandeja, ParteDescartada } from './wa-bandeja-reglas.ts';
import { todayBogotaISO } from './bogota.ts';
import { aplanarBloques } from './niveles-solicitud.ts';
import {
  aplicarSumas,
  conDeducciones,
  conMesEnLaPregunta,
  digitosTelefono,
  esquemaDeSalida,
  fusionarSugeridos,
  huecos,
  LO_LLENA_AGENCIA,
  instruccionesEntendimiento,
  interpretarRespuestaContacto,
  mayusculasDeViaje,
  mensajeAlComercial,
  nombreDeLaRespuesta,
  nombreDeViaje,
  nombreEsLugar,
  nombreViajeNuevo,
  nombrePropio,
  normalizarNombre,
  pistasDelTexto,
  resumenEntendido,
  MAX_PREGUNTAS,
  textoNombreNuevoEnDuda,
  textoPreguntaContacto,
} from './wa-entendimiento-reglas.ts';
import type { CampoEntendible, ClaseMensaje, ContactoCandidato, DecisionContacto, SalidaEntendida } from './wa-entendimiento-reglas.ts';
import {
  armarOpcionesNegocio,
  cargarEnExistente,
  codigoCompacto,
  detectarCruce,
  interpretarRespuestaNegocio,
  mensajeCargaExistente,
  lineaAvance,
  origenDeFrase,
  primerNombre,
  sugeridosConDeducciones,
  textoAvisoCruce,
  textoPreguntaNegocio,
  trazaCarga,
} from './wa-carga-reglas.ts';
import type { Actualizado, Conflicto, NegocioAbierto, OpcionNegocio } from './wa-carga-reglas.ts';
import { entenderEntrega, textoDosViajes, textoParaModelo, textoSinSolicitud } from './wa-guardianes.ts';
import type { MensajeEntrega } from './wa-guardianes.ts';
import {
  aplicarCambios,
  armarPlan,
  botonesDelResumen,
  esNombreNuevo,
  sinPresentacion,
  interpretarConfirmacionNuevo,
  resolverEncabezado,
  textoConfirmarNuevo,
  viajesParecidos,
  armarSegmentos,
  mensajesDelResumen,
  nombresDeLasCajas,
  pendienteDeLaCaja,
  esSi,
  gruposDelPlan,
  interpretarRespuestaPlan,
  planSinDudas,
  partesResumenPlan,
  tieneEncabezados,
  viajeDeLaCaja,
  TEXTO_COMO_CORREGIR,
} from './wa-viajes-reglas.ts';
import type { DestinoNuevo, DestinoPlan, MensajeViaje, PendienteDeLaCaja, PlanViajes, ViajeAbierto } from './wa-viajes-reglas.ts';
import {
  aplicarCambioCliente, clienteDeCaja, clienteDeLaCaja, lineasDeParecidos, clientesPorResolver, resolverClientesDelPlan, respuestaAlEncabezado, textoPreguntaEncabezado, TEXTO_PIDE_NOMBRE_NUEVO as TEXTO_PIDE_CLIENTE,
} from './wa-viajes-reglas.ts';
import type { Segmento } from './wa-viajes-reglas.ts';
import {
  completarLlave, crearContactoConGuardian, directorioDeLaTanda, directorioDelPlan, directorioPara, empresaEspejo, resolverClienteEnBase,
} from './wa-cliente.ts';
import {
  textoConsultaAmbigua, textoEstadoViaje, textoTanda, textoTandaEnResumen, textoViajesDelCliente, TEXTO_CONSULTA_DE_QUE_VIAJE, TEXTO_CONSULTA_DE_QUIEN, TEXTO_SIN_TANDA,
} from './wa-consulta-bandeja.ts';
import type { ConsultaBandeja } from './wa-consulta-bandeja.ts';
import { datoDeLaFicha, leerEsLaMisma, llavesDelTexto, nombreEnElDirectorio, pareceNombre, separarNombreYLlave, soloLlave, textoDelCliente, textoLlave, textoNoEsLaMisma, tieneLlave, unirLlaves } from './wa-cliente-reglas.ts';
import type { Directorio, FichaCliente, Llave, ResolucionCliente } from './wa-cliente-reglas.ts';
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
 * Llama al modelo con el esquema dado. Verifica el MOTIVO DE TERMINACIÓN, no solo que haya
 * texto: media respuesta aceptada en silencio es un falso verde (§3 del diseño).
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
  bandeja: ConfigBandeja;
}

/**
 * La línea de la solicitud: `config_extra.bandeja_solicitudes.linea_id` del workspace, o su
 * `linea_activa_id` (la misma que usa `crearNegocio` sin línea). La etapa es la primera por
 * `orden`: la «Solicitud».
 */
async function lineaDeLaBandeja(
  supabase: SupabaseClient, workspaceId: string,
): Promise<{ lineaId: string; slug: string; cfg: Fila; bandeja: ConfigBandeja } | string> {
  const { data: ws, error } = await supabase
    .from('workspaces').select('slug, linea_activa_id, config_extra').eq('id', workspaceId).maybeSingle();
  if (error || !ws) return `no se pudo leer el workspace: ${error?.message ?? 'no existe'}`;
  const cfg = (ws.config_extra?.bandeja_solicitudes ?? {}) as Fila;
  const lineaId = (typeof cfg.linea_id === 'string' && cfg.linea_id) || ws.linea_activa_id;
  if (!lineaId) return 'sin línea: declara config_extra.bandeja_solicitudes.linea_id';
  return { lineaId, slug: ws.slug as string, cfg, bandeja: leerConfigBandeja(ws.config_extra ?? null) };
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
    bandeja: l.bandeja,
  };
}

// ── Los mensajes de la entrega ───────────────────────────────────────────────

type MensajeCrudo = {
  id: string;
  cuerpo: string | null;
  cuerpo_origen: string | null;
  reenviado: boolean | null;
  tipo: string | null;
  recibido_at: string | null;
  enviado_at?: string | null;
  segmento: number | null;
  /** Lo que decidió el intérprete conversacional (nula con el interruptor apagado). Ver `armarSegmentos`. */
  interpretacion?: MensajeViaje['interpretacion'];
};

/**
 * Los mensajes de contenido de la entrega, en el orden en que el comercial los MANDÓ (la hora de
 * Meta, `ordenarPorEnvio`): un escrito registrado antes que su encabezado, por la carrera de los
 * webhooks, queda después de él (prueba en vivo del 2026-10-01, error 1). Su número (1, 2…) es su
 * posición.
 */
async function leerMensajes(supabase: SupabaseClient, entregaId: string): Promise<MensajeCrudo[] | string> {
  const { data, error } = await supabase.from('wa_bandeja_mensajes')
    .select('id, cuerpo, cuerpo_origen, reenviado, tipo, recibido_at, enviado_at, segmento, interpretacion')
    .eq('entrega_id', entregaId).eq('papel', 'contenido').order('recibido_at', { ascending: true });
  if (error) return `no se pudieron leer los mensajes: ${error.message}`;
  return ordenarPorEnvio((data ?? []) as MensajeCrudo[]);
}

function aEntrega(crudos: ReadonlyArray<MensajeCrudo>): MensajeEntrega[] {
  return crudos.map((m, i) => ({
    n: i + 1, cuerpo: String(m.cuerpo ?? ''), reenviado: m.reenviado === true, tipo: m.tipo ?? 'text', origen: m.cuerpo_origen,
  }));
}

function aViaje(crudos: ReadonlyArray<MensajeCrudo>): MensajeViaje[] {
  return crudos.map((m, i) => ({
    n: i + 1, cuerpo: String(m.cuerpo ?? ''), reenviado: m.reenviado === true, tipo: m.tipo ?? 'text',
    en: new Date(momentoDelMensaje(m)).toISOString(),
    // Solo si la hay: sin ella el mensaje es idéntico al de siempre.
    ...(m.interpretacion ? { interpretacion: m.interpretacion } : {}),
  }));
}

/** N3: deja anotado quién habla en cada mensaje (auditoría de dónde salió cada dato). */
async function guardarClases(
  supabase: SupabaseClient, crudos: ReadonlyArray<MensajeCrudo>, mensajes: ReadonlyArray<MensajeEntrega>, clases: Record<number, ClaseMensaje>,
): Promise<void> {
  const porClase = new Map<ClaseMensaje, string[]>();
  for (const m of mensajes) {
    const crudo = crudos[m.n - 1];
    const c = clases[m.n];
    if (!crudo || !c) continue;
    porClase.set(c, [...(porClase.get(c) ?? []), crudo.id]);
  }
  for (const [clase, ids] of porClase) {
    const { error } = await supabase.from('wa_bandeja_mensajes').update({ clase }).in('id', ids);
    if (error) console.error('[wa-entendimiento] no se pudo anotar la clase de los mensajes:', error.message);
  }
}

// ── Contacto ─────────────────────────────────────────────────────────────────

// ── Negocio ──────────────────────────────────────────────────────────────────

async function crearNegocio(
  supabase: SupabaseClient,
  p: {
    workspaceId: string; cfg: ConfigLinea; contactoId: string; entregaId: string;
    staffId: string | null; salida: SalidaEntendida; pistas: { mes: number | null; duracion: string | null };
  },
): Promise<{ negocioId: string; valores: Record<string, unknown> } | string> {
  const { data: contacto } = await supabase.from('contactos').select('nombre').eq('id', p.contactoId).maybeSingle();
  // El nombre con la convención de la agencia (destino y mes o duración: «CARTAGENA DIC 12-16»), o
  // uno provisional sin destino («Viaje de Laura Prueba»). La marca dice que lo puso el bot: si
  // alguien lo cambia a mano, el bot ya no lo toca (prueba en vivo del 2026-10-01, parte B).
  const sug = p.salida.sugeridos;
  const auto = nombreViajeNuevo({
    destino: sug.destino?.valor, salida: sug.fecha_salida?.valor, regreso: sug.fecha_regreso?.valor,
    mes: p.pistas.mes, duracion: p.pistas.duracion, cliente: (contacto?.nombre as string | null) ?? null,
  });
  const nombre = auto.nombre;
  // La empresa espejo de la persona natural, como la crea la app (el único negocio que creó el bot en Trappvel
  // era el único de los 12 sin `empresa_id`: diseño 2026-10-05, §1).
  const empresaId = await empresaEspejo(supabase, p.workspaceId, p.contactoId);

  const { data: neg, error } = await supabase.from('negocios').insert({
    workspace_id: p.workspaceId,
    nombre,
    metadata: { nombre_auto: nombre, nombre_provisional: auto.provisional, nombre_pistas: p.pistas },
    linea_id: p.cfg.lineaId,
    contacto_id: p.contactoId,
    ...(empresaId ? { empresa_id: empresaId } : {}),
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

  // La historia al timeline: son citas del cliente, no un resumen (N7).
  const { error: eA } = await supabase.from('activity_log').insert({
    workspace_id: p.workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio_sistema',
    autor_id: p.staffId,
    contenido: ['Solicitud entendida desde WhatsApp. Los datos llegan como sugeridos hasta que alguien los confirme.', p.salida.historia].filter(Boolean).join('\n\n'),
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
  /**
   * `llave`: la que dio el comercial o la de los mensajes, para completarla en el contacto sin pisar nada (§3.2
   * paso 5). `nota`: lo que el comercial tiene que saber del cliente («Va a Mauricio Moreno, cel. …9444, que ya
   * era cliente»).
   */
  extra: { llave?: Llave | null; nota?: string | null } = {},
): Promise<void> {
  const avisosLlave = await completarLlave(supabase, ent.workspace_id as string, contactoId, extra.llave ?? llaveDeLaSalida(salida));
  const pistas = await pistasDeLaEntrega(supabase, ent);
  const r = await crearNegocio(supabase, {
    workspaceId: ent.workspace_id as string, cfg, contactoId, entregaId: ent.entrega_id as string,
    staffId: (ent.remitente_staff_id as string | null) ?? null, salida, pistas,
  });
  if (typeof r === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: r, contacto_id: contactoId });
    return;
  }
  const h = huecos(cfg.fields, r.valores);
  const { data: creado } = await supabase.from('negocios').select('codigo, nombre, contactos(nombre)').eq('id', r.negocioId).maybeSingle();
  const msg = mensajeAlComercial({
    // El resumen con lo que el comercial dijo, no con la mayúscula del bloque.
    resumen: resumenEntendido(cfg.fields, { ...r.valores, ...Object.fromEntries(Object.entries(salida.sugeridos).map(([k, v]) => [k, v.valor])) }),
    faltanMinimo: conMesEnLaPregunta(h.minimo.faltan, vacioFecha(r.valores) ? pistas.mes : null),
    enlace: enlaceNegocio(cfg.slug, r.negocioId),
    descartados: salida.descartados.map(d => d.slug),
    preguntasAntes: preguntasDeGuardian(salida.descartados),
    avance: lineaAvance({
      codigo: (creado?.codigo as string | null) ?? null, cliente: nombreRel(creado?.contactos), nombre: (creado?.nombre as string | null) ?? null,
      fields: cfg.fields, valores: r.valores,
    }),
  });
  const ok = await enviar(ent.remitente_phone as string, await redactado(supabase, ent, { tipo: 'carga', fijo: [msg, extra.nota, ...avisosLlave].filter(Boolean).join('\n') }), ent.workspace_id as string);
  // El viaje que acaba de cargar queda en foco (con lo que pidió «me falta»): la respuesta a eso va directo a él.
  await anotarFoco(supabase, ent.workspace_id as string, ent.remitente_phone as string, { negocio_id: r.negocioId, por: 'carga', faltan: h.minimo.faltan.length, pedidos: pedidosDeLaCarga(h.minimo.faltan, cfg.fields) });
  await actualizar(supabase, ent.id as string, {
    estado: 'negocio_creado', contacto_id: contactoId, negocio_id: r.negocioId, huecos: h, confirmacion_pendiente: null,
    respuesta_enviada_at: ok ? new Date().toISOString() : null, error: ok ? null : 'envio fallido',
  });
}

/** ¿Falta la fecha de salida? Solo entonces la pregunta recuerda el mes que dijeron. */
function vacioFecha(valores: Record<string, unknown>): boolean {
  const v = valores.fecha_salida;
  return v === undefined || v === null || v === '';
}

/** El mes y la duración que dicen los mensajes de este viaje (los de su segmento, si es un reparto). */
async function pistasDeLaEntrega(supabase: SupabaseClient, ent: Fila): Promise<{ mes: number | null; duracion: string | null }> {
  const crudos = await leerMensajes(supabase, ent.entrega_id as string);
  if (typeof crudos === 'string') return { mes: null, duracion: null };
  const k = Number(ent.segmento ?? 0);
  const delViaje = k > 0 ? crudos.filter(m => m.segmento === k) : crudos;
  return pistasDelTexto(delViaje.map(m => String(m.cuerpo ?? '')).join('\n'));
}

/** Las preguntas en el acto que dejó un guardián (C9), sin repetir. */
function preguntasDeGuardian(descartados: SalidaEntendida['descartados']): string[] {
  return [...new Set(descartados.map(d => d.pregunta).filter((q): q is string => !!q))];
}

function salidaGuardada(ent: Fila): SalidaEntendida {
  return {
    historia: (ent.historia as string) ?? '',
    cliente: (ent.cliente as SalidaEntendida['cliente']) ?? { nombre: null, telefono: null },
    sugeridos: (ent.sugeridos as SalidaEntendida['sugeridos']) ?? {},
    descartados: (ent.descartados as SalidaEntendida['descartados']) ?? [],
  };
}

/** Las llaves que el modelo leyó tal cual de los mensajes (celular y correo). */
function llaveDeLaSalida(salida: SalidaEntendida): Llave | null {
  const l: Llave = {};
  const cel = digitosTelefono(salida.cliente.telefono);
  if (cel) l.celular = cel;
  if (salida.cliente.email) l.correo = salida.cliente.email;
  return tieneLlave(l) ? l : null;
}

async function preguntarContacto(supabase: SupabaseClient, ent: Fila, d: Extract<DecisionContacto, { tipo: 'preguntar' }>, texto?: string) {
  const nombre = d.nombre || await nombreDelViaje(supabase, ent);
  // «¿Es la misma persona?» (una sola ficha): con sus dos botones (2026-10-05). Contestan «sí» o «no», como escritos.
  const misma = (d.motivo === 'llave_de_otro' || d.motivo === 'mismo') && d.opciones.length === 1;
  const botones = misma ? botonesSiNo('p', ent.id as string, { si: TITULO_SI_ES, no: TITULO_NO_ES }) : [];
  const fijo = conNombreDelViaje(nombre, texto ?? textoPreguntaContacto(d));
  const ok = await enviarConBotones(ent.remitente_phone as string, await redactado(supabase, ent, { tipo: 'pregunta', fijo, botones: botones.map(b => b.title) }), botones, { workspaceId: ent.workspace_id as string, intent: INTENT });
  await actualizar(supabase, ent.id as string, {
    estado: 'esperando_contacto', contacto_opciones: d.opciones, contacto_nombre: d.nombre,
    pregunta_contacto_at: ok ? new Date().toISOString() : null, respuesta_contacto: null, error: ok ? null : 'envio fallido',
  });
}

/**
 * Le pregunta algo al comercial y espera su respuesta por la vía de «¿A qué viaje van?»
 * (`esperando_negocio` + `respuesta_negocio`). `confirmacion` dice qué se espera (N4, N5, N6).
 */
async function preguntarYEsperar(
  supabase: SupabaseClient, ent: Fila, texto: string, confirmacion: 'cruce' | 'sin_solicitud' | 'dos_viajes' | null, extra: Fila = {},
  opts: { sinNombre?: boolean; botones?: BotonBandeja[]; aparte?: string; resumen?: boolean; sinRedaccion?: boolean } = {},
): Promise<void> {
  const conNombre = opts.sinNombre ? texto : conNombreDelViaje(await nombreDelViaje(supabase, ent), texto);
  // Las confirmaciones de sí/no llevan sus botones (2026-10-05): «¿Seguro que van en …?», «¿Es una solicitud de viaje?».
  const botones = opts.botones ?? botonesDeLaConfirmacion(ent.id as string, confirmacion);
  // El modelo redacta el texto (con el interruptor prendido); los títulos de los botones quedan fijos.
  const final = opts.sinRedaccion ? conNombre
    : await redactado(supabase, ent, { tipo: opts.resumen ? 'resumen' : confirmacion ? 'confirmacion' : 'pregunta', fijo: conNombre, botones: botones.map(b => b.title) });
  const ok = await enviarConBotones(ent.remitente_phone as string, final, botones, { workspaceId: ent.workspace_id as string, intent: INTENT, aparte: opts.aparte });
  await actualizar(supabase, ent.id as string, {
    ...extra,
    estado: 'esperando_negocio', confirmacion_pendiente: confirmacion, respuesta_negocio: null, respuesta_negocio_at: null,
    pregunta_negocio_at: ok ? new Date().toISOString() : null, error: ok ? null : 'envio fallido',
  });
}

/** El texto que se envía: el que redacta el modelo si el interruptor está prendido y pasa la validación; si no, el fijo. */
function redactado(supabase: SupabaseClient, ent: Fila, p: PedidoRedaccion): Promise<string> {
  return textoRedactado(supabase, { workspaceId: ent.workspace_id as string, phone: ent.remitente_phone as string }, p);
}

/** Los botones de una confirmación del entendimiento: contestan lo mismo que su «sí» o su «descartar» escritos. */
function botonesDeLaConfirmacion(entId: string, c: 'cruce' | 'sin_solicitud' | 'dos_viajes' | null): BotonBandeja[] {
  if (c === 'cruce') return botonesSiNo('p', entId, { si: TITULO_SI_CARGARLOS, des: true });
  if (c === 'sin_solicitud') return botonesSiNo('p', entId, { si: TITULO_SI_CREALO, des: true });
  if (c === 'dos_viajes') return [{ id: idBoton('p', 'des', entId), title: TITULO_DESCARTAR }];
  return [];
}

/**
 * El modelo falló (prueba en vivo v2: un 403 de cobro de Gemini dejó dos entregas en error sin que
 * el comercial se enterara). Queda en error para el reintento del cron, y el bot avisa DOS veces como
 * mucho: al primer error («los reintento solo») y al agotar los intentos («escribe REINTENTAR …»).
 */
async function falloDelModelo(supabase: SupabaseClient, ent: Fila, lectura: Lectura): Promise<void> {
  await actualizar(supabase, ent.id as string, {
    estado: 'error', error: lectura.error, finish_reason: lectura.finishReason, modelo: GEMINI_MODEL,
  });
  const intento = Number(ent.intentos ?? 1);
  const aviso = intento >= MAX_INTENTOS ? 'agotado' : intento <= 1 ? 'primero' : null;
  if (!aviso) return;
  const { nombre, referencia } = await referenciaDelViaje(supabase, ent);
  await enviar(ent.remitente_phone as string, textoFallaEntendimiento(aviso, nombre, referencia), ent.workspace_id as string);
}

/** Cómo se nombra el viaje de un entendimiento en un aviso, y cómo se pide su reintento (código o nombre). */
async function referenciaDelViaje(supabase: SupabaseClient, ent: Fila): Promise<{ nombre: string; referencia: string }> {
  const nombre = await nombreDelViaje(supabase, ent);
  if (ent.negocio_destino_id) {
    const { data: n } = await supabase.from('negocios').select('codigo').eq('id', ent.negocio_destino_id).maybeSingle();
    if (n?.codigo) return { nombre, referencia: String(n.codigo) };
  }
  return { nombre, referencia: nombre };
}

/**
 * REINTENTAR <código o nombre>: vuelve a poner en la cola del cron un entendimiento que agotó sus
 * intentos. Sin objetivo y con una sola carga fallida, esa. Contesta siempre.
 */
export async function reintentarCarga(supabase: SupabaseClient, workspaceId: string, phone: string, objetivo: string): Promise<void> {
  const { data } = await supabase.from('wa_bandeja_entendimientos').select('*')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'error').limit(50);
  const agotadas = ((data ?? []) as Fila[]).filter(e => Number(e.intentos ?? 0) >= MAX_INTENTOS && e.error !== EN_COLA);
  const fallidas = await Promise.all(agotadas.map(async e => ({ fila: e, ...(await referenciaDelViaje(supabase, e)) })));
  const r = elegirFallida(objetivo, fallidas.map(f => ({ id: f.fila.id as string, referencias: [f.nombre, f.referencia] })));
  if (r.tipo !== 'una') {
    await enviar(phone, textoReintentarSinElegir(objetivo, fallidas.map(f => f.referencia)), workspaceId);
    return;
  }
  const f = fallidas.find(x => x.fila.id === r.id)!;
  await actualizar(supabase, r.id, { estado: 'error', intentos: 0, error: 'reintento pedido por el comercial' });
  await enviar(phone, `Reintento ${f.nombre}. Te aviso cuando quede cargado.`, workspaceId);
}

async function descartarEntrega(supabase: SupabaseClient, ent: Fila, nMensajes: number, motivo: string): Promise<void> {
  const ok = await enviar(ent.remitente_phone as string, `Listo: descarté ${nMensajes === 1 ? 'el mensaje' : `los ${nMensajes} mensajes`}. No creé ni cargué nada.`, ent.workspace_id as string);
  await actualizar(supabase, ent.id as string, {
    estado: 'descartada', confirmacion_pendiente: null, error: motivo, respuesta_enviada_at: ok ? new Date().toISOString() : null,
  });
}


// ── Una entrega ──────────────────────────────────────────────────────────────

async function entender(supabase: SupabaseClient, ent: Fila): Promise<void> {
  const workspaceId = ent.workspace_id as string;

  const { data: entrega } = await supabase.from('wa_bandeja_entregas')
    .select('cliente_texto, negocio_opciones, plan_viajes').eq('id', ent.entrega_id).maybeSingle();
  const crudos = await leerMensajes(supabase, ent.entrega_id as string);
  if (typeof crudos === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: crudos });
    return;
  }

  // Un viaje de un reparto ya confirmado: solo sus mensajes, contra su destino.
  const segmento = Number(ent.segmento ?? 0);
  if (segmento > 0) {
    await entenderSegmento(supabase, ent, entrega as Fila | null, crudos, segmento);
    return;
  }

  const todos = aEntrega(crudos);
  if (!todos.some(m => m.cuerpo.trim())) {
    await actualizar(supabase, ent.id as string, { estado: 'descartada', error: 'la entrega no tiene texto (solo media sin pie)' });
    return;
  }

  // Modo encabezado con encabezados en la tanda: el reparto se confirma primero.
  if (entrega?.plan_viajes) {
    await resolverPlan(supabase, ent, entrega.plan_viajes as PlanViajes, crudos);
    return;
  }

  const respuesta = String(ent.respuesta_negocio ?? entrega?.cliente_texto ?? '');
  const pendiente = (ent.confirmacion_pendiente as string | null) ?? null;
  if (pendiente) {
    const hecho = await atenderConfirmacion(supabase, ent, pendiente, respuesta, crudos);
    if (hecho) return;
  }

  // ¿A qué viaje va? Con la pregunta vieja (`negocio_opciones` nula) la respuesta es el
  // cliente y el camino es el de siempre: negocio nuevo.
  const opciones = Array.isArray(entrega?.negocio_opciones) ? (entrega!.negocio_opciones as OpcionNegocio[]) : null;

  // «¿Creo el cliente nuevo «X»?» espera su «sí» (2026-10-03): la respuesta es para esa pregunta.
  const porConfirmar = nuevoPorConfirmar(ent, null);
  if (porConfirmar) {
    await atenderConfirmacionNuevo(supabase, ent, porConfirmar, respuesta, crudos, opciones, { revisarDosViajes: true });
    return;
  }
  let clienteTexto: string | null = entrega?.cliente_texto ?? null;
  if (opciones) {
    let r = interpretarRespuestaNegocio(respuesta, opciones);
    if (r.tipo === 'descartar') {
      await descartarEntrega(supabase, ent, crudos.length, 'el comercial descartó la tanda en «¿A qué viaje van?»');
      return;
    }
    if (r.tipo === 'no_entendida') {
      // El nombre de un viaje abierto que no está en la lista corta («Europa 2 días», «Marta Gómez»).
      const v = await viajePorNombre(supabase, workspaceId, respuesta);
      if (v) r = { tipo: 'existente', negocio_id: v };
    }
    if (r.tipo === 'no_entendida') {
      await volverAPreguntarNegocio(supabase, ent, opciones, `No entendí «${respuesta.slice(0, 40)}».`);
      return;
    }
    // «nueva reserva»: lo que sigue a NUEVO no parece un nombre. Se pregunta; nunca se crea (control de Vera, NU5).
    if (r.tipo === 'nuevo_en_duda') {
      await volverAPreguntarNegocio(supabase, ent, opciones, textoNombreNuevoEnDuda(r.propuesto));
      return;
    }
    // «nuevo X»: ningún cliente se crea sin un «sí» a un texto que muestra su nombre tal cual (2026-10-03).
    // Mientras tanto no se carga nada en ningún viaje.
    if (r.tipo === 'nuevo' && r.cliente) {
      await pedirConfirmacionNuevo(supabase, ent, r.cliente, opciones);
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
      await actualizar(supabase, ent.id as string, { destino: 'existente', negocio_destino_id: negocioId, confirmacion_pendiente: null });
      await cargarEnNegocioExistente(supabase, ent, negocioId, crudos, opciones);
      return;
    }
    // NUEVO a secas: el nombre sale de los mensajes y se pregunta el contacto (que lo muestra antes de crearlo).
    clienteTexto = null;
    await actualizar(supabase, ent.id as string, { destino: 'nuevo', confirmacion_pendiente: null, contacto_nombre: null });
    await entenderNuevo(supabase, ent, crudos, clienteTexto, { revisarDosViajes: true });
    return;
  }

  await entenderNuevo(supabase, ent, crudos, clienteTexto, { revisarDosViajes: true });
}

/**
 * La respuesta a una confirmación pendiente (N4, N5, N6). Devuelve `true` si la atendió; `false`
 * si la respuesta hay que leerla como la de «¿A qué viaje van?» (otro número o código).
 */
async function atenderConfirmacion(
  supabase: SupabaseClient, ent: Fila, pendiente: string, respuesta: string, crudos: ReadonlyArray<MensajeCrudo>,
): Promise<boolean> {
  const t = respuesta.trim().toLowerCase();
  const descartar = /^descart/.test(t);
  if (pendiente === 'cruce') {
    if (esSi(respuesta) && ent.negocio_destino_id) {
      await actualizar(supabase, ent.id as string, { confirmacion_pendiente: null });
      await cargarEnNegocioExistente(supabase, ent, ent.negocio_destino_id as string, crudos, [], { previa: salidaGuardada(ent), forzar: true });
      return true;
    }
    if (descartar) {
      await descartarEntrega(supabase, ent, crudos.length, 'el comercial descartó tras el aviso de viaje equivocado');
      return true;
    }
    await actualizar(supabase, ent.id as string, { confirmacion_pendiente: null });
    return false;
  }
  if (pendiente === 'sin_solicitud') {
    if (descartar) {
      await descartarEntrega(supabase, ent, crudos.length, 'sin solicitud de viaje (N4)');
    } else if (esSi(respuesta)) {
      await entenderNuevo(supabase, ent, crudos, (ent.contacto_nombre as string | null) ?? null, { previa: salidaGuardada(ent) });
    } else {
      await preguntarYEsperar(supabase, ent, textoSinSolicitud(crudos.length), 'sin_solicitud');
    }
    return true;
  }
  if (pendiente === 'dos_viajes') {
    // No se separa sola: el comercial descarta y vuelve a reenviar con un encabezado por cliente.
    if (descartar) {
      await descartarEntrega(supabase, ent, crudos.length, 'dos solicitudes en una tanda; el comercial descartó para reenviar con encabezados (N5)');
    } else {
      await preguntarYEsperar(supabase, ent, '¿Me las reenvías por separado? No mezclo dos solicitudes: responde «descartar» y reenvía cada una después de su encabezado.', 'dos_viajes');
    }
    return true;
  }
  return false;
}

/** Negocio nuevo: modelo, guardianes, N5, N4 y contacto. `previa`: salida ya entendida (se confirma). */
async function entenderNuevo(
  supabase: SupabaseClient, ent: Fila, crudos: ReadonlyArray<MensajeCrudo>, clienteTexto: string | null,
  opts: {
    previa?: SalidaEntendida; revisarDosViajes?: boolean;
    /**
     * El comercial escribió NUEVO y el nombre («nuevo Laura Prueba»): esa ya es la decisión. Si el
     * nombre no está en el directorio, se crea y se carga sin volver a preguntar; solo se pregunta
     * si ya hay un contacto con ese nombre (¿es el mismo?) o si se parece a uno o más.
     */
    nuevoExplicito?: boolean;
    /**
     * El viaje nuevo del resumen que el comercial confirmó con su «sí» (diseño 2026-10-05): el contacto que ya
     * existía (mostrado con su dato) o la llave del cliente nuevo (mostrada). Sin él, el cliente se resuelve aquí.
     */
    destino?: DestinoNuevo | null;
  } = {},
): Promise<void> {
  const workspaceId = ent.workspace_id as string;
  const cfg = await configDeLinea(supabase, workspaceId);
  if (typeof cfg === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: cfg });
    return;
  }

  let salida: SalidaEntendida;
  if (opts.previa) {
    salida = opts.previa;
  } else {
    const mensajes = aEntrega(crudos);
    const lectura = await leerConModelo(
      instruccionesEntendimiento(cfg.fields, todayBogotaISO()),
      `${clienteTexto ? `El comercial dice que el cliente es: ${clienteTexto}\n\n` : ''}Mensajes:\n${textoParaModelo(mensajes)}`,
      esquemaDeSalida(cfg.fields),
    );
    if (lectura.error || lectura.json === null) {
      await falloDelModelo(supabase, ent, lectura);
      return;
    }
    const e = entenderEntrega(lectura.json, cfg.fields, mensajes, { hoyISO: todayBogotaISO() });
    await guardarClases(supabase, crudos, mensajes, e.clases);
    // Lo que se deduce sin el modelo (infantes = 0 con las edades de todos los niños) entra como
    // un sugerido más, con la deducción en vez de la frase.
    salida = { ...e.salida, sugeridos: conDeducciones(cfg.fields, e.salida.sugeridos) };
    // La llave que dio el comercial antes (la confirmación, la pregunta del cliente) no se pierde al releer.
    const llaveGuardada = ((ent.cliente ?? null) as { llave?: Llave | null } | null)?.llave ?? null;
    if (tieneLlave(llaveGuardada)) salida = { ...salida, cliente: { ...salida.cliente, llave: llaveGuardada } as SalidaEntendida['cliente'] };
    const valores = aplicarSumas(cfg.fields, Object.fromEntries(Object.entries(salida.sugeridos).map(([k, v]) => [k, v.valor])));
    await actualizar(supabase, ent.id as string, {
      linea_id: cfg.lineaId, historia: salida.historia, sugeridos: salida.sugeridos, descartados: salida.descartados,
      cliente: salida.cliente, huecos: huecos(cfg.fields, valores), modelo: GEMINI_MODEL, finish_reason: lectura.finishReason, error: null,
      contacto_nombre: clienteTexto,
    });
    // N5: dos viajes en una tanda no se mezclan.
    if (opts.revisarDosViajes && e.solicitudes.length >= 2) {
      await preguntarYEsperar(supabase, ent, textoDosViajes(e.solicitudes), 'dos_viajes');
      return;
    }
    // N4: sin solicitud no se crea nada.
    if (!e.haySolicitud) {
      await preguntarYEsperar(supabase, ent, textoSinSolicitud(mensajes.length), 'sin_solicitud');
      return;
    }
  }

  // Un «cliente» que es un lugar (el destino entendido o el de un viaje abierto) no es un nombre:
  // sin nombre, el bot lo pide (N9). D2m: «NUEVO Punta Cana».
  const lugares = [salida.sugeridos.destino?.valor, ...((await viajesAbiertosDeLaBandeja(supabase, workspaceId)) ?? []).map(v => v.destino)];
  if (nombreEsLugar(clienteTexto, lugares)) clienteTexto = null;
  if (nombreEsLugar(salida.cliente.nombre, lugares)) salida = { ...salida, cliente: { ...salida.cliente, nombre: null } };

  // ¿Quién es el cliente? (diseño 2026-10-05, §3.2): el contacto del resumen confirmado gana; si no, la llave
  // (la del comercial, o la que el modelo leyó tal cual) y el nombre, contra TODO el directorio.
  const d = opts.destino ?? null;
  const llave = unirLlaves(d?.llave, unirLlaves(llavesDelTexto(clienteTexto), llaveDe(salida)));
  if (d?.contacto) {
    await cerrarConNegocio(supabase, ent, cfg, d.contacto.id, salida, { llave });
    return;
  }
  const nombre = nombreDeLaRespuesta(sinLlaves(clienteTexto)) || salida.cliente.nombre || '';
  await decidirCliente(supabase, ent, cfg, salida, {
    nombre, llave, confirmado: !!opts.nuevoExplicito, descartadas: d?.descartadas, otraPersona: d?.otraPersona,
  });
}

/** El texto sin las llaves («Ana Gómez 300 555 1234» → «Ana Gómez»). */
function sinLlaves(t: string | null | undefined): string {
  return String(t ?? '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, ' ').replace(/@[A-Za-z0-9._]{3,30}/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Las llaves del cliente de un entendimiento: las del comercial (`cliente.llave`) y las que leyó el modelo. */
function llaveDe(salida: SalidaEntendida): Llave | null {
  const dadas = (salida.cliente as { llave?: Llave | null }).llave ?? null;
  return unirLlaves(dadas, llaveDeLaSalida(salida));
}

/** Lo que el entendimiento recuerda de la pregunta del cliente (en `cliente`, jsonb): qué preguntó y lo descartado. */
interface EstadoPregunta {
  llave?: Llave | null;
  pregunta?: 'crear' | 'llave' | 'llave_de_otro' | 'elegir' | null;
  descartadas?: string[];
  otraPersona?: boolean;
}

/**
 * Decide el cliente de un viaje nuevo y lo cierra, o pregunta lo que falta (UNA cosa). Nunca crea un contacto sin
 * llave, ni con una llave que ya es de otro, ni si la búsqueda falla (`crearContactoConGuardian`). `confirmado`:
 * el comercial ya dijo «sí» a un texto con este nombre (el resumen, «¿Creo el cliente nuevo …?», NUEVO).
 */
async function decidirCliente(
  supabase: SupabaseClient, ent: Fila, cfg: ConfigLinea, salida: SalidaEntendida,
  p: { nombre: string; llave: Llave | null; confirmado: boolean; descartadas?: string[]; otraPersona?: boolean },
): Promise<void> {
  const r = await resolverClienteEnBase(supabase, ent.workspace_id as string, {
    nombre: p.nombre, llave: p.llave, descartadas: p.descartadas, otraPersona: p.otraPersona,
  });
  const estado: EstadoPregunta = { llave: p.llave, descartadas: p.descartadas ?? [], otraPersona: !!p.otraPersona };
  if (r.tipo === 'existente') {
    // Decisión 2: un nombre idéntico a UN contacto se usa, y se dice con su dato.
    const nota = r.por === 'llave' ? null : `Lo dejé a nombre de ${nombrePropio(r.ficha.nombre)} (${datoDeLaFicha(r.ficha)}), que ya era cliente.`;
    await cerrarConNegocio(supabase, ent, cfg, r.ficha.id, salida, { llave: p.llave, nota });
    return;
  }
  if (r.tipo === 'nuevo' && p.confirmado) {
    await crearContactoYNegocio(supabase, ent, cfg, salida, p.nombre, p.llave, estado);
    return;
  }
  await preguntarPorElCliente(supabase, ent, salida, r, p.nombre, estado);
}

/** La pregunta del cliente que falta, con su estado guardado para leer la respuesta (`resolverRespuesta`). */
async function preguntarPorElCliente(
  supabase: SupabaseClient, ent: Fila, salida: SalidaEntendida, r: ResolucionCliente, nombre: string, estado: EstadoPregunta,
): Promise<void> {
  if (r.tipo === 'error') {
    // «Error al comprobar ≠ permiso para crear»: queda en error y el cron lo reintenta.
    await actualizar(supabase, ent.id as string, { estado: 'error', error: 'no se pudo revisar el directorio de clientes: no se crea nada' });
    return;
  }
  const comoCandidato = (f: FichaCliente): ContactoCandidato => ({ id: f.id, nombre: f.nombre, telefono: null, cel4: f.cel4 });
  const guardar = async (pregunta: EstadoPregunta['pregunta']) => {
    await actualizar(supabase, ent.id as string, { cliente: { ...salida.cliente, ...estado, pregunta } });
  };
  if (r.tipo === 'nuevo') {
    await guardar('crear');
    await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: 'ninguno', opciones: [], nombre }, `No tengo a ${nombre} en el directorio. ¿Lo creo como cliente nuevo, con ${textoLlave(r.llave)}?`);
    return;
  }
  if (r.tipo === 'pedir_llave') {
    await guardar('llave');
    await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: 'llave', opciones: [], nombre });
    return;
  }
  if (r.tipo === 'llave_de_otro') {
    await guardar('llave_de_otro');
    await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: 'llave_de_otro', opciones: [comoCandidato(r.ficha)], nombre });
    return;
  }
  if (r.tipo === 'elegir') {
    await guardar('elegir');
    await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: r.motivo === 'homonimos' || r.motivo === 'llave_compartida' ? 'varios' : 'ninguno', opciones: r.opciones.map(comoCandidato), nombre });
    return;
  }
  // Sin nombre (y sin nadie con la llave): se pide el nombre.
  await guardar(null);
  await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: 'ninguno', opciones: [], nombre: '' });
}

// ── Cliente nuevo: nada se crea sin un «sí» ─────────────────────────────────

/**
 * ¿La fila espera el «sí» a «¿Creo el cliente nuevo «X»?»? Devuelve X o `null`. Sin migración: la marca es
 * `destino = 'nuevo'` con `contacto_nombre` (el nombre propuesto), puestos por `pedirConfirmacionNuevo`.
 *   · Sin reparto (`destinoDelPlan` nulo): solo ahí se escribe `destino = 'nuevo'` con un nombre, antes
 *     de correr el modelo. Después del «sí» la marca sigue, y un reintento del cron vuelve a leer el «sí».
 *   · Un viaje del reparto: su destino viene del resumen ya confirmado. Solo espera si el resumen lo
 *     mandaba a un viaje EXISTENTE y el comercial pidió un cliente nuevo después (el aviso de cruce).
 */
export function nuevoPorConfirmar(ent: Fila, destinoDelPlan: 'nuevo' | 'existente' | null): string | null {
  const nombre = String(ent.contacto_nombre ?? '').trim();
  if (ent.destino !== 'nuevo' || !nombre || ent.negocio_id || ent.contacto_id) return null;
  if (destinoDelPlan === 'nuevo') return null;
  return nombre;
}

/**
 * «¿Creo el cliente nuevo «X»?» (2026-10-03). Se pregunta ANTES de leer los mensajes con el modelo: nada
 * se carga en ningún viaje ni se crea hasta el «sí». Si X se parece al cliente de un viaje abierto, la
 * pregunta lo dice con su número en la lista (o su código).
 */
async function pedirConfirmacionNuevo(
  supabase: SupabaseClient, ent: Fila, nombreDado: string, opciones: OpcionNegocio[] | null, aviso: string | null = null,
): Promise<void> {
  // «nuevo Ana Gómez 300 555 1234»: el nombre sin la llave, y la llave se guarda (es del comercial).
  const separado = separarNombreYLlave(nombreDado);
  const nombre = separado.nombre || nombreDado;
  const guardada = salidaGuardada(ent);
  const clienteConLlave = separado.llave ? { ...guardada.cliente, llave: unirLlaves(separado.llave, (guardada.cliente as { llave?: Llave | null }).llave) } : null;
  if (clienteConLlave) ent = { ...ent, cliente: clienteConLlave };
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, ent.workspace_id as string)) ?? [];
  const parecidos = viajesParecidos(nombre, viajes).map(v => {
    const i = (opciones ?? []).findIndex(o => o.id === v.id);
    return { viaje: v, numero: i >= 0 ? i + 1 : null };
  });
  // Quién es, contra todo el directorio (diseño 2026-10-05): el «sí» confirma lo que se muestra.
  const llave = llaveDe(salidaGuardada(ent));
  const r = await resolverClienteEnBase(supabase, ent.workspace_id as string, { nombre, llave });
  const texto = textoConfirmarNuevo({ nombre, parecidos, conLista: !!opciones && opciones.length > 0, aviso, cliente: sobreElCliente(r) });
  // El prefijo nombra la tanda (o el viaje del reparto), no el nombre que todavía no se confirma.
  const prefijo = await nombreDelViaje(supabase, { ...ent, contacto_nombre: null, cliente: null });
  await preguntarYEsperar(supabase, ent, conNombreDelViaje(prefijo, texto), null, { destino: 'nuevo', contacto_nombre: nombre, ...(clienteConLlave ? { cliente: clienteConLlave } : {}) }, { sinNombre: true });
}

/** Lo que la confirmación dice del cliente, según el directorio. */
function sobreElCliente(r: ResolucionCliente): string {
  switch (r.tipo) {
    case 'existente': return `Ya es cliente: ${nombrePropio(r.ficha.nombre)} (${datoDeLaFicha(r.ficha)}); va a su nombre.`;
    case 'nuevo': return `No lo tengo en el directorio: lo creo como cliente nuevo, con ${textoLlave(r.llave)}.`;
    case 'pedir_llave': return 'No lo tengo en el directorio: después del sí te pido su celular o correo (sin uno de los dos no lo creo).';
    case 'elegir': return 'Tengo contactos parecidos: después del sí te pregunto cuál es.';
    case 'llave_de_otro': return `El dato que tengo ya es de ${nombrePropio(r.ficha.nombre)}: después del sí te pregunto si es la misma persona.`;
    case 'error': return 'No pude revisar el directorio: lo reviso antes de crear a nadie.';
    default: return '';
  }
}

/** La respuesta a «¿Creo el cliente nuevo «X»?». */
async function atenderConfirmacionNuevo(
  supabase: SupabaseClient, ent: Fila, nombre: string, respuesta: string, crudos: ReadonlyArray<MensajeCrudo>,
  opciones: OpcionNegocio[] | null, opts: { revisarDosViajes?: boolean },
): Promise<void> {
  // Con los viajes abiertos, como los leyó la confirmación: una frase que señala un viaje resuelve también contra
  // los que el aviso «Ya hay un viaje de …» nombró por su código, fuera de la lista (sexto control de Vera).
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, ent.workspace_id as string)) ?? [];
  // La llave escrita sola: se guarda y se vuelve a preguntar mostrándola (el «sí» es a lo que se muestra).
  const llave = soloLlave(respuesta);
  if (llave) {
    await actualizar(supabase, ent.id as string, { cliente: { ...salidaGuardada(ent).cliente, llave } });
    await pedirConfirmacionNuevo(supabase, { ...ent, cliente: { ...salidaGuardada(ent).cliente, llave } }, nombre, opciones);
    return;
  }
  const r = interpretarConfirmacionNuevo(respuesta, opciones ?? [], nombre, viajes);
  if (r.tipo === 'si') {
    // El «sí»: ahora sí, el cliente con ese nombre (si ya hay un contacto igual, se pregunta «¿es el mismo?»).
    await entenderNuevo(supabase, ent, crudos, nombre, { revisarDosViajes: opts.revisarDosViajes, nuevoExplicito: true });
    return;
  }
  if (r.tipo === 'nombre') {
    await pedirConfirmacionNuevo(supabase, ent, r.nombre, opciones);
    return;
  }
  if (r.tipo === 'descartar') {
    await descartarEntrega(supabase, ent, crudos.length, 'el comercial descartó en «¿Creo el cliente nuevo?»');
    return;
  }
  let negocioId: string | null = r.tipo === 'existente' ? r.negocio_id : null;
  if (r.tipo === 'codigo') {
    negocioId = await negocioAbiertoPorCodigo(supabase, ent.workspace_id as string, r.codigo);
    if (!negocioId) {
      await pedirConfirmacionNuevo(supabase, ent, nombre, opciones, `No encontré un viaje abierto con el código «${respuesta.trim().slice(0, 20)}».`);
      return;
    }
  }
  if (negocioId) {
    // El número o el código del viaje: se cancela el nuevo y se carga ahí.
    await actualizar(supabase, ent.id as string, { destino: 'existente', negocio_destino_id: negocioId, contacto_nombre: null, confirmacion_pendiente: null });
    await cargarEnNegocioExistente(supabase, { ...ent, destino: 'existente', contacto_nombre: null }, negocioId, crudos, opciones ?? []);
    return;
  }
  await pedirConfirmacionNuevo(supabase, ent, nombre, opciones, `No entendí «${respuesta.trim().slice(0, 40)}».`);
}

// ── «¿A qué viaje van?» ──────────────────────────────────────────────────────

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
 * Los negocios abiertos de la línea, con su cliente y su destino. Del más reciente al más
 * viejo; 500 alcanza para una agencia (el techo de PostgREST es 1.000). `null` si no se pudo.
 */
async function negociosAbiertos(
  supabase: SupabaseClient, workspaceId: string, lineaId: string, staffId: string | null,
): Promise<NegocioAbierto[] | null> {
  const { data: negs, error } = await supabase.from('negocios')
    .select('id, codigo, nombre, created_at, contacto_id, empresa_id, responsable_id, contactos(nombre), empresas(nombre)')
    .eq('workspace_id', workspaceId).eq('linea_id', lineaId).eq('estado', 'abierto')
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

  return filas.map(n => ({
    id: n.id as string,
    codigo: (n.codigo as string | null) ?? null,
    // El cliente es el contacto o la empresa; el nombre del negocio va aparte (y también es encabezado).
    cliente: nombreRel(n.contactos) ?? nombreRel(n.empresas),
    cliente_id: (n.contacto_id as string | null) ?? (n.empresa_id as string | null) ?? null,
    destino: destinos.get(n.id as string) ?? null,
    nombre: (n.nombre as string | null) ?? null,
    created_at: n.created_at as string,
    del_remitente: suyos.has(n.id as string),
  }));
}

/**
 * Los nombres de quienes escriben al bot en el workspace (staff y colaboradores de WhatsApp): nunca
 * son candidatos a encabezado (QA de #971 v5: «Tatiana» resolvía a un negocio a su nombre). Ante un
 * error de lectura devuelve lo que pudo leer: la lista solo QUITA candidatos.
 */
export async function equipoDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<string[]> {
  const [{ data: st, error: e1 }, { data: co, error: e2 }] = await Promise.all([
    supabase.from('staff').select('full_name').eq('workspace_id', workspaceId).limit(500),
    supabase.from('wa_collaborators').select('name').eq('workspace_id', workspaceId).limit(500),
  ]);
  if (e1 || e2) console.error('[wa-entendimiento] no se pudo leer el equipo del workspace:', e1?.message ?? e2?.message);
  return [
    ...((st ?? []) as Fila[]).map(x => x.full_name),
    ...((co ?? []) as Fila[]).map(x => x.name),
  ].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
}

/** Los viajes abiertos y el equipo: lo que hace falta para resolver un encabezado. `null` si no se pudo. */
export async function candidatosDeEncabezado(
  supabase: SupabaseClient, workspaceId: string,
): Promise<{ viajes: ViajeAbierto[]; equipo: string[] } | null> {
  const [viajes, equipo] = await Promise.all([viajesAbiertosDeLaBandeja(supabase, workspaceId), equipoDelWorkspace(supabase, workspaceId)]);
  return viajes ? { viajes, equipo } : null;
}

/**
 * Lo que espera la tanda abierta de este remitente: la elección de la lista numerada de un
 * encabezado aproximado o ambiguo, o el nombre de un «nuevo» suelto (QA de #971 v6; Trappvel,
 * 2026-10-02). Se mira antes de registrar el mensaje, que todavía no está en la tanda. Lleva el
 * equipo para reconocer el nombre. `null`: nada.
 */
export async function pendienteDeLaTanda(
  supabase: SupabaseClient, workspaceId: string, phone: string, horasCajaActiva: number,
): Promise<(PendienteDeLaCaja & { equipo: string[]; viajes: ViajeAbierto[] }) | null> {
  const { data: abierta, error } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (error || !abierta) return null;
  const crudos = await leerMensajes(supabase, abierta.id as string);
  if (typeof crudos === 'string' || crudos.length === 0) return null;
  const c = await candidatosDeEncabezado(supabase, workspaceId);
  if (!c) return null;
  const mensajes = aViaje(crudos);
  const cfg = { horasCajaActiva, equipo: c.equipo };
  const directorio = await directorioDeLaTanda(supabase, workspaceId, mensajes, c.viajes, cfg);
  const p = pendienteDeLaCaja(armarSegmentos(mensajes, c.viajes, { ...cfg, directorio }).segmentos, directorio);
  return p ? { ...p, equipo: c.equipo, viajes: c.viajes } : null;
}

/** Lo que un escrito del comercial HARÍA en la tanda abierta (o en una nueva), antes de registrarlo. */
export interface EnLaTanda {
  /** Es la respuesta a lo que esperaba la caja abierta (la lista, el cliente, la llave): no es contenido ni abre caja. */
  respuesta: boolean;
  /** Abre una caja (es un encabezado). */
  abre: boolean;
  /** Lo que el bot contesta en el acto, o `null`. */
  acuse: string | null;
  /** Lo que esperaba la caja abierta antes de este escrito. */
  antes: PendienteDeLaCaja | null;
  /**
   * Es contenido de la caja abierta aunque su texto resuelva un viaje: el nombre del cliente de la caja de un viaje
   * NUEVO (octavo control de Vera, bloqueante 2). No es un encabezado y no se contesta «📌».
   */
  contenido?: boolean;
}

/**
 * Pasa el escrito por `armarSegmentos` como si ya estuviera en la tanda, con el directorio de sus nombres y
 * llaves, y dice qué sería y qué contestar (diseño 2026-10-05: el cliente se resuelve en el MISMO camino del
 * encabezado de hoy y del intérprete). `null` si no se pudo leer.
 */
export async function simularEnLaTanda(
  supabase: SupabaseClient, workspaceId: string, phone: string, horasCajaActiva: number, texto: string, enviadoAt: string,
  /** Un reenvío (o un audio, una foto) nunca contesta nada: solo puede recordar lo que espera la caja. */
  como: { reenviado?: boolean; tipo?: string } = {},
): Promise<EnLaTanda | null> {
  const { data: abierta, error } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (error) return null;
  const crudos = abierta ? await leerMensajes(supabase, abierta.id as string) : [];
  if (typeof crudos === 'string') return null;
  const c = await candidatosDeEncabezado(supabase, workspaceId);
  if (!c) return null;
  const mensajes = aViaje(crudos);
  const este: MensajeViaje = { n: mensajes.length + 1, cuerpo: texto, reenviado: como.reenviado === true, tipo: como.tipo ?? 'text', en: enviadoAt };
  const cfg = { horasCajaActiva, equipo: c.equipo };
  const directorio = await directorioDeLaTanda(supabase, workspaceId, [...mensajes, este], c.viajes, cfg);
  const antes = armarSegmentos(mensajes, c.viajes, { ...cfg, directorio });
  const despues = armarSegmentos([...mensajes, este], c.viajes, { ...cfg, directorio });
  const pendAntes = pendienteDeLaCaja(antes.segmentos, directorio);
  const ultimo = despues.segmentos[despues.segmentos.length - 1] ?? null;
  const abre = !!ultimo?.encabezado && ultimo.encabezado.n === este.n;
  const enc = despues.encabezados.includes(este.n) || abre;
  if (abre) return { respuesta: false, abre: true, acuse: acuseDeLaCaja(ultimo!, directorio, texto), antes: pendAntes };
  if (enc && ultimo) {
    // La respuesta en la caja: lo que quedó claro, o lo que todavía falta.
    if (ultimo.eleccion?.n === este.n) return { respuesta: true, abre: false, acuse: `📌 ${nombreDeViaje(ultimo.eleccion.viaje)}`, antes: pendAntes };
    const despuesP = pendienteDeLaCaja(despues.segmentos, directorio);
    // La lista sigue sin contestar (un sí, un no, un número fuera de ella): se vuelve a mostrar.
    if (pendAntes?.tipo === 'eleccion' && despuesP?.tipo === 'eleccion') {
      return { respuesta: true, abre: false, acuse: `No entendí. ${textoPreguntaEncabezado(pendAntes.texto, pendAntes.candidatos)}`, antes: pendAntes };
    }
    // «No es la misma persona» a la llave de otro: nunca con esa llave.
    const noEsElla = pendAntes?.tipo === 'cliente' && pendAntes.resolucion.tipo === 'llave_de_otro'
      && (ultimo.cliente?.descartadas ?? []).includes(pendAntes.resolucion.ficha.id);
    if (noEsElla && pendAntes?.tipo === 'cliente' && pendAntes.resolucion.tipo === 'llave_de_otro') {
      return { respuesta: true, abre: false, acuse: textoNoEsLaMisma(pendAntes.nombre, pendAntes.resolucion.ficha), antes: pendAntes };
    }
    return { respuesta: true, abre: false, acuse: acuseDeLaCaja(ultimo, directorio, texto) ?? (despuesP ? textoDeLoQueFalta(despuesP) : null), antes: pendAntes };
  }
  return { respuesta: false, abre: false, acuse: null, antes: pendAntes, contenido: !!ultimo?.mensajes.includes(este.n) };
}

/** Lo que el bot dice de una caja: el viaje (📌), la lista, o el cliente del viaje nuevo (§3.3). */
function acuseDeLaCaja(seg: Segmento, dir: Directorio, texto: string): string | null {
  const r = seg.encabezado?.resolucion ?? null;
  if (r?.tipo === 'nuevo') {
    if (seg.eleccion) return null;
    const rc = clienteDeLaCaja(seg, dir);
    if (!rc) return seg.nombre === null ? TEXTO_PIDE_CLIENTE : null;
    // Si no es un cliente que ya existe, se dice también qué viaje abierto se le parece (cuarto control de Vera).
    // Solo si el cliente es nuevo (o falta su llave) y el comercial no dijo ya que es otra persona.
    const nuevoDeVerdad = (rc.tipo === 'nuevo' || rc.tipo === 'pedir_llave') && !seg.cliente?.otraPersona && !seg.cliente?.descartadas.length;
    const parecidos = nuevoDeVerdad && r.parecidos?.length ? lineasDeParecidos(r.parecidos) : [];
    return [textoDelCliente(rc, { conContenido: seg.mensajes.length > 0 }), ...parecidos].join('\n');
  }
  if (seg.eleccion) return `📌 ${nombreDeViaje(seg.eleccion.viaje)}`;
  return respuestaAlEncabezado(r, texto);
}

/** La pregunta de lo que espera la caja, para recordarla. */
export function textoDeLoQueFalta(p: PendienteDeLaCaja): string {
  if (p.tipo === 'nombre') return TEXTO_PIDE_CLIENTE;
  if (p.tipo === 'cliente') return textoDelCliente(p.resolucion);
  return textoPreguntaEncabezado(p.texto, p.candidatos);
}

/**
 * El acuse del cliente de la caja abierta del remitente, si es la de un viaje nuevo (para el intérprete, que abre
 * la caja con su `interpretacion`: el mismo texto que el código de hoy). `null`: no aplica.
 */
export async function acuseDelClienteDeLaTanda(
  supabase: SupabaseClient, workspaceId: string, phone: string, horasCajaActiva: number,
): Promise<string | null> {
  const { data: abierta } = await supabase.from('wa_bandeja_entregas').select('id')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (!abierta) return null;
  const crudos = await leerMensajes(supabase, abierta.id as string);
  const c = await candidatosDeEncabezado(supabase, workspaceId);
  if (typeof crudos === 'string' || !c) return null;
  const mensajes = aViaje(crudos);
  const cfg = { horasCajaActiva, equipo: c.equipo };
  const directorio = await directorioDeLaTanda(supabase, workspaceId, mensajes, c.viajes, cfg);
  const { segmentos } = armarSegmentos(mensajes, c.viajes, { ...cfg, directorio });
  const ultimo = segmentos[segmentos.length - 1];
  if (!ultimo || ultimo.encabezado?.resolucion.tipo !== 'nuevo') return null;
  return acuseDeLaCaja(ultimo, directorio, '');
}

/**
 * La tanda abierta del remitente como la ve el intérprete conversacional: cuándo se abrió, cómo se
 * llama, cuántos mensajes irían al resumen y el viaje de su caja activa (la última). `null`: no hay.
 * Solo la usa el intérprete, que solo corre con su interruptor encendido.
 */
export async function tandaAbiertaDelRemitente(
  supabase: SupabaseClient, workspaceId: string, phone: string, horasCajaActiva: number,
): Promise<{ id: string; creadaAt: string | null; nombre: string; n: number; cajaViajeId: string | null; cajaCliente: string | null } | null> {
  const { data: abierta, error } = await supabase.from('wa_bandeja_entregas').select('id, created_at')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'abierta').limit(1).maybeSingle();
  if (error || !abierta) return null;
  const { nombre, n } = await nombreYConteoDeLaTanda(supabase, abierta.id as string, workspaceId, horasCajaActiva);
  let cajaViajeId: string | null = null;
  let cajaCliente: string | null = null;
  const crudos = await leerMensajes(supabase, abierta.id as string);
  const c = typeof crudos === 'string' ? null : await candidatosDeEncabezado(supabase, workspaceId);
  if (c && typeof crudos !== 'string') {
    const { segmentos } = armarSegmentos(aViaje(crudos), c.viajes, { horasCajaActiva, equipo: c.equipo });
    const ultimo = segmentos[segmentos.length - 1];
    cajaViajeId = ultimo ? (viajeDeLaCaja(ultimo)?.id ?? null) : null;
    // El cliente de la caja (de un viaje que ya existe o de uno nuevo): el «candidato pendiente» del intérprete
    // para «el mismo», «cliente antiguo», «es para uno nuevo» (diseño 2026-10-05, §5.2).
    cajaCliente = ultimo ? clienteDeCaja(ultimo) : null;
  }
  return { id: abierta.id as string, creadaAt: (abierta.created_at as string | null) ?? null, nombre, n, cajaViajeId, cajaCliente };
}

/** Los viajes abiertos de la línea de la bandeja (para encabezados y el ruteo). `null` si no se pudo. */
export async function viajesAbiertosDeLaBandeja(supabase: SupabaseClient, workspaceId: string): Promise<ViajeAbierto[] | null> {
  const l = await lineaDeLaBandeja(supabase, workspaceId);
  if (typeof l === 'string') return null;
  const abiertos = await negociosAbiertos(supabase, workspaceId, l.lineaId, null);
  return abiertos ? abiertos.map(n => ({ id: n.id, codigo: n.codigo, cliente: n.cliente, destino: n.destino, nombre: n.nombre ?? null })) : null;
}

/** Códigos (compactos) de negocios NO abiertos del workspace: «T1 26 3 está cerrado» y no «no existe». */
async function codigosCerrados(supabase: SupabaseClient, workspaceId: string): Promise<Set<string>> {
  const { data } = await supabase.from('negocios').select('codigo')
    .eq('workspace_id', workspaceId).neq('estado', 'abierto').not('codigo', 'is', null).limit(1000);
  return new Set(((data ?? []) as Fila[]).map(n => codigoCompacto(n.codigo as string)));
}

/**
 * El reparto de una entrega por encabezados (sin modelo: manda el encabezado). `conEncabezados`
 * dice si la tanda trae alguno; sin ninguno, la tanda es un viaje y se pregunta como siempre.
 * `null` si no se pudo armar.
 */
async function armarReparto(
  supabase: SupabaseClient, entregaId: string, workspaceId: string, crudos: ReadonlyArray<MensajeCrudo>,
): Promise<{ plan: PlanViajes; bandeja: ConfigBandeja; conEncabezados: boolean; nombres: string[]; viajes: ViajeAbierto[] } | null> {
  const l = await lineaDeLaBandeja(supabase, workspaceId);
  if (typeof l === 'string') {
    console.error(`[wa-entendimiento] sin reparto para ${entregaId}: ${l}`);
    return null;
  }
  const abiertos = await negociosAbiertos(supabase, workspaceId, l.lineaId, null);
  if (!abiertos) return null;
  const viajes: ViajeAbierto[] = abiertos.map(n => ({ id: n.id, codigo: n.codigo, cliente: n.cliente, destino: n.destino, nombre: n.nombre ?? null }));
  const mensajes = aViaje(crudos);
  const equipo = await equipoDelWorkspace(supabase, workspaceId);
  const cfgSeg = { horasCajaActiva: l.bandeja.horasCajaActiva, equipo };
  const directorio = await directorioDeLaTanda(supabase, workspaceId, mensajes, viajes, cfgSeg);
  const { segmentos, encabezados } = armarSegmentos(mensajes, viajes, { ...cfgSeg, directorio });
  const desconocidos = segmentos.some(s => s.encabezado?.resolucion.tipo === 'codigo_desconocido');
  const armado = armarPlan({
    mensajes, viajes, segmentos, encabezados,
    codigosCerrados: desconocidos ? await codigosCerrados(supabase, workspaceId) : new Set(),
  });
  // Quién es el cliente de cada viaje nuevo, contra TODO el directorio (diseño 2026-10-05): el resumen lo muestra
  // y su «sí» lo confirma.
  const plan = resolverClientesDelPlan(armado, await directorioDelPlan(supabase, workspaceId, armado));
  return { plan, bandeja: l.bandeja, conEncabezados: tieneEncabezados(segmentos), nombres: nombresDeLasCajas(segmentos), viajes };
}

/**
 * Arma lo que se le pregunta al comercial al cerrar una entrega:
 *   · modo `uno`: «¿A qué viaje van?» con la lista corta (devuelve `opciones`);
 *   · modo `encabezado` con encabezados en la tanda: el resumen del reparto (devuelve `plan`);
 *     sin encabezados, la tanda es un viaje y la pregunta es la de `uno`.
 * Devuelve `null` si no se pudo: quien llama hace la pregunta vieja.
 */
export async function armarPreguntaNegocio(
  supabase: SupabaseClient, entregaId: string, workspaceId: string, nMensajes: number,
): Promise<{
  texto: string; antes?: string[]; opciones?: OpcionNegocio[]; plan?: PlanViajes; sinDudas?: boolean;
  /** La tanda solo trajo encabezados (y acuses): no hay nada que preguntar ni cargar. El nombre de sus cajas. */
  sinContenido?: string;
} | null> {
  const l = await lineaDeLaBandeja(supabase, workspaceId);
  if (typeof l === 'string') {
    console.error(`[wa-entendimiento] sin lista de viajes para ${entregaId}: ${l}`);
    return null;
  }

  if (l.bandeja.modoViajes === 'encabezado') {
    const crudos = await leerMensajes(supabase, entregaId);
    if (typeof crudos === 'string') return null;
    const r = await armarReparto(supabase, entregaId, workspaceId, crudos);
    if (!r) return null;
    if (r.conEncabezados) {
      // Solo encabezados y acuses («nuevo Daniel Pérez», «si», «otro cliente»): nada que repartir. No
      // se pregunta «¿Así?» por un resumen vacío (Trappvel, 2026-10-02: esa pregunta ocupaba la cola).
      if (r.plan.mensajes.length === 0) {
        const nombres = r.nombres.length === 0 ? 'esta tanda' : r.nombres.length === 1 ? r.nombres[0] : `${r.nombres.slice(0, -1).join(', ')} y ${r.nombres[r.nombres.length - 1]}`;
        return { texto: '', plan: r.plan, sinContenido: nombres };
      }
      const sinDudas = r.bandeja.confirmar === 'si_duda' && planSinDudas(r.plan);
      const partes = partesResumenPlan(r.plan, aViaje(crudos), undefined, r.viajes);
      return { texto: partes[partes.length - 1], antes: partes.slice(0, -1), plan: r.plan, sinDudas };
    }
  }

  const { data: ent } = await supabase.from('wa_bandeja_entregas')
    .select('remitente_staff_id').eq('id', entregaId).maybeSingle();
  const staffId = (ent?.remitente_staff_id as string | null) ?? null;
  const abiertos = await negociosAbiertos(supabase, workspaceId, l.lineaId, staffId);
  if (!abiertos) return null;

  const { data: msgs } = await supabase.from('wa_bandeja_mensajes')
    .select('cuerpo').eq('entrega_id', entregaId).eq('papel', 'contenido');
  const texto = ((msgs ?? []) as Fila[]).map(m => String(m.cuerpo ?? '')).join('\n');
  const opciones = armarOpcionesNegocio(abiertos, texto);
  return { texto: textoPreguntaNegocio({ nMensajes, opciones }), opciones };
}

/** El viaje abierto que nombra un texto tal cual (código, nombre del negocio o cliente), o `null`. */
async function viajePorNombre(supabase: SupabaseClient, workspaceId: string, texto: string): Promise<string | null> {
  const viajes = await viajesAbiertosDeLaBandeja(supabase, workspaceId);
  const r = viajes ? resolverEncabezado(texto, viajes) : null;
  return r?.tipo === 'viaje' ? r.viaje.id : null;
}

async function volverAPreguntarNegocio(supabase: SupabaseClient, ent: Fila, opciones: OpcionNegocio[], aviso: string): Promise<void> {
  await preguntarYEsperar(supabase, ent, textoPreguntaNegocio({ nMensajes: 0, opciones, aviso }), null);
}

/** Un código que no estaba en la lista: se busca entre los abiertos del workspace. */
async function negocioAbiertoPorCodigo(supabase: SupabaseClient, workspaceId: string, codigo: string): Promise<string | null> {
  const { data } = await supabase.from('negocios').select('id, codigo')
    .eq('workspace_id', workspaceId).eq('estado', 'abierto').not('codigo', 'is', null).limit(1000);
  const hallados = ((data ?? []) as Fila[]).filter(n => codigoCompacto(n.codigo as string) === codigo);
  return hallados.length === 1 ? (hallados[0].id as string) : null;
}

// ── El reparto: proponer, corregir, confirmar ────────────────────────────────

/** El resumen puede venir en varias partes: se mandan en orden y se espera respuesta a la última. */
async function preguntarResumen(supabase: SupabaseClient, ent: Fila, partes: string[]): Promise<void> {
  // 2026-10-05: el resumen ya nombra cada viaje en su bloque (sin el nombre de la tanda delante) y lleva sus botones,
  // con la huella del reparto que acaba de quedar guardado.
  const { data: entrega } = await supabase.from('wa_bandeja_entregas').select('plan_viajes').eq('id', ent.entrega_id).maybeSingle();
  const plan = (entrega?.plan_viajes ?? null) as PlanViajes | null;
  for (const p of partes.slice(0, -1)) await enviar(ent.remitente_phone as string, p, ent.workspace_id as string);
  const botones = plan ? botonesDelResumen(plan, ent.entrega_id as string) : [];
  // Un resumen en varias partes no se redacta: la última sola no es el resumen.
  await preguntarYEsperar(supabase, ent, partes[partes.length - 1], null, {}, { sinNombre: true, botones, aparte: textoBotonesAparte(botones), resumen: true, sinRedaccion: partes.length > 1 });
}

/**
 * El resumen vigente de una entrega, armado de su reparto guardado (el mismo que recibió la última corrección): para
 * volver a mostrarlo con sus botones ante un toque viejo. `null`: la entrega no tiene reparto o no se pudo leer.
 */
export async function resumenGuardado(
  supabase: SupabaseClient, workspaceId: string, entregaId: string,
): Promise<{ partes: string[]; botones: BotonBandeja[]; aparte: string } | null> {
  const { data: e } = await supabase.from('wa_bandeja_entregas').select('plan_viajes').eq('id', entregaId).eq('workspace_id', workspaceId).maybeSingle();
  const plan = (e?.plan_viajes ?? null) as PlanViajes | null;
  if (!plan) return null;
  const crudos = await leerMensajes(supabase, entregaId);
  if (typeof crudos === 'string') return null;
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, workspaceId)) ?? [];
  const botones = botonesDelResumen(plan, entregaId);
  return { partes: partesResumenPlan(plan, aViaje(crudos), undefined, viajes), botones, aparte: textoBotonesAparte(botones) };
}

/** El mensaje corto de los botones cuando el resumen no cabe en su cuerpo. */
export function textoBotonesAparte(botones: ReadonlyArray<BotonBandeja>): string {
  return botones.some(b => b.title === TITULO_CARGAR) ? TEXTO_BOTONES_APARTE : TEXTO_BOTONES_APARTE_SIN_CARGAR;
}

/** «Laura Prueba · ¿…?»: toda pregunta lleva el nombre del viaje al principio. */
export function conNombreDelViaje(nombre: string, texto: string): string {
  return `${nombre} · ${texto}`;
}

/** «Tanda de las 10:42»: el nombre de una tanda sin cliente todavía, por la hora de Bogotá. */
export function nombreDeTanda(iso: string | null): string {
  if (!iso) return 'Tanda sin nombre';
  const hora = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  return `Tanda de las ${hora}`;
}

/** El nombre de una entrega: los clientes de su reparto («Diego Prueba», «Carolina y Luisa»), o la hora de la tanda. */
export function nombreDeLaEntrega(plan: PlanViajes | null, creadaAt: string | null): string {
  // Un viaje que ya existe se nombra como lo recuerda el comercial («Europa 2 días · Carolina Ruiz (M1 26 5)»).
  const nombres = plan
    ? gruposDelPlan(plan).map(g => (g.destino.tipo === 'existente' ? nombreDeViaje(g.destino) : g.destino.cliente)).filter((x): x is string => !!x && x.trim() !== '')
    : [];
  if (nombres.length === 0) return nombreDeTanda(creadaAt);
  return nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** El nombre del viaje de un entendimiento: el cliente que dio el comercial, el que se entendió o el negocio. */
async function nombreDelViaje(supabase: SupabaseClient, ent: Fila): Promise<string> {
  const dado = String(ent.contacto_nombre ?? '').trim() || String((ent.cliente as Fila | null)?.nombre ?? '').trim();
  if (dado) return dado;
  if (ent.negocio_destino_id) {
    const { data: n } = await supabase.from('negocios').select('codigo, nombre, contactos(nombre)').eq('id', ent.negocio_destino_id).maybeSingle();
    if (n) return nombreDeViaje({ nombre: (n.nombre as string | null) ?? null, cliente: nombreRel(n.contactos), codigo: (n.codigo as string | null) ?? null });
  }
  const { data: e } = await supabase.from('wa_bandeja_entregas').select('plan_viajes, created_at').eq('id', ent.entrega_id).maybeSingle();
  return nombreDeLaEntrega((e?.plan_viajes ?? null) as PlanViajes | null, (e?.created_at as string | null) ?? null);
}

/** La respuesta al resumen del reparto. Nada se carga hasta el «sí». */
async function resolverPlan(supabase: SupabaseClient, ent: Fila, planGuardado: PlanViajes, crudos: ReadonlyArray<MensajeCrudo>): Promise<void> {
  let plan = planGuardado;
  const workspaceId = ent.workspace_id as string;
  const { data: entrega } = await supabase.from('wa_bandeja_entregas').select('cliente_texto').eq('id', ent.entrega_id).maybeSingle();
  const respuesta = String(ent.respuesta_negocio ?? entrega?.cliente_texto ?? '');
  const viajes = (await viajesAbiertosDeLaBandeja(supabase, workspaceId)) ?? [];
  const mensajes = aViaje(crudos);
  // Un viaje nuevo cuya búsqueda falló se vuelve a buscar antes de leer la respuesta (nunca se crea sin buscar).
  if (clientesPorResolver(plan).some(f => f.destino.falta === 'error')) {
    plan = await resolverDeNuevo(supabase, workspaceId, plan, f => f.falta === 'error');
    await supabase.from('wa_bandeja_entregas').update({ plan_viajes: plan }).eq('id', ent.entrega_id);
  }
  const r = interpretarRespuestaPlan(respuesta, plan, viajes);

  if (r.tipo === 'cliente') {
    // La llave, cuál de los parecidos, o si es el dueño de la llave: se vuelve a resolver y se muestra otra vez.
    const nuevo = await resolverDeNuevo(supabase, workspaceId, aplicarCambioCliente(plan, r.clave, r.cambio), () => false);
    await supabase.from('wa_bandeja_entregas').update({ plan_viajes: nuevo }).eq('id', ent.entrega_id);
    const aviso = r.cambio.descartar ? `Entonces no lo mezclo con ese contacto: a esa persona la creas desde la app, o pásame otro celular o correo.` : 'Listo. Así queda:';
    await preguntarResumen(supabase, ent, partesResumenPlan(nuevo, mensajes, aviso, viajes));
    return;
  }
  if (r.tipo === 'corregir') {
    // Mover a «nuevo Pedro» también es un viaje nuevo: su cliente se resuelve antes de volver a mostrar el resumen.
    const nuevo = await resolverDeNuevo(supabase, workspaceId, aplicarCambios(plan, r.cambios), () => false);
    await supabase.from('wa_bandeja_entregas').update({ plan_viajes: nuevo }).eq('id', ent.entrega_id);
    await preguntarResumen(supabase, ent, partesResumenPlan(nuevo, mensajes, 'Corregido. Así queda:', viajes));
    return;
  }
  if (r.tipo === 'como_corregir' || r.tipo === 'no_entendida') {
    const aviso = r.tipo === 'como_corregir' ? TEXTO_COMO_CORREGIR : (r.aviso ?? `No entendí «${respuesta.slice(0, 40)}». No cargué nada.`);
    await preguntarResumen(supabase, ent, partesResumenPlan(plan, mensajes, aviso, viajes));
    return;
  }
  if (r.tipo === 'descartar_todo') {
    await guardarAsignacion(supabase, crudos, { ...plan, mensajes: plan.mensajes.map(m => ({ ...m, destino: null, descartado: true })) }, []);
    // Se cuentan los mensajes del resumen, no los encabezados ni las respuestas (prueba en vivo v2, N11).
    await descartarEntrega(supabase, ent, plan.mensajes.length, 'el comercial descartó el reparto');
    return;
  }

  // «Sí»: se guarda la asignación por mensaje y cada viaje corre aparte.
  const grupos = gruposDelPlan(plan);
  await guardarAsignacion(supabase, crudos, plan, grupos);
  await supabase.from('wa_bandeja_entregas').update({ plan_confirmado_at: new Date().toISOString() }).eq('id', ent.entrega_id);
  if (grupos.length === 0) {
    await descartarEntrega(supabase, ent, crudos.length, 'el reparto confirmado no asignó ningún mensaje');
    return;
  }
  await actualizar(supabase, ent.id as string, { estado: 'repartida', confirmacion_pendiente: null, error: null });
  for (const g of grupos) {
    const { data: fila } = await supabase.from('wa_bandeja_entendimientos').upsert({
      workspace_id: workspaceId, entrega_id: ent.entrega_id, segmento: g.k, remitente_phone: ent.remitente_phone,
      remitente_staff_id: ent.remitente_staff_id ?? null, estado: 'procesando', intentos: 1,
      destino: g.destino.tipo, negocio_destino_id: g.destino.tipo === 'existente' ? g.destino.negocio_id : null,
      contacto_nombre: g.destino.tipo === 'nuevo' ? g.destino.cliente : null,
    }, { onConflict: 'entrega_id,segmento', ignoreDuplicates: true }).select('*').maybeSingle();
    if (!fila) continue;
    // Una sola pregunta abierta a la vez: si el viaje anterior quedó preguntando, este espera en
    // cola (el reintento del cron lo toma cuando se conteste).
    if (await preguntaAbierta(supabase, workspaceId, ent.remitente_phone as string)) {
      await actualizar(supabase, (fila as Fila).id as string, { estado: 'error', intentos: 0, error: EN_COLA });
      continue;
    }
    await entender(supabase, fila as Fila);
  }
}

/**
 * Vuelve a resolver contra el directorio los viajes nuevos del plan que no están resueltos (y los que `rehacer`
 * marque, como una búsqueda que falló).
 */
async function resolverDeNuevo(
  supabase: SupabaseClient, workspaceId: string, plan: PlanViajes, rehacer: (d: DestinoNuevo) => boolean,
): Promise<PlanViajes> {
  const limpio: PlanViajes = {
    ...plan,
    mensajes: plan.mensajes.map(m => m.destino?.tipo === 'nuevo' && rehacer(m.destino)
      ? { ...m, destino: { tipo: 'nuevo' as const, cliente: m.destino.cliente, ...(m.destino.llave ? { llave: m.destino.llave } : {}), ...(m.destino.elegido ? { elegido: m.destino.elegido } : {}), ...(m.destino.otraPersona ? { otraPersona: true } : {}), ...(m.destino.descartadas?.length ? { descartadas: m.destino.descartadas } : {}) } }
      : m),
  };
  return resolverClientesDelPlan(limpio, await directorioDelPlan(supabase, workspaceId, limpio));
}

/** La asignación por mensaje, guardada para auditar de dónde salió cada dato. */
async function guardarAsignacion(
  supabase: SupabaseClient, crudos: ReadonlyArray<MensajeCrudo>, plan: PlanViajes,
  grupos: ReadonlyArray<{ k: number; mensajes: number[] }>,
): Promise<void> {
  const k = new Map<number, number>();
  for (const g of grupos) for (const n of g.mensajes) k.set(n, g.k);
  const en = new Date().toISOString();
  for (const m of plan.mensajes) {
    const crudo = crudos[m.n - 1];
    if (!crudo) continue;
    const { error } = await supabase.from('wa_bandeja_mensajes').update({
      segmento: k.get(m.n) ?? null,
      asignacion: {
        destino: m.destino, por: m.por, motivo: m.motivo ?? null,
        varios: m.varios === true, descartado: m.descartado === true, confirmado_at: en,
      },
    }).eq('id', crudo.id);
    if (error) console.error(`[wa-entendimiento] no se pudo guardar la asignación de ${crudo.id}:`, error.message);
  }
  const encabezados = plan.encabezados.map(n => crudos[n - 1]?.id).filter((x): x is string => !!x);
  if (encabezados.length > 0) await supabase.from('wa_bandeja_mensajes').update({ clase: 'encabezado' }).in('id', encabezados);
}

/** Un viaje del reparto confirmado: sus mensajes, contra su destino, como una entrega de un viaje. */
async function entenderSegmento(
  supabase: SupabaseClient, ent: Fila, entrega: Fila | null, crudos: ReadonlyArray<MensajeCrudo>, k: number,
): Promise<void> {
  const plan = (entrega?.plan_viajes ?? null) as PlanViajes | null;
  const grupo = plan ? gruposDelPlan(plan).find(g => g.k === k) : null;
  const delGrupo = crudos.filter(m => m.segmento === k);
  if (!grupo || delGrupo.length === 0) {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: `el viaje ${k} del reparto no tiene mensajes` });
    return;
  }
  // Si quedó esperando una confirmación (cruce, sin solicitud), la respuesta se atiende igual.
  const pendiente = (ent.confirmacion_pendiente as string | null) ?? null;
  if (pendiente && ent.respuesta_negocio) {
    const hecho = await atenderConfirmacion(supabase, ent, pendiente, String(ent.respuesta_negocio), delGrupo);
    if (hecho) return;
    const r = interpretarRespuestaNegocio(String(ent.respuesta_negocio), []);
    if (r.tipo === 'codigo') {
      const id = await negocioAbiertoPorCodigo(supabase, ent.workspace_id as string, r.codigo);
      if (id) {
        await cargarEnNegocioExistente(supabase, ent, id, delGrupo, []);
        return;
      }
    }
    if (r.tipo === 'nuevo' && r.cliente) {
      await pedirConfirmacionNuevo(supabase, ent, r.cliente, null);
      return;
    }
    if (r.tipo === 'nuevo') {
      await entenderNuevo(supabase, ent, delGrupo, null, {});
      return;
    }
    if (r.tipo === 'nuevo_en_duda') {
      await preguntarYEsperar(supabase, ent, textoNombreNuevoEnDuda(r.propuesto), pendiente as 'cruce' | 'sin_solicitud' | 'dos_viajes');
      return;
    }
    await preguntarYEsperar(supabase, ent, 'No entendí. ¿Los cargo ahí? Responde «sí», dime cuál es el viaje correcto, o «nuevo» y el nombre del cliente.', pendiente as 'cruce' | 'sin_solicitud' | 'dos_viajes');
    return;
  }
  const destino: DestinoPlan = grupo.destino;
  // El viaje iba a uno existente y el comercial pidió un cliente nuevo: espera su «sí» (2026-10-03).
  const porConfirmar = nuevoPorConfirmar(ent, destino.tipo);
  if (porConfirmar) {
    await atenderConfirmacionNuevo(supabase, ent, porConfirmar, String(ent.respuesta_negocio ?? ''), delGrupo, null, {});
    return;
  }
  if (destino.tipo === 'existente') {
    await cargarEnNegocioExistente(supabase, ent, destino.negocio_id, delGrupo, []);
  } else {
    // «nuevo Laura Prueba» en el encabezado: el comercial ya dijo «sí» al resumen, que decía «Cliente nuevo: Laura Prueba».
    // El resumen mostraba el cliente (el que ya existía, con su dato, o el nuevo con su llave): ese «sí» lo confirma.
    await entenderNuevo(supabase, ent, delGrupo, destino.cliente, { nuevoExplicito: !!destino.cliente || !!destino.contacto, destino });
  }
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
  crudos: ReadonlyArray<MensajeCrudo>,
  opciones: OpcionNegocio[],
  opts: { previa?: SalidaEntendida; forzar?: boolean } = {},
): Promise<void> {
  const workspaceId = ent.workspace_id as string;
  const { data: neg } = await supabase.from('negocios')
    .select('id, codigo, nombre, metadata, estado, linea_id, contacto_id, workspaces(slug), contactos(nombre), empresas(nombre)')
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
  const mensajes = aEntrega(crudos);
  const meta = { entrega_id: ent.entrega_id as string, en: new Date().toISOString(), origenDe: (f: string) => origenDeFrase(f, crudos) };

  let salida: SalidaEntendida;
  let sePresenta: string | null = null;
  if (opts.previa) {
    salida = opts.previa;
  } else {
    const lectura = await leerConModelo(
      instruccionesEntendimiento(campos, todayBogotaISO(), yaTiene),
      `Mensajes:\n${textoParaModelo(mensajes)}`,
      esquemaDeSalida(campos),
    );
    if (lectura.error || lectura.json === null) {
      await falloDelModelo(supabase, ent, lectura);
      return;
    }
    const e = entenderEntrega(lectura.json, campos, mensajes, { hoyISO: todayBogotaISO(), conocidos: yaTiene });
    sePresenta = e.sePresenta;
    await guardarClases(supabase, crudos, mensajes, e.clases);
    // La deducción se hace sobre lo que el negocio QUEDARÍA teniendo: los niños pueden haber
    // llegado en otra entrega y las edades en esta.
    salida = {
      ...e.salida,
      sugeridos: sugeridosConDeducciones(bloques.map(b => ({ fields: b.fields, data: b.data })), e.salida.sugeridos, meta),
    };
    await actualizar(supabase, ent.id as string, {
      linea_id: neg.linea_id ?? null, historia: salida.historia, sugeridos: salida.sugeridos, descartados: salida.descartados,
      cliente: salida.cliente, modelo: GEMINI_MODEL, finish_reason: lectura.finishReason, error: null,
      destino: 'existente', negocio_destino_id: negocioId,
    });
    // N5: dos viajes en una tanda tampoco se mezclan en un negocio existente.
    if (Number(ent.segmento ?? 0) === 0 && e.solicitudes.length >= 2) {
      await preguntarYEsperar(supabase, ent, textoDosViajes(e.solicitudes), 'dos_viajes');
      return;
    }
  }

  // N6: antes de cargar, ¿los mensajes hablan de otro viaje? Se avisa y se espera el «sí».
  const clienteNegocio = nombreRel((neg as Fila).contactos) ?? nombreRel((neg as Fila).empresas);
  if (!opts.forzar) {
    const cruces = detectarCruce({
      destinoNegocio: yaTiene.destino, destinoMensajes: salida.sugeridos.destino?.valor,
      // Solo un nombre con el que alguien se presenta en un mensaje del cliente (no el del modelo).
      clienteNegocio, clienteMensajes: sePresenta,
    });
    if (cruces.length > 0) {
      await preguntarYEsperar(supabase, ent, textoAvisoCruce({
        codigo: (neg.codigo as string | null) ?? null, cliente: clienteNegocio, destino: (yaTiene.destino as string | undefined) ?? null,
        nombre: (neg.nombre as string | null) ?? null, cruces,
      }), 'cruce', { negocio_destino_id: negocioId });
      return;
    }
  }

  // Cada bloque con lo suyo. Un slug repetido en dos bloques se queda con el primero.
  const vistos = new Set<string>();
  const escritos: Array<{ slug: string; valor: unknown }> = [];
  const conflictos: Conflicto[] = [];
  const actualizados: Actualizado[] = [];
  const sinSustento: string[] = [];
  const despues: Array<{ fields: unknown; data: unknown }> = [];
  for (const b of bloques) {
    const vistosAntes = new Set(vistos);
    for (const f of b.fields) vistos.add(f.slug);
    let r = cargarEnExistente(b.data, b.fields, salida.sugeridos, meta, new Set(vistosAntes));
    const quedo = await escribirBloque(supabase, b, d => {
      r = cargarEnExistente(d, b.fields, salida.sugeridos, meta, new Set(vistosAntes));
      return r.escritos.length > 0 || r.conflictos.length > 0 || r.actualizados.length > 0 ? r.data : null;
    });
    if (quedo) {
      escritos.push(...r.escritos.map(s => ({ slug: s, valor: r.data[s] })));
      conflictos.push(...r.conflictos);
      // El valor que quedó escrito (en mayúscula si es texto del bloque de viaje).
      actualizados.push(...r.actualizados.map(a => ({ ...a, valor: r.data[a.slug] as string | number })));
    }
    sinSustento.push(...r.sinSustento);
    despues.push({ fields: b.fields, data: quedo ?? b.data });
  }

  const valoresQuedan = aplicarSumas(campos, aplanarBloques(despues).valores);
  const h = huecos(campos, valoresQuedan);

  // El nombre PROVISIONAL («Viaje de Laura Prueba») se cambia cuando llega el destino, y solo si
  // nadie lo editó a mano: el nombre sigue siendo el que puso el bot (`metadata.nombre_auto`).
  const pistas = pistasDelTexto(crudos.map(m => String(m.cuerpo ?? '')).join('\n'));
  const nombreViaje = await renombrarSiEsProvisional(supabase, neg as Fila, valoresQuedan, pistas);

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
      quien, fechaISO: todayBogotaISO(), escritos: escritos.map(e => e.slug), conflictos, actualizados, fields: campos, historia: salida.historia,
    }),
  });
  if (eA) console.error(`[wa-entendimiento] negocio ${negocioId} sin traza en la actividad:`, eA.message);

  const wsSlug = (relUno((neg as Fila).workspaces)?.slug as string | undefined) ?? '';
  const descartadosTodos = [
    ...salida.descartados,
    ...sinSustento.map(slug => ({ slug, motivo: `la frase no dice el número nuevo: «${salida.sugeridos[slug]?.frase ?? ''}»` })),
  ];
  const nombrado = { nombre: nombreViaje, cliente: nombreRel(neg.contactos) ?? nombreRel(neg.empresas), codigo: (neg.codigo as string | null) ?? null };
  const msg = mensajeCargaExistente({
    codigo: (neg.codigo as string | null) ?? null, nombre: nombreDeViaje(nombrado), fields: campos, escritos, conflictos, actualizados,
    faltanMinimo: conMesEnLaPregunta(h.minimo.faltan, vacioFecha(valoresQuedan) ? pistas.mes : null), enlace: enlaceNegocio(wsSlug, negocioId), maxPreguntas: MAX_PREGUNTAS,
    descartados: descartadosTodos.map(d => d.slug),
    preguntasAntes: preguntasDeGuardian(descartadosTodos),
    avance: lineaAvance({ ...nombrado, fields: campos, valores: valoresQuedan }),
  });
  const ok = await enviar(ent.remitente_phone as string, await redactado(supabase, ent, { tipo: 'carga', fijo: msg }), workspaceId);
  await anotarFoco(supabase, workspaceId, ent.remitente_phone as string, { negocio_id: negocioId, por: 'carga', faltan: h.minimo.faltan.length, pedidos: pedidosDeLaCarga(h.minimo.faltan, campos) });
  await actualizar(supabase, ent.id as string, {
    estado: 'negocio_actualizado', negocio_id: negocioId, destino: 'existente', negocio_destino_id: negocioId,
    contacto_id: (neg.contacto_id as string | null) ?? null, huecos: h, confirmacion_pendiente: null,
    // `cargados` lleva también lo actualizado: el detalle (anterior → nuevo) vive en la marca.
    cargados: [...escritos.map(e => e.slug), ...actualizados.map(a => a.slug)], conflictos,
    descartados: descartadosTodos,
    respuesta_enviada_at: ok ? new Date().toISOString() : null, error: ok ? null : 'envio fallido',
  });
}

/**
 * Si el nombre del negocio sigue siendo el que puso el bot (`metadata.nombre_auto`), se rehace con lo
 * que el negocio tiene ahora: el provisional («Viaje de Laura Prueba») pasa a la convención cuando
 * llega el destino, y uno automático cambia si cambia el destino o las fechas (prueba en vivo v2, N8:
 * P 26 2 seguía «SAN ANDRÉS DIC» yendo a Santa Marta en enero). El mes y la duración que dijeron antes
 * se recuerdan (`metadata.nombre_pistas`): un mensaje que no los repite no los borra. Un nombre editado
 * a mano no se toca nunca. Devuelve el nombre que quedó.
 */
async function renombrarSiEsProvisional(
  supabase: SupabaseClient, neg: Fila, valores: Record<string, unknown>, pistas: { mes: number | null; duracion: string | null },
): Promise<string | null> {
  const actual = (neg.nombre as string | null) ?? null;
  const meta = (neg.metadata && typeof neg.metadata === 'object' ? neg.metadata : {}) as Fila;
  if (!actual || meta.nombre_auto !== actual) return actual;
  const antes = (meta.nombre_pistas && typeof meta.nombre_pistas === 'object' ? meta.nombre_pistas : {}) as { mes?: number | null; duracion?: string | null };
  const juntas = { mes: pistas.mes ?? antes.mes ?? null, duracion: pistas.duracion ?? antes.duracion ?? null };
  const nuevo = nombreViajeNuevo({
    destino: valores.destino, salida: valores.fecha_salida, regreso: valores.fecha_regreso,
    mes: juntas.mes, duracion: juntas.duracion, cliente: nombreRel(neg.contactos),
  });
  // Un nombre con destino no vuelve a ser provisional; el provisional solo cambia con destino.
  if (nuevo.provisional || nuevo.nombre === actual) return actual;
  // Solo si el nombre sigue siendo el del bot en este instante (una edición a mano entre tanto gana).
  const { data, error } = await supabase.from('negocios')
    .update({ nombre: nuevo.nombre, metadata: { ...meta, nombre_auto: nuevo.nombre, nombre_provisional: false, nombre_pistas: juntas } })
    .eq('id', neg.id).eq('nombre', actual).select('id');
  if (error || (data ?? []).length === 0) {
    if (error) console.error(`[wa-entendimiento] no se pudo renombrar el negocio ${neg.id}:`, error.message);
    return actual;
  }
  return nuevo.nombre;
}

/**
 * El comercial contestó la pregunta del cliente («¿Me pasas su celular o su correo?», «¿Cuál es?», «¿Es la misma
 * persona?», «¿Lo creo como cliente nuevo?»). Lo que la pregunta sabía (la llave, lo descartado) está en
 * `cliente`. Toda creación pasa por el guardián; nunca se crea con la llave de otro.
 */
async function resolverRespuesta(supabase: SupabaseClient, ent: Fila): Promise<void> {
  const workspaceId = ent.workspace_id as string;
  const opciones = (ent.contacto_opciones ?? []) as ContactoCandidato[];
  const respuestaTexto = String(ent.respuesta_contacto ?? '');
  const salida = salidaGuardada(ent);
  const est = ((ent.cliente ?? {}) as EstadoPregunta);
  const nombreMostrado = String(ent.contacto_nombre ?? '').trim();
  const nombre = nombreMostrado || salida.cliente.nombre || '';
  const llave = llaveDe(salida);
  const repreguntar = () => preguntarContacto(supabase, ent, {
    tipo: 'preguntar', nombre: nombreMostrado,
    motivo: est.pregunta === 'llave' ? 'llave' : est.pregunta === 'llave_de_otro' ? 'llave_de_otro' : opciones.length > 1 ? 'varios' : opciones.length === 1 ? 'mismo' : 'ninguno',
    opciones,
  }, est.pregunta === 'crear' && tieneLlave(llave) ? `No tengo a ${nombre} en el directorio. ¿Lo creo como cliente nuevo, con ${textoLlave(llave)}?` : undefined);

  const cfg = await configDeLinea(supabase, workspaceId);
  if (typeof cfg === 'string') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: cfg });
    return;
  }
  const decidir = (q: { nombre?: string; llave?: Llave | null; confirmado: boolean; descartadas?: string[]; otraPersona?: boolean }) => decidirCliente(supabase, ent, cfg, salida, {
    nombre: q.nombre ?? nombre, llave: q.llave === undefined ? llave : q.llave, confirmado: q.confirmado,
    descartadas: q.descartadas ?? est.descartadas ?? [], otraPersona: q.otraPersona ?? est.otraPersona,
  });

  // «Ese celular ya lo tenemos a nombre de X. ¿Es la misma persona?»: sí → X; no → nunca con esa llave.
  if (est.pregunta === 'llave_de_otro' && opciones.length === 1) {
    const s = leerEsLaMisma(respuestaTexto);
    if (s === 'si' || esSi(respuestaTexto)) {
      await cerrarConNegocio(supabase, ent, cfg, opciones[0].id, salida, { llave: null });
      return;
    }
    if (s === 'no') {
      const descartadas = [...(est.descartadas ?? []), opciones[0].id];
      await enviar(ent.remitente_phone as string, textoNoEsLaMisma(nombre || null, { id: opciones[0].id, nombre: opciones[0].nombre ?? '', cel4: opciones[0].cel4 ?? null, correo: false, abiertos: [] }), workspaceId);
      const sinEsa: Llave | null = null;
      await actualizar(supabase, ent.id as string, { cliente: { ...salida.cliente, telefono: null, email: null, llave: sinEsa, descartadas, pregunta: 'llave' } });
      await preguntarContacto(supabase, ent, { tipo: 'preguntar', motivo: 'llave', opciones: [], nombre });
      return;
    }
  }
  // Con una sola opción, un sí la elige: «Si», «sí», «Sí» y «SI» valen igual.
  if (opciones.length === 1 && est.pregunta !== 'llave_de_otro' && esSi(respuestaTexto)) {
    await cerrarConNegocio(supabase, ent, cfg, opciones[0].id, salida, { llave });
    return;
  }
  // «¿Lo creo como cliente nuevo, con cel. …?»: el «sí» crea (con el guardián).
  if (est.pregunta === 'crear' && opciones.length === 0 && esSi(respuestaTexto)) {
    await crearContactoYNegocio(supabase, ent, cfg, salida, nombre, llave, est);
    return;
  }
  // La llave escrita sola («300 555 1234», «ana@x.co», «@laurapc»): se vuelve a decidir con ella. Contesta lo
  // que se le pidió, así que cuenta como confirmado para el nombre que ya mostró la pregunta.
  const nuevaLlave = soloLlave(respuestaTexto);
  if (nuevaLlave) {
    await decidir({ llave: nuevaLlave, confirmado: !!nombre });
    return;
  }
  const r = interpretarRespuestaContacto(respuestaTexto, opciones);
  if (r.tipo === 'elegido') {
    await cerrarConNegocio(supabase, ent, cfg, r.contacto_id, salida, { llave });
    return;
  }
  if (r.tipo === 'otra') {
    await decidir({ confirmado: false, otraPersona: true });
    return;
  }
  if (r.tipo === 'telefono' || r.tipo === 'llave') {
    const l: Llave = r.tipo === 'telefono' ? { celular: r.telefono } : { ...(r.correo ? { correo: r.correo } : {}), ...(r.usuario ? { usuario: r.usuario } : {}) };
    await decidir({ llave: l, confirmado: !!nombre });
    return;
  }
  // Se le pidió el nombre y escribió solo el nombre («Valeria Prueba5»), sin NUEVO.
  let nuevoNombre: string | null = r.tipo === 'nuevo' ? r.nombre : null;
  // Sin la fórmula que lo presenta («la clienta es …», «para …»: octavo control de Vera, hallazgo 3).
  if (r.tipo === 'no_entendida' && opciones.length === 0 && !nombreMostrado
    && !/(^|\s)\d/.test(respuestaTexto.trim()) && esNombreNuevo(respuestaTexto.replace(/\d/g, ''))) {
    nuevoNombre = sinPresentacion(respuestaTexto.trim());
  }
  if (r.tipo === 'no_entendida' && !nuevoNombre) {
    await repreguntar();
    return;
  }
  // NUEVO, o NUEVO y un nombre: un nombre que el bot no mostró se vuelve a preguntar mostrándolo (2026-10-03);
  // el mismo nombre (o NUEVO a secas) es el «sí» a crear. En los dos casos, con el guardián.
  const otroNombre = !!nuevoNombre && normalizarNombre(nuevoNombre) !== normalizarNombre(nombreMostrado);
  await decidir({ nombre: nuevoNombre ?? nombre, confirmado: !otroNombre, ...(otroNombre ? { otraPersona: false } : { otraPersona: true }) });
}

/**
 * Crea el contacto con el guardián y el negocio. Sin llave no crea (pregunta por ella); con la llave de otro, no
 * crea (pregunta si es la misma persona); si la búsqueda falla, queda en error y el cron lo reintenta.
 */
async function crearContactoYNegocio(
  supabase: SupabaseClient, ent: Fila, cfg: ConfigLinea, salida: SalidaEntendida, nombreDado: string | null, llave: Llave | null, estado: EstadoPregunta = {},
): Promise<void> {
  const nombre = String(nombreDado || ent.contacto_nombre || salida.cliente.nombre || '').trim();
  const res = await crearContactoConGuardian(supabase, ent.workspace_id as string, { nombre, llave });
  if (res.tipo === 'error') {
    await actualizar(supabase, ent.id as string, { estado: 'error', error: res.motivo });
    return;
  }
  if (res.tipo === 'no_creado') {
    if (res.resolucion.tipo === 'existente') {
      await cerrarConNegocio(supabase, ent, cfg, res.resolucion.ficha.id, salida, { llave: null });
      return;
    }
    await preguntarPorElCliente(supabase, ent, salida, res.resolucion, nombre, { ...estado, llave });
    return;
  }
  await cerrarConNegocio(supabase, ent, cfg, res.id, salida, { llave: null });
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
 *   3. respuestas a «¿cuál contacto?» → se resuelven;
 *   4. respuestas a «¿A qué viaje van?», al reparto o a una confirmación → se atienden.
 */
export async function procesarEntendimientos(
  supabase: SupabaseClient,
  /**
   * Solo lo de un remitente (2026-10-05, conversación con memoria): la bandeja lo corre EN EL ACTO cuando toma una
   * respuesta, sin esperar al cron de cada minuto (de ahí salían los 55 s y los 37 s de la prueba de Mauricio). Los
   * reclamos son actualizaciones condicionadas: correr junto al cron no toma dos veces lo mismo.
   */
  de?: { workspaceId: string; phone: string },
): Promise<{ entendidas: number; respuestas: number }> {
  const delRemitente = <Q extends { eq: (c: string, v: string) => Q }>(q: Q): Q => (de ? q.eq('workspace_id', de.workspaceId).eq('remitente_phone', de.phone) : q);
  // Un error de esta misma pasada se reintenta en la siguiente (un minuto después), no enseguida: con
  // el modelo caído, los tres intentos se gastaban en dos pasadas (prueba en vivo v2, 403 de cobro).
  const inicio = new Date().toISOString();
  let entendidas = 0;
  let respuestas = 0;

  // 3. Respuestas a «¿cuál contacto?».
  const { data: conRespuesta } = await delRemitente(supabase.from('wa_bandeja_entendimientos').select('*'))
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

  // 4. Respuestas a la re-pregunta «¿A qué viaje van?», al reparto o a una confirmación.
  const { data: conViaje } = await delRemitente(supabase.from('wa_bandeja_entendimientos').select('*'))
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

  // Lo nuevo y los reintentos van DESPUÉS de las respuestas: una respuesta libera la pregunta
  // abierta del remitente y lo que esperaba turno puede correr en la misma pasada.
  // 1. Nuevas. El reclamo es el INSERT (entrega + segmento 0 es único): dos corridas no toman la misma.
  const { data: entregas } = await delRemitente(supabase.from('wa_bandeja_entregas')
    .select('id, workspace_id, remitente_phone, remitente_staff_id'))
    .eq('estado', 'con_cliente').order('cliente_respondido_at', { ascending: true }).limit(50);
  const lista = (entregas ?? []) as Fila[];
  if (lista.length > 0) {
    const { data: ya } = await supabase.from('wa_bandeja_entendimientos').select('entrega_id').in('entrega_id', lista.map(e => e.id));
    const tomadas = new Set(((ya ?? []) as Fila[]).map(e => e.entrega_id as string));
    const activos = await workspacesActivos(supabase, [...new Set(lista.map(e => e.workspace_id as string))]);
    for (const e of lista.filter(x => !tomadas.has(x.id as string) && activos.has(x.workspace_id as string)).slice(0, LOTE)) {
      // Una sola pregunta abierta a la vez por remitente: si hay otra, esta entrega espera turno.
      if (await preguntaAbierta(supabase, e.workspace_id as string, e.remitente_phone as string)) continue;
      const { data: fila } = await supabase.from('wa_bandeja_entendimientos').upsert({
        workspace_id: e.workspace_id, entrega_id: e.id, segmento: 0, remitente_phone: e.remitente_phone,
        remitente_staff_id: e.remitente_staff_id, estado: 'procesando', intentos: 1,
      }, { onConflict: 'entrega_id,segmento', ignoreDuplicates: true }).select('*').maybeSingle();
      if (!fila) continue;
      await entender(supabase, fila);
      entendidas++;
    }
  }

  // 2. Reintentos del modelo.
  const { data: fallidas } = await delRemitente(supabase.from('wa_bandeja_entendimientos').select('*'))
    .eq('estado', 'error').lt('intentos', MAX_INTENTOS).is('negocio_id', null).is('contacto_id', null).limit(LOTE);
  const activosF = await workspacesActivos(supabase, [...new Set(((fallidas ?? []) as Fila[]).map(e => e.workspace_id as string))]);
  for (const f of ((fallidas ?? []) as Fila[]).filter(x => activosF.has(x.workspace_id as string))) {
    if (f.error !== EN_COLA && String(f.updated_at ?? '') >= inicio) continue;
    if (await preguntaAbierta(supabase, f.workspace_id as string, f.remitente_phone as string)) continue;
    const { data: fila } = await supabase.from('wa_bandeja_entendimientos')
      .update({ estado: 'procesando', intentos: (f.intentos as number) + 1, updated_at: new Date().toISOString() })
      .eq('id', f.id).eq('estado', 'error').select('*').maybeSingle();
    if (!fila) continue;
    await entender(supabase, fila);
    entendidas++;
  }

  return { entendidas, respuestas };
}

/** Marca de un entendimiento que espera turno porque el remitente tiene otra pregunta abierta. */
const EN_COLA = 'en cola: el comercial tiene otra pregunta abierta';

/** Las dos preguntas que el paso de entendimiento puede dejar abiertas, con sus columnas. */
const PENDIENTES = [
  { estado: 'esperando_negocio', pregunta: 'pregunta_negocio_at', respuesta: 'respuesta_negocio', en: 'respuesta_negocio_at', papel: 'respuesta_negocio' },
  { estado: 'esperando_contacto', pregunta: 'pregunta_contacto_at', respuesta: 'respuesta_contacto', en: 'respuesta_at', papel: 'respuesta_contacto' },
] as const;

/**
 * ¿Tiene el remitente una pregunta del paso de entendimiento sin responder (en las últimas 24
 * horas)? La usa el ruteo (N8): un escrito con una pregunta pendiente es la respuesta, no una
 * consulta para el bot de siempre.
 */
export async function hayPreguntaPendiente(supabase: SupabaseClient, workspaceId: string, phone: string): Promise<boolean> {
  const desde = new Date(Date.now() - HORAS_RESPUESTA_CONTACTO * 3600_000).toISOString();
  for (const k of PENDIENTES) {
    const { data } = await supabase.from('wa_bandeja_entendimientos').select('id')
      .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', k.estado)
      .is(k.respuesta, null).gte(k.pregunta, desde).limit(1).maybeSingle();
    if (data) return true;
  }
  return false;
}

/** La pregunta abierta de un remitente, en una línea, para recordarla: «Laura Prueba · ¿Lo creo? NUEVO / celular». */
export interface PreguntaAbierta {
  tipo: 'entrega' | 'negocio' | 'contacto';
  id: string;
  nombre: string;
  corta: string;
  /**
   * Qué forma tiene la respuesta que se espera:
   *   · `viaje`: «¿A qué viaje van?» o el aviso de viaje equivocado — un número, un código, el nombre
   *     de un viaje, «NUEVO nombre» o «DESCARTAR». Nada de eso es un encabezado (prueba en vivo v2, N2);
   *   · `nombre`: el nombre de un cliente nuevo (`TEXTO_PIDE_NOMBRE`): «NUEVO Marta Gómez» tampoco;
   *   · `resumen`: el «sí» o la corrección del reparto;
   *   · `otra`: «¿es el mismo?», «¿lo creo igual?»: un sí, un no o un número.
   */
  espera: 'viaje' | 'nombre' | 'resumen' | 'otra';
  /** La entrega de la pregunta (para leer su `negocio_opciones`). */
  entregaId?: string | null;
  /**
   * El nombre de «¿Creo el cliente nuevo «X»?» si ESA es la pregunta (X); `null` si es otra. El intérprete
   * la muestra con su propia capa, la lista del aviso y la opción «sí» (cuarto control de Vera, CF7).
   */
  nuevoPorConfirmar?: string | null;
}

/**
 * La pregunta abierta del remitente, si hay una: el resumen o «¿A qué viaje van?» de una entrega
 * (`esperando_cliente` con la pregunta enviada) o una pregunta del entendimiento sin responder.
 * Una sola a la vez por remitente (prueba en vivo del 2026-10-01): las demás esperan en cola.
 * `excepto`: la entrega o el entendimiento que se está atendiendo.
 */
export async function preguntaAbierta(
  supabase: SupabaseClient, workspaceId: string, phone: string, excepto: string[] = [],
): Promise<PreguntaAbierta | null> {
  const desde = new Date(Date.now() - HORAS_RESPUESTA_CONTACTO * 3600_000).toISOString();
  const { data: ents } = await supabase.from('wa_bandeja_entendimientos')
    .select('id, entrega_id, segmento, estado, confirmacion_pendiente, destino, contacto_nombre, contacto_opciones, cliente, negocio_destino_id, negocio_id, contacto_id, pregunta_negocio_at, pregunta_contacto_at, respuesta_negocio, respuesta_contacto')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).in('estado', ['esperando_negocio', 'esperando_contacto']).limit(20);
  for (const e of (ents ?? []) as Fila[]) {
    if (excepto.includes(e.id as string)) continue;
    const contacto = e.estado === 'esperando_contacto';
    const at = (contacto ? e.pregunta_contacto_at : e.pregunta_negocio_at) as string | null;
    const resp = contacto ? e.respuesta_contacto : e.respuesta_negocio;
    if (!at || at < desde || resp) continue;
    const nombre = await nombreDelViaje(supabase, e);
    if (contacto) {
      const n = Array.isArray(e.contacto_opciones) ? e.contacto_opciones.length : 0;
      const sinNombre = n === 0 && !String(e.contacto_nombre ?? '').trim();
      return {
        tipo: 'contacto', id: e.id as string, nombre, espera: sinNombre ? 'nombre' : 'otra',
        corta: n === 0 ? '¿Me pasas su celular o su correo?' : n === 1 ? '¿Es la misma persona?' : '¿Cuál contacto es?',
      };
    }
    const c = e.confirmacion_pendiente as string | null;
    // Sin confirmación pendiente, la fila 0 de un reparto espera el «sí» del resumen; cualquier otra
    // espera «¿A qué viaje van?» (la re-pregunta: antes decía «¿Así? SÍ o corrige», prueba en vivo v2).
    let resumen = false;
    if (!c && Number(e.segmento ?? 0) === 0) {
      const { data: en } = await supabase.from('wa_bandeja_entregas').select('plan_viajes').eq('id', e.entrega_id).maybeSingle();
      resumen = !!en?.plan_viajes;
    }
    // «¿Creo el cliente nuevo «X»?» (2026-10-03): se contesta como «¿A qué viaje van?» (un sí, un nombre,
    // un número o un código), así que espera lo mismo.
    const porConfirmar = !c && !resumen ? nuevoPorConfirmar(e, null) : null;
    const corta = c === 'cruce' ? '¿Los cargo en ese viaje?'
      : c === 'sin_solicitud' ? '¿Es una solicitud de viaje?'
      : c === 'dos_viajes' ? '¿Me las reenvías por separado?'
      : resumen ? '¿Lo cargo así?'
      : porConfirmar ? `¿Va como viaje nuevo de ${porConfirmar.slice(0, 40)}? Sí, el nombre correcto, o dime el viaje si ya existe`
      : '¿De qué viaje son?';
    const espera = c === 'cruce' || (!c && !resumen) ? 'viaje' : resumen ? 'resumen' : 'otra';
    return { tipo: 'negocio', id: e.id as string, nombre, corta, espera, entregaId: (e.entrega_id as string | null) ?? null, nuevoPorConfirmar: porConfirmar };
  }
  const { data: pendientes } = await supabase.from('wa_bandeja_entregas').select('id, plan_viajes, created_at, pregunta_enviada_at')
    .eq('workspace_id', workspaceId).eq('remitente_phone', phone).eq('estado', 'esperando_cliente').limit(20);
  for (const e of (pendientes ?? []) as Fila[]) {
    if (excepto.includes(e.id as string)) continue;
    const at = e.pregunta_enviada_at as string | null;
    if (!at || at < desde) continue;
    const plan = (e.plan_viajes ?? null) as PlanViajes | null;
    return {
      tipo: 'entrega', id: e.id as string, nombre: nombreDeLaEntrega(plan, (e.created_at as string | null) ?? null),
      corta: plan ? '¿Lo cargo así?' : '¿De qué viaje son?',
      espera: plan ? 'resumen' : 'viaje',
    };
  }
  return null;
}

/** «Primero: Laura Prueba · ¿Me pasas su celular o su correo?». */
export function textoPrimero(p: PreguntaAbierta): string {
  return `Primero: ${p.nombre} · ${p.corta}`;
}

/**
 * ¿Este texto del comercial es la respuesta a una pregunta del paso de entendimiento («¿A qué
 * viaje van?» repetida, el reparto, una confirmación o «¿cuál contacto?»)? Lo llama la bandeja
 * ANTES de registrar el mensaje como contenido: sin esto, la respuesta abriría una entrega nueva.
 * Solo cuenta un texto escrito (no reenviado), sin entrega abierta del mismo remitente y dentro
 * de las 24 horas de la pregunta. Devuelve `true` si lo tomó.
 */
export async function tomarRespuestaContacto(
  supabase: SupabaseClient,
  p: {
    workspaceId: string; phone: string; texto: string; wamid: string; enviadoAt: string | null;
    /** La respuesta se toma aunque haya una tanda abierta (un «sí» corto, o la respuesta a «¿A qué viaje van?»). */
    aunConTandaAbierta?: boolean;
    /** El crudo que se guarda, si `texto` es la forma canónica que tradujo el intérprete. Sin él, `texto`. */
    cuerpo?: string;
  },
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

  if (!p.aunConTandaAbierta) {
    const { data: abierta } = await supabase.from('wa_bandeja_entregas').select('id')
      .eq('workspace_id', p.workspaceId).eq('remitente_phone', p.phone).eq('estado', 'abierta').limit(1).maybeSingle();
    if (abierta) return false;
  }

  // El crudo se guarda igual que todo lo demás de la bandeja, con su papel.
  const { error: eIns } = await supabase.from('wa_bandeja_mensajes').insert({
    workspace_id: p.workspaceId, entrega_id: pend.entrega_id, wa_message_id: p.wamid,
    remitente_phone: p.phone, remitente_staff_id: pend.remitente_staff_id ?? null,
    tipo: 'text', papel: cual.papel, cuerpo: p.cuerpo ?? p.texto, cuerpo_origen: 'texto', enviado_at: p.enviadoAt,
  });
  if (eIns && !String(eIns.message).includes('duplicate')) {
    console.error('[wa-entendimiento] no se pudo guardar la respuesta:', eIns.message);
  }
  if (eIns && String(eIns.message).includes('duplicate')) return true; // Meta reintentó: ya se tomó.

  await actualizar(supabase, pend.id as string, { [cual.respuesta]: p.texto, [cual.en]: new Date().toISOString() });
  return true;
}

/**
 * La respuesta a la pregunta de una ENTREGA cerrada («¿A qué viaje van?» o el resumen del reparto),
 * tomada aunque haya una tanda abierta: un «sí» corto o la respuesta a «¿A qué viaje van?» no son
 * contenido de la caja que abrió un encabezado mandado detrás (prueba en vivo v2, N1 y N2). Hace lo
 * mismo que la rama `respuesta_cliente` de `wa_bandeja_registrar_mensaje`. Devuelve `true` si la tomó.
 */
export async function tomarRespuestaDeEntrega(
  supabase: SupabaseClient,
  p: {
    workspaceId: string; phone: string; texto: string; wamid: string; enviadoAt: string | null; horas: number;
    /** El crudo que se guarda, si `texto` es la forma canónica que tradujo el intérprete. Sin él, `texto`. */
    cuerpo?: string;
  },
): Promise<boolean> {
  const desde = new Date(Date.now() - p.horas * 3600_000).toISOString();
  const { data: e } = await supabase.from('wa_bandeja_entregas').select('id, remitente_staff_id, remitente_colaborador_id')
    .eq('workspace_id', p.workspaceId).eq('remitente_phone', p.phone).eq('estado', 'esperando_cliente')
    .gte('pregunta_enviada_at', desde).order('cerrada_at', { ascending: false }).limit(1).maybeSingle();
  if (!e) return false;
  const { error: eIns } = await supabase.from('wa_bandeja_mensajes').insert({
    workspace_id: p.workspaceId, entrega_id: e.id, wa_message_id: p.wamid, remitente_phone: p.phone,
    remitente_staff_id: e.remitente_staff_id ?? null, remitente_colaborador_id: e.remitente_colaborador_id ?? null,
    tipo: 'text', papel: 'respuesta_cliente', cuerpo: p.cuerpo ?? p.texto, cuerpo_origen: 'texto', enviado_at: p.enviadoAt,
  });
  if (eIns) {
    if (String(eIns.message).includes('duplicate')) return true; // Meta reintentó: ya se tomó.
    console.error('[wa-entendimiento] no se pudo guardar la respuesta a la entrega:', eIns.message);
    return false;
  }
  const { data: hecho } = await supabase.from('wa_bandeja_entregas')
    .update({ estado: 'con_cliente', cliente_texto: p.texto, cliente_respondido_at: new Date().toISOString() })
    .eq('id', e.id).eq('estado', 'esperando_cliente').select('id');
  return (hecho ?? []).length > 0;
}

/**
 * El nombre de una tanda abierta y cuántos mensajes de contenido tiene (sin encabezados ni respuestas
 * en el acto): «Laura Prueba (2 mensajes)». Para «cancelar» dentro de una caja abierta.
 */
export async function nombreYConteoDeLaTanda(
  supabase: SupabaseClient, entregaId: string, workspaceId: string, horasCajaActiva: number,
): Promise<{ nombre: string; n: number }> {
  const { data: en } = await supabase.from('wa_bandeja_entregas').select('created_at').eq('id', entregaId).maybeSingle();
  const crudos = await leerMensajes(supabase, entregaId);
  const c = await candidatosDeEncabezado(supabase, workspaceId);
  if (typeof crudos === 'string' || !c) return { nombre: nombreDeTanda((en?.created_at as string | null) ?? null), n: 0 };
  const mensajes = aViaje(crudos);
  const { segmentos } = armarSegmentos(mensajes, c.viajes, { horasCajaActiva, equipo: c.equipo });
  const nombres = nombresDeLasCajas(segmentos);
  // Los mensajes que irían al resumen: sin encabezados, respuestas, risas ni acuses del comercial.
  const n = mensajesDelResumen(segmentos, mensajes);
  const nombre = nombres.length === 0 ? nombreDeTanda((en?.created_at as string | null) ?? null)
    : nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
  return { nombre, n };
}

/** Marca de lo que el comercial descartó con «descartar» o «cancelar» (Trappvel, 2026-10-02, regla 4). */
export const DESCARTE_DEL_COMERCIAL = 'descartado por el comercial (DESCARTAR): no se pregunta ni se carga';

/** Cuántos mensajes del resumen tiene una entrega: los de su reparto sin descartar, o los de contenido. */
function mensajesDeLaEntrega(e: Fila): number {
  const plan = (e.plan_viajes ?? null) as PlanViajes | null;
  return plan ? plan.mensajes.filter(m => !m.descartado).length : Number(e.n_mensajes ?? 0);
}

/**
 * «descartar» (regla 4): descarta lo pendiente del remitente FUERA de la tanda abierta (de esa se
 * encarga la bandeja):
 *   · los entendimientos que esperan una respuesta (`esperando_negocio`, `esperando_contacto`, de
 *     cualquier capa: el resumen, «¿A qué viaje van?», una confirmación, «¿cuál contacto?») o su turno
 *     (en cola tras otra pregunta) → `descartada`;
 *   · las entregas cerradas que esperan su pregunta o su respuesta, y las que el comercial ya contestó
 *     pero el cron todavía no tomó → sin pregunta, con la marca (no vuelven a la cola ni toman la
 *     siguiente respuesta).
 * Nada de eso cargó nada todavía. `guardarRespuesta`: el «descartar» se guarda (como respuesta) en lo
 * primero que descarta, para que el crudo no se pierda. Devuelve qué descartó y cuántos mensajes.
 */
export async function descartarPendientesDelRemitente(
  supabase: SupabaseClient,
  p: {
    workspaceId: string; phone: string; texto: string; wamid: string; enviadoAt: string | null; guardarRespuesta: boolean;
    /** La config de la bandeja: en modo `encabezado`, una entrega sin reparto se nombra y se cuenta por sus cajas. */
    bandeja: Pick<ConfigBandeja, 'modoViajes' | 'horasCajaActiva'>;
  },
): Promise<ParteDescartada[]> {
  const partes: ParteDescartada[] = [];
  let guardar = p.guardarRespuesta;
  const guardarEn = async (entregaId: unknown, papel: string, staff: unknown, colaborador: unknown = null) => {
    if (!guardar) return;
    guardar = false;
    const { error } = await supabase.from('wa_bandeja_mensajes').insert({
      workspace_id: p.workspaceId, entrega_id: entregaId, wa_message_id: p.wamid, remitente_phone: p.phone,
      remitente_staff_id: staff ?? null, remitente_colaborador_id: colaborador ?? null,
      tipo: 'text', papel, cuerpo: p.texto, cuerpo_origen: 'texto', enviado_at: p.enviadoAt,
    });
    if (error && !String(error.message).includes('duplicate')) console.error('[wa-entendimiento] no se pudo guardar el «descartar»:', error.message);
  };

  const { data: ents } = await supabase.from('wa_bandeja_entendimientos').select('*')
    .eq('workspace_id', p.workspaceId).eq('remitente_phone', p.phone)
    .in('estado', ['esperando_negocio', 'esperando_contacto', 'error']).limit(50);
  for (const e of (ents ?? []) as Fila[]) {
    if (e.estado === 'error' && e.error !== EN_COLA) continue;
    const { data: hecho } = await supabase.from('wa_bandeja_entendimientos')
      .update({ estado: 'descartada', confirmacion_pendiente: null, error: DESCARTE_DEL_COMERCIAL, updated_at: new Date().toISOString() })
      .eq('id', e.id).eq('estado', e.estado).select('id');
    if ((hecho ?? []).length === 0) continue;
    const segmento = Number(e.segmento ?? 0);
    let n = 0;
    if (segmento > 0) {
      const { data: ms } = await supabase.from('wa_bandeja_mensajes').select('id')
        .eq('entrega_id', e.entrega_id).eq('segmento', segmento).eq('papel', 'contenido');
      n = (ms ?? []).length;
    } else {
      const { data: en } = await supabase.from('wa_bandeja_entregas').select('plan_viajes, n_mensajes').eq('id', e.entrega_id).maybeSingle();
      n = en ? mensajesDeLaEntrega(en as Fila) : 0;
    }
    partes.push({ nombre: await nombreDelViaje(supabase, e), n });
    await guardarEn(e.entrega_id, e.estado === 'esperando_contacto' ? 'respuesta_contacto' : 'respuesta_negocio', e.remitente_staff_id);
  }

  const { data: entregas } = await supabase.from('wa_bandeja_entregas')
    .select('id, estado, plan_viajes, n_mensajes, created_at, pregunta_error, remitente_staff_id, remitente_colaborador_id')
    .eq('workspace_id', p.workspaceId).eq('remitente_phone', p.phone).in('estado', ['esperando_cliente', 'con_cliente']).limit(50);
  const lista = (entregas ?? []) as Fila[];
  if (lista.length === 0) return partes;
  const { data: tomadas } = await supabase.from('wa_bandeja_entendimientos').select('entrega_id').in('entrega_id', lista.map(e => e.id));
  const conEntendimiento = new Set(((tomadas ?? []) as Fila[]).map(e => e.entrega_id as string));
  for (const e of lista) {
    if (conEntendimiento.has(e.id as string)) continue;
    // Una entrega cerrada sin pregunta a propósito (solo ruido, cancelada, sin contenido) ya no está pendiente.
    if (e.estado === 'esperando_cliente' && e.pregunta_error) continue;
    const { data: hecho } = await supabase.from('wa_bandeja_entregas')
      .update({ estado: 'esperando_cliente', pregunta_enviada_at: null, pregunta_error: DESCARTE_DEL_COMERCIAL })
      .eq('id', e.id).eq('estado', e.estado).select('id');
    if ((hecho ?? []).length === 0) continue;
    // Sin reparto todavía (la pregunta esperaba turno), en modo `encabezado` se nombra por sus cajas y se
    // cuentan los mensajes que irían al resumen (sin encabezados ni acuses).
    const parte = !e.plan_viajes && p.bandeja.modoViajes === 'encabezado'
      ? await nombreYConteoDeLaTanda(supabase, e.id as string, p.workspaceId, p.bandeja.horasCajaActiva)
      : { nombre: nombreDeLaEntrega((e.plan_viajes ?? null) as PlanViajes | null, (e.created_at as string | null) ?? null), n: mensajesDeLaEntrega(e) };
    partes.push(parte);
    await guardarEn(e.id, 'respuesta_cliente', e.remitente_staff_id, e.remitente_colaborador_id);
  }
  return partes;
}

// ── Preguntas al bot dentro de la bandeja (solo lectura) ─────────────────────

/**
 * Lo que el bot contesta a una pregunta escrita sobre la bandeja (`leerConsultaBandeja`): los viajes abiertos de un
 * cliente, cómo va o qué le falta a un viaje, o qué lleva la tanda abierta. SOLO LECTURA: no registra el mensaje,
 * no crea, no mueve ni cierra nada. «tiene», «ese cliente» son el cliente de la tanda abierta.
 */
export async function textoDeLaConsulta(
  supabase: SupabaseClient, workspaceId: string, phone: string, consulta: ConsultaBandeja, bandeja: ConfigBandeja,
): Promise<string> {
  const tanda = await tandaAbiertaDelRemitente(supabase, workspaceId, phone, bandeja.horasCajaActiva);
  if (consulta.tipo === 'tanda') {
    if (!tanda) {
      // Noveno control (hallazgo 7): la tanda ya se cerró y su resumen espera: se cuentan sus mensajes.
      const abierta = await preguntaAbierta(supabase, workspaceId, phone);
      const entregaId = abierta?.espera === 'resumen' ? (abierta.tipo === 'entrega' ? abierta.id : abierta.entregaId ?? null) : null;
      if (abierta && entregaId) {
        const { data: e } = await supabase.from('wa_bandeja_entregas').select('plan_viajes').eq('id', entregaId).maybeSingle();
        const plan = (e?.plan_viajes ?? null) as PlanViajes | null;
        const n = plan ? plan.mensajes.filter(m => !m.descartado).length : 0;
        return textoTandaEnResumen({ nombre: abierta.nombre, n });
      }
      return TEXTO_SIN_TANDA;
    }
    return textoTanda({ nombre: tanda.nombre, n: tanda.n, cierre: bandeja.palabrasCierre[0] ?? 'listo' });
  }
  if (consulta.tipo === 'viajes') {
    // Sin nombre: el cliente de la tanda abierta, o el del viaje en foco (conversación con memoria, 2026-10-05).
    const dicho = consulta.cliente ?? tanda?.cajaCliente ?? await clienteDelFoco(supabase, workspaceId, phone, bandeja);
    if (!dicho) return TEXTO_CONSULTA_DE_QUIEN;
    // Noveno control (hallazgo 2): el cliente es el contacto que el escrito nombra exacto, por la parte que coincide con
    // el directorio («qué tiene abierto ahorita Ana Ruiz» → Ana Ruiz). Sin eso, solo un parecido de lo dicho entero.
    const dir = await directorioPara(supabase, workspaceId, { nombres: [dicho], llaves: [] });
    const leido = nombreEnElDirectorio(dicho, dir);
    const quien = leido.nombre;
    const fichas = dir.porNombre(quien);
    if (fichas === null) return 'No pude revisar el directorio de clientes. Pregúntame otra vez en un momento.';
    const exactos = (fichas ?? []).filter(f => normalizarNombre(f.nombre) === normalizarNombre(quien));
    const usadas = exactos.length > 0 ? exactos : leido.dudoso ? [] : (fichas ?? []).filter(f => pareceNombre(quien, f.nombre)).slice(0, 1);
    // Nunca «no lo tengo» con un nombre que no se pudo aislar: se pregunta de qué cliente.
    if (usadas.length === 0) return TEXTO_CONSULTA_DE_QUIEN;
    return usadas.map(f => textoViajesDelCliente({
      cliente: nombrePropio(f.nombre) + (usadas.length > 1 ? ` (${datoDeLaFicha(f)})` : ''),
      viajes: f.abiertos.map(v => ({ linea: nombreDeViaje({ nombre: v.nombre, codigo: v.codigo }) })),
      cerrado: f.cerrado ? nombreDeViaje({ nombre: f.cerrado.nombre, codigo: f.cerrado.codigo }) : null,
    })).join('\n');
  }
  // Cómo va o qué le falta a un viaje: el que nombra (código o cliente/nombre del viaje), o el de la tanda.
  let negocioId: string | null = null;
  if (consulta.ref) {
    const cod = codigoCompacto(consulta.ref);
    negocioId = /\d/.test(cod) ? await negocioAbiertoPorCodigo(supabase, workspaceId, cod) : null;
    if (!negocioId) {
      const viajes = (await viajesAbiertosDeLaBandeja(supabase, workspaceId)) ?? [];
      const r = resolverEncabezado(consulta.ref, viajes);
      if (r?.tipo === 'viaje') negocioId = r.viaje.id;
      else if (r?.tipo === 'aproximado') negocioId = r.viaje.id; // solo lectura: con un solo candidato, ese
      else if (r?.tipo === 'ambiguo') {
        const cands = r.candidatos;
        return textoConsultaAmbigua(consulta.ref, cands.slice(0, 5).map(v => ({ linea: nombreDeViaje(v), cliente: v.cliente, destino: v.destino, nombre: v.nombre })));
      }
    }
    if (!negocioId) return `No encontré un viaje abierto de «${consulta.ref}». ${TEXTO_CONSULTA_DE_QUE_VIAJE}`;
  } else if (tanda?.cajaViajeId) {
    negocioId = tanda.cajaViajeId;
  } else if (tanda?.cajaCliente) {
    return `El viaje nuevo de ${nombrePropio(tanda.cajaCliente)} todavía no está creado: lo creo cuando me digas que sí en el resumen. Llevas ${tanda.n} ${tanda.n === 1 ? 'mensaje' : 'mensajes'}.`;
  } else {
    // Conversación con memoria (2026-10-05, punto 1): sin referencia, el viaje en foco. Con dos en la ventana, se
    // pregunta una vez nombrando los dos; sin ninguno, «¿De qué viaje?». En los dos casos la pregunta queda pendiente:
    // el escrito que nombre el viaje la contesta con el mismo alcance.
    const conv = await leerConversacion(supabase, workspaceId, phone);
    const f = viajeEnFoco(conv.focos, Date.now(), bandeja.minutosFoco);
    if (f.tipo === 'uno') negocioId = f.foco.negocio_id;
    else {
      await anotarConsultaPendiente(supabase, workspaceId, phone, {
        tipo: 'viaje', ...(consulta.alcance ? { alcance: consulta.alcance } : {}), at: new Date().toISOString(),
        ...(f.tipo === 'dos' ? { candidatos: f.focos.map(x => x.negocio_id) } : {}),
      });
      if (f.tipo === 'ninguno') return TEXTO_CONSULTA_DE_QUE_VIAJE;
      const dos = await viajesPorId(supabase, workspaceId, f.focos.map(x => x.negocio_id));
      return textoConsultaAmbigua('Lo que preguntas', dos.map(v => ({ linea: nombreDeViaje(v), cliente: v.cliente, destino: v.destino, nombre: v.nombre })));
    }
  }
  const { data: neg } = await supabase.from('negocios').select('id, codigo, nombre, contactos(nombre), empresas(nombre)').eq('id', negocioId).maybeSingle();
  const bloques = await bloquesDatosDelNegocio(supabase, negocioId);
  if (!neg || typeof bloques === 'string') return 'No pude leer ese viaje. Pregúntame otra vez en un momento.';
  const fields = bloques.flatMap(b => b.fields);
  const valores = Object.assign({}, ...bloques.map(b => b.data)) as Record<string, unknown>;
  const avance = lineaAvance({
    codigo: (neg.codigo as string | null) ?? null, cliente: nombreRel(neg.contactos) ?? nombreRel(neg.empresas), nombre: (neg.nombre as string | null) ?? null, fields, valores,
  });
  // Lo que se pregunta (punto 3): «para completo» lista lo de completo (mínimo y deseable, sin lo que llena la agencia,
  // como la barra «Completo»); «para cotizar», lo del mínimo; «cómo va», los dos.
  const sinAgencia = huecos(fields.filter(f => f.lo_llena !== LO_LLENA_AGENCIA), valores);
  await anotarFoco(supabase, workspaceId, phone, { negocio_id: negocioId, por: 'consulta' });
  return textoEstadoViaje({
    avance, alcance: consulta.alcance,
    faltan: huecos(fields, valores).minimo.faltan.map(f => f.label.toLowerCase()),
    faltanCompleto: [...sinAgencia.minimo.faltan, ...sinAgencia.deseable.faltan].map(f => f.label.toLowerCase()),
  });
}

/**
 * La respuesta a «me falta» para el viaje en foco (2026-10-06, decisión de Mauricio tras el undécimo control de Vera): el
 * foco solo SUGIERE el viaje y nunca carga solo. El escrito queda en una entrega propia, ya repartida a ese viaje y con
 * su resumen corto enviado (`esperando_cliente`): se carga con el toque de «Cargar» o con un «sí» a ESE resumen, como
 * cualquier tanda (la confirmación queda atada a la entrega y a la huella del reparto, #1034); «Descartar» la descarta.
 * Antes (#1033) nacía con el «sí» ya puesto y se cargaba en el acto: el undécimo control encontró 4 dañinas vivas así.
 * `null`: no se pudo (sigue el camino de hoy).
 */
export async function proponerDatoEnElViaje(
  supabase: SupabaseClient,
  p: { workspaceId: string; phone: string; staffId: string | null; colaboradorId: string | null; wamid: string; cuerpo: string; enviadoAt: string | null; negocioId: string },
): Promise<{ entregaId: string; plan: PlanViajes; nombre: string } | null> {
  const [v] = await viajesPorId(supabase, p.workspaceId, [p.negocioId]);
  if (!v) return null;
  const ahora = new Date().toISOString();
  const plan: PlanViajes = {
    version: 2,
    mensajes: [{ n: 1, destino: { tipo: 'existente', negocio_id: v.id, codigo: v.codigo, cliente: v.cliente, nombre: v.nombre ?? null }, por: 'comercial' }],
    encabezados: [],
    avisos: [],
  };
  const { data: e, error } = await supabase.from('wa_bandeja_entregas').insert({
    workspace_id: p.workspaceId, remitente_phone: p.phone, remitente_staff_id: p.staffId, remitente_colaborador_id: p.colaboradorId,
    estado: 'esperando_cliente', abierta_at: ahora, ultimo_mensaje_at: ahora, n_mensajes: 1, cerrada_at: ahora, motivo_cierre: 'respuesta_a_lo_que_falta',
    pregunta_enviada_at: ahora, plan_viajes: plan,
  }).select('id').single();
  if (error || !e) {
    console.error('[wa-entendimiento] no se pudo crear la entrega del dato:', error?.message);
    return null;
  }
  const { error: eM } = await supabase.from('wa_bandeja_mensajes').insert({
    workspace_id: p.workspaceId, entrega_id: e.id, wa_message_id: p.wamid, remitente_phone: p.phone, remitente_staff_id: p.staffId,
    remitente_colaborador_id: p.colaboradorId, tipo: 'text', papel: 'contenido', cuerpo: p.cuerpo, cuerpo_origen: 'texto', reenviado: false, enviado_at: p.enviadoAt,
  });
  if (eM) {
    // Meta reintentó el mismo mensaje: ya se tomó. La entrega nueva queda sin pregunta (no se muestra ni se carga).
    console.error('[wa-entendimiento] no se pudo guardar el dato:', eM.message);
    await supabase.from('wa_bandeja_entregas').update({ pregunta_enviada_at: null, pregunta_error: 'dato duplicado' }).eq('id', e.id);
    return null;
  }
  return { entregaId: e.id as string, plan, nombre: nombreDeViaje(v) };
}

/** Agrega otro dato a la entrega del resumen corto que espera el «sí» y la deja lista para volver a mostrarse. */
export async function agregarDatoAlResumenCorto(
  supabase: SupabaseClient,
  p: { workspaceId: string; phone: string; staffId: string | null; colaboradorId: string | null; wamid: string; cuerpo: string; enviadoAt: string | null; entregaId: string },
): Promise<{ plan: PlanViajes; nombre: string; cuerpos: string[] } | null> {
  const { data: e } = await supabase.from('wa_bandeja_entregas').select('id, plan_viajes, n_mensajes').eq('id', p.entregaId).eq('estado', 'esperando_cliente').maybeSingle();
  const plan = (e?.plan_viajes ?? null) as PlanViajes | null;
  const d = plan?.mensajes[0]?.destino;
  if (!e || !plan || !d || d.tipo !== 'existente') return null;
  const { error: eM } = await supabase.from('wa_bandeja_mensajes').insert({
    workspace_id: p.workspaceId, entrega_id: e.id, wa_message_id: p.wamid, remitente_phone: p.phone, remitente_staff_id: p.staffId,
    remitente_colaborador_id: p.colaboradorId, tipo: 'text', papel: 'contenido', cuerpo: p.cuerpo, cuerpo_origen: 'texto', reenviado: false, enviado_at: p.enviadoAt,
  });
  if (eM) {
    console.error('[wa-entendimiento] no se pudo agregar el dato:', eM.message);
    return null;
  }
  const n = Math.max(0, ...plan.mensajes.map(m => m.n)) + 1;
  const nuevo: PlanViajes = { ...plan, mensajes: [...plan.mensajes, { n, destino: d, por: 'comercial' }] };
  const ahora = new Date().toISOString();
  await supabase.from('wa_bandeja_entregas').update({ plan_viajes: nuevo, n_mensajes: n, ultimo_mensaje_at: ahora, pregunta_enviada_at: ahora }).eq('id', e.id);
  const { data: ms } = await supabase.from('wa_bandeja_mensajes').select('cuerpo, recibido_at').eq('entrega_id', e.id).order('recibido_at', { ascending: true });
  const [v] = await viajesPorId(supabase, p.workspaceId, [d.negocio_id]);
  return { plan: nuevo, nombre: v ? nombreDeViaje(v) : nombreDeViaje({ nombre: d.nombre ?? null, cliente: d.cliente, codigo: d.codigo }), cuerpos: ((ms ?? []) as Array<{ cuerpo: string }>).map(x => String(x.cuerpo ?? '')) };
}

/** El viaje de un id, como lo nombra la bandeja («D1 26 1 · Diego Torres»). */
export async function nombreDelViajeDeId(supabase: SupabaseClient, workspaceId: string, negocioId: string): Promise<string | null> {
  const [v] = await viajesPorId(supabase, workspaceId, [negocioId]);
  return v ? nombreDeViaje(v) : null;
}

/** El cliente del viaje en foco, si hay uno solo en la ventana. */
async function clienteDelFoco(supabase: SupabaseClient, workspaceId: string, phone: string, bandeja: ConfigBandeja): Promise<string | null> {
  const f = viajeEnFoco((await leerConversacion(supabase, workspaceId, phone)).focos, Date.now(), bandeja.minutosFoco);
  if (f.tipo !== 'uno') return null;
  const [v] = await viajesPorId(supabase, workspaceId, [f.foco.negocio_id]);
  return v?.cliente ? nombrePropio(v.cliente) : null;
}

/** Los viajes de unos ids, como los ve la bandeja (código, cliente, destino, nombre). */
async function viajesPorId(supabase: SupabaseClient, workspaceId: string, ids: string[]): Promise<ViajeAbierto[]> {
  const todos = (await viajesAbiertosDeLaBandeja(supabase, workspaceId)) ?? [];
  return ids.map(id => todos.find(v => v.id === id)).filter((v): v is ViajeAbierto => !!v);
}
