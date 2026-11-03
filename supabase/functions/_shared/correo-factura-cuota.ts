// ============================================================
// El correo con la factura de una cuota — reglas puras
// ------------------------------------------------------------
// Decisión de Mauricio (2026-10-28): cuando se registra la factura electrónica de una cuota, el
// cliente recibe un correo con el PDF y el XML adjuntos, además del aviso en la campana, sin
// importar cómo entró la factura (ONE, SQL o script). Texto aprobado por Vera el 2026-10-28: se
// usa TAL CUAL, y `correo-factura-cuota.test.ts` lo fija palabra por palabra.
//
// Puro: sin Deno ni red. Lo importan la edge function `enviar-factura-cuota` y vitest.
// ============================================================

import { escaparHtml } from './correo-interno.ts';

/** Reply-To y copia oculta de todo correo de factura. */
export const CORREO_RESPUESTA_FACTURA = 'mauricio.moreno@metrik.com.co';

/**
 * Los colores de la paleta «Pino Profundo» que usa el correo. Copia de `src/lib/marca/paleta.ts`
 * (la edge function no alcanza `src/`); `correo-factura-cuota.test.ts` falla si se separan.
 */
export const COLORES_CORREO_FACTURA = {
  acento: '#0E5C43',
  tinta: '#191713',
  tintaSuave: '#6E6A62',
  papel: '#F3F1EC',
} as const;

// ── Qué se manda ─────────────────────────────────────────────────────────────

export type DecisionCorreo = { enviar: true } | { enviar: false; motivo: 'sin_pdf' | 'sin_xml' };

/** El correo lleva los DOS archivos. Con uno solo se omite: cuando llegue el otro, entra otra fila a la cola. */
export function decidirCorreo(f: { pdf_sha256: string | null; xml_sha256: string | null }): DecisionCorreo {
  if (!f.pdf_sha256) return { enviar: false, motivo: 'sin_pdf' };
  if (!f.xml_sha256) return { enviar: false, motivo: 'sin_xml' };
  return { enviar: true };
}

// ── A quién ──────────────────────────────────────────────────────────────────

export interface DestinosCorreo {
  to: string[];
  cc: string[];
}

function correoValido(c: string | null | undefined): string | null {
  const limpio = (c ?? '').trim();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpio) ? limpio : null;
}

/**
 * Para: el correo fiscal de la empresa pagadora (`empresas.email_fiscal`, o el
 * `correo_facturacion` de la suscripción). Sin él, la persona designada. Copia: la persona
 * designada, si es otra dirección. Sin ninguna de las dos: null (se omite).
 */
export function destinosCorreoFactura(p: {
  correoEmpresa: string | null | undefined;
  correoDesignado: string | null | undefined;
}): DestinosCorreo | null {
  const empresa = correoValido(p.correoEmpresa);
  const designado = correoValido(p.correoDesignado);
  if (empresa) {
    const cc = designado && designado.toLowerCase() !== empresa.toLowerCase() ? [designado] : [];
    return { to: [empresa], cc };
  }
  if (designado) return { to: [designado], cc: [] };
  return null;
}

/** Los destinos como se guardan en `envios_factura_cuota.destinos`. */
export function textoDestinos(d: DestinosCorreo): string {
  return [...d.to.map((c) => `para: ${c}`), ...d.cc.map((c) => `cc: ${c}`)].join(', ');
}

// ── Cómo se nombra ───────────────────────────────────────────────────────────

/** «Valida» fijo para los contratos de Valida; si no, el nombre del catálogo. */
export function nombreServicio(s: { slug: string | null; modulo: string | null; nombre: string | null } | null): string {
  if (!s) return 'Valida';
  const esValida = (s.modulo ?? '').startsWith('valida') || (s.slug ?? '').startsWith('valida');
  if (esValida) return 'Valida';
  return (s.nombre ?? '').trim() || 'Valida';
}

/** `$150.000`: punto de miles, sin decimales. No depende del ICU del runtime. */
export function pesos(monto: number): string {
  const entero = Math.round(monto);
  const signo = entero < 0 ? '-' : '';
  return `${signo}$${String(Math.abs(entero)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** `28 de octubre de 2026`, en hora de Bogotá (UTC-5 fijo, sin horario de verano). */
export function fechaLarga(iso: string): string {
  const d = new Date(Date.parse(iso) - 5 * 3600 * 1000);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

export function enlacePagosEspacio(slug: string): string {
  return `https://${slug}.metrikone.co/suscripcion?tab=pagos`;
}

/** `<numero>.pdf` / `<numero>.xml`. El número ya viene validado (`^[A-Za-z0-9-]{1,40}$`). */
export function nombreAdjunto(numero: string, clase: 'pdf' | 'xml'): string {
  return `${numero}.${clase}`;
}

// ── El texto ─────────────────────────────────────────────────────────────────

export interface DatosCorreoFactura {
  numero: string;
  numeroCuota: number;
  totalCuotas: number;
  servicio: string;
  empresa: string | null;
  monto: number;
  slugPagador: string;
  /** El último correo de factura ya ENVIADO para esta cuota. Con él, el correo es un reenvío. */
  anterior: { numero: string; enviadoAt: string } | null;
}

export interface TextoCorreo {
  asunto: string;
  texto: string;
  html: string;
}

export function correoFactura(d: DatosCorreoFactura): TextoCorreo {
  const cuota = `cuota ${d.numeroCuota} de ${d.totalCuotas} de ${d.servicio}`;
  const asunto = d.anterior
    ? `Factura ${d.numero} (reenvío) · ${cuota}`
    : `Factura ${d.numero} · ${cuota}`;
  const empresa = (d.empresa ?? '').trim();
  const saludo = empresa ? `Hola, ${empresa}:` : 'Hola:';
  const primero =
    `Le enviamos la factura electrónica ${d.numero} por la ${cuota}, por ${pesos(d.monto)}. Adjuntamos el PDF y el XML.`;
  const reemplazo = d.anterior
    ? d.anterior.numero === d.numero
      ? `Tome esta en lugar de la que le enviamos el ${fechaLarga(d.anterior.enviadoAt)}.`
      : `Tome esta en lugar de la factura ${d.anterior.numero} que le enviamos el ${fechaLarga(d.anterior.enviadoAt)}.`
    : null;
  const designada =
    'La persona designada del contrato también la puede descargar en ONE, en el menú Suscripción, pestaña Pagos.';
  const enlace = enlacePagosEspacio(d.slugPagador);
  const cierre = 'Si algo no cuadra, responda este correo.';
  const firma = 'Equipo MéTRIK';

  const parrafos = [primero, ...(reemplazo ? [reemplazo] : []), designada];
  const texto = [saludo, ...parrafos, `Ir a Pagos: ${enlace}`, cierre, firma].join('\n\n');

  const c = COLORES_CORREO_FACTURA;
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${c.tinta}">${escaparHtml(t)}</p>`;
  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:${c.papel};font-family:Helvetica,Arial,sans-serif;color:${c.tinta}">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    ${p(saludo)}
    ${parrafos.map(p).join('\n    ')}
    <p style="margin:8px 0 24px"><a href="${escaparHtml(enlace)}" style="display:inline-block;background:${c.acento};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600">Ir a Pagos</a></p>
    ${p(cierre)}
    <p style="margin:0;font-size:15px;line-height:1.6;color:${c.tintaSuave}">${escaparHtml(firma)}</p>
  </div>
</body></html>`;

  return { asunto, texto, html };
}
