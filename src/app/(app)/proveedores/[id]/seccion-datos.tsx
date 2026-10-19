'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { NOMBRE_TARIFA_CANAL, NOMBRE_TIPO_PROVEEDOR, TARIFA_CANALES, TIPOS_PROVEEDOR, etiquetasDeTexto, type TipoProveedor } from '@/lib/proveedores/tipos'
import { guardarDatos, type FichaProveedor, type PersonaEquipo } from '../actions'

const campo = 'block h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground disabled:opacity-70'
const etiqueta = 'min-w-0 space-y-0.5 text-[11px] text-muted-foreground'

const triestadoTexto = (v: boolean | null) => (v === true ? 'si' : v === false ? 'no' : '')

/**
 * «Datos» de la ficha. Solo nombre y tipo son obligatorios; el resto se llena cuando se sepa.
 * Las etiquetas se escriben separadas por coma y se guardan normalizadas («Luna de Miel» →
 * «luna de miel»).
 */
export default function SeccionDatos({
  ficha,
  equipo,
  mayoristas,
  editable,
  onGuardado,
}: {
  ficha: FichaProveedor
  equipo: PersonaEquipo[]
  mayoristas: PersonaEquipo[]
  editable: boolean
  onGuardado: () => void
}) {
  const [d, setD] = useState({
    nombre: ficha.nombre,
    tipoProveedor: ficha.tipoProveedor as TipoProveedor,
    ciudad: ficha.ciudad ?? '',
    pais: ficha.pais ?? '',
    estrellas: ficha.estrellas === null ? '' : String(ficha.estrellas),
    web: ficha.web ?? '',
    contactoNombre: ficha.contactoNombre ?? '',
    celular: ficha.celularOriginal ?? ficha.celular ?? '',
    correo: ficha.correo ?? '',
    telefono: ficha.telefono ?? '',
    direccion: ficha.direccion ?? '',
    notas: ficha.notas ?? '',
    etiquetas: ficha.etiquetas.join(', '),
    tarifasMayorista: ficha.tarifasMayorista,
    responsableId: ficha.responsableId ?? '',
    compradoViaId: ficha.compradoViaId ?? '',
    departamento: ficha.departamento ?? '',
    destino: ficha.destino ?? '',
    ivaDeclarado: triestadoTexto(ficha.ivaDeclarado),
    ivaIncluido: triestadoTexto(ficha.ivaIncluido),
    tarifaCanal: ficha.tarifaCanal ?? '',
  })
  const [guardando, setGuardando] = useState(false)
  const poner = (k: keyof typeof d) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value })

  const guardar = async () => {
    if (guardando) return
    setGuardando(true)
    try {
      const r = await guardarDatos(ficha.id, {
        ...d,
        estrellas: d.estrellas === '' ? null : Number(d.estrellas),
        etiquetas: etiquetasDeTexto(d.etiquetas),
        compradoViaId: d.tipoProveedor === 'mayorista' ? '' : d.compradoViaId,
      })
      if (!r.ok) return void toast.error(r.error)
      if (r.aviso) toast.warning(r.aviso)
      else toast.success(r.alias ? 'Guardado. Las cotizaciones lo reconocerán con su nombre y ciudad nuevos.' : 'Guardado')
      onGuardado()
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setGuardando(false)
    }
  }

  const ro = !editable
  return (
    <section className="space-y-3" data-seccion="datos">
      <h2 className="text-sm font-semibold">Datos</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={etiqueta}>
          Nombre
          <input className={campo} value={d.nombre} onChange={poner('nombre')} disabled={ro} />
        </label>
        <label className={etiqueta}>
          Tipo
          <select className={campo} value={d.tipoProveedor} onChange={poner('tipoProveedor')} disabled={ro}>
            {TIPOS_PROVEEDOR.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_TIPO_PROVEEDOR[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={etiqueta}>
          Ciudad (municipio donde duerme o se presta el servicio)
          <input className={campo} value={d.ciudad} onChange={poner('ciudad')} disabled={ro} placeholder="Cartagena" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={etiqueta}>
            Departamento
            <input className={campo} value={d.departamento} onChange={poner('departamento')} disabled={ro} placeholder="Bolívar" />
          </label>
          <label className={etiqueta}>
            Destino
            <input className={campo} value={d.destino} onChange={poner('destino')} disabled={ro} placeholder="Caribe - Cartagena" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={etiqueta}>
            País (código)
            <input className={campo} value={d.pais} onChange={(e) => setD({ ...d, pais: e.target.value.toUpperCase().slice(0, 2) })} disabled={ro} placeholder="CO" />
          </label>
          <label className={etiqueta}>
            Estrellas
            <select className={campo} value={d.estrellas} onChange={poner('estrellas')} disabled={ro}>
              <option value="">Sin dato</option>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n === 0 ? 'Sin categoría' : '★'.repeat(n)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className={etiqueta}>
          Persona de contacto
          <input className={campo} value={d.contactoNombre} onChange={poner('contactoNombre')} disabled={ro} />
        </label>
        <label className={etiqueta}>
          Celular o WhatsApp
          <input className={campo} value={d.celular} onChange={poner('celular')} disabled={ro} inputMode="tel" placeholder="300 123 4567" />
          {ficha.celular && <span className="block text-[10.5px]">Se marca como {ficha.celular}</span>}
        </label>
        <label className={etiqueta}>
          Correo de reservas
          <input className={campo} value={d.correo} onChange={poner('correo')} disabled={ro} inputMode="email" />
        </label>
        <label className={etiqueta}>
          Teléfono
          <input className={campo} value={d.telefono} onChange={poner('telefono')} disabled={ro} inputMode="tel" />
        </label>
        <label className={etiqueta}>
          Web
          <input className={campo} value={d.web} onChange={poner('web')} disabled={ro} placeholder="www.hotel.com" />
        </label>
        <label className={etiqueta}>
          Dirección
          <input className={campo} value={d.direccion} onChange={poner('direccion')} disabled={ro} />
        </label>
        <label className={`${etiqueta} sm:col-span-2`}>
          Etiquetas (separadas por coma: destino, «familias», «luna de miel», «lujo»…)
          <input className={campo} value={d.etiquetas} onChange={poner('etiquetas')} disabled={ro} />
        </label>
        <label className={etiqueta}>
          Responsable de mantener las tarifas
          <select className={campo} value={d.responsableId} onChange={poner('responsableId')} disabled={ro}>
            <option value="">Nadie todavía</option>
            {equipo.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        {d.tipoProveedor !== 'mayorista' && (
          <label className={etiqueta}>
            Se compra a través de (mayorista)
            <select className={campo} value={d.compradoViaId} onChange={poner('compradoViaId')} disabled={ro}>
              <option value="">Directo con el proveedor</option>
              {mayoristas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={etiqueta}>
          Tarifa
          <select className={campo} value={d.tarifaCanal} onChange={poner('tarifaCanal')} disabled={ro}>
            <option value="">No se sabe</option>
            {TARIFA_CANALES.map((t) => (
              <option key={t} value={t}>
                {NOMBRE_TARIFA_CANAL[t]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={etiqueta}>
            ¿Cobra IVA?
            <select className={campo} value={d.ivaDeclarado} onChange={poner('ivaDeclarado')} disabled={ro}>
              <option value="">No se sabe</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className={etiqueta}>
            ¿Sus precios lo incluyen?
            <select className={campo} value={d.ivaIncluido} onChange={poner('ivaIncluido')} disabled={ro}>
              <option value="">No se sabe</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        {d.ivaIncluido === 'si' && (
          <p className="m-0 text-[11px] text-[#9A5F0C] sm:col-span-2">ONE guarda los costos SIN IVA: al cargar un precio de este proveedor, descuéntale el IVA.</p>
        )}
        <label className="flex items-center gap-2 text-xs sm:col-span-2">
          <input type="checkbox" checked={d.tarifasMayorista} onChange={(e) => setD({ ...d, tarifasMayorista: e.target.checked })} disabled={ro} />
          Maneja tarifas de mayorista
        </label>
        <label className={`${etiqueta} sm:col-span-2`}>
          Notas
          <textarea className={`${campo} h-24 py-1.5`} value={d.notas} onChange={poner('notas')} disabled={ro} />
        </label>
      </div>
      {editable && (
        <button type="button" onClick={() => void guardar()} disabled={guardando || !d.nombre.trim()} className="inline-flex h-9 items-center gap-1 rounded-md bg-[#10B981] px-4 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50">
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar datos
        </button>
      )}
    </section>
  )
}
