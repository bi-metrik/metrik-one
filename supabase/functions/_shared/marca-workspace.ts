/**
 * La MARCA con la que un correo al cliente habla de parte del workspace: el `name` del
 * workspace (SOENA → «SOENA (via MeTRIK)»), su `config_extra` para el reply_to y el
 * remitente propio (`remitente_correo`, ver remitente-correo.ts), y su `logo_url`.
 *
 * SOE-010: `notificar-etapa` pedia la columna `nombre`, que en `workspaces` no existe
 * (es `name`). PostgREST devolvia error, el codigo solo miraba `data`, y cada correo al
 * cliente salio como «tu proveedor (via MeTRIK)» sin que nada lo registrara; de paso el
 * `email_respuesta` de `config_extra` nunca se leyo. Por eso la lectura vive aqui, con
 * prueba, y un error se REGISTRA en vez de tragarse.
 *
 * Si la lectura falla, el correo igual sale con el respaldo neutro: frenar el aviso al
 * cliente por no poder leer el nombre seria peor que mandarlo sin marca.
 */

type Supabase = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const MARCA_POR_DEFECTO = 'tu proveedor';

export interface MarcaWorkspace {
  marca: string;
  configExtra: Record<string, unknown> | null;
  /** `workspaces.logo_url` (URL publica del bucket `workspace-logos`), o null. */
  logoUrl: string | null;
}

export async function marcaDelWorkspace(
  supabase: Supabase,
  workspaceId: string | null | undefined,
): Promise<MarcaWorkspace> {
  if (!workspaceId) return { marca: MARCA_POR_DEFECTO, configExtra: null, logoUrl: null };
  const { data, error } = await supabase
    .from('workspaces')
    .select('name, config_extra, logo_url')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) {
    console.error(
      `[marca-workspace] no se pudo leer el workspace ${workspaceId}, el correo sale como «${MARCA_POR_DEFECTO}»:`,
      error.message ?? error,
    );
    return { marca: MARCA_POR_DEFECTO, configExtra: null, logoUrl: null };
  }
  const fila = data as { name?: string | null; config_extra?: unknown; logo_url?: string | null } | null;
  const marca = typeof fila?.name === 'string' && fila.name.trim() ? fila.name.trim() : MARCA_POR_DEFECTO;
  const configExtra = fila?.config_extra && typeof fila.config_extra === 'object'
    ? (fila.config_extra as Record<string, unknown>)
    : null;
  const logoUrl = typeof fila?.logo_url === 'string' && fila.logo_url.trim() ? fila.logo_url.trim() : null;
  return { marca, configExtra, logoUrl };
}
