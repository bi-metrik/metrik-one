// ============================================================
// La factura de un negocio: cuál es, dónde está su PDF, y quién puede cargarla a mano.
//
// FUENTE ÚNICA para la cola de Tesorería, la barrera de emisión, la carga manual y la
// ficha del negocio. Si cada pantalla resolviera la factura por su cuenta, podrían
// mostrar archivos distintos para el mismo negocio, que es justo lo que pasaba.
//
// Fuentes válidas, y SOLO estas dos:
//   - la data del bloque de factura ORIGINAL (la config con slug, la nativa);
//   - la marca `negocios.metadata.siigo_factura`, que deja la emisión o la adopción.
//
// ⚠️ Nunca la data de una COPIA heredada. Medido en SOENA el 2026-09-14: 646 copias de
// «Factura emitida» con un archivo distinto del de su origen (certificados UPME,
// certificaciones bancarias, RUT, la factura del vehículo), 20 de ellas con un
// `numero_factura` sacado del documento equivocado (Tesla, VISSAN, «FACTURA EDDI
// ALIRIO»). Con que una sola copia trajera número, la cola daba el negocio por facturado.
//
// Puro: no toca DB ni red.
// ============================================================

import { nitSinDv } from '@/lib/dian/nit'

export const ORIGENES_FACTURA = ['emitido_en_siigo', 'adoptada_de_siigo', 'cargada_manual'] as const
export type OrigenFactura = (typeof ORIGENES_FACTURA)[number]

/** Orígenes cuyo PDF no se reemplaza a mano: el documento lo trajo Siigo, no una persona. */
const ORIGENES_DE_SIIGO: readonly string[] = ['emitido_en_siigo', 'adoptada_de_siigo']

// ── Emisor ───────────────────────────────────────────────────────────────────

export type VeredictoEmisor = 'coincide' | 'no_coincide' | 'sin_emisor' | 'sin_esperado'

/**
 * ¿El NIT del emisor leído del documento es el esperado?
 *
 * Lo comparten el gate `factura:emitida` y la carga manual de Tesorería, que es la
 * barrera contra volver a subir la factura del vehículo como si fuera la nuestra.
 * `sin_esperado` significa que la línea no declara `emisor_nit_esperado`: no hay contra
 * qué comparar, y la comparación no bloquea.
 */
export function verificarEmisorFactura(
  emisor: string | null | undefined,
  esperado: string | null | undefined,
): VeredictoEmisor {
  const esp = esperado ? nitSinDv(String(esperado).trim()) : null
  if (!esp) return 'sin_esperado'
  const bruto = String(emisor ?? '').trim()
  if (!bruto) return 'sin_emisor'
  return nitSinDv(bruto) === esp ? 'coincide' : 'no_coincide'
}

/** ¿Este veredicto impide dar el documento por factura del workspace? */
export function emisorImpideFactura(v: VeredictoEmisor): boolean {
  return v === 'no_coincide' || v === 'sin_emisor'
}

// ── Resolución ───────────────────────────────────────────────────────────────

export interface MarcaFacturaMinima {
  numero?: string | null
  archivo_url?: string | null
  origen?: string | null
}

export interface FacturaDelNegocio {
  numero: string
  /** URL del PDF. `null` = facturada, sin soporte. */
  pdfUrl: string | null
  /** De dónde viene la factura. `null` = cargada en la ficha, sin origen declarado. */
  origen: OrigenFactura | null
  /** De dónde salió el PDF que se enlaza. */
  fuentePdf: 'bloque' | 'marca' | null
}

export interface ResolucionFactura {
  factura: FacturaDelNegocio | null
  /**
   * El bloque original tiene un documento cuyo emisor NO es el del workspace: no es una
   * factura nuestra, aunque traiga número. Caso real: V0089, la factura del vehículo
   * (VNYC 638, emisor 800041629) cargada en «Factura emitida».
   */
  documentoAjeno: { emisor: string; numero: string | null } | null
}

const texto = (v: unknown): string => (v == null ? '' : String(v).trim())

function campo(data: Record<string, unknown> | null, slug: string): string {
  const campos = data?.campos as Record<string, { value?: unknown } | null> | undefined
  return texto(campos?.[slug]?.value)
}

export function urlDeDocumento(data: unknown): string | null {
  const url = (data as { drive_url?: unknown } | null)?.drive_url
  return typeof url === 'string' && url.trim() !== '' ? url : null
}

function origenDeData(data: Record<string, unknown> | null): OrigenFactura | null {
  const o = data?.origen
  return typeof o === 'string' && (ORIGENES_FACTURA as readonly string[]).includes(o) ? o as OrigenFactura : null
}

