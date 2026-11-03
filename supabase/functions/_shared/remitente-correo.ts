/**
 * El remitente de los correos que le hablan AL CLIENTE FINAL de un workspace.
 *
 * SOE-010: los clientes de SOENA no conocen a MeTRIK y leen «SOENA (via MeTRIK)
 * <noreply@metrikone.co>» como spam o fraude. Un workspace puede declarar en
 * `workspaces.config_extra` su propio remitente:
 *
 *   "remitente_correo": { "nombre": "SOENA", "direccion": "avisos@soena.metrikone.co" }
 *
 * y entonces TODO correo al cliente final en su nombre sale desde ahí. `nombre` es opcional
 * (si falta, va la marca del workspace).
 *
 * Sin la clave, el correo sale de `DIRECCION_AVISOS_CLIENTE` (avisos@avisos.metrikone.co) con el
 * NOMBRE visible de siempre de cada envío: quien llama pasa ese remitente como respaldo y se
 * devuelve tal cual.
 *
 * Reparto de dominios (Resend Pro, 2026-10-26), para que la reputación de uno no arrastre al otro:
 *   · metrikone.co (raíz)      → auth de Supabase, sistema y avisos internos al equipo.
 *   · avisos.metrikone.co      → avisos a clientes finales de workspaces SIN remitente propio.
 *   · <ws>.metrikone.co        → remitente propio del workspace (`remitente_correo`).
 *   · metrik.com.co            → facturación de MéTRIK.
 *
 * La dirección solo vale si su dominio está en `DOMINIOS_PERMITIDOS`: un dominio que no está
 * verificado en Resend hace rebotar el POST con 403 y el aviso al cliente no saldría. Una
 * clave mal puesta se registra con console.error y sale el remitente de siempre.
 *
 * Módulo PURO (sin Deno ni Next): lo importan las edge functions y el servidor de Next.
 */

export const CLAVE_REMITENTE_CORREO = 'remitente_correo';

/**
 * Dominios verificados en Resend para remitentes de workspace.
 * `metrikone.co` admite subdominios (ej. `soena.metrikone.co`); `metrik.com.co`, solo la raíz.
 * Antes de agregar uno aquí, verificarlo en Resend.
 *
 * Dar remitente propio a un workspace con `<slug>.metrikone.co` crea registros de Resend
 * bajo ese nombre (`send.<slug>`, `rsend.<slug>`, `resend._domainkey.<slug>`). Con hijos, el
 * comodín `*.metrikone.co` deja de aplicarle a `<slug>.metrikone.co` y el espacio deja de
 * resolver SIN error en ningún log (SOENA, 2026-10-26, ~2 h caído). En el MISMO paso hay que
 * crear `<slug>` CNAME al destino del ALIAS `*` (leerlo de `vercel dns ls metrikone.co`) y
 * comprobar con `dig +short <slug>.metrikone.co`. El `vercel dns add` lo corre Mauricio.
 * Ver docs/gotchas.md.
 */
export const DOMINIOS_PERMITIDOS: ReadonlyArray<{ dominio: string; subdominios: boolean }> = [
  { dominio: 'metrikone.co', subdominios: true },
  { dominio: 'metrik.com.co', subdominios: false },
];

/**
 * La dirección por defecto de los avisos al cliente final. ⚠️ Necesita el dominio
 * `avisos.metrikone.co` verificado en Resend: sin él Resend responde 403 y el aviso no sale.
 */
export const DIRECCION_AVISOS_CLIENTE = 'avisos@avisos.metrikone.co';

/** «<nombre> <avisos@avisos.metrikone.co>»: el remitente por defecto con el nombre visible de cada envío. */
export function remitenteAvisosPorDefecto(nombreVisible: string): string {
  const nombre = limpiarNombre(nombreVisible);
  return nombre ? `${nombre} <${DIRECCION_AVISOS_CLIENTE}>` : DIRECCION_AVISOS_CLIENTE;
}

const FORMA_CORREO = /^[a-z0-9._%+-]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/;

export function dominioPermitido(direccion: string): boolean {
  const m = FORMA_CORREO.exec(direccion.trim().toLowerCase());
  if (!m) return false;
  const host = m[1];
  return DOMINIOS_PERMITIDOS.some(({ dominio, subdominios }) =>
    host === dominio || (subdominios && host.endsWith(`.${dominio}`))
  );
}

