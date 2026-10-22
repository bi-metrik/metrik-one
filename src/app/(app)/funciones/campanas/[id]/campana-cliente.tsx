'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
import { toast } from 'sonner'
import type { CampanaPanel, FuncionAgenda } from '@/lib/funciones/datos'
import { ETIQUETA_ESTADO_CAMPANA, insigniaFuncion, pesos } from '@/lib/funciones/reglas'
import {
  agregarFuncionesAction,
  cambiarCuposAction,
  cambiarEstadoCampanaAction,
  cambiarEstadoFuncionAction,
  duplicarCampanaAction,
  eliminarCampanaAction,
  eliminarFuncionAction,
  guardarAnuncioAction,
  guardarCampanaAction,
  publicarCampanaAction,
  type LineaAgenda,
} from '../../actions'
import { AgendaEditor } from '../../agenda-editor'
import { conDeshacer, copiar, Hoja, Insignia } from '../../panel-ui'

const AVISO_POST = 'El texto del post se activa cuando se apruebe la ficha.'

type HojaAbierta =
  | { tipo: 'precios' }
  | { tipo: 'menu' }
  | { tipo: 'post' }
  | { tipo: 'publicar' }
  | { tipo: 'confirmar'; titulo: string; efecto: string; texto: string; peligro?: boolean; accion: () => void }
  | { tipo: 'funcion'; f: FuncionAgenda }
  | { tipo: 'cupo'; f: FuncionAgenda }
  | null