/**
 * La factura del negocio a partir del bloque ORIGINAL y la marca.
 *
 * - Con marca: la factura es la de la marca. El PDF sale del bloque si su documento no es
 *   ajeno y su número no contradice el de la marca; si no, del `archivo_url` de la marca.
 * - Sin marca: la factura es el número del bloque, salvo que el emisor del documento no
 *   sea el esperado. Un bloque sin emisor extraído (cargue histórico, emisión desde ONE)
 *   no se juzga ajeno: no hay nada que lo contradiga.
 */
export function resolverFacturaDelNegocio(p: {
  /** `data` del bloque de factura ORIGINAL, o null si el negocio no tiene esa fila. */
  original: unknown
  marca: MarcaFacturaMinima | null | undefined
  emisorNitEsperado?: string | null
  nitCampo?: string
  numeroCampo?: string
}): ResolucionFactura {
  const data = (p.original && typeof p.original === 'object' ? p.original : null) as Record<string, unknown> | null
  const numeroBloque = campo(data, p.numeroCampo ?? 'numero_factura') || null
  const emisor = campo(data, p.nitCampo ?? 'emisor_nit')
  const url = urlDeDocumento(data)
  const ajeno = verificarEmisorFactura(emisor, p.emisorNitEsperado) === 'no_coincide'
  const documentoAjeno = ajeno ? { emisor, numero: numeroBloque } : null

  const numeroMarca = texto(p.marca?.numero) || null
  if (numeroMarca) {
    const bloqueSirve = !!url && !ajeno && (!numeroBloque || mismoNumero(numeroBloque, numeroMarca))
    const urlMarca = texto(p.marca?.archivo_url) || null
    const pdfUrl = bloqueSirve ? url : urlMarca
    return {
      factura: {
        numero: numeroMarca,
        pdfUrl,
        origen: p.marca?.origen === 'adoptada_de_siigo' ? 'adoptada_de_siigo' : 'emitido_en_siigo',
        fuentePdf: bloqueSirve ? 'bloque' : pdfUrl ? 'marca' : null,
      },
      documentoAjeno,
    }
  }

  if (numeroBloque && !ajeno) {
    return {
      factura: { numero: numeroBloque, pdfUrl: url, origen: origenDeData(data), fuentePdf: url ? 'bloque' : null },
      documentoAjeno: null,
    }
  }
  return { factura: null, documentoAjeno }
}

/** Compara consecutivos sin que importen mayúsculas, espacios ni guiones: `FV-2-459` = `fv 2 459`. */
export function mismoNumero(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (x: string | null | undefined) => texto(x).toUpperCase().replace(/[^A-Z0-9]/g, '')
  return n(a) !== '' && n(a) === n(b)
}

// ── Carga manual ─────────────────────────────────────────────────────────────

export type PermisoCargaManual =
  | { permitido: true; reemplaza: boolean }
  | { permitido: false; razon: string }

/**
 * ¿Se puede cargar a mano el PDF de la factura, y sería un reemplazo?
 *
 * Decisión de Mauricio (2026-09-14): se carga cuando la factura se hizo por fuera de ONE,
 * o cuando ONE ya la reconoce como facturada pero no tiene el PDF. Reemplazar solo se
 * permite sobre una carga manual previa; sobre un PDF que trajo Siigo, no.
 *
 * `reemplaza` = el bloque original ya tiene un archivo, que quedaría sustituido. Quien
 * llama exige motivo escrito en ese caso.
 */
export function cargaManualPermitida(original: unknown, resolucion: ResolucionFactura): PermisoCargaManual {
  const data = (original && typeof original === 'object' ? original : null) as Record<string, unknown> | null
  const tieneArchivo = urlDeDocumento(data) != null
  const f = resolucion.factura
  if (f?.pdfUrl) {
    if (f.fuentePdf === 'marca' || ORIGENES_DE_SIIGO.includes(texto(data?.origen))) {
      return {
        permitido: false,
        razon: f.origen === 'adoptada_de_siigo'
          ? `La factura ${f.numero} se trajo de Siigo con su PDF. No se reemplaza a mano.`
          : `La factura ${f.numero} la emitió ONE y su PDF vino de Siigo. No se reemplaza a mano.`,
      }
    }
    return { permitido: true, reemplaza: true }
  }
  return { permitido: true, reemplaza: tieneArchivo }
}

/**
 * Si ONE ya tiene la factura marcada, el PDF que se carga tiene que ser ESA factura.
 * Devuelve el mensaje de rechazo, o null si el número sirve.
 */
export function numeroNoCoincideConMarca(
  numeroCargado: string,
  marca: MarcaFacturaMinima | null | undefined,
): string | null {
  const numeroMarca = texto(marca?.numero)
  if (!numeroMarca) return null
  if (mismoNumero(numeroCargado, numeroMarca)) return null
  return `El número ${texto(numeroCargado)} no coincide con la factura que ONE ya tiene registrada (${numeroMarca}).`
}
