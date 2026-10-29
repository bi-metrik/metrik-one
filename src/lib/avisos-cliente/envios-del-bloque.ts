/**
 * Bloque `avisos_cliente` (SOE-031): qué correos le salieron al cliente por entrar a la etapa
 * del bloque, a dónde, cuándo y si llegaron.
 *
 * El dato no es del bloque: vive en `avisos_cliente`, que escribe `notificar-etapa` al mandar y
 * actualiza `resend-webhook` con los acuses (entregado, rebotado, suprimido). El bloque solo
 * lo lee. La marca automática de la confirmación de entrega y el aviso de rebote al equipo los
 * hace la base (trigger `avisos_cliente_tras_acuse`, migración 20261028163000), no esta capa.
 *
 * Puro: no toca DB ni red.
 */

/** Lo que el bloque declara en `config_extra`. Todo es opcional. */
export interface ConfigBloqueAvisos {
  /** Solo `email` hoy: WhatsApp no deja acuse de entrega (`disparado` no es «llegó»). */
  canal?: 'email'
  /** Cómo se nombra lo que se mandó en la pantalla y en el aviso de rebote: «el certificado UPME». */
  que_se_envio?: string
  /**
   * Por defecto solo el aviso de ENTRADA a la etapa (`bloque_config_id` nulo). Los avisos por
   * documento cargado (la factura, p. ej.) también dejan la etapa donde estaba el caso y
   * contarían como «el certificado» si se mezclaran.
   */
  incluir_avisos_de_documento?: boolean
}

export interface FilaAvisoCliente {
  id: string
  canal: string
  estado: string
  destino: string | null
  copia_a: string | null
  motivo: string | null
  titulo: string | null
  created_at: string
  entregado_at: string | null
  queja_at: string | null
  bloque_config_id: string | null
}

export type ClaveEnvio =
  | 'entregado'
  | 'enviado'
  | 'rebotado'
  | 'suprimido'
  | 'fallido'
  | 'omitido'
  | 'diferido'
  | 'otro'

export interface EnvioVista {
  id: string
  clave: ClaveEnvio
  etiqueta: string
  /** Para el color: `ok` verde, `espera` gris, `problema` rojo. */
  tono: 'ok' | 'espera' | 'problema'
  destino: string | null
  copiaA: string | null
  titulo: string | null
  enviadoAt: string
  entregadoAt: string | null
  /** Qué hacer, en llano. Solo cuando el equipo tiene trabajo. */
  explicacion: string | null
}

/**
 * El estado de un envío para quien lo lee. El rebote MANDA sobre la entrega: Resend puede
 * confirmar la entrega al servidor y el buzón devolverlo minutos después (ver la migración
 * 20260909000001). En ese caso el cliente no lo tiene.
 */
export function claveDeEnvio(f: Pick<FilaAvisoCliente, 'estado' | 'entregado_at'>): ClaveEnvio {
  switch (f.estado) {
    case 'rebotado':
    case 'suprimido':
    case 'fallido':
    case 'omitido':
    case 'diferido':
      return f.estado
    case 'enviado':
      return f.entregado_at ? 'entregado' : 'enviado'
    default:
      return 'otro'
  }
}

const ETIQUETA: Record<ClaveEnvio, string> = {
  entregado: 'Entregado',
  enviado: 'Enviado, sin confirmar entrega',
  rebotado: 'Rebotó',
  suprimido: 'No se envió: dirección bloqueada',
  fallido: 'No salió',
  omitido: 'No se envió',
  diferido: 'Programado',
  otro: 'Sin estado',
}

const TONO: Record<ClaveEnvio, EnvioVista['tono']> = {
  entregado: 'ok',
  enviado: 'espera',
  diferido: 'espera',
  otro: 'espera',
  rebotado: 'problema',
  suprimido: 'problema',
  fallido: 'problema',
  omitido: 'problema',
}

function explicar(clave: ClaveEnvio, motivo: string | null): string | null {
  switch (clave) {
    case 'rebotado':
      return 'El buzón del cliente lo devolvió. Corrige el correo del cliente y vuelve a enviárselo; la confirmación de entrega no se marca sola.'
    case 'suprimido':
      return 'Esa dirección ya había rebotado antes y el proveedor no la usa. Corrige el correo del cliente y vuelve a enviárselo.'
    case 'omitido':
      return motivo === 'sin_correo'
        ? 'El cliente no tiene correo registrado.'
        : 'La plataforma no lo mandó porque faltaba un dato.'
    case 'fallido':
      return 'El proveedor de correo no lo mandó. Avísale a MéTRIK.'
    default:
      return null
  }
}

/** Filtra, ordena (más reciente primero) y traduce las filas al formato de la pantalla. */
export function enviosDelBloque(filas: FilaAvisoCliente[], config: ConfigBloqueAvisos = {}): EnvioVista[] {
  const canal = config.canal ?? 'email'
  return filas
    .filter(f => f.canal === canal)
    .filter(f => config.incluir_avisos_de_documento === true || f.bloque_config_id === null)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(f => {
      const clave = claveDeEnvio(f)
      return {
        id: f.id,
        clave,
        etiqueta: ETIQUETA[clave],
        tono: TONO[clave],
        destino: f.destino,
        copiaA: f.copia_a,
        titulo: f.titulo,
        enviadoAt: f.created_at,
        // Una entrega seguida de un rebote no se muestra como entrega.
        entregadoAt: clave === 'entregado' ? f.entregado_at : null,
        explicacion: explicar(clave, f.motivo),
      }
    })
}

/** «28 oct 2026, 3:15 p. m.» en hora de Bogotá. */
export function fechaHoraBogota(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}
