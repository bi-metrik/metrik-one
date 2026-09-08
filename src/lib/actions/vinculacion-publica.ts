'use server';

/**
 * El formulario que llena la contraparte. Sin sesión: la credencial es el token
 * del enlace, y por eso todo lo que sale de acá es exactamente lo que Valida ya
 * expone en sus rutas públicas, ni un campo más.
 *
 * Lo único que ONE agrega es la marca: el logo y los datos de la empresa que
 * invita. Sin eso la contraparte recibe un enlace de una plataforma que no
 * conoce pidiéndole la cédula del representante legal, que es exactamente la
 * forma de un fraude. La marca no es decoración, es lo que hace que el correo
 * sea creíble.
 *
 * ── De dónde sale la marca ────────────────────────────────────────────────
 *
 * Del `workspace_one_id` que devuelve el propio expediente, NO del subdominio
 * por el que entró la contraparte. Si saliera del subdominio, un token válido
 * se podría abrir bajo la marca de cualquier otro cliente.
 */

import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';
import {
  CADENA_VACIA,
  VERSION_TEXTO,
  esMotivoEnlaceCerrado,
  estaFirmado,
  faltaAceptar,
  mensajeErrorFirma,
  otpCompleto,
  pasoActual,
  type LecturaDoc,
  porcentajeANumero,
  type CadenaPublica,
  type DeclaracionRegistrada,
  type FormSocio,
  type MotivoEnlaceCerrado,
  type PasoPublico,
  type Socio,
} from '@/lib/compliance/vinculacion-publica';
import {
  esMotivoEnlaceSolicitud,
  faltaEnSolicitud,
  mensajeErrorSolicitud,
  normalizarDocumento,
  type DatosSolicitud,
  type MotivoEnlaceSolicitud,
} from '@/lib/compliance/solicitud-vinculacion';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

// ─── Formas ───────────────────────────────────────────────────────────────

export type MarcaInvitante = {
  nombre: string;
  logoUrl: string | null;
  colorPrimario: string | null;
  razonSocial: string | null;
  nit: string | null;
  direccion: string | null;
  ciudad: string | null;
  telefono: string | null;
  correo: string | null;
};

export type SlotPedido = { slot: string; cargado: boolean };

export type DocumentoPublico = {
  doc_id?: string | null;
  slot: string;
  persona_id?: string | null;
  estado_extraccion: string | null;
  subido_en: string | null;
};

export type CampoPublico = {
  slug: string;
  value: unknown;
  origen: string;
  confirmado: boolean;
  requiere_confirmacion: boolean;
};

export type VistaPublica = {
  expedienteId: string;
  estado: string;
  tokenExpiraEn: string | null;
  sujeto: { tipo: 'natural' | 'juridica'; razon_social: string | null; nombre: string | null };
  kit: SlotPedido[];
  documentos: DocumentoPublico[];
  campos: CampoPublico[];
  declaraciones: DeclaracionRegistrada[];
  marca: MarcaInvitante;
  paso: PasoPublico;
  falta: string[];
  /** A una persona natural no se le pregunta por socios. */
  pideCadena: boolean;
  socios: Socio[];
  cadena: CadenaPublica;
};

// ─── Llamada a las rutas públicas de Valida ───────────────────────────────

async function publico<T>(ruta: string, init?: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(`${VALIDA_API_BASE}${ruta}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `http_${res.status}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: 'valida_no_responde' };
  }
}

/**
 * El token va en la ruta, así que se codifica siempre. Un token con `/` o `..`
 * sin codificar podría apuntar a otra ruta de la API.
 */
function ruta(token: string, sufijo = ''): string {
  return `/api/public/kyc/${encodeURIComponent(token)}${sufijo}`;
}

// ─── La marca de quien invita ─────────────────────────────────────────────

/**
 * Los datos de empresa pueden estar vacíos: el perfil fiscal del workspace es
 * opcional. Lo que falta se devuelve como null y la pantalla no lo pinta. Un
 * rótulo "NIT:" sin número al lado se lee como plataforma rota, y esta página
 * la ve alguien que todavía no confía en nosotros.
 */
