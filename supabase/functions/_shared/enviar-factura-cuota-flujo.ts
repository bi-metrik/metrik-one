// ============================================================
// enviar-factura-cuota — el flujo de un envío, contra puertos
// ------------------------------------------------------------
// La edge function `enviar-factura-cuota` lee y escribe la base, Storage y Resend; las DECISIONES
// viven aquí, y vitest las ejercita con puertos falsos. Las reglas de la campana están en
// `aviso-factura-cuota.ts`; las del correo, en `correo-factura-cuota.ts`.
//
// Por cada fila de `envios_factura_cuota`, idempotente:
//
//   1. Tomar la fila (candado de 5 min). Ya enviada, omitida, agotada o tomada por otra llamada:
//      no se hace nada.
//   2. Si la factura cambió desde que se encoló, esta fila queda `omitido` (`reemplazada`): la
//      fila del contenido nuevo es la que manda.
//   3. Campana PRIMERO, una sola vez (`aviso_campana_at`). Si falla, no se manda el correo en ese
//      intento: así una fila con correo enviado siempre tiene la campana resuelta, y el job de
//      reintentos solo mira filas sin correo.
//   4. Correo, solo con PDF y XML. Con uno solo: `omitido` (`sin_pdf` / `sin_xml`).
//   5. Falla: `intentos + 1`, `ultimo_error`, `fallido`. Al tercer fallo, aviso interno al equipo.
// ============================================================

import {
  destinatariosAvisoFactura,
  elegirContrato,
  type ContratoAviso,
} from './aviso-factura-cuota.ts';
import {
  CORREO_RESPUESTA_FACTURA,
  correoFactura,
  decidirCorreo,
  destinosCorreoFactura,
  nombreAdjunto,
  textoDestinos,
} from './correo-factura-cuota.ts';
import { FROM_FACTURACION } from './remitente-facturacion.ts';

export const MAX_INTENTOS = 3;
/** Cuánto dura el candado de una llamada sobre la fila. */
export const CANDADO_MS = 5 * 60 * 1000;

export interface EnvioFila {
  id: string;
  workspace_id: string;
  factura_cuota_id: string;
  plan_cobro_cuota_id: string;
  numero: string;
  pdf_sha256: string | null;
  xml_sha256: string | null;
  estado: string;
  intentos: number;
  aviso_campana_at: string | null;
  correo_enviado_at: string | null;
  created_at: string;
}

export interface PrevioEnvio {
  id: string;
  numero: string;
  estado: string;
  aviso_campana_at: string | null;
  correo_enviado_at: string | null;
  created_at: string;
}

export interface ContratoEnvio extends ContratoAviso {
  servicio_slug: string | null;
}

export interface ContextoEnvio {
  /** La factura sigue teniendo el contenido de esta fila. */
  vigente: boolean;
  pdfPath: string | null;
  xmlPath: string | null;
  cuota: { numero: number; monto: number };
  totalCuotas: number;
  contratos: ContratoEnvio[];
}

export interface DatosPagador {
  slug: string | null;
  servicio: string;
  empresa: { nombre: string | null; correo: string | null };
  correoDesignado: string | null;
}

export interface CorreoSaliente {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; content: string }[];
  idempotencyKey: string;
}

export type RespuestaCorreo = { ok: true; id: string | null } | { ok: false; error: string };

export interface PuertosEnvio {
  /** Toma la fila con el candado, o null si no está disponible. */
  tomar(envioId: string): Promise<EnvioFila | null>;
  contexto(envio: EnvioFila): Promise<ContextoEnvio>;
  /** Lo que depende del contrato elegido: espacio pagador, empresa, servicio, correo del designado. */
  pagador(envio: EnvioFila, contrato: ContratoEnvio): Promise<DatosPagador>;
  /** Los envíos anteriores de la misma cuota (creados antes que este). */
  previos(envio: EnvioFila): Promise<PrevioEnvio[]>;
  /** Crea o actualiza el aviso pendiente de la campana. Lanza si no pudo. */
  avisarCampana(p: {
    workspacePagadorId: string;
    destinatarios: string[];
    cuotaId: string;
    numeroCuota: number;
    numeroFactura: string;
    reemplazo: boolean;
    contratoId: string;
  }): Promise<void>;
  /** El archivo del bucket, en base64. Lanza si no pudo. */
  descargarBase64(path: string): Promise<string>;
  enviarCorreo(m: CorreoSaliente): Promise<RespuestaCorreo>;
  guardar(envioId: string, cambios: Record<string, unknown>): Promise<void>;
  avisarEquipo(p: { envioId: string; numero: string; error: string }): Promise<void>;
  ahora(): string;
}

export type ResultadoEnvio =
  | { estado: 'no_disponible' }
  | { estado: 'enviado'; resendId: string | null }
  | { estado: 'omitido'; motivo: string; campana: boolean }
  | { estado: 'fallido'; error: string; intentos: number };

/** El último correo ENVIADO de la cuota antes de este: con él, el correo nuevo es un reenvío. */
export function correoAnterior(previos: readonly PrevioEnvio[]): { numero: string; enviadoAt: string } | null {
  const enviados = previos
    .filter((p) => p.estado === 'enviado' && p.correo_enviado_at)
    .sort((a, b) => (b.correo_enviado_at ?? '').localeCompare(a.correo_enviado_at ?? ''));
  const ultimo = enviados[0];
  return ultimo ? { numero: ultimo.numero, enviadoAt: ultimo.correo_enviado_at as string } : null;
}

