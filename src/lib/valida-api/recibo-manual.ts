/**
 * Reglas puras de `cargarReciboManual` (spec v2 §4.4, conservada por §5.6).
 *
 * Un recibo hecho a mano (RC-2026-09-001 de 4D SOFT es el primero) se carga en Tesorería sobre
 * el COBRO que respalda, igual que los recibos que emite Siigo: la marca vive en
 * `cobros.siigo_recibo`, así que el control de recibos de `/conciliacion` lo cuenta como
 * `con_recibo` sin cambiar una línea (decide por `siigo_recibo.numero`).
 *
 * ## Dónde queda el PDF, y por qué NO en Drive
 *
 * En el bucket PRIVADO `documentos-servicio`, bajo su huella. El cliente lo descarga desde el
 * módulo con una URL firmada de 60 s (§5.4). Un enlace de Drive «cualquiera con el enlace» no
 * tiene control de acceso, y Google no está entre los destinatarios de la Política de Valida.
 * Por eso `archivo_url` queda en `null`: esa llave la leen `BloqueCobros` y el control de
 * recibos para pintar un enlace, y un recibo manual no tiene enlace público que dar.
 */

export const BUCKET_DOCUMENTOS_SERVICIO = 'documentos-servicio'
export const TAMANO_MAX_RECIBO = 10 * 1024 * 1024

export interface ArchivoRecibo {
  nombre: string
  tipo: string
  tamano: number
}

/** Motivo por el que la carga no procede, o null. Se valida ANTES de subir nada. */
export function problemaCargaRecibo(numero: string | null | undefined, archivo: ArchivoRecibo | null): string | null {
  const n = (numero ?? '').trim()
  if (!n) return 'Falta el número del recibo'
  if (n.length > 40) return 'El número del recibo tiene más de 40 caracteres'
  if (!archivo || archivo.tamano === 0) return 'Falta el PDF del recibo'
  const esPdf = archivo.tipo === 'application/pdf' || archivo.nombre.toLowerCase().endsWith('.pdf')
  if (!esPdf) return 'El recibo tiene que ser un PDF'
  if (archivo.tamano > TAMANO_MAX_RECIBO) return 'El PDF pesa más de 10 MB'
  return null
}

/**
 * Ruta del PDF: por workspace y por huella. Por huella, para que el mismo archivo cargado dos
 * veces no ocupe dos lugares y para que la ruta no revele el número ni el cliente.
 */
export function rutaRecibo(workspaceId: string, sha256: string): string {
  return `${workspaceId}/recibos/${sha256}.pdf`
}

export interface MarcaReciboManual {
  numero: string
  valor: number
  origen: 'manual'
  archivo_url: null
  storage_bucket: string
  storage_path: string
  sha256: string
  at: string
  por: string | null
}

export function marcaReciboManual(args: {
  numero: string
  valor: number
  workspaceId: string
  sha256: string
  ahoraIso: string
  por: string | null
}): MarcaReciboManual {
  return {
    numero: args.numero.trim(),
    valor: args.valor,
    origen: 'manual',
    archivo_url: null,
    storage_bucket: BUCKET_DOCUMENTOS_SERVICIO,
    storage_path: rutaRecibo(args.workspaceId, args.sha256),
    sha256: args.sha256,
    at: args.ahoraIso,
    por: args.por,
  }
}

/** Nombre con el que se descarga: el número del recibo, sin caracteres raros. */
export function nombreDescargaRecibo(numero: string | null): string {
  const base = (numero ?? 'recibo').trim().replace(/[^\w.-]+/g, '-') || 'recibo'
  return `${base}.pdf`
}