async function marcaDelWorkspace(workspaceId: string | null): Promise<MarcaInvitante> {
  const vacia: MarcaInvitante = {
    nombre: 'la empresa que te invitó',
    logoUrl: null,
    colorPrimario: null,
    razonSocial: null,
    nit: null,
    direccion: null,
    ciudad: null,
    telefono: null,
    correo: null,
  };
  if (!workspaceId) return vacia;

  const svc = createServiceClient();
  const [ws, fiscal] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from('workspaces') as any)
      .select('name, logo_url, color_primario')
      .eq('id', workspaceId)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc.from('fiscal_profiles') as any)
      .select('nit, razon_social, direccion_fiscal, municipio, telefono, email_fiscal')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),
  ]);

  const w = ws.data as Record<string, string | null> | null;
  const f = fiscal.data as Record<string, string | null> | null;
  const limpio = (v: string | null | undefined) => {
    const s = (v ?? '').trim();
    return s.length > 0 ? s : null;
  };

  return {
    nombre: limpio(f?.razon_social) ?? limpio(w?.name) ?? vacia.nombre,
    logoUrl: limpio(w?.logo_url),
    colorPrimario: limpio(w?.color_primario),
    razonSocial: limpio(f?.razon_social),
    nit: limpio(f?.nit),
    direccion: limpio(f?.direccion_fiscal),
    ciudad: limpio(f?.municipio),
    telefono: limpio(f?.telefono),
    correo: limpio(f?.email_fiscal),
  };
}

// ─── Abrir el enlace ──────────────────────────────────────────────────────

type PayloadValida = {
  expediente_id: string;
  workspace_one_id: string | null;
  estado: string;
  etapa_actual: string;
  token_expira_en: string | null;
  sujeto: { tipo: 'natural' | 'juridica'; razon_social: string | null; nombre: string | null };
  kit_requerido: SlotPedido[];
  documentos: DocumentoPublico[];
  socios?: Socio[];
  cadena?: CadenaPublica;
};

export async function abrirVinculacion(
  token: string,
): Promise<Result<VistaPublica> & { motivo?: MotivoEnlaceCerrado }> {
  const base = await publico<PayloadValida>(ruta(token));
  if (!base.ok) {
    return esMotivoEnlaceCerrado(base.error)
      ? { ok: false, error: base.error, motivo: base.error }
      : { ok: false, error: base.error };
  }

  const [decl, campos, marca] = await Promise.all([
    publico<{ declaraciones: DeclaracionRegistrada[] }>(ruta(token, '/declaraciones')),
    publico<{ campos: CampoPublico[] }>(ruta(token, '/campos')),
    marcaDelWorkspace(base.data.workspace_one_id),
  ]);

  // Si no se pueden leer las declaraciones NO se asume que no hay ninguna: eso
  // volvería a pedir una autorización ya dada, y peor, dejaría avanzar a quien
  // no la dio si el error fuera al revés. Se falla a la vista.
  if (!decl.ok) return { ok: false, error: decl.error };
  if (!campos.ok) return { ok: false, error: campos.error };

  const declaraciones = decl.data.declaraciones ?? [];
  const listaCampos = campos.data.campos ?? [];
  const kit = base.data.kit_requerido ?? [];
  const falta = faltaAceptar(declaraciones);
  const pideCadena = base.data.sujeto.tipo === 'juridica';
  const cadena = base.data.cadena ?? CADENA_VACIA;

  return {
    ok: true,
    data: {
      expedienteId: base.data.expediente_id,
      estado: base.data.estado,
      tokenExpiraEn: base.data.token_expira_en,
      sujeto: base.data.sujeto,
      kit,
      documentos: base.data.documentos ?? [],
      campos: listaCampos,
      declaraciones,
      marca,
      paso: pasoActual({
        acepto: falta.length === 0,
        slotsFaltantes: kit.filter((s) => !s.cargado).length,
        // Una cadena incompleta detiene el paso, pero nunca deja sin salida:
        // toda rama que no se pueda bajar se cierra declarando por qué.
        cadenaPendiente: pideCadena && !cadena.completa ? cadena.pendientes.length || 1 : 0,
        camposPorConfirmar: listaCampos.filter((c) => c.requiere_confirmacion && !c.confirmado)
          .length,
        firmado: estaFirmado(base.data.estado),
      }),
      falta,
      pideCadena,
      socios: base.data.socios ?? [],
      cadena,
    },
  };
}

