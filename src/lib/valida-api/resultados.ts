/**
 * Formas de lo que devuelven las acciones del módulo Valida API.
 *
 * Viven fuera de `acciones.ts` a propósito: ese archivo es `'use server'`, y re-exportar desde
 * ahí un tipo importado tumba producción sin fallar en dev ni en `tsc` (CLAUDE.md, PR #452).
 */

import type { MotivoNoDisponible } from './cliente-nucleo'
import type { DocumentoPorAceptar, RazonNoAcepta } from './terminos'
import type { ListadoLlaves, ResumenValidaApi } from './tipos'

/** Por qué una pestaña no carga. `sin_acceso` y `no_disponible` se explican distinto. */
export type Carga<T> =
  | { estado: 'ok'; datos: T }
  | { estado: 'sin_acceso'; razon: string }
  | { estado: 'no_disponible'; motivo: MotivoNoDisponible | 'base' | 'sin_migracion'; detalle?: string }
  | { estado: 'rechazada'; codigo: string; mensaje: string }

export type ResultadoResumen = Carga<ResumenValidaApi>
export type ResultadoLlaves = Carga<ListadoLlaves>

export interface LlaveRecienEmitida {
  keyId: string
  keyPrefix: string
  nombre: string
  /** EN CLARO. Se muestra una sola vez y no se guarda en ninguna parte. */
  llave: string
  regenerada: boolean
  anteriorDejaDeAutenticarEn: string | null
}

export type ResultadoEmitir =
  | { ok: true; llave: LlaveRecienEmitida }
  | { ok: false; error: string }

export type ResultadoRevocar = { ok: true; yaEstabaRevocada: boolean } | { ok: false; error: string }

export interface DocumentoContractual {
  documentoId: string
  slug: string
  titulo: string
  version: string
  textoMd: string
  pdfSha256: string
  vigenteDesde: string
  vigenteHasta: string | null
  aceptadoAt: string | null
  aceptadoPor: string | null
  aceptadoCalidad: string | null
  aceptadoCanal: 'whatsapp' | 'modulo' | null
}

export interface AceptacionPoliticaPropia {
  version: string
  aceptadaAt: string
}

export interface DocumentosValidaApi {
  contractuales: DocumentoContractual[]
  politica: AceptacionPoliticaPropia[]
}

export interface CobroDeServicio {
  cobroId: string
  fecha: string | null
  concepto: string
  monto: number
  fuente: string | null
  estado: 'pagado' | 'programado' | 'anulado'
  reciboNumero: string | null
  reciboOrigen: string | null
  /** true = hay PDF en el bucket privado y se descarga por la ruta firmada. */
  reciboDescargable: boolean
}

export interface ServicioConPagos {
  servicioContratadoId: string
  nombre: string
  estado: string
  vigenteDesde: string
  vigenteHasta: string | null
  cobros: CobroDeServicio[]
}

export type ResultadoDocumentos = Carga<DocumentosValidaApi>

/** Un documento de términos vigente, tal como se lee en la entrada del módulo. */
export interface DocumentoEntradaPagina {
  documentoId: string
  slug: string
  titulo: string
  version: string
  textoMd: string
}

/**
 * La aceptación contractual en la entrada. `pendiente` con `puede: true` trae lo que el dueño firma
 * (una declaración por documento pendiente); con `puede: false`, por qué quien entra no puede.
 */
export type ContratoEntradaPagina =
  | { estado: 'aceptado' }
  | { estado: 'pendiente'; puede: true; empresas: string[]; porFirmar: DocumentoPorAceptar[] }
  | { estado: 'pendiente'; puede: false; razon: RazonNoAcepta }

/** Lo que la página necesita para decidir si abre el módulo o pinta la entrada. */
export type EstadoEntradaPagina =
  | { estado: 'aprobada' }
  | { estado: 'sin_documentos' }
  | { estado: 'no_disponible' }
  | {
      estado: 'pendiente'
      documentos: DocumentoEntradaPagina[]
      contrato: ContratoEntradaPagina
      /** El usuario ya aceptó otro documento con el mismo nombre y versión: no puede completar aquí. */
      conflicto: boolean
    }

export type ResultadoAprobarEntrada = { ok: true; yaEstaba: boolean } | { ok: false; error: string }
export type ResultadoPagos = Carga<ServicioConPagos[]>