export async function procesarEnvio(envioId: string, p: PuertosEnvio): Promise<ResultadoEnvio> {
  const envio = await p.tomar(envioId);
  if (!envio) return { estado: 'no_disponible' };

  const cerrar = async (cambios: Record<string, unknown>) =>
    p.guardar(envio.id, { ...cambios, tomado_at: null, updated_at: p.ahora() });

  const omitir = async (motivo: string, campana: boolean): Promise<ResultadoEnvio> => {
    await cerrar({ estado: 'omitido', motivo, ultimo_error: null });
    return { estado: 'omitido', motivo, campana };
  };

  try {
    const ctx = await p.contexto(envio);
    if (!ctx.vigente) return await omitir('reemplazada', false);

    const contrato = elegirContrato(ctx.contratos);
    if (!contrato) return await omitir('sin_contrato', false);
    if (!contrato.workspace_pagador_id) return await omitir('sin_pagador', false);

    const previos = await p.previos(envio);

    // ── Campana, una sola vez ──
    let campana = Boolean(envio.aviso_campana_at);
    const destinatarios = destinatariosAvisoFactura(contrato);
    if (!campana && destinatarios.length > 0) {
      await p.avisarCampana({
        workspacePagadorId: contrato.workspace_pagador_id,
        destinatarios,
        cuotaId: envio.plan_cobro_cuota_id,
        numeroCuota: ctx.cuota.numero,
        numeroFactura: envio.numero,
        reemplazo: previos.some((x) => x.aviso_campana_at),
        contratoId: contrato.id,
      });
      await p.guardar(envio.id, { aviso_campana_at: p.ahora(), updated_at: p.ahora() });
      campana = true;
    }

    // ── Correo ──
    const decision = decidirCorreo(envio);
    if (!decision.enviar) return await omitir(decision.motivo, campana);

    const datos = await p.pagador(envio, contrato);
    const destinos = destinosCorreoFactura({
      correoEmpresa: datos.empresa.correo,
      correoDesignado: datos.correoDesignado,
    });
    if (!destinos) return await omitir('sin_destinatario', campana);
    if (!datos.slug) throw new Error('el espacio pagador no tiene slug');
    if (!ctx.pdfPath || !ctx.xmlPath) throw new Error('la factura no tiene la ruta del PDF o del XML');

    const texto = correoFactura({
      numero: envio.numero,
      numeroCuota: ctx.cuota.numero,
      totalCuotas: ctx.totalCuotas,
      servicio: datos.servicio,
      empresa: datos.empresa.nombre,
      monto: ctx.cuota.monto,
      slugPagador: datos.slug,
      anterior: correoAnterior(previos),
    });

    const [pdf, xml] = await Promise.all([p.descargarBase64(ctx.pdfPath), p.descargarBase64(ctx.xmlPath)]);

    const respuesta = await p.enviarCorreo({
      from: FROM_FACTURACION,
      to: destinos.to,
      cc: destinos.cc,
      bcc: [CORREO_RESPUESTA_FACTURA],
      replyTo: CORREO_RESPUESTA_FACTURA,
      subject: texto.asunto,
      html: texto.html,
      text: texto.texto,
      attachments: [
        { filename: nombreAdjunto(envio.numero, 'pdf'), content: pdf },
        { filename: nombreAdjunto(envio.numero, 'xml'), content: xml },
      ],
      idempotencyKey: `factura-cuota/${envio.id}`,
    });
    if (!respuesta.ok) throw new Error(respuesta.error);

    await cerrar({
      estado: 'enviado',
      resend_id: respuesta.id,
      destinos: textoDestinos(destinos),
      correo_enviado_at: p.ahora(),
      ultimo_error: null,
      motivo: null,
    });
    return { estado: 'enviado', resendId: respuesta.id };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const intentos = envio.intentos + 1;
    try {
      await cerrar({ estado: 'fallido', intentos, ultimo_error: error });
    } catch (eg) {
      console.error('[enviar-factura-cuota] no se pudo registrar la falla', envio.id, (eg as Error).message);
    }
    if (intentos >= MAX_INTENTOS) {
      try {
        await p.avisarEquipo({ envioId: envio.id, numero: envio.numero, error });
      } catch (ea) {
        console.error('[enviar-factura-cuota] no se pudo avisar al equipo', envio.id, (ea as Error).message);
      }
    }
    return { estado: 'fallido', error, intentos };
  }
}

/** Bytes → base64, por tramos (un PDF de varios MB revienta `String.fromCharCode(...bytes)`). */
export function base64DeBytes(bytes: Uint8Array): string {
  let binario = '';
  const TRAMO = 0x8000;
  for (let i = 0; i < bytes.length; i += TRAMO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + TRAMO));
  }
  return btoa(binario);
}

/** El correo interno al equipo cuando un envío agota sus intentos. */
export function textoAvisoEquipoFalla(p: { envioId: string; numero: string; error: string }): { asunto: string; texto: string } {
  return {
    asunto: `No salió la factura ${p.numero} al cliente (3 intentos)`,
    texto: [
      `La factura ${p.numero} no se pudo mandar al cliente después de ${MAX_INTENTOS} intentos.`,
      `Último error: ${p.error}`,
      `Envío: ${p.envioId} (tabla envios_factura_cuota).`,
      'Para reintentar: update envios_factura_cuota set intentos = 0, estado = \'pendiente\' where id = \'' + p.envioId + '\'; select public.disparar_envio_factura_cuota(\'' + p.envioId + '\');',
    ].join('\n\n'),
  };
}