// ─── El portón ────────────────────────────────────────────────────────────

/**
 * Se guardan las dos aceptaciones con su versión. La versión es la prueba: sin
 * ella el expediente solo puede decir que la contraparte aceptó algo.
 */
export async function aceptarCondiciones(token: string): Promise<Result<{ aceptadas: number }>> {
  const r = await publico<{ ok: true; actualizadas: number }>(ruta(token, '/declaraciones'), {
    method: 'PATCH',
    body: JSON.stringify({
      declaraciones: [
        { tipo: 'nda', aceptada: true, texto_version: VERSION_TEXTO.nda },
        {
          tipo: 'autorizacion_datos',
          aceptada: true,
          texto_version: VERSION_TEXTO.autorizacion_datos,
        },
      ],
    }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { aceptadas: r.data.actualizadas } };
}

// ─── Documentos ───────────────────────────────────────────────────────────

/**
 * Registra el documento y devuelve la URL firmada. El binario lo sube el
 * navegador directo al almacenamiento de Valida: si pasara por acá, un archivo
 * de 10 MB chocaría contra el tope de cuerpo de la función serverless.
 */
export async function pedirUrlDeSubida(
  token: string,
  input: { slot: string; mime: string; size: number; personaId?: string | null },
): Promise<
  Result<{ docId: string; uploadUrl: string; uploadToken: string; reemplazoDe: string | null }>
> {
  if (!input.slot) return { ok: false, error: 'slot_requerido' };

  const r = await publico<{
    doc_id: string;
    upload_url: string;
    upload_token: string;
    reemplazo_de: string | null;
  }>(ruta(token, '/docs'), {
    method: 'POST',
    body: JSON.stringify({
      slot: input.slot,
      mime: input.mime,
      size_bytes: input.size,
      // El soporte de un socio no es un casillero del expediente: cuelga de la
      // persona. Valida rechaza la combinación al revés.
      persona_id: input.personaId ?? null,
    }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    data: {
      docId: r.data.doc_id,
      uploadUrl: r.data.upload_url,
      uploadToken: r.data.upload_token,
      // Valida deja el anterior marcado como reemplazado y este pasa a ser el
      // que vale. La pantalla lo dice: un reemplazo silencioso deja a la
      // persona sin saber cuál de los dos quedó.
      reemplazoDe: r.data.reemplazo_de ?? null,
    },
  };
}

/**
 * Pide que el documento se lea AHORA, con la contraparte todavía en la
 * pantalla. No es por velocidad: es para que pueda ver que subió el que era.
 *
 * Valida corta su propia espera y responde 202 `en_proceso` si el modelo se
 * demora; la extracción sigue corriendo del otro lado. Acá eso NO es error: se
 * devuelve como un estado más, porque decirle "falló" a alguien cuyo documento
 * sí entró lo manda a subirlo otra vez sin necesidad.
 */
export async function leerDocumento(
  token: string,
  docId: string,
): Promise<Result<LecturaDoc>> {
  if (!docId) return { ok: false, error: 'doc_requerido' };

  const r = await publico<{
    estado: string;
    doc_type_match: boolean | null;
    doc_type_detected: string | null;
    campos: { slug: string; value: unknown }[];
  }>(ruta(token, `/docs/${encodeURIComponent(docId)}/leer`), { method: 'POST' });

  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    data: {
      estado: r.data.estado ?? 'pendiente',
      doc_type_match: r.data.doc_type_match ?? null,
      doc_type_detected: r.data.doc_type_detected ?? null,
      campos: r.data.campos ?? [],
    },
  };
}

// ─── Socios ─────────────────────────────────────────────────────────

type RespuestaCadena = { socios?: Socio[]; cadena?: CadenaPublica };

/**
 * Declara o corrige un socio. Devuelve la cadena entera y no solo el socio
 * guardado: corregir un porcentaje arriba cambia la participación efectiva de
 * todo lo que cuelga debajo, y repintar una fila dejaría los demás números
 * diciendo lo de antes.
 */
export async function guardarSocio(
  token: string,
  input: {
    personaId?: string | null;
    padrePersonaId?: string | null;
    form: FormSocio;
  },
): Promise<Result<{ socios: Socio[]; cadena: CadenaPublica }>> {
  const f = input.form;
  const nombre = f.nombre.trim();
  if (!nombre) return { ok: false, error: 'nombre_requerido' };

  const r = await publico<RespuestaCadena>(ruta(token, '/personas'), {
    method: 'POST',
    body: JSON.stringify({
      persona_id: input.personaId ?? null,
      padre_persona_id: input.padrePersonaId ?? null,
      rol: 'socio',
      tipo_sujeto: f.tipoSujeto,
      nombre,
      documento_tipo: f.tipoSujeto === 'juridica' ? 'NIT' : f.documentoTipo,
      documento_numero: f.documentoNumero.trim() || null,
      porcentaje_participacion: porcentajeANumero(f.porcentaje),
      motivo_parada: f.motivoParada || null,
      parada_justificacion: f.motivoParada ? f.justificacion.trim() : null,
    }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    data: { socios: r.data.socios ?? [], cadena: r.data.cadena ?? CADENA_VACIA },
  };
}

/**
 * Retira un socio. Del otro lado se va con toda su rama y con los soportes que
 * se le hubieran subido: dejar los hijos colgando de un padre que ya no existe
 * es dejarlos fuera de la pantalla y dentro de la aritmética.
 */
export async function retirarSocio(
  token: string,
  personaId: string,
): Promise<Result<{ socios: Socio[]; cadena: CadenaPublica }>> {
  if (!personaId) return { ok: false, error: 'persona_requerida' };
  const r = await publico<RespuestaCadena>(
    ruta(token, `/personas/${encodeURIComponent(personaId)}`),
    { method: 'DELETE' },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    data: { socios: r.data.socios ?? [], cadena: r.data.cadena ?? CADENA_VACIA },
  };
}

// ─── Datos ────────────────────────────────────────────────────────────────

export async function confirmarCampos(
  token: string,
  campos: { slug: string; value?: unknown; confirmado?: boolean }[],
): Promise<Result<{ actualizados: number }>> {
  if (campos.length === 0) return { ok: false, error: 'campos_requeridos' };
  const r = await publico<{ ok: true; actualizados: number }>(ruta(token, '/campos'), {
    method: 'PATCH',
    body: JSON.stringify({ campos }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { actualizados: r.data.actualizados } };
}

// ─── La firma ─────────────────────────────────────────────────────────────

/**
 * Pide el código. Valida lo genera, lo guarda hasheado y lo manda al correo de
 * la contraparte; acá nunca pasa por el navegador ni por este proceso. Lo único
 * que vuelve es a qué dirección salió, enmascarada.
 */
export async function pedirCodigoDeFirma(
  token: string,
  datos: { nombre?: string; documento?: string } = {},
): Promise<
  { ok: true; data: { enviadoA: string; expiraEn: string } } | { ok: false; error: string }
> {
  const r = await publico<{
    ok: true;
    expira_en: string;
    enviado_a: string;
    error?: string;
    esperar_segundos?: number | null;
  }>(ruta(token, '/firma'), {
    method: 'POST',
    body: JSON.stringify({
      firmante_nombre: datos.nombre?.trim() || null,
      firmante_documento: datos.documento?.trim() || null,
    }),
  });

  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { enviadoA: r.data.enviado_a, expiraEn: r.data.expira_en } };
}

/**
 * Verifica el código y sella la firma. Del otro lado, Valida aplica el gate de
 * Lucía (no se firma con campos sin confirmar), calcula el hash de integridad
 * del expediente y lo pasa a revisión del oficial.
 */
export async function firmarConCodigo(
  token: string,
  otp: string,
): Promise<{ ok: true; data: { hash: string } } | { ok: false; error: string }> {
  if (!otpCompleto(otp)) return { ok: false, error: 'otp_incompleto' };

  const r = await publico<{ ok: true; firmado: boolean; hash_documento_firmado: string }>(
    ruta(token, '/firma/verificar'),
    { method: 'POST', body: JSON.stringify({ otp }) },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: { hash: r.data.hash_documento_firmado } };
}

/** Traduce a frase lo que devuelven las dos rutas de firma. */
export async function traducirErrorFirma(
  codigo: string,
  esperarSegundos?: number | null,
): Promise<string> {
  if (codigo === 'otp_incompleto') return 'Escribe los seis dígitos del código.';
  if (codigo === 'valida_no_responde') {
    return 'No pudimos conectar. Vuelve a intentar en un momento.';
  }
  return mensajeErrorFirma(codigo, esperarSegundos);
}

// ─── Mensajes ─────────────────────────────────────────────────────────────

export async function traducirErrorPublico(error: string): Promise<string> {
  switch (error) {
    case 'valida_no_responde':
      return 'No pudimos conectar. Vuelve a intentar en un momento.';
    case 'registro_doc_error':
      return 'No se pudo registrar el documento. Revisa que sea uno de los que se piden.';
    case 'slot_requerido':
      return 'Falta indicar qué documento estás subiendo.';
    case 'nombre_requerido':
      return 'Escribe el nombre del socio.';
    case 'porcentaje_invalido':
    case 'porcentaje_fuera_de_rango':
      return 'El porcentaje tiene que ser un número entre 0 y 100.';
    case 'justificacion_requerida':
      return 'Falta explicar por qué no se puede seguir bajando por ese socio.';
    case 'ciclo_en_cadena':
      return 'Un socio no puede colgar de su propia rama.';
    case 'padre_no_encontrado':
    case 'persona_no_encontrada':
      return 'Ese socio ya no está. Recarga la página para ver la lista al día.';
    default:
      return 'Algo salió mal. Vuelve a intentar, y si sigue igual escríbele a quien te envió el enlace.';
  }
}

// ─── El mostrador de solicitudes ──────────────────────────────────────────

/**
 * La pantalla donde un proveedor pide vincularse, antes de que exista
 * expediente. No tiene token de expediente porque todavía no hay expediente: la
 * credencial es el token del enlace de la empresa.
 *
 * Lo único que se resuelve acá es la marca, y por la misma razón de siempre:
 * quien llega a esta página está a punto de dejar su documento y su correo en
 * un sitio que no conoce. Si no ve de quién es, no hay razón para que confíe.
 */
export type VistaSolicitud = { marca: MarcaInvitante };

function rutaSolicitud(token: string, sufijo = ''): string {
  return `/api/public/kyc/solicitud/${encodeURIComponent(token)}${sufijo}`;
}

export async function abrirSolicitud(
  token: string,
): Promise<Result<VistaSolicitud> & { motivo?: MotivoEnlaceSolicitud }> {
  const base = await publico<{ workspace_one_id: string | null }>(rutaSolicitud(token));
  if (!base.ok) {
    return esMotivoEnlaceSolicitud(base.error)
      ? { ok: false, error: base.error, motivo: base.error }
      : { ok: false, error: base.error };
  }
  return { ok: true, data: { marca: await marcaDelWorkspace(base.data.workspace_one_id) } };
}

/**
 * Manda la solicitud. La respuesta de Valida es muda a propósito: no dice si
 * creó el expediente o si reenvió el enlace de uno que ya existía. Acá tampoco
 * se intenta averiguarlo, porque distinguirlo convertiría la pantalla en un
 * oráculo para saber quién es proveedor de quién.
 */
export async function enviarSolicitud(
  token: string,
  datos: DatosSolicitud,
): Promise<Result<null>> {
  const falta = faltaEnSolicitud(datos);
  if (falta.length > 0) return { ok: false, error: 'datos_invalidos' };

  // El host lo pone ONE, no el navegador: si viniera del cliente, cualquiera
  // podría pedirle a Valida que mande un correo con la marca de la empresa y un
  // enlace a un sitio suyo.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  const r = await publico<{ ok: boolean }>(rutaSolicitud(token), {
    method: 'POST',
    body: JSON.stringify({
      tipo_sujeto: datos.tipoSujeto,
      razon_social: datos.tipoSujeto === 'juridica' ? datos.denominacion.trim() : null,
      nombre: datos.tipoSujeto === 'natural' ? datos.denominacion.trim() : null,
      documento_tipo: datos.tipoDocumento,
      documento_numero: normalizarDocumento(datos.documento),
      email: datos.correo.trim().toLowerCase(),
      enlace_base: `${proto}://${host}`,
    }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, data: null };
}

export async function traducirErrorSolicitud(codigo: string): Promise<string> {
  return mensajeErrorSolicitud(codigo);
}
