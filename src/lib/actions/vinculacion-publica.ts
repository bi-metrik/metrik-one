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

import { createServiceClient } from '@/lib/supabase/server';
import {
  VERSION_TEXTO,
  esMotivoEnlaceCerrado,
  estaFirmado,
  faltaAceptar,
  mensajeErrorFirma,
  otpCompleto,
  pasoActual,
  type DeclaracionRegistrada,
  type MotivoEnlaceCerrado,
  type PasoPublico,
} from '@/lib/compliance/vinculacion-publica';

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
  slot: string;
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
        camposPorConfirmar: listaCampos.filter((c) => c.requiere_confirmacion && !c.confirmado)
          .length,
        firmado: estaFirmado(base.data.estado),
      }),
      falta,
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
  input: { slot: string; mime: string; size: number },
): Promise<Result<{ docId: string; uploadUrl: string; uploadToken: string }>> {
  if (!input.slot) return { ok: false, error: 'slot_requerido' };

  const r = await publico<{ doc_id: string; upload_url: string; upload_token: string }>(
    ruta(token, '/docs'),
    {
      method: 'POST',
      body: JSON.stringify({ slot: input.slot, mime: input.mime, size_bytes: input.size }),
    },
  );
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    data: { docId: r.data.doc_id, uploadUrl: r.data.upload_url, uploadToken: r.data.upload_token },
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
    default:
      return 'Algo salió mal. Vuelve a intentar, y si sigue igual escríbele a quien te envió el enlace.';
  }
}
