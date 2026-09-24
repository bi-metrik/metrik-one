/**
 * Filas del módulo Ferretería tal como las devuelve la base (ver la migración
 * `20260924235500_modulo_ferreteria.sql`). Van aquí y no en `src/types/database.ts` hasta que
 * se regeneren los tipos después de aplicar la migración.
 */
import type {
  Canal,
  CanalConversacion,
  EstadoPublicacion,
  Linea,
  ResultadoConversacion,
  RutaVenta,
} from './reglas'

export interface ItemFicha {
  etiqueta: string
  valor: string
  fuente?: string | null
  verificado?: boolean
}

export interface ProductoFila {
  id: string
  workspace_id: string
  sku: string
  nombre: string
  marca: string | null
  categoria: string | null
  proveedor: string | null
  pagina_catalogo: string | null
  fotos: string[]
  ficha: ItemFicha[]
  observaciones: string | null
  created_at?: string
  updated_at?: string
}

export interface CostoFila {
  id?: string
  workspace_id: string
  producto_id: string
  fecha_lista: string
  costo_f: number
  costo_d: number | null
}

export interface PublicacionFila {
  id: string
  workspace_id: string
  codigo: string
  producto_id: string
  canal: Canal
  titulo: string
  descripcion: string | null
  etiquetas: string[]
  precio: number | null
  linea: Linea | null
  link: string | null
  id_aviso: string | null
  perfil: string | null
  fecha_publicacion: string | null
  estado: EstadoPublicacion
  pendiente_en_canal: boolean
  pendiente_desde: string | null
  version_canal: number
  intentos_fallidos: number
  ultimo_error_canal: string | null
  created_at?: string
  updated_at?: string
}

export const TIPOS_EVENTO = [
  'creada',
  'cambio_precio',
  'cambio_estado',
  'cambio_texto',
  'cambio_dato',
  'venta',
  'nota',
  'aplicado_en_canal',
  'error_en_canal',
] as const
export type TipoEvento = (typeof TIPOS_EVENTO)[number]

export type TipoAutor = 'persona' | 'agente' | 'cron'

export interface Autor {
  tipo: TipoAutor
  /** `profiles.id` de la persona. Null para el agente y el cron. */
  id: string | null
  nombre: string | null
}

export interface EventoNuevo {
  workspace_id: string
  publicacion_id: string
  tipo: TipoEvento
  campo: string | null
  valor_anterior: string | null
  valor_nuevo: string | null
  motivo: string | null
  autor_tipo: TipoAutor
  autor_id: string | null
  autor_nombre: string | null
}

export interface EventoFila extends EventoNuevo {
  id: string
  created_at: string
}

export interface MedicionFila {
  workspace_id: string
  publicacion_id: string
  fecha: string
  clics_acumulados: number
  guardados: number | null
  estado_visto: string | null
}

export interface ConversacionFila {
  id?: string
  workspace_id: string
  publicacion_id: string
  fecha: string
  interesado: string
  canal: CanalConversacion
  resultado: ResultadoConversacion
  motivo_perdida: string | null
  clave: string
}

export interface VentaFila {
  id?: string
  workspace_id: string
  publicacion_id: string
  conversacion_id: string | null
  fecha_primer_pago: string
  precio_final: number
  costo_dia: number
  ganancia: number
  ruta: RutaVenta
  registrado_por: string | null
  created_at?: string
}

export interface TokenFila {
  id: string
  workspace_id: string
  nombre: string
  escritor: 'agente' | 'cron'
  revocado_at: string | null
}

/**
 * Una publicación del catálogo tal como la lee el cron para saber QUÉ medir en el canal. Sin
 * descripción ni etiquetas: no las necesita y son lo que más pesa.
 */
export interface PublicacionCatalogo {
  codigo: string
  /** SKU del producto. Null solo si el producto desapareció (no debería: hay FK). */
  sku: string | null
  canal: Canal
  titulo: string
  precio: number | null
  estado: EstadoPublicacion
  linea: Linea | null
  link: string | null
  id_aviso: string | null
  fecha_publicacion: string | null
  pendiente_en_canal: boolean
}

/** Campos de una publicación que se pueden cambiar. `undefined` = no se toca. */
export interface CambiosPublicacion {
  precio?: number | null
  estado?: EstadoPublicacion
  titulo?: string
  descripcion?: string | null
  etiquetas?: string[]
  linea?: Linea | null
  link?: string | null
  id_aviso?: string | null
  perfil?: string | null
  fecha_publicacion?: string | null
}

/**
 * Acceso a datos del módulo. Una implementación va contra Supabase con service_role
 * (`repo-supabase.ts`) y otra en memoria para las pruebas (`repo-memoria.ts`): el núcleo no
 * sabe cuál recibe.
 */
export interface RepoFerreteria {
  buscarTokenPorHash(hash: string): Promise<TokenFila | null>
  marcarUsoToken(id: string, cuando: string): Promise<void>
  moduloActivo(workspaceId: string): Promise<boolean>

  productoPorSku(ws: string, sku: string): Promise<ProductoFila | null>
  productoPorId(ws: string, id: string): Promise<ProductoFila | null>
  guardarProducto(fila: Omit<ProductoFila, 'id'> & { id?: string }): Promise<ProductoFila>
  costos(ws: string, productoId: string): Promise<CostoFila[]>
  guardarCosto(fila: CostoFila): Promise<void>

  publicacionPorCodigo(ws: string, codigo: string): Promise<PublicacionFila | null>
  publicacionPorId(ws: string, id: string): Promise<PublicacionFila | null>
  publicacionesPorCodigos(ws: string, codigos: string[]): Promise<PublicacionFila[]>
  publicacionesPendientes(ws: string): Promise<PublicacionFila[]>
  /** TODAS las publicaciones del workspace, con el SKU de su producto. Sin orden garantizado. */
  catalogoPublicaciones(ws: string): Promise<PublicacionCatalogo[]>
  insertarPublicacion(fila: Omit<PublicacionFila, 'id'>): Promise<PublicacionFila>
  /**
   * Actualiza solo si `version_canal` sigue siendo `versionEsperada`. `false` = otra escritura
   * se metió en medio y no se tocó nada.
   */
  actualizarPublicacion(
    ws: string,
    id: string,
    versionEsperada: number,
    cambios: Partial<PublicacionFila>,
  ): Promise<boolean>

  insertarEventos(eventos: EventoNuevo[]): Promise<void>
  eventosDesde(ws: string, publicacionId: string, desde: string): Promise<EventoFila[]>

  guardarMediciones(filas: MedicionFila[]): Promise<void>
  guardarConversaciones(filas: ConversacionFila[]): Promise<void>
  insertarVenta(fila: VentaFila): Promise<void>
}