/** El nombre visible sin los caracteres que rompen la cabecera `From`. */
function limpiarNombre(nombre: string): string {
  return nombre.replace(/[<>"\r\n]/g, '').trim();
}

export interface RemitenteConfigurado {
  nombre: string | null;
  direccion: string;
}

/**
 * Lee y valida la clave. Devuelve null si no está (silencio) o si está mal (con console.error).
 * `contexto` va en el log para saber de qué workspace es la clave mala.
 */
export function remitenteConfigurado(
  configExtra: unknown,
  contexto = '',
): RemitenteConfigurado | null {
  if (!configExtra || typeof configExtra !== 'object') return null;
  const crudo = (configExtra as Record<string, unknown>)[CLAVE_REMITENTE_CORREO];
  if (crudo === undefined || crudo === null) return null;
  const c = crudo as { nombre?: unknown; direccion?: unknown };
  const direccion = typeof c.direccion === 'string' ? c.direccion.trim().toLowerCase() : '';
  if (typeof crudo !== 'object' || !direccion || !dominioPermitido(direccion)) {
    console.error(
      `[remitente-correo] ${CLAVE_REMITENTE_CORREO} ignorado${contexto ? ` (${contexto})` : ''}: ` +
        `la dirección «${direccion || String(c.direccion ?? '')}» no está en un dominio permitido ` +
        `(${DOMINIOS_PERMITIDOS.map((d) => d.dominio).join(', ')}). Sale el remitente de siempre.`,
    );
    return null;
  }
  const nombre = typeof c.nombre === 'string' && limpiarNombre(c.nombre) ? limpiarNombre(c.nombre) : null;
  return { nombre, direccion };
}

/**
 * El `from` del correo al cliente. Con la clave válida: «<nombre> <direccion>» (nombre de la
 * clave, o la marca). Sin ella o inválida: `porDefecto`, intacto.
 */
export function remitenteCliente(p: {
  configExtra: unknown;
  marca: string;
  porDefecto: string;
  contexto?: string;
}): { from: string; propio: boolean } {
  const r = remitenteConfigurado(p.configExtra, p.contexto);
  if (!r) return { from: p.porDefecto, propio: false };
  const nombre = r.nombre ?? limpiarNombre(p.marca);
  return { from: nombre ? `${nombre} <${r.direccion}>` : r.direccion, propio: true };
}

/**
 * El logo del workspace para la cabecera del correo, solo si es una URL https (el de
 * `workspaces.logo_url` vive en el bucket público `workspace-logos`). Otra cosa → null y
 * la cabecera queda con el texto de la marca.
 */
export function logoParaCorreo(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!/^https:\/\/[^\s"'<>]+$/i.test(u)) return null;
  return u;
}

// ── El aviso de avance de etapa (notificar-etapa) ─────────────────────────────
// Vive aquí y no en notificar-etapa/index.ts para poder probarlo desde vitest.

/**
 * El remitente por defecto del aviso de etapa: el nombre de siempre («SOENA (via MeTRIK)») desde
 * `avisos.metrikone.co`. Hasta el 2026-10-26 salía de `noreply@metrikone.co`, la misma dirección
 * del auth y de los avisos internos.
 */
export function remitenteAvisoEtapaPorDefecto(marca: string): string {
  return remitenteAvisosPorDefecto(`${marca} (via MeTRIK)`);
}

export function remitenteAvisoEtapa(p: {
  marca: string;
  configExtra: unknown;
  contexto?: string;
}): { from: string; propio: boolean } {
  return remitenteCliente({
    configExtra: p.configExtra,
    marca: p.marca,
    porDefecto: remitenteAvisoEtapaPorDefecto(p.marca),
    contexto: p.contexto,
  });
}

/**
 * La cabecera de marca del aviso de etapa. Con remitente propio y logo, el logo; en
 * cualquier otro caso, el texto de la marca de siempre (idéntico al HTML anterior).
 * El logo va atado al remitente propio a propósito: el PR que lo trajo no podía cambiar
 * ningún correo en producción hasta que el workspace configurara su clave.
 */
export function cabeceraMarcaAvisoHtml(p: {
  marca: string;
  logoUrl: string | null;
  propio: boolean;
  escapar: (t: string) => string;
}): string {
  const logo = p.propio ? logoParaCorreo(p.logoUrl) : null;
  if (logo) {
    return `<p style="margin:0 0 14px"><img src="${p.escapar(logo)}" alt="${p.escapar(p.marca)}" height="40" style="display:block;height:40px;max-width:200px;width:auto;border:0"></p>`;
  }
  return `<p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6B7280">${p.escapar(p.marca)}</p>`;
}
