/**
 * Repositorio en memoria del módulo Ferretería, para las pruebas. Reproduce lo que la base
 * garantiza y el núcleo da por hecho: unicidad de SKU y código por workspace, upsert de
 * mediciones por (publicación, fecha) y de conversaciones por clave, control de versión al
 * actualizar una publicación y una bitácora que solo crece.
 */
import type {
  ConversacionFila,
  CostoFila,
  EventoFila,
  EventoNuevo,
  MedicionFila,
  ProductoFila,
  PublicacionFila,
  RepoFerreteria,
  TokenFila,
  VentaFila,
} from './tipos'

export interface EstadoMemoria {
  tokens: (TokenFila & { token_hash: string; ultimo_uso_at?: string | null })[]
  modulos: Record<string, boolean>
  productos: ProductoFila[]
  costos: CostoFila[]
  publicaciones: PublicacionFila[]
  eventos: EventoFila[]
  mediciones: MedicionFila[]
  conversaciones: ConversacionFila[]
  ventas: VentaFila[]
}

export function estadoVacio(): EstadoMemoria {
  return { tokens: [], modulos: {}, productos: [], costos: [], publicaciones: [], eventos: [], mediciones: [], conversaciones: [], ventas: [] }
}

export function repoEnMemoria(estado: EstadoMemoria = estadoVacio(), reloj: () => string = () => new Date().toISOString()): RepoFerreteria & { estado: EstadoMemoria } {
  let seq = 0
  const nuevoId = (p: string) => `${p}-${++seq}`
  const copia = <T>(v: T): T => structuredClone(v)

  return {
    estado,
    async buscarTokenPorHash(hash) {
      const t = estado.tokens.find((x) => x.token_hash === hash)
      return t ? copia({ id: t.id, workspace_id: t.workspace_id, nombre: t.nombre, escritor: t.escritor, revocado_at: t.revocado_at }) : null
    },
    async marcarUsoToken(id, cuando) {
      const t = estado.tokens.find((x) => x.id === id)
      if (t) t.ultimo_uso_at = cuando
    },
    async moduloActivo(ws) {
      return estado.modulos[ws] === true
    },
    async productoPorSku(ws, sku) {
      const p = estado.productos.find((x) => x.workspace_id === ws && x.sku === sku)
      return p ? copia(p) : null
    },
    async productoPorId(ws, id) {
      const p = estado.productos.find((x) => x.workspace_id === ws && x.id === id)
      return p ? copia(p) : null
    },
    async guardarProducto(fila) {
      const i = estado.productos.findIndex((x) => x.workspace_id === fila.workspace_id && x.sku === fila.sku)
      if (i >= 0) {
        estado.productos[i] = { ...estado.productos[i], ...copia(fila), id: estado.productos[i].id }
        return copia(estado.productos[i])
      }
      const nueva = { ...copia(fila), id: nuevoId('prod') } as ProductoFila
      estado.productos.push(nueva)
      return copia(nueva)
    },
    async costos(ws, productoId) {
      return copia(estado.costos.filter((c) => c.workspace_id === ws && c.producto_id === productoId))
    },
    async guardarCosto(fila) {
      const i = estado.costos.findIndex((c) => c.producto_id === fila.producto_id && c.fecha_lista === fila.fecha_lista)
      if (i >= 0) estado.costos[i] = { ...estado.costos[i], ...copia(fila) }
      else estado.costos.push({ ...copia(fila), id: nuevoId('costo') })
    },
    async publicacionPorCodigo(ws, codigo) {
      const p = estado.publicaciones.find((x) => x.workspace_id === ws && x.codigo === codigo)
      return p ? copia(p) : null
    },
    async publicacionPorId(ws, id) {
      const p = estado.publicaciones.find((x) => x.workspace_id === ws && x.id === id)
      return p ? copia(p) : null
    },
    async publicacionesPorCodigos(ws, codigos) {
      return copia(estado.publicaciones.filter((x) => x.workspace_id === ws && codigos.includes(x.codigo)))
    },
    async publicacionesPendientes(ws) {
      return copia(estado.publicaciones.filter((x) => x.workspace_id === ws && x.pendiente_en_canal))
    },
    async insertarPublicacion(fila) {
      if (estado.publicaciones.some((x) => x.workspace_id === fila.workspace_id && x.codigo === fila.codigo)) {
        throw new Error(`duplicate key: ${fila.codigo}`)
      }
      const nueva = { ...copia(fila), id: nuevoId('pub') }
      estado.publicaciones.push(nueva)
      return copia(nueva)
    },
    async actualizarPublicacion(ws, id, versionEsperada, cambios) {
      const p = estado.publicaciones.find((x) => x.workspace_id === ws && x.id === id)
      if (!p || p.version_canal !== versionEsperada) return false
      Object.assign(p, copia(cambios))
      return true
    },
    async insertarEventos(eventos: EventoNuevo[]) {
      for (const e of eventos) estado.eventos.push({ ...copia(e), id: nuevoId('ev'), created_at: reloj() })
    },
    async eventosDesde(ws, publicacionId, desde) {
      return copia(
        estado.eventos
          .filter((e) => e.workspace_id === ws && e.publicacion_id === publicacionId && e.created_at >= desde)
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      )
    },
    async guardarMediciones(filas) {
      for (const f of filas) {
        const i = estado.mediciones.findIndex((m) => m.publicacion_id === f.publicacion_id && m.fecha === f.fecha)
        if (i >= 0) estado.mediciones[i] = copia(f)
        else estado.mediciones.push(copia(f))
      }
    },
    async guardarConversaciones(filas) {
      for (const f of filas) {
        const i = estado.conversaciones.findIndex((c) => c.workspace_id === f.workspace_id && c.clave === f.clave)
        if (i >= 0) estado.conversaciones[i] = { ...estado.conversaciones[i], ...copia(f) }
        else estado.conversaciones.push({ ...copia(f), id: nuevoId('conv') })
      }
    },
    async insertarVenta(fila) {
      estado.ventas.push({ ...copia(fila), id: nuevoId('venta') })
    },
  }
}
