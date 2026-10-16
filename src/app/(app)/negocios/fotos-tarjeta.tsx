'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { claveDeFoto } from '@/lib/fotos/clave'
import type { ElementoVista } from '@/lib/fotos/vista'
import { fotosParaTarjetas, type FotosDeTarjetas } from '../fotos/actions'
import type { PedidoFoto } from '../fotos/selector-fotos'

/**
 * La biblioteca de fotos vista desde las tarjetas de la cotización (Mauricio, 2026-10-16: el
 * recuadro de la foto del hotel es la puerta a la biblioteca). Cada tarjeta dice qué foto
 * necesita (`useFotoDeBiblioteca`) y el proveedor las pide TODAS en una sola acción: las server
 * actions de Next van en fila, una por tarjeta haría esperar a la cotización entera.
 *
 * Sin proveedor (o sin biblioteca en el espacio) la tarjeta queda como antes: la foto en la opción.
 */

/** Lo cambió alguien (la tarjeta, el panel «Fotos de la propuesta»): los demás vuelven a leer. */
export const EVENTO_FOTOS_BIBLIOTECA = 'one:fotos-biblioteca'

export function avisarCambioDeFotos(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENTO_FOTOS_BIBLIOTECA))
}

const llave = (p: PedidoFoto) => `${p.tipo}:${claveDeFoto(p.tipo, p.nombre, p.ciudad)}`

interface Estado {
  /** `null` = todavía no se sabe; `false` = el espacio no tiene biblioteca. */
  disponible: boolean | null
  editable: boolean
  sitioOficial: boolean
  /** Lo leído por llave; `null` = leído y sin fotos. Ausente = sin leer. */
  elementos: Record<string, ElementoVista | null>
}

interface Contexto {
  estado: Estado
  registrar: (p: PedidoFoto) => () => void
  poner: (p: PedidoFoto, e: ElementoVista | null) => void
}

const Ctx = createContext<Contexto | null>(null)

export function FotosEnTarjetas({
  children,
  leer = fotosParaTarjetas,
}: {
  children: ReactNode
  /** Inyectable para verla con datos de muestra. */
  leer?: (pedidos: PedidoFoto[]) => Promise<FotosDeTarjetas>
}) {
  const [estado, setEstado] = useState<Estado>({ disponible: null, editable: false, sitioOficial: false, elementos: {} })
  const pedidos = useRef(new Map<string, { pedido: PedidoFoto; usos: number }>())
  const pedidas = useRef(new Set<string>())
  const [version, setVersion] = useState(0)
  const disponible = useRef<boolean | null>(null)

  const cargar = useCallback(
    async (todas: boolean) => {
      if (disponible.current === false) return
      const faltan = [...pedidos.current.entries()].filter(([k]) => todas || !pedidas.current.has(k))
      if (faltan.length === 0) return
      for (const [k] of faltan) pedidas.current.add(k)
      try {
        const r = await leer(faltan.map(([, v]) => v.pedido))
        if (!r.ok) {
          disponible.current = false
          setEstado((e) => ({ ...e, disponible: false }))
          return
        }
        disponible.current = true
        const porLlave = new Map(r.elementos.map((e) => [`${e.tipo}:${e.clave}`, e]))
        setEstado((e) => {
          const elementos = { ...e.elementos }
          for (const [k] of faltan) elementos[k] = porLlave.get(k) ?? null
          return { disponible: true, editable: r.editable, sitioOficial: r.sitioOficial, elementos }
        })
      } catch {
        // Sin red: se reintenta con la próxima tarjeta o el próximo cambio.
        for (const [k] of faltan) pedidas.current.delete(k)
      }
    },
    [leer],
  )

  // Las tarjetas que aparecen en el mismo render se piden juntas.
  useEffect(() => {
    if (version === 0) return
    const t = setTimeout(() => void cargar(false), 0)
    return () => clearTimeout(t)
  }, [version, cargar])

  useEffect(() => {
    const otraVez = () => void cargar(true)
    window.addEventListener(EVENTO_FOTOS_BIBLIOTECA, otraVez)
    return () => window.removeEventListener(EVENTO_FOTOS_BIBLIOTECA, otraVez)
  }, [cargar])

  const registrar = useCallback((p: PedidoFoto) => {
    const k = llave(p)
    const actual = pedidos.current.get(k)
    pedidos.current.set(k, { pedido: p, usos: (actual?.usos ?? 0) + 1 })
    if (!pedidas.current.has(k)) setVersion((v) => v + 1)
    return () => {
      const v = pedidos.current.get(k)
      if (!v) return
      if (v.usos <= 1) pedidos.current.delete(k)
      else pedidos.current.set(k, { ...v, usos: v.usos - 1 })
    }
  }, [])

  const poner = useCallback((p: PedidoFoto, e: ElementoVista | null) => {
    setEstado((s) => ({ ...s, elementos: { ...s.elementos, [llave(p)]: e } }))
  }, [])

  const valor = useMemo(() => ({ estado, registrar, poner }), [estado, registrar, poner])
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export interface FotoDeBiblioteca {
  /** `null` = todavía no se sabe. */
  disponible: boolean | null
  editable: boolean
  sitioOficial: boolean
  /** `undefined` = sin leer; `null` = sin fotos en la biblioteca. */
  elemento: ElementoVista | null | undefined
  poner: (e: ElementoVista | null) => void
}

/** La foto de la biblioteca para lo que muestra una tarjeta. `null` sin proveedor o sin pedido. */
export function useFotoDeBiblioteca(pedido: PedidoFoto | null): FotoDeBiblioteca | null {
  const ctx = useContext(Ctx)
  const tipo = pedido?.tipo
  const nombre = pedido?.nombre
  const ciudad = pedido?.ciudad ?? null
  const registrar = ctx?.registrar
  useEffect(() => {
    if (!registrar || !tipo || !nombre) return
    return registrar({ tipo, nombre, ciudad })
  }, [registrar, tipo, nombre, ciudad])
  if (!ctx || !pedido || !pedido.nombre) return null
  const k = llave(pedido)
  return {
    disponible: ctx.estado.disponible,
    editable: ctx.estado.editable,
    sitioOficial: ctx.estado.sitioOficial,
    elemento: ctx.estado.elementos[k],
    poner: (e) => ctx.poner(pedido, e),
  }
}
