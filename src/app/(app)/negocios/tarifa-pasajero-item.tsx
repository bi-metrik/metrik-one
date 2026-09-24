'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronRight, Image as ImageIcon, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  actualizarComposicionDeItem,
  confirmarMenorNoPaga,
  confirmarTarifaPorPasajero,
  corregirCampoDeFicha,
  elegirMonedaDeTarifa,
  leerCasillaDeItem,
  quitarCasillaDeItem,
} from '@/app/(app)/negocios/tarifa-pax-actions'
import FichaDeLinea from '@/app/(app)/negocios/ficha-linea-item'
import HabitacionesDeOpcion, { PegarOtraHabitacion } from '@/app/(app)/negocios/habitaciones-opcion'
import { conHabitaciones, recibeHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { descartarPropuestaDePantallazo } from '@/app/(app)/negocios/pantallazo-actions'
import { margenDelProveedor, type MargenProveedor } from '@/lib/cotizaciones/margen-proveedor'
import { formatMargenPct } from '@/lib/cotizaciones/margen-vista'
import type { DefinicionRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import {
  capturasDesactualizadas,
  casillasDe,
  composicionDeLectura,
  composicionDeLinea,
  confirmacionDesactualizada,
  confirmadaVigente,
  describirOcupacion,
  faltanPorAcomodar,
  formatoMonto,
  leerTarifaPax,
  lineaPorPasajero,
  MENSAJE_MONEDA_ASUMIDA,
  mismaComposicion,
  MONEDAS_FRECUENTES,
  monedaDeTarifa,
  ocupacionObservada,
  resolverTarifa,
  tarifaMasReciente,
  traeDesgloseCompleto,
  type CasillaDef,
  type ClaveCasilla,
  type Composicion,
  type LecturaCasilla,
  type MonedaDeTarifa,
  type TarifaPax,
} from '@/lib/cotizaciones/tarifa-pasajero'
import type { Correcciones } from '@/lib/cotizaciones/correcciones'
import { cifrasPorRevisar } from '@/lib/cotizaciones/ficha-linea'
import { parseMontoCop } from '@/lib/negocios/monto-cop'
import { formatBogotaFechaCorta } from '@/lib/dates/bogota'

/**
 * Pantallazos de una línea con precio por tipo de pasajero (diseño §6.1).
 *
 * ## El requisito de esta pantalla
 *
 * *«Que nadie dude qué soporte va en cada casilla.»* Nada de «captura A/B/C» ni de restas a
 * la vista: cada casilla dice con números y palabras la búsqueda literal que hay que hacer
 * en la plataforma (P3), y el resultado se muestra ya partido (P6). De dónde salió cada
 * número queda a un clic (CC5).
 *
 * ## Lo que decide el servidor, no esta pantalla
 *
 * Qué casillas existen, si un pantallazo coincide con la suya y el costo de cada pasajero
 * salen de `tarifa-pasajero.ts`, el MISMO módulo que usa la server action. Aquí solo se
 * pinta: si la pantalla tuviera su propia regla, las casillas que ve la persona y las que
 * acepta el servidor se desincronizarían en silencio.
 *
 * ## Lo que se pinta después de guardar
 *
 * Toda acción que escribe la tarifa devuelve la que quedó, y la casilla pinta con ella sin
 * esperar el refresco de la página: manda la más nueva de las dos (`tarifaMasReciente`).
 * Elegir la moneda también: `elegirMonedaDeTarifa` devuelve la tarifa guardada. (Hasta el
 * 2026-09-16 el camino de la moneda dejaba la casilla 1 vacía hasta recargar.)
 *
 * ## El orden del bloque (diseño del 2026-09-21, §3)
 *
 * 1. **La zona de pegado, SIEMPRE visible**, sin nada que llenar antes. Hasta el
 *    2026-09-21 solo se dibujaba con la composición ya declarada, así que un negocio sin
 *    pasajeros en la etapa 1 dejaba la línea **sin ningún sitio donde pegar** — el bloqueo
 *    que abrió este frente.
 * 2. Lo que encontró la lectura, incluida **a quién cubre**, que sale de la propia captura.
 * 3. Lo que falta: la siguiente captura, o la pregunta que la lectura no resolvió.
 *
 * La secuencia de capturas complementarias (2 y 3) arranca DESPUÉS de la primera lectura:
 * la razón por la que existen —saber qué casillas pedir— aplica a la SEGUNDA captura, no a
 * la primera.
 *
 * ## Lo que queda viejo se dice, no se borra (brief del 2026-09-22)
 *
 * Si cambian los pasajeros —de la línea o del viaje que la línea hereda—, cada captura
 * buscada para otros pasajeros lleva su alerta PERSISTENTE, dentro de su casilla y dicha en
 * palabras («Este pantallazo es para 2 adultos y la línea ahora cubre 3 adultos: pega uno
 * nuevo»). Pegar la nueva la quita. El costo cargado, igual: se queda y dice que es de otro
 * grupo. Y la moneda que la captura no mostraba queda SUPUESTA hasta un clic.
 */
export default function TarifaPasajeroItem({
  itemId,
  ranura,
  composicionViaje,
  tarifaPax,
  costoUnitarioLinea,
  sugeridosGuardados,
  onCambio,
}: {
  itemId: string
  ranura: DefinicionRanura
  /** La composición del viaje (etapa 1). `null` si el negocio no la tiene. */
  composicionViaje: Composicion | null
  /** `items.tarifa_pax` tal como llega. `undefined` mientras la migración no esté aplicada. */
  tarifaPax: unknown
  /** Costo unitario confirmado de la línea, para saber si el reparto guardado sigue vigente. */
  costoUnitarioLinea: number
  /** Propuesta pendiente del cargue de pantallazo anterior a la tarifa por pasajero. */
  sugeridosGuardados?: { id: string }[]
  onCambio: () => void
}) {
  // Lo último que el servidor confirmó haber guardado desde esta casilla. No reemplaza a la
  // página: solo gana mientras sea más nuevo que ella.
  const [guardada, setGuardada] = useState<TarifaPax | null>(null)
  const tarifa = tarifaMasReciente(leerTarifaPax(tarifaPax), guardada)
  const composicion = composicionDeLinea(tarifa, composicionViaje)
  const casillas = tarifa.casillas ?? {}

  const [leyendo, setLeyendo] = useState<ClaveCasilla | null>(null)
  const [previews, setPreviews] = useState<Partial<Record<ClaveCasilla, string>>>({})
  const [rechazos, setRechazos] = useState<Partial<Record<ClaveCasilla, RechazoDeCasilla>>>({})
  const [ultimoMensaje, setUltimoMensaje] = useState<string | null>(null)
  const [detalleAbierto, setDetalleAbierto] = useState<Partial<Record<ClaveCasilla | 'resultado', boolean>>>({})
  const [editandoComposicion, setEditandoComposicion] = useState(false)
  const [tasa, setTasa] = useState('')
  const [isPending, startTransition] = useTransition()

  // R8 · una opción de hotel con varias habitaciones se cotiza por sus habitaciones, contra
  // el grupo del negocio. Su bloque es otro: cupos, papel de cada captura y costo por
  // habitación (`habitaciones-opcion.tsx`).
  if (conHabitaciones(tarifa)) {
    return (
      <HabitacionesDeOpcion
        itemId={itemId}
        tarifa={tarifa}
        composicionViaje={composicionViaje}
        onGuardada={setGuardada}
        onCambio={onCambio}
        monedaSlot={(
          <MonedaDeLaTarifa
            itemId={itemId}
            info={monedaDeTarifa(tarifa)}
            deshabilitado={isPending}
            onGuardada={setGuardada}
            onCambio={onCambio}
          />
        )}
      />
    )
  }

  // La moneda con que se costea (la elegida, la leída o COP supuesta) y lo que quedó viejo.
  // Salen del MISMO módulo que usa el servidor: la pantalla no puede dar por vigente lo que
  // la confirmación va a rechazar.
  const monedaTarifa = monedaDeTarifa(tarifa)
  const viejas = composicion ? capturasDesactualizadas(composicion, casillas, ranura.slug) : []
  const alertaDe = (clave: ClaveCasilla) => viejas.find(v => v.clave === clave)?.mensaje ?? null
  const confirmacionVieja = confirmacionDesactualizada(tarifa, composicion)

  const defs = composicion ? casillasDe(composicion, ranura.slug) : []
  const estado = composicion ? resolverTarifa(composicion, casillas, ranura.slug, { moneda: monedaTarifa.moneda }) : null
  const primera = casillas.grupo_completo
  const primeraResuelve = !!(composicion && primera && traeDesgloseCompleto(primera, composicion))

  // §2.1 · la secuencia de tres casillas solo existe cuando la primera lectura NO resolvió.
  // Mientras tanto hay UNA zona de pegado y ningún número: numerar una casilla 1 obliga a
  // preguntarse dónde están la 2 y la 3.
  const enSecuencia = !!composicion && !!primera && !primeraResuelve && defs.length > 1
  const complementarias = defs.slice(1).filter(d => enSecuencia || !!casillas[d.clave])
  const defPrimera: CasillaDef = enSecuencia
    ? defs[0]
    : { ...(defs[0] ?? DEF_SIN_COMPOSICION), titulo: 'Pantallazo del proveedor', busqueda: '' }

  // De dónde salió la ocupación de la línea, y a quién del viaje le falta sitio (§2.4).
  const ocupacionLeida = primera ? composicionDeLectura(primera) : null
  const laPusoElPantallazo = !!(tarifa.composicion && ocupacionLeida && mismaComposicion(ocupacionLeida, tarifa.composicion))
  const faltan = composicion ? faltanPorAcomodar(composicion, composicionViaje) : null
  // La pregunta que la lectura no resolvió: sale DESPUÉS de pegar y diciendo por qué.
  const pedirComposicion = !composicion && !!primera
  const mostrarComposicion = !!composicion && (!!primera || !!tarifa.composicion)

  function leer(clave: ClaveCasilla, dataUrl: string, enfoque: OpcionParaElegir | null = null) {
    setPreviews(p => ({ ...p, [clave]: dataUrl }))
    setRechazos(r => ({ ...r, [clave]: undefined }))
    setUltimoMensaje(null)
    setLeyendo(clave)
    void (async () => {
      try {
        // Sin moneda visible ya no hay rechazo que resolver aquí: la lectura se guarda con
        // COP supuesta y la pregunta sale DESPUÉS, persistente (`MonedaDeLaTarifa`).
        const r = await leerCasillaDeItem(itemId, clave, dataUrl, null, enfoque)
        if (r.ok) {
          setGuardada(r.tarifa)
          setUltimoMensaje(r.mensaje)
          setPreviews(p => ({ ...p, [clave]: undefined }))
          onCambio()
        } else {
          // P8 · con opciones legibles se guarda la imagen para volver a leerla sobre la que
          // toque la persona, sin pedirle que la pegue otra vez.
          setRechazos(x => ({ ...x, [clave]: { mensaje: r.mensaje, detalle: r.detalle, opciones: r.opciones, dataUrl } }))
        }
      } finally {
        setLeyendo(null)
      }
    })()
  }

  function pegar(clave: ClaveCasilla, e: React.ClipboardEvent) {
    const entrada = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!entrada) return
    e.preventDefault()
    const archivo = entrada.getAsFile()
    if (!archivo) return
    const lector = new FileReader()
    lector.onload = ev => leer(clave, ev.target?.result as string)
    lector.readAsDataURL(archivo)
  }

  function accion(fn: () => Promise<{ success: boolean; error?: string; tarifa?: TarifaPax }>, exito: string) {
    startTransition(async () => {
      const r = await fn()
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      if (r.tarifa) setGuardada(r.tarifa)
      toast.success(exito)
      onCambio()
    })
  }

  // La ficha espera la respuesta para cerrar su editor solo si se guardó: con un error, lo
  // que escribió la persona sigue en pantalla para corregirlo.
  async function corregir(slug: string, valor: string | null): Promise<boolean> {
    const r = await corregirCampoDeFicha(itemId, slug, valor)
    if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return false }
    if (r.tarifa) setGuardada(r.tarifa)
    toast.success(valor === null ? 'Vuelve a lo que leyó el pantallazo.' : 'Corrección guardada. Lo que leyó el pantallazo sigue guardado.')
    onCambio()
    return true
  }

  const monedaResuelta = estado?.estado === 'resuelta' ? estado.moneda : 'COP'
  const enCOP = monedaResuelta === 'COP'
  // ⚠️ Por el normalizador único de montos: la tasa se escribe en formato colombiano. Con
  // `Number()` sobre el texto limpio, «4.150» era 4,15 y el costo en pesos salía mil veces menor.
  const tasaNum = parseMontoCop(tasa) ?? Number.NaN
  const tasaValida = enCOP || (Number.isFinite(tasaNum) && tasaNum > 0)

  // ¿Hay una lectura más nueva que la última confirmación, o la confirmación quedó vieja
  // (otros pasajeros, otra moneda)? Entonces hay algo por confirmar.
  const ultimaLectura = Object.values(casillas).reduce<string>((m, l) => (l && l.leidaEn > m ? l.leidaEn : m), '')
  const confirmada = tarifa.confirmada ?? null
  const hayPorConfirmar = estado?.estado === 'resuelta'
    && (!confirmada || ultimaLectura > confirmada.confirmadaEn || !!confirmacionVieja)
  const confirmadaAlDia = !!confirmada && confirmadaVigente(confirmada, costoUnitarioLinea)
  // El margen que la captura ya fija. Se calcula con el MISMO helper que usa el servidor al
  // confirmar: escrito dos veces, la pantalla anunciaría un porcentaje y la línea guardaría
  // otro (es la lección de `seleccionSupuesta`). Los montos, en la moneda de la línea.
  const margenLeido = margenDelProveedor(casillas.grupo_completo)
  const margenProveedor = margenLeido ? { ...margenLeido, moneda: monedaTarifa.moneda } : null

  return (
    <div className="mt-3 rounded-lg border border-dashed p-3">
      {/* ── Qué se pide, ANTES de pegar ── */}
      <div className="mb-2">
        <p className="text-[11px] font-medium">Pantallazo de {ranura.label.toLowerCase()} · precio por pasajero</p>
        <p className="text-[10px] text-muted-foreground">{ranura.queSePide}</p>
        <p className="text-[10px] text-muted-foreground">No sirve: {ranura.queNoSirve}</p>
        <p className="text-[10px] text-muted-foreground">La imagen no se guarda: queda lo que se leyó de ella.</p>
      </div>

      {(sugeridosGuardados?.length ?? 0) > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 p-2">
          <p className="text-[11px] text-amber-900">
            Hay una propuesta de costo de un pantallazo anterior, sin confirmar. No está en el costo.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => accion(() => descartarPropuestaDePantallazo(itemId), 'Propuesta anterior descartada.')}
            className="shrink-0 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Descartar
          </button>
        </div>
      )}

      {/* ── 1 · LA ZONA DE PEGADO, siempre visible ────────────────────────────
          Es lo primero del bloque y no depende de que nadie haya declarado nada. */}
      <Casilla
        def={defPrimera}
        numerada={enSecuencia}
        lectura={primera}
        ficha={{ ranura, correcciones: tarifa.correcciones, onGuardar: corregir }}
        rechazo={rechazos.grupo_completo}
        desactualizada={alertaDe('grupo_completo')}
        moneda={monedaTarifa}
        preview={previews.grupo_completo}
        leyendo={leyendo === 'grupo_completo'}
        detalleAbierto={!!detalleAbierto.grupo_completo}
        deshabilitado={isPending || leyendo !== null}
        onToggleDetalle={() => setDetalleAbierto(x => ({ ...x, grupo_completo: !x.grupo_completo }))}
        onQuitar={() => accion(() => quitarCasillaDeItem(itemId, 'grupo_completo'), 'Pantallazo quitado.')}
        onPegar={e => pegar('grupo_completo', e)}
        onElegir={o => {
          const url = rechazos.grupo_completo?.dataUrl
          if (url) leer('grupo_completo', url, o)
        }}
      />

      {/* ── La moneda de la tarifa (parte 2): editable, COP por defecto, nunca callada ──
          Aparece con la primera lectura. Si la captura no la mostraba, la alerta queda
          aquí hasta que alguien la acepte o la cambie: el costo no se confirma antes. */}
      {primera && (
        <MonedaDeLaTarifa
          itemId={itemId}
          info={monedaTarifa}
          deshabilitado={isPending || leyendo !== null}
          onGuardada={setGuardada}
          onCambio={onCambio}
        />
      )}

      {/* R8 · el grupo en más de una habitación del mismo hotel. */}
      {primera && ranura.slug === 'hotel_detalle' && recibeHabitaciones(tarifa) && (
        <PegarOtraHabitacion
          itemId={itemId}
          deshabilitado={isPending || leyendo !== null}
          onGuardada={setGuardada}
          onCambio={onCambio}
        />
      )}

      {/* ── 2 · A quién cubre esta línea: RESULTADO de la lectura (§2.4, P7) ──
          Solo se habla cuando hay algo que decir: después de una lectura, o cuando
          alguien ajustó la ocupación a mano. Antes de pegar no se pregunta nada. */}
      {(mostrarComposicion || pedirComposicion || editandoComposicion) && (
        <ComposicionDeLinea
          itemId={itemId}
          composicion={composicion}
          esPropia={!!tarifa.composicion}
          laPusoElPantallazo={laPusoElPantallazo}
          faltan={faltan}
          hayViaje={!!composicionViaje}
          editando={editandoComposicion || pedirComposicion}
          motivo={pedirComposicion ? 'Este pantallazo no dice a cuántos pasajeros cubre.' : null}
          onEditar={setEditandoComposicion}
          hayLecturas={Object.keys(casillas).length > 0}
          onGuardada={setGuardada}
          onCambio={onCambio}
        />
      )}

      {composicion && (
        <div className="mt-2 space-y-2">
          {/* ── 3 · Lo que falta: las capturas complementarias (CC4a) ──────────
              Nacen DESPUÉS de la primera lectura, cuando ya se sabe qué falta. */}
          {complementarias.map(d => (
            <Casilla
              key={d.clave}
              def={d}
              numerada
              lectura={casillas[d.clave]}
              rechazo={rechazos[d.clave]}
              desactualizada={alertaDe(d.clave)}
              moneda={monedaTarifa}
              preview={previews[d.clave]}
              leyendo={leyendo === d.clave}
              detalleAbierto={!!detalleAbierto[d.clave]}
              deshabilitado={isPending || leyendo !== null}
              onToggleDetalle={() => setDetalleAbierto(x => ({ ...x, [d.clave]: !x[d.clave] }))}
              onQuitar={() => accion(() => quitarCasillaDeItem(itemId, d.clave), `Pantallazo ${d.numero} quitado.`)}
              onPegar={e => pegar(d.clave, e)}
              onElegir={o => {
                const url = rechazos[d.clave]?.dataUrl
                if (url) leer(d.clave, url, o)
              }}
            />
          ))}

          {/* ── Qué encontró (P4) y qué falta ── */}
          {ultimoMensaje && estado?.estado !== 'falta' && estado?.estado !== 'resuelta' && estado?.estado !== 'desactualizada' && (
            <p className="text-[11px] font-medium">{ultimoMensaje}</p>
          )}
          {/* Las capturas viejas ya dicen, cada una en su casilla, qué hay que reemplazar.
              Aquí solo el efecto: con ellas no hay costo, ni se puede confirmar. */}
          {estado?.estado === 'desactualizada' && (
            <p className="rounded-md bg-red-50 p-2 text-[11px] font-medium text-red-900">
              {estado.capturas.length === 1
                ? 'Hay un pantallazo buscado para otros pasajeros: el costo por pasajero no se calcula hasta reemplazarlo.'
                : `Hay ${estado.capturas.length} pantallazos buscados para otros pasajeros: el costo por pasajero no se calcula hasta reemplazarlos.`}
            </p>
          )}
          {estado?.estado === 'falta' && (
            <p className="rounded-md bg-amber-50 p-2 text-[11px] font-medium text-amber-900">{estado.mensaje}</p>
          )}
          {estado?.estado === 'inconsistente' && (
            <p className="rounded-md bg-red-50 p-2 text-[11px] font-medium text-red-900">{estado.mensaje}</p>
          )}
          {estado?.estado === 'confirmar_menor_no_paga' && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2">
              <p className="text-[11px] font-medium text-amber-900">{estado.mensaje}</p>
              <button
                type="button"
                disabled={isPending}
                onClick={() => accion(() => confirmarMenorNoPaga(itemId, estado.casilla.clave), 'Queda registrado que ese pasajero no paga.')}
                className="mt-1.5 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Confirmo: no paga en este proveedor
              </button>
            </div>
          )}

          {/* ── El resultado, ya partido (P6) ── */}
          {estado?.estado === 'resuelta' && hayPorConfirmar && (
            <div className="space-y-2 rounded-md border bg-background p-2.5">
              {/* Por qué se vuelve a confirmar, cuando lo cargado quedó viejo. */}
              {confirmacionVieja && (
                <p className="flex items-start gap-1.5 rounded bg-amber-50 p-1.5 text-[11px] font-medium text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {confirmacionVieja.mensaje}
                </p>
              )}
              <p className="text-[11px] font-medium">{ultimoMensaje ?? estado.mensaje}</p>
              <p className="text-sm font-semibold tabular-nums">{lineaPorPasajero(estado.costos, estado.moneda)}</p>
              <p className="text-[10px] text-muted-foreground">
                Costo por pasajero, de {describirOcupacion(composicion)}. Es una propuesta: no entra al costo hasta que confirmes.
              </p>

              <MargenDelPantallazo margen={margenProveedor} />

              <button
                type="button"
                onClick={() => setDetalleAbierto(x => ({ ...x, resultado: !x.resultado }))}
                className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
              >
                {detalleAbierto.resultado ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                De dónde sale cada valor
              </button>
              {detalleAbierto.resultado && (
                <ul className="space-y-0.5 pl-4 text-[10px] text-muted-foreground">
                  {estado.costos.map(c => (
                    <li key={c.tipo}>
                      <span className="font-medium text-foreground">{lineaPorPasajero([c], estado.moneda)}</span>: {c.deDonde}
                    </li>
                  ))}
                </ul>
              )}

              {Object.values(casillas).flatMap(l => l?.alertas ?? []).filter((a, i, arr) => arr.indexOf(a) === i).map((a, i) => (
                <p key={i} className="flex items-start gap-1.5 rounded bg-amber-50 p-1.5 text-[10px] text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {a}
                </p>
              ))}

              {!enCOP && (
                <div>
                  <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                    Tasa de cambio {monedaResuelta} → COP
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={tasa}
                    onChange={e => setTasa(e.target.value)}
                    placeholder="ej. 4150"
                    aria-label={`Tasa de cambio ${monedaResuelta} a COP`}
                    className="w-40 rounded border bg-background px-2 py-1 text-sm"
                  />
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    El sistema no consulta la TRM: la escribes tú y queda en el costo.
                  </p>
                </div>
              )}

              {/* La moneda supuesta frena aquí también: el servidor lo rechaza igual, y un
                  botón que se deja apretar para responder «no» enseña a ignorar la pantalla. */}
              {monedaTarifa.asumida && (
                <p className="text-[10px] font-medium text-amber-800">
                  Acepta o cambia la moneda de la tarifa (arriba) para poder confirmar el costo.
                </p>
              )}
              <button
                type="button"
                disabled={isPending || !tasaValida || monedaTarifa.asumida}
                onClick={() => accion(() => confirmarTarifaPorPasajero(itemId, enCOP ? null : tasaNum), 'Costo por pasajero cargado. Revisa el margen de la línea.')}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Confirmar y cargar el costo
              </button>
              <p className="text-[10px] text-muted-foreground">
                Al confirmar, esto REEMPLAZA los rubros de la línea. El precio lo calcula el margen.
              </p>
            </div>
          )}

          {confirmada && !hayPorConfirmar && (
            <div className={confirmacionVieja
              ? 'rounded-md border border-amber-300 bg-amber-50 p-2'
              : 'rounded-md border border-emerald-200 bg-emerald-50/60 p-2'}
            >
              {/* Lo cargado sigue siendo el costo de la línea (nadie lo borra), pero si es de
                  otro grupo u otra moneda se dice ENCIMA, no debajo en letra chica. */}
              {confirmacionVieja && (
                <p className="mb-1 flex items-start gap-1.5 text-[11px] font-medium text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {confirmacionVieja.mensaje}
                </p>
              )}
              <p className={`text-[11px] font-medium ${confirmacionVieja ? 'text-amber-900' : 'text-emerald-900'}`}>
                Costo cargado por pasajero: {lineaPorPasajero(confirmada.costos.map(c => ({ tipo: c.tipo, unitario: c.unitarioCOP })), 'COP')}
              </p>
              {confirmada.margenProveedor && (
                <p className="mt-0.5 text-[10px] text-emerald-900">
                  Margen {formatMargenPct(confirmada.margenProveedor.margenPct)}, puesto por el pantallazo. La línea se vende
                  en {formatoMonto(confirmada.margenProveedor.precioCliente, confirmada.margenProveedor.moneda)}.
                </p>
              )}
              {!confirmadaAlDia && (
                <p className="mt-0.5 text-[10px] text-amber-800">
                  El costo de la línea cambió después de confirmar. El precio por pasajero no se imprime hasta volver a confirmar.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * La casilla 1 cuando la línea todavía no sabe a cuántos cubre: una zona de pegado y nada
 * más. No hay búsqueda literal que dictar porque la ocupación sale de la propia captura.
 */
const DEF_SIN_COMPOSICION: CasillaDef = {
  clave: 'grupo_completo',
  numero: 1,
  titulo: 'Pantallazo del proveedor',
  ocupacion: { adultos: 1, ninos: 0, infantes: 0 },
  busqueda: '',
  condicional: false,
  razonCondicional: null,
}

/** Una opción leída de una captura con varias (P8). */
type OpcionParaElegir = { nombre: string; precio: string | null }

/** Por qué no se guardó un pantallazo, y lo necesario para elegir sin volver a pegarlo. */
type RechazoDeCasilla = {
  mensaje: string
  detalle?: string
  opciones?: OpcionParaElegir[]
  dataUrl?: string
}

/**
 * «¿Cuál de estas?» (P8 del ensayo del 2026-09-23). La captura traía varias opciones y
 * ninguna marcada: en vez de mandar a la persona de vuelta al proveedor, se le muestran las
 * que se leyeron y toca la que va a cotizar.
 */
export function ElegirOpcion({
  opciones,
  onElegir,
  deshabilitado,
}: {
  opciones: OpcionParaElegir[]
  onElegir: (o: OpcionParaElegir) => void
  deshabilitado: boolean
}) {
  return (
    <div className="mt-1.5 space-y-1 pl-5" role="group" aria-label="¿Cuál de estas?">
      {opciones.map(o => (
        <button
          key={`${o.nombre}|${o.precio ?? ''}`}
          type="button"
          disabled={deshabilitado}
          onClick={() => onElegir(o)}
          className="flex w-full items-center justify-between gap-2 rounded border border-red-200 bg-white px-2 py-1 text-left text-[11px] text-foreground hover:bg-red-100 disabled:opacity-50"
        >
          <span className="min-w-0 flex-1 truncate">{o.nombre}</span>
          {o.precio && <span className="shrink-0 tabular-nums font-medium">{o.precio}</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * Una casilla: su instrucción, lo que se leyó en ella y dónde pegar.
 *
 * `numerada` es la diferencia entre la zona de pegado única del comienzo y una de las tres
 * casillas de la secuencia complementaria. El número solo aparece cuando hay más de una: un
 * «1» solitario obliga a preguntarse dónde están la 2 y la 3.
 */
function Casilla({
  def,
  numerada,
  lectura,
  rechazo,
  desactualizada,
  moneda,
  preview,
  leyendo,
  detalleAbierto,
  deshabilitado,
  onToggleDetalle,
  onQuitar,
  onPegar,
  ficha,
  onElegir,
}: {
  def: CasillaDef
  numerada: boolean
  lectura: LecturaCasilla | undefined
  /**
   * Solo la captura principal: su lectura es la que llega al documento, y ahí se corrige.
   * Las complementarias existen para el costo por pasajero y se muestran como se leyeron.
   */
  ficha?: {
    ranura: DefinicionRanura
    correcciones: Correcciones | undefined
    onGuardar: (slug: string, valor: string | null) => Promise<boolean>
  }
  rechazo?: RechazoDeCasilla
  /** P8 · la persona tocó una de las opciones leídas: se relee la misma imagen sobre ella. */
  onElegir?: (opcion: OpcionParaElegir) => void
  /**
   * La captura se buscó para otros pasajeros (`capturasDesactualizadas`). La alerta vive
   * DENTRO de la casilla, pegada a lo que hay que reemplazar, y se va sola al pegar la nueva.
   */
  desactualizada: string | null
  /** La moneda con que se costea la línea: los montos leídos se dicen en ella. */
  moneda: MonedaDeTarifa
  preview?: string
  leyendo: boolean
  detalleAbierto: boolean
  deshabilitado: boolean
  onToggleDetalle: () => void
  onQuitar: () => void
  onPegar: (e: React.ClipboardEvent) => void
}) {
  const comoSeLlama = numerada ? `el pantallazo ${def.numero}: ${def.titulo}` : 'el pantallazo del proveedor'
  return (
    <div className="rounded-md border bg-background p-2.5">
      <div className="flex items-start gap-2">
        {numerada && (
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {def.numero}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">{def.titulo}</p>
          {/* La búsqueda literal. Es EL requisito de la pantalla (P3). */}
          {def.busqueda && <p className="text-[11px] text-foreground">{def.busqueda}</p>}

          {lectura && (
            <LecturaResumen
              lectura={lectura}
              moneda={moneda}
              abierta={detalleAbierto}
              onToggle={onToggleDetalle}
              onQuitar={onQuitar}
              deshabilitado={deshabilitado}
              ficha={ficha}
            />
          )}

          {/* Persistente, no un toast: se queda mientras la captura sea de otra ocupación. */}
          {lectura && desactualizada && (
            <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-red-300 bg-red-50 p-2 text-[11px] font-medium text-red-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {desactualizada}
            </p>
          )}

          <div
            onPaste={onPegar}
            tabIndex={0}
            aria-label={`Pegar ${comoSeLlama}`}
            className="mt-1.5 flex min-h-[52px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed bg-muted/30 p-2 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {leyendo ? (
              <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
                <Loader2 className="h-3 w-3 animate-spin" /> Leyendo {comoSeLlama}…
              </span>
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL del portapapeles, no optimizable por next/image
              <img src={preview} alt={`Pantallazo ${def.numero} pegado`} className="max-h-20 rounded object-contain" />
            ) : (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ImageIcon className="h-4 w-4" />
                {lectura
                  ? 'Pega otro pantallazo aquí para reemplazar este (Ctrl+V / Cmd+V)'
                  : numerada
                    ? 'Pega aquí el pantallazo con Ctrl+V / Cmd+V'
                    : 'Pega aquí el pantallazo del proveedor (Ctrl+V / Cmd+V)'}
              </span>
            )}
          </div>

          {rechazo && (
            <div className="mt-1.5 rounded-md border border-red-300 bg-red-50 p-2">
              <p className="flex items-start gap-1.5 text-[11px] font-medium text-red-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {rechazo.mensaje}
              </p>
              {(rechazo.opciones ?? []).length > 0 && onElegir ? (
                <ElegirOpcion opciones={rechazo.opciones ?? []} onElegir={onElegir} deshabilitado={leyendo || deshabilitado} />
              ) : (
                <>
                  {rechazo.detalle && <p className="mt-0.5 pl-5 text-[10px] text-red-800">{rechazo.detalle}</p>}
                  <p className="mt-0.5 pl-5 text-[10px] text-red-700">Este pantallazo no se guardó.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * La moneda de la tarifa: editable, COP por defecto, y nunca callada (brief del 2026-09-22).
 *
 * ## Por qué la supuesta se ve distinto de la leída
 *
 * «$» solo no dice si son pesos o dólares, y un USD tomado por COP deja el costo miles de
 * veces corto: es el error más caro del motor. Cuando la captura no la mostraba, COP va
 * PRESELECCIONADA pero con alerta persistente y un clic para aceptarla o cambiarla; el
 * servidor no confirma el costo antes (`MENSAJE_MONEDA_ASUMIDA`).
 *
 * ## Lo que dijo la IA no se pierde
 *
 * Elegir otra moneda se guarda aparte, con quién y cuándo (patrón de #821). Si la captura sí
 * mostraba una y la persona eligió otra, se enseñan las dos.
 */
function MonedaDeLaTarifa({
  itemId,
  info,
  deshabilitado,
  onGuardada,
  onCambio,
}: {
  itemId: string
  info: MonedaDeTarifa
  deshabilitado: boolean
  onGuardada: (tarifa: TarifaPax) => void
  onCambio: () => void
}) {
  const [cambiando, setCambiando] = useState(false)
  const [otra, setOtra] = useState('')
  const [isPending, startTransition] = useTransition()
  const apagado = deshabilitado || isPending

  function elegir(moneda: string | null) {
    startTransition(async () => {
      const r = await elegirMonedaDeTarifa(itemId, moneda)
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar la moneda'); return }
      if (r.tarifa) onGuardada(r.tarifa)
      toast.success(
        r.confirmacionDesactualizada
          ? 'Moneda cambiada. El costo que estaba cargado quedó desactualizado: vuelve a confirmarlo.'
          : moneda === null
            ? 'Vuelve a la moneda que muestra el pantallazo.'
            : `La tarifa queda en ${moneda.toUpperCase()}.`,
      )
      setCambiando(false)
      setOtra('')
      onCambio()
    })
  }

  const opciones = (
    <div className="flex flex-wrap items-center gap-1.5">
      {MONEDAS_FRECUENTES.map(m => (
        <button
          key={m}
          type="button"
          disabled={apagado}
          onClick={() => elegir(m)}
          className={`rounded border px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50 ${
            m === info.moneda && !info.asumida ? 'border-primary bg-primary/10' : 'bg-background'
          }`}
        >
          {info.asumida && m === 'COP' ? 'Sí, es COP' : m}
        </button>
      ))}
      <input
        value={otra}
        onChange={e => setOtra(e.target.value.toUpperCase().slice(0, 3))}
        placeholder="Otra"
        aria-label="Otra moneda (código de tres letras)"
        className="w-16 rounded border bg-background px-1.5 py-0.5 text-[11px] uppercase"
      />
      {otra.length === 3 && (
        <button
          type="button"
          disabled={apagado}
          onClick={() => elegir(otra)}
          className="rounded border bg-background px-2 py-0.5 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
        >
          Usar {otra}
        </button>
      )}
    </div>
  )

  if (info.asumida) {
    return (
      <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-2">
        <p className="flex items-start gap-1.5 text-[11px] font-medium text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {MENSAJE_MONEDA_ASUMIDA}
        </p>
        <p className="mt-0.5 pl-5 text-[10px] text-amber-800">
          «$» solo no dice si son pesos o dólares. Un precio en dólares tomado por pesos deja el costo miles de veces corto.
        </p>
        <div className="mt-1.5 pl-5">{opciones}</div>
      </div>
    )
  }

  const origen = info.origen === 'persona' && info.decision
    ? `la eligió ${info.decision.por ?? 'una persona'}${info.decision.en ? ` · ${formatBogotaFechaCorta(info.decision.en)}` : ''}`
    : 'leída del pantallazo'
  // Lo que dijo la IA, cuando la persona eligió otra: se enseña al lado, nunca en su lugar.
  const leidaDistinta = info.origen === 'persona' && info.leida && info.leida !== info.moneda ? info.leida : null

  return (
    <div className="mt-2 rounded-md bg-muted/30 px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]">
          <span className="font-medium">Moneda de la tarifa:</span> {info.moneda}
          <span className="ml-1 text-muted-foreground">· {origen}</span>
          {leidaDistinta && <span className="ml-1 text-amber-800">· el pantallazo dice {leidaDistinta}</span>}
        </p>
        <div className="flex items-center gap-2">
          {leidaDistinta && (
            <button
              type="button"
              disabled={apagado}
              onClick={() => elegir(null)}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Volver a {leidaDistinta}
            </button>
          )}
          <button
            type="button"
            disabled={apagado}
            onClick={() => setCambiando(v => !v)}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            <Pencil className="h-3 w-3" /> Cambiar moneda
          </button>
        </div>
      </div>
      {cambiando && <div className="mt-1.5">{opciones}</div>}
    </div>
  )
}

/**
 * El margen que el pantallazo ya trae, dicho con los tres números que lo sostienen.
 *
 * ⚠️ Los DOS precios se nombran. «Margen 10,4%» a secas obliga a creerle a la pantalla; con
 * «cliente $2.029.118 · agencia $1.818.919» quien confirma puede cotejarlo contra la imagen
 * que acaba de pegar, que es justo lo que se le está pidiendo que haga.
 */
function MargenDelPantallazo({ margen }: { margen: MargenProveedor | null }) {
  if (!margen) return null
  return (
    <p className="rounded bg-emerald-50 p-1.5 text-[10px] text-emerald-900">
      <span className="font-medium">Este pantallazo ya trae el margen: {formatMargenPct(margen.margenPct)}.</span>{' '}
      Paga el cliente {formatoMonto(margen.precioCliente, margen.moneda)} y paga la agencia{' '}
      {formatoMonto(margen.costoAgencia, margen.moneda)}. Al confirmar, la línea queda con ese margen: no hace falta
      escribirlo.
    </p>
  )
}

function LecturaResumen({
  lectura,
  moneda,
  abierta,
  onToggle,
  onQuitar,
  deshabilitado,
  ficha,
}: {
  lectura: LecturaCasilla
  /** La moneda con que se costea la línea: los montos se dicen en ella, no en la leída. */
  moneda: MonedaDeTarifa
  abierta: boolean
  onToggle: () => void
  onQuitar: () => void
  deshabilitado: boolean
  ficha?: {
    ranura: DefinicionRanura
    correcciones: Correcciones | undefined
    onGuardar: (slug: string, valor: string | null) => Promise<boolean>
  }
}) {
  const corregidos = Object.keys(ficha?.correcciones ?? {}).length
  // Montos en pesos por debajo del piso de verosimilitud: se cuentan aquí, con la ficha cerrada,
  // porque «revisa esta cifra» no puede depender de que alguien abra el detalle para verlo.
  const porRevisar = ficha ? cifrasPorRevisar(ficha.ranura, lectura.campos, ficha.correcciones, lectura.moneda).size : 0
  const obs = ocupacionObservada(lectura)
  const ocupacion = lectura.ocupacionDelItem
    ? 'ocupación no visible en la imagen'
    : obs.adultos !== null || obs.ninos !== null || obs.infantes !== null
      ? describirOcupacion({ adultos: obs.adultos ?? 0, ninos: obs.ninos ?? 0, infantes: obs.infantes ?? 0 })
      : `${obs.total} personas`
  const mon = moneda.moneda
  return (
    <div className="mt-1.5 rounded border bg-muted/20 px-2 py-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]">
          <span className="font-medium">Leído:</span> {formatoMonto(lectura.total, mon)}
          {moneda.asumida && <span className="font-medium text-amber-800"> (moneda sin confirmar)</span>} · {ocupacion}
          {lectura.porTipo.length > 0 && ' · con precio por tipo de pasajero'}
          {lectura.aPagarAgencia !== null && ` · a pagar agencia ${formatoMonto(lectura.aPagarAgencia, mon)}`}
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground">
            {abierta ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {ficha ? 'Ver y corregir lo leído' : 'Ver lo leído'}
            {corregidos > 0 && (
              <span className="ml-0.5 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-900">
                {corregidos} {corregidos === 1 ? 'corregido' : 'corregidos'}
              </span>
            )}
            {porRevisar > 0 && (
              <span className="ml-0.5 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 text-[9px] font-medium text-amber-900">
                <AlertTriangle className="h-2.5 w-2.5" />
                {porRevisar === 1 ? 'revisa una cifra' : `revisa ${porRevisar} cifras`}
              </span>
            )}
          </button>
          <button type="button" disabled={deshabilitado} onClick={onQuitar} className="flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground hover:text-red-700 disabled:opacity-50">
            <X className="h-3 w-3" /> Quitar
          </button>
        </div>
      </div>
      {abierta && ficha && (
        <>
          {lectura.porTipo.length > 0 && (
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
              {lectura.porTipo.map(f => (
                <div key={f.tipo} className="min-w-0">
                  <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Fila {f.tipo === 'nino' ? 'niños' : f.tipo === 'adulto' ? 'adultos' : 'infantes'}</span>
                  <span className="block truncate text-[11px] tabular-nums">{f.cantidad} · {formatoMonto(f.subtotal, mon)}</span>
                </div>
              ))}
            </div>
          )}
          <FichaDeLinea
            ranura={ficha.ranura}
            campos={lectura.campos}
            moneda={lectura.moneda}
            correcciones={ficha.correcciones}
            deshabilitado={deshabilitado}
            onGuardar={ficha.onGuardar}
          />
        </>
      )}
      {abierta && !ficha && (
        <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 sm:grid-cols-3">
          {lectura.porTipo.map(f => (
            <div key={f.tipo} className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">Fila {f.tipo === 'nino' ? 'niños' : f.tipo === 'adulto' ? 'adultos' : 'infantes'}</span>
              <span className="block truncate text-[11px] tabular-nums">{f.cantidad} · {formatoMonto(f.subtotal, mon)}</span>
            </div>
          ))}
          {lectura.campos.map(c => (
            <div key={c.label} className="min-w-0">
              <span className="block text-[9px] uppercase tracking-wide text-muted-foreground">{c.label}</span>
              <span className="block truncate text-[11px]">{c.valor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * A quién cubre la línea: un RESULTADO de la lectura, corregible con un clic (§2.4).
 *
 * ⚠️ Solo habla cuando hay algo que decir. Antes de la primera lectura no aparece: la
 * ocupación sale del pantallazo, y preguntarla antes era pedir el dato que la captura trae
 * en la mayoría de los casos. Y contra los pasajeros del viaje **solo se avisa lo que
 * falta**: una línea que cubre a todos no dice nada.
 */
function ComposicionDeLinea({
  itemId,
  composicion,
  esPropia,
  laPusoElPantallazo,
  faltan,
  hayViaje,
  editando,
  motivo,
  onEditar,
  hayLecturas,
  onGuardada,
  onCambio,
}: {
  itemId: string
  composicion: Composicion | null
  esPropia: boolean
  /** La ocupación de la línea es la que leyó la captura, no una que alguien escribió. */
  laPusoElPantallazo: boolean
  /** Pasajeros del viaje que esta línea deja sin acomodar, o `null` si no falta nadie. */
  faltan: Composicion | null
  hayViaje: boolean
  editando: boolean
  /** Por qué se está preguntando, cuando la lectura no lo resolvió. */
  motivo: string | null
  onEditar: (v: boolean) => void
  hayLecturas: boolean
  onGuardada: (tarifa: TarifaPax) => void
  onCambio: () => void
}) {
  const [adultos, setAdultos] = useState(String(composicion?.adultos ?? ''))
  const [ninos, setNinos] = useState(String(composicion?.ninos ?? 0))
  const [infantes, setInfantes] = useState(String(composicion?.infantes ?? 0))
  const [isPending, startTransition] = useTransition()

  function guardar(propia: { adultos: string; ninos: string; infantes: string } | null) {
    startTransition(async () => {
      const r = await actualizarComposicionDeItem(itemId, propia)
      if (!r.success) { toast.error(r.error ?? 'No se pudo guardar'); return }
      if (r.tarifa) onGuardada(r.tarifa)
      // Nada se borra: lo que quedó viejo lleva su alerta en la casilla (brief del 2026-09-22).
      toast.success((r.desactualizadas ?? 0) > 0 || r.confirmacionDesactualizada
        ? 'Pasajeros de la línea actualizados. Los pantallazos de la ocupación anterior quedaron marcados: pega uno nuevo.'
        : 'Pasajeros de la línea actualizados.')
      onEditar(false)
      onCambio()
    })
  }

  if (!editando && composicion) {
    return (
      <div className="mt-2 rounded-md bg-muted/30 px-2 py-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px]">
            <span className="font-medium">Esta línea cubre:</span> {describirOcupacion(composicion, 'y')}
            <span className="ml-1 text-muted-foreground">
              · {laPusoElPantallazo ? 'leído del pantallazo' : esPropia ? 'ajustado en esta línea' : 'la del viaje'}
            </span>
          </p>
          <button
            type="button"
            onClick={() => onEditar(true)}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Pencil className="h-3 w-3" /> Cambiar pasajeros de esta línea
          </button>
        </div>
        {/* Lo único que el sistema tiene que decir sobre los pasajeros del viaje: quién se
            queda sin sitio. Que la línea cubra de más es una decisión de quien cotiza. */}
        {faltan && (
          <p className="mt-0.5 text-[11px] font-medium text-amber-800">
            Faltan {describirOcupacion(faltan, 'y')} por acomodar.
          </p>
        )}
      </div>
    )
  }

  const numero = (label: string, valor: string, set: (v: string) => void) => (
    <label className="flex flex-col">
      <span className="text-[10px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        min={label === 'Adultos' ? 1 : 0}
        step={1}
        value={valor}
        onChange={e => set(e.target.value)}
        aria-label={`${label} de esta línea`}
        className="w-20 rounded border bg-background px-2 py-1 text-sm tabular-nums"
      />
    </label>
  )

  return (
    <div className="mt-2 rounded-md border bg-muted/20 p-2">
      {/* La pregunta SIEMPRE dice por qué está preguntando: sale después de pegar, cuando
          la captura no trae la ocupación (§2.4). Un campo en blanco sin motivo se lee como
          un requisito del sistema y no como un límite de esa imagen. */}
      {motivo && <p className="text-[11px] font-medium text-amber-900">{motivo}</p>}
      <p className="text-[11px] font-medium">
        {composicion ? '¿Cuántos pasajeros cubre esta línea?' : 'Escribe cuántos adultos, niños e infantes cubre esta línea.'}
      </p>
      <p className="text-[10px] text-muted-foreground">
        Clasifica a cada menor como lo hace este proveedor: la aerolínea y el hotel pueden llamarlo distinto.
      </p>
      <div className="mt-1.5 flex flex-wrap items-end gap-2">
        {numero('Adultos', adultos, setAdultos)}
        {numero('Niños', ninos, setNinos)}
        {numero('Infantes', infantes, setInfantes)}
        <button
          type="button"
          disabled={isPending}
          onClick={() => guardar({ adultos, ninos, infantes })}
          className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          Guardar
        </button>
        {esPropia && hayViaje && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => guardar(null)}
            className="rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Usar la del viaje
          </button>
        )}
        {composicion && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => onEditar(false)}
            className="rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
          >
            Cancelar
          </button>
        )}
      </div>
      {/* ⚠️ Solo si la línea YA sabía a cuántos cubre. Respondiendo la pregunta que sale
          después de pegar no queda nada viejo (no hay ocupación anterior), y advertirlo ahí
          sería falso: quien lee esa frase no contesta y vuelve a pegar. */}
      {hayLecturas && composicion && (
        <p className="mt-1 text-[10px] text-amber-800">
          Cambiar los pasajeros deja marcados los pantallazos de esta línea como desactualizados: habrá que pegar uno nuevo.
        </p>
      )}
    </div>
  )
}