/** La campaña (§4.2, §4.5, §4.6): estado, código copiable, precios, agenda, post y el ⋮ de la campaña. */
export function CampanaCliente({ campana: c, puedeEditar, ahoraMs }: { campana: CampanaPanel; puedeEditar: boolean; ahoraMs: number }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [hoja, setHoja] = useState<HojaAbierta>(null)
  const [agregando, setAgregando] = useState(false)
  const [lineas, setLineas] = useState<LineaAgenda[] | null>(null)
  const vivas = c.funciones.filter((f) => f.estado !== 'cancelada')
  const ultima = c.funciones[c.funciones.length - 1]

  const correr = (f: () => Promise<{ ok: boolean; error?: string }>, ok: string, despues?: () => void) =>
    empezar(async () => {
      const r = await f()
      setHoja(null)
      if (!r.ok) return void toast.error(r.error ?? 'No se pudo.')
      toast.success(ok)
      despues?.()
      router.refresh()
    })

  const estadoCampana = (estado: 'activa' | 'pausada' | 'cerrada') => cambiarEstadoCampanaAction(c.campana_id, estado)

  const reactivar = () =>
    empezar(async () => {
      const r = await estadoCampana('activa')
      setHoja(null)
      if (!r.ok) return void toast.error(r.error)
      conDeshacer('Campaña activa: el asistente vuelve a ofrecer sus funciones.', async () => {
        const d = await estadoCampana('pausada')
        router.refresh()
        return d
      })
      router.refresh()
    })

  const reactivarFuncion = (f: FuncionAgenda) =>
    empezar(async () => {
      const r = await cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'activa')
      setHoja(null)
      if (!r.ok) return void toast.error(r.error)
      conDeshacer('Función activa.', async () => {
        const d = await cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'pausada')
        router.refresh()
        return d
      })
      router.refresh()
    })

  const duplicar = () =>
    empezar(async () => {
      const r = await duplicarCampanaAction(c.campana_id)
      setHoja(null)
      if (!r.ok) return void toast.error(r.error)
      conDeshacer('Campaña duplicada: agrégale la agenda.', async () => {
        const d = await eliminarCampanaAction(r.dato!)
        router.push(`/funciones/campanas/${c.campana_id}`)
        return d
      })
      router.push(`/funciones/campanas/${r.dato}`)
    })

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-24 md:p-6">
      <header className="space-y-2">
        <Link href="/funciones" className="text-xs text-[#6B7280] hover:underline">← Campañas</Link>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-[#1A1A1A]">{c.nombre}</h1>
            <Link href={`/funciones/experiencias/${c.experiencia.experiencia_id}`} className="text-sm text-[#6B7280] hover:underline">{c.experiencia.nombre}</Link>
          </div>
          <div className="flex items-center gap-1">
            <Insignia texto={ETIQUETA_ESTADO_CAMPANA[c.estado] ?? c.estado} />
            {puedeEditar && (
              <button type="button" aria-label="Más acciones de la campaña" onClick={() => setHoja({ tipo: 'menu' })} className="flex size-10 items-center justify-center rounded-md hover:bg-gray-100">
                <MoreVertical className="size-5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-[#6B7280]">Código</span>
          <code className="rounded bg-gray-100 px-2 py-0.5 font-mono">{c.codigo}</code>
          <button type="button" onClick={() => copiar(c.codigo, 'Código copiado.')} className="text-[#059669] underline">Copiar</button>
        </div>
        <div className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm">
          <span>
            {pesos(c.precio_persona)}
            {c.precio_preventa_persona ? ` · prev ${pesos(c.precio_preventa_persona)}` : ''}
            {c.abono_persona ? ` · abono ${pesos(c.abono_persona)}` : ''}
            {c.permite_pago_total ? '' : ' · sin pago total'}
          </span>
          {puedeEditar && <button type="button" onClick={() => setHoja({ tipo: 'precios' })} className="text-[#059669] underline">Cambiar</button>}
        </div>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-[#1A1A1A]">Agenda</h2>
        {c.funciones.length === 0 && <p className="rounded-lg border border-dashed border-[#E5E7EB] p-4 text-sm text-[#6B7280]">Sin funciones todavía. Agrégalas abajo.</p>}
        <ul className="space-y-2">
          {c.funciones.map((f) => {
            const insignia = insigniaFuncion(f)
            const paraEquipo = Math.max(f.capacidad - f.ocupadas, 0)
            return (
              <li key={f.funcion_id} className="rounded-lg border border-[#E5E7EB] bg-white">
                <div className="flex items-center gap-2 px-3 py-2">
                  <Link href={`/funciones/${f.funcion_id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#1A1A1A] first-letter:uppercase">{f.inicia_texto}</div>
                    <div className="text-xs text-[#6B7280]">
                      {f.ocupadas}/{f.cupo_asistente} asist · {f.ocupadas}/{f.capacidad}
                      {f.es_preventa ? ' · preventa' : ''}
                    </div>
                  </Link>
                  <Insignia texto={insignia} />
                  {puedeEditar && (
                    <button type="button" aria-label="Acciones de la función" onClick={() => setHoja({ tipo: 'funcion', f })} className="flex size-10 items-center justify-center rounded-md hover:bg-gray-100">
                      <MoreVertical className="size-4" />
                    </button>
                  )}
                </div>
                {insignia === 'Llena para el asistente' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[#E5E7EB] px-3 py-2 text-xs">
                    <span className="text-sky-700">Quedan {paraEquipo} para el equipo</span>
                    <Link href={`/funciones/${f.funcion_id}`} className="rounded border border-[#E5E7EB] px-2 py-1">Agendar a mano</Link>
                    {puedeEditar && <button type="button" onClick={() => setHoja({ tipo: 'cupo', f })} className="rounded border border-[#E5E7EB] px-2 py-1">Subir cupo del asistente</button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        {puedeEditar && c.estado !== 'cerrada' && (
          agregando ? (
            <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3">
              <AgendaEditor onCambio={setLineas} ahoraMs={ahoraMs} />
              <p className="text-xs text-[#6B7280]">Con el cupo de la última función: {ultima ? `${ultima.capacidad} · asistente ${ultima.cupo_asistente}` : 'escríbelo en el detalle de cada función después'}.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setAgregando(false)} className="h-11 rounded-md border border-[#E5E7EB] px-4 text-sm">Cerrar</button>
                <button
                  type="button"
                  disabled={pendiente || !lineas || !ultima}
                  onClick={() => correr(() => agregarFuncionesAction(c.campana_id, lineas!, ultima!.capacidad, ultima!.cupo_asistente), 'Funciones agregadas.', () => setAgregando(false))}
                  className="h-11 flex-1 rounded-md bg-[#10B981] text-sm font-medium text-white disabled:opacity-50"
                >
                  Agregar {lineas?.length ?? 0} funciones
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAgregando(true)} className="h-11 w-full rounded-md border border-dashed border-[#E5E7EB] text-sm">+ Agregar funciones</button>
          )
        )}
        {puedeEditar && !ultima && agregando && <p className="text-xs text-amber-700">La primera agenda se arma desde «Nueva campaña» (pide el cupo).</p>}
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={() => setHoja({ tipo: 'post' })} className="h-11 flex-1 rounded-md border border-[#E5E7EB] text-sm">Ver post</button>
        {puedeEditar && !c.publicada && (
          <button type="button" disabled={vivas.length === 0} onClick={() => setHoja({ tipo: 'publicar' })} className="h-11 flex-1 rounded-md bg-[#10B981] text-sm font-medium text-white disabled:opacity-50">
            Publicar y copiar post
          </button>
        )}
      </div>

      {/* ── Hojas ── */}
      <Hoja abierta={hoja?.tipo === 'post'} onCerrar={() => setHoja(null)} titulo="Post de Instagram" efecto={AVISO_POST}>
        <button type="button" disabled className="h-11 w-full rounded-md border border-[#E5E7EB] text-sm opacity-50">Copiar post</button>
      </Hoja>

      <Hoja
        abierta={hoja?.tipo === 'publicar'}
        onCerrar={() => setHoja(null)}
        titulo="Publicar la campaña"
        efecto={`Las ${vivas.length} funciones quedan disponibles para el asistente desde ya. Hoy solo se publica: ${AVISO_POST.toLowerCase()}`}
        confirmar={{ texto: 'Publicar', pendiente, onConfirmar: () => correr(() => publicarCampanaAction(c.campana_id), `Publicada. ${AVISO_POST}`) }}
      />

      {hoja?.tipo === 'confirmar' && (
        <Hoja
          abierta
          onCerrar={() => setHoja(null)}
          titulo={hoja.titulo}
          efecto={hoja.efecto}
          confirmar={{ texto: hoja.texto, peligro: hoja.peligro, pendiente, onConfirmar: hoja.accion }}
        />
      )}

      <Hoja abierta={hoja?.tipo === 'menu'} onCerrar={() => setHoja(null)} titulo={c.nombre}>
        <MenuCampana
          c={c}
          pendiente={pendiente}
          onPausar={() =>
            setHoja({
              tipo: 'confirmar', titulo: 'Pausar la campaña', texto: 'Pausar',
              efecto: `El asistente deja de ofrecer sus ${vivas.length} funciones. Las reservas hechas siguen.`,
              accion: () => correr(() => estadoCampana('pausada'), 'Campaña pausada.'),
            })
          }
          onReactivar={reactivar}
          onCerrarCampana={() =>
            setHoja({
              tipo: 'confirmar', titulo: 'Cerrar la campaña', texto: 'Cerrar',
              efecto: 'No se vende más. Las reservas hechas siguen. Igual se cierra sola cuando pasa su última función.',
              accion: () => correr(() => estadoCampana('cerrada'), 'Campaña cerrada.'),
            })
          }
          onDuplicar={duplicar}
          onEliminar={() =>
            setHoja({
              tipo: 'confirmar', titulo: 'Eliminar la campaña', texto: 'Eliminar', peligro: true,
              efecto: c.funciones.some((f) => f.reservas_activas > 0)
                ? 'Tiene reservas: queda en el historial (archivada) y no se lista ni se vende.'
                : 'No tiene reservas: se borra con su agenda.',
              accion: () => correr(() => eliminarCampanaAction(c.campana_id), 'Campaña eliminada.', () => router.push('/funciones')),
            })
          }
        />
      </Hoja>

      {hoja?.tipo === 'precios' && <HojaPrecios c={c} onCerrar={() => setHoja(null)} onGuardar={(f) => correr(f, 'Precios guardados. Las reservas hechas conservan su precio.')} pendiente={pendiente} />}

      {hoja?.tipo === 'funcion' && (
        <Hoja abierta onCerrar={() => setHoja(null)} titulo={hoja.f.inicia_texto}>
          <div className="grid gap-2">
            {hoja.f.estado === 'activa' && (
              <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => {
                const f = hoja.f
                setHoja({
                  tipo: 'confirmar', titulo: 'Pausar la función', texto: 'Pausar',
                  efecto: 'El asistente deja de ofrecerla. El equipo puede seguir agendando a mano. Las reservas hechas siguen.',
                  accion: () => correr(() => cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'pausada'), 'Función pausada.'),
                })
              }}>Pausar</button>
            )}
            {hoja.f.estado === 'pausada' && (
              <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => reactivarFuncion(hoja.f)}>Reactivar</button>
            )}
            <button type="button" className="h-11 rounded-md border border-[#E5E7EB] text-sm" onClick={() => setHoja({ tipo: 'cupo', f: hoja.f })}>Cambiar cupos</button>
            {hoja.f.estado !== 'cancelada' && (
              <button type="button" className="h-11 rounded-md border border-red-200 text-sm text-red-700" onClick={() => {
                const f = hoja.f
                setHoja({
                  tipo: 'confirmar', titulo: 'Cancelar la función', texto: 'Cancelar función', peligro: true,
                  efecto: f.reservas_activas > 0 ? `Tiene ${f.reservas_activas} reservas: hay que avisarles.` : 'No tiene reservas.',
                  accion: () => correr(() => cambiarEstadoFuncionAction(c.campana_id, f.funcion_id, 'cancelada'), 'Función cancelada.'),
                })
              }}>Cancelar función</button>
            )}
            <button type="button" className="h-11 rounded-md border border-red-200 text-sm text-red-700" onClick={() => {
              const f = hoja.f
              setHoja({
                tipo: 'confirmar', titulo: 'Eliminar la función', texto: 'Eliminar', peligro: true,
                efecto: f.reservas_activas > 0 ? 'Tiene reservas: queda en el historial (archivada) y no se vende.' : 'No tiene reservas: se borra.',
                accion: () => correr(() => eliminarFuncionAction(c.campana_id, f.funcion_id), 'Función eliminada.'),
              })
            }}>Eliminar</button>
          </div>
        </Hoja>
      )}

      {hoja?.tipo === 'cupo' && <HojaCupos c={c} f={hoja.f} pendiente={pendiente} onCerrar={() => setHoja(null)} onGuardar={(cap, asist) => correr(() => cambiarCuposAction(c.campana_id, hoja.f.funcion_id, cap, asist), 'Cupos guardados.')} />}
    </div>
  )
}

function MenuCampana(p: {
  c: CampanaPanel
  pendiente: boolean
  onPausar: () => void
  onReactivar: () => void
  onCerrarCampana: () => void
  onDuplicar: () => void
  onEliminar: () => void
}) {
  const { c } = p
  const router = useRouter()
  const [nombre, setNombre] = useState(c.nombre)
  const [codigo, setCodigo] = useState(c.codigo)
  const [anuncio, setAnuncio] = useState('')
  const [pendiente, empezar] = useTransition()
  const guardarDatos = () =>
    empezar(async () => {
      const r = await guardarCampanaAction(c.campana_id, {
        experiencia_id: c.experiencia.experiencia_id, nombre, codigo, desde: c.desde, hasta: c.hasta, estado: c.estado_guardado,
        minutos_apartado: c.minutos_apartado,
        precios: { precio_persona: c.precio_persona, precio_preventa_persona: c.precio_preventa_persona, abono_persona: c.abono_persona, permite_pago_total: c.permite_pago_total, tope_sobreventa: c.tope_sobreventa },
      })
      if (!r.ok) return void toast.error(r.error)
      toast.success('Datos guardados.')
      router.refresh()
    })
  const anuncioAccion = (ad: string, quitar: boolean) =>
    empezar(async () => {
      const r = await guardarAnuncioAction(c.campana_id, ad, quitar)
      if (!r.ok) return void toast.error(r.error)
      setAnuncio('')
      router.refresh()
    })
  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'
  return (
    <div className="max-h-[70vh] space-y-4 overflow-y-auto text-sm">
      <div className="grid gap-2">
        {c.estado === 'activa' || c.estado === 'agotada' ? (
          <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onPausar}>Pausar</button>
        ) : null}
        {c.estado === 'pausada' && <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onReactivar}>Reactivar</button>}
        {c.estado !== 'cerrada' && c.publicada && <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onCerrarCampana}>Cerrar</button>}
        <button type="button" className="h-11 rounded-md border border-[#E5E7EB]" onClick={p.onDuplicar}>Duplicar</button>
        <button type="button" className="h-11 rounded-md border border-red-200 text-red-700" onClick={p.onEliminar}>Eliminar</button>
      </div>

      <div className="space-y-2 border-t border-[#E5E7EB] pt-3">
        <p className="font-medium">Datos de la campaña</p>
        <label className="block">Nombre<input value={nombre} onChange={(e) => setNombre(e.target.value)} className={campo} /></label>
        <label className="block">
          Código de atribución
          <input value={codigo} disabled={c.publicada} onChange={(e) => setCodigo(e.target.value.toUpperCase())} className={`${campo} font-mono disabled:bg-gray-50`} />
          {c.publicada && <span className="text-xs text-[#6B7280]">Publicada: el código ya no cambia.</span>}
        </label>
        <p className="text-xs text-[#6B7280]">Fechas: {c.desde ?? '—'} a {c.hasta ?? '—'} (de la primera a la última función).</p>
        <button type="button" disabled={pendiente || p.pendiente} onClick={guardarDatos} className="h-11 w-full rounded-md bg-[#10B981] font-medium text-white disabled:opacity-50">Guardar datos</button>
      </div>

      <div className="space-y-2 border-t border-[#E5E7EB] pt-3">
        <p className="font-medium">Anuncios de WhatsApp</p>
        <p className="text-xs text-[#6B7280]">El id de cada anuncio que lleva a esta campaña: así el asistente sabe de qué campaña viene el cliente.</p>
        {c.anuncios.map((a) => (
          <div key={a} className="flex items-center justify-between rounded border border-[#E5E7EB] px-2 py-1">
            <code className="font-mono text-xs">{a}</code>
            <button type="button" onClick={() => anuncioAccion(a, true)} className="text-xs text-red-700">Quitar</button>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={anuncio} onChange={(e) => setAnuncio(e.target.value.trim())} placeholder="Id del anuncio" className="h-11 flex-1 rounded-md border border-[#E5E7EB] px-3 font-mono" />
          <button type="button" disabled={!anuncio || pendiente} onClick={() => anuncioAccion(anuncio, false)} className="h-11 rounded-md border border-[#E5E7EB] px-3 disabled:opacity-50">Agregar</button>
        </div>
      </div>
    </div>
  )
}

function HojaPrecios(p: { c: CampanaPanel; onCerrar: () => void; onGuardar: (f: () => Promise<{ ok: boolean; error?: string }>) => void; pendiente: boolean }) {
  const { c } = p
  const [precio, setPrecio] = useState(String(c.precio_persona ?? ''))
  const [preventa, setPreventa] = useState(String(c.precio_preventa_persona ?? ''))
  const [abono, setAbono] = useState(String(c.abono_persona ?? ''))
  const [total, setTotal] = useState(c.permite_pago_total)
  const [minutos, setMinutos] = useState(String(c.minutos_apartado ?? ''))
  const [tope, setTope] = useState(String(c.tope_sobreventa ?? ''))
  const n = (s: string) => (s.trim() ? Math.round(Number(s.replace(/[.$\s]/g, ''))) : null)
  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'
  return (
    <Hoja
      abierta
      onCerrar={p.onCerrar}
      titulo="Precios y reglas"
      efecto="Las reservas hechas conservan su precio."
      confirmar={{
        texto: 'Guardar', pendiente: p.pendiente,
        onConfirmar: () => p.onGuardar(() => guardarCampanaAction(c.campana_id, {
          experiencia_id: c.experiencia.experiencia_id, nombre: c.nombre, codigo: c.codigo, desde: c.desde, hasta: c.hasta,
          estado: c.estado_guardado, minutos_apartado: n(minutos),
          precios: { precio_persona: n(precio), precio_preventa_persona: n(preventa), abono_persona: n(abono), permite_pago_total: total, tope_sobreventa: n(tope) },
        })),
      }}
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Por persona<input inputMode="numeric" value={precio} onChange={(e) => setPrecio(e.target.value)} className={campo} /></label>
        <label>Preventa<input inputMode="numeric" value={preventa} onChange={(e) => setPreventa(e.target.value)} className={campo} /></label>
        <label>Abono por persona<input inputMode="numeric" value={abono} onChange={(e) => setAbono(e.target.value)} className={campo} /></label>
        <label className="flex items-end gap-2 pb-3"><input type="checkbox" checked={total} onChange={(e) => setTotal(e.target.checked)} className="size-5" /> Pago total</label>
        <label>Minutos de apartado<input inputMode="numeric" value={minutos} onChange={(e) => setMinutos(e.target.value)} className={campo} /></label>
        <label>Tope de sobreventa<input inputMode="numeric" value={tope} onChange={(e) => setTope(e.target.value)} className={campo} placeholder="Sin sobreventa" /></label>
      </div>
    </Hoja>
  )
}

function HojaCupos(p: { c: CampanaPanel; f: FuncionAgenda; pendiente: boolean; onCerrar: () => void; onGuardar: (cap: number, asist: number) => void }) {
  const [cap, setCap] = useState(String(p.f.capacidad))
  const [asist, setAsist] = useState(String(p.f.capacidad))
  const capN = Number(cap)
  const asistN = Number(asist)
  const bajaDeLoOcupado = capN < p.f.ocupadas
  const campo = 'mt-1 h-11 w-full rounded-md border border-[#E5E7EB] px-3 text-base'
  return (
    <Hoja
      abierta
      onCerrar={p.onCerrar}
      titulo={`Cupos · ${p.f.inicia_texto}`}
      efecto={`Hay ${p.f.ocupadas} personas ocupando. La capacidad no baja de ahí.`}
      confirmar={{ texto: 'Guardar', pendiente: p.pendiente || bajaDeLoOcupado || !(asistN >= 1 && asistN <= capN), onConfirmar: () => p.onGuardar(capN, asistN) }}
    >
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label>Cupo<input inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className={campo} /></label>
        <label>Cupo del asistente<input inputMode="numeric" value={asist} onChange={(e) => setAsist(e.target.value)} className={campo} /></label>
      </div>
      {bajaDeLoOcupado && <p className="text-xs text-red-600">Hay {p.f.ocupadas} ocupando: el cupo no puede quedar en {capN}.</p>}
    </Hoja>
  )
}
