'use client'

import { useEffect, useState } from 'react'
import { useTransitionTolerante } from '@/hooks/use-transition-tolerante'
import { useRouter } from 'next/navigation'
import { Download, FileText, CheckCircle2, AlertCircle, Loader2, RefreshCw, Lock, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import {
  generarVersionPropuesta,
  aprobarVersionPropuesta,
  corregirAprobacion,
  revertirAprobacionPropuesta,
  getTarifaPropuesta,
  type TarifaPropuestaVista,
} from '@/lib/actions/propuesta-economica-actions'
import { formatBogotaFechaHora } from '@/lib/dates/bogota'
import { hrefArchivo } from '@/lib/almacenamiento/referencia'
import { conReintentoDeRed } from '@/lib/red/con-reintento'
import { mensajeDeFallaDeCarga } from '@/lib/red/error-de-red'
import { useIntencion } from '@/hooks/use-intencion'

interface PropuestaVersion {
  n: number
  descuento_pct_plan1: number
  descuento_pct_plan2: number
  valor_final_plan1: number
  valor_final_plan2: number
  /** Servicio con el que se emitio esta version. null en versiones previas a 2026-09-01. */
  servicio?: string | null
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null
  /** Presentes solo si la versión se armó con tarifas por plan y ruta. */
  tarifa_version_id?: string
  tarifa_version?: number
  base_plan1?: number | null
  base_plan2?: number | null
  planes_ofrecidos?: Array<1 | 2>
  cap_descuento_pct?: number
}

interface PropuestaData {
  precio_base_con_iva?: number
  iva_pct?: number
  descuento_pct_plan1?: number
  descuento_pct_plan2?: number
  valor_final_plan1?: number
  valor_final_plan2?: number
  versiones?: PropuestaVersion[]
  version_activa?: number | null
  aprobado_at?: string | null
  aprobado_por?: string | null
  aprobado_version?: number | null
  aprobado_plan?: 1 | 2 | null
  /** Honorario efectivamente aprobado. Es lo que corrige `corregirAprobacion`
   *  cuando quedó mal registrado; las `versiones[]` conservan lo que se le envió
   *  al cliente y no se tocan. */
  aprobado_honorario?: number | null
  /** Servicio congelado al aprobar, al lado de `aprobado_plan`. */
  aprobado_servicio?: string | null
  /** Versión de tarifas con la que se armó (ausente = esquema anterior). */
  tarifa?: { version_id: string; version: number } | null
}

interface ConfigExtra {
  cap_descuento_pct?: number
  /** Descuentos sobre este % requieren aprobación de rol gerencial. */
  umbral_aprobacion_pct?: number
  servicio_id?: string
  template_slug?: string
  /**
   * Lo resuelve el servidor: el usuario está declarado en
   * `workspaces.config_extra.correccion_precio.staff_ids` (o es el owner) y por
   * tanto puede corregir la aprobación (valor y plan). NO se deriva del rol.
   */
  _puedeCorregirPrecio?: boolean
  /**
   * Ventana de reversión resuelta en el servidor: el negocio sigue dentro del rango
   * declarado en `revertir_hasta_etapa_orden`. No se deriva del modo del bloque porque
   * la propuesta se aprueba en una etapa y se renegocia en la siguiente, donde este
   * bloque ya es copia de solo lectura.
   */
  _puedeRevertirAprobacion?: boolean
  /**
   * Lo resuelve el servidor: el servicio que `servicio_contratado` declara HOY.
   * Se contrasta contra `aprobado_servicio` (el congelado al aprobar) para poder
   * mostrar la divergencia en vez de esconderla.
   */
  _servicioVigente?: string | null
}

interface BloqueInstancia {
  id: string
  completado: boolean
  data: PropuestaData | null
}

interface Props {
  negocioBloqueId: string
  negocioId: string
  instancia: BloqueInstancia | null
  modo: 'editable' | 'visible'
  configExtra: ConfigExtra
  userRole?: string
}

function formatFechaCorta(iso: string): string {
  return formatBogotaFechaHora(iso) ?? ''
}

// Redondeo a 2 decimales — SOLO para mostrar el % en pantalla / historial.
// El precio se mantiene exacto porque el descuento canónico conserva precisión.
function pct2(n: number): number {
  return Math.round(n * 100) / 100
}
// String limpio del % para el input (sin ceros de más): 40 → "40", 41.176 → "41.18"
function pctStr(n: number): string {
  return String(pct2(n))
}

// Nombres de los servicios de la linea. Si llega uno que no esta mapeado se imprime
// crudo antes que esconderlo: un slug feo en pantalla se corrige; un servicio invisible
// devuelve el bloque al estado que motivo este cambio.
function nombreServicio(servicio: string | null | undefined): string {
  if (servicio === 'completo') return 'Certificación UPME + devolución de IVA'
  if (servicio === 'solo_upme') return 'Solo certificación UPME'
  if (servicio === 'solo_iva') return 'Solo devolución de IVA'
  return servicio || 'sin declarar'
}

type TarifaVigente = Extract<TarifaPropuestaVista, { esquema: 'tarifas' }>

/** Planes de una versión que se pueden aprobar. Versiones del esquema anterior: los dos. */
function planesDe(v: PropuestaVersion | undefined): Array<1 | 2> {
  return v?.planes_ofrecidos ?? [1, 2]
}

/**
 * La tarifa que rige la propuesta la decide el servidor (versión vigente el día en que
 * se creó el negocio, ruta declarada hoy). Se pide antes de pintar el cuerpo porque los
 * valores iniciales de los planes dependen de ella. Una propuesta ya emitida con el
 * esquema anterior no la necesita: ese esquema no cambia, así que no se pregunta.
 */
export default function BloquePropuestaEconomica(props: Props) {
  const data = (props.instancia?.data ?? {}) as PropuestaData
  const nVersiones = (data.versiones ?? []).length
  const esquemaAnteriorSeguro = nVersiones > 0 && !data.tarifa
  const servicioVigente = props.configExtra._servicioVigente ?? null
  const [tarifa, setTarifa] = useState<TarifaVigente | null | 'cargando'>(
    esquemaAnteriorSeguro ? null : 'cargando',
  )

  useEffect(() => {
    if (esquemaAnteriorSeguro) return
    let vivo = true
    conReintentoDeRed(() => getTarifaPropuesta(props.negocioBloqueId)).then(res => {
      if (!vivo) return
      if (!res.ok) {
        toast.error(res.error)
        setTarifa(null)
        return
      }
      setTarifa(res.tarifa.esquema === 'tarifas' ? res.tarifa : null)
    }).catch(e => {
      if (!vivo) return
      toast.error(mensajeDeFallaDeCarga(e, 'No se pudieron cargar las tarifas'))
      setTarifa(null)
    })
    return () => { vivo = false }
    // La ruta (`servicioVigente`) y las versiones cambian lo que rige: se vuelve a pedir.
  }, [props.negocioBloqueId, esquemaAnteriorSeguro, servicioVigente, nVersiones])

  if (tarifa === 'cargando') {
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando tarifas…
      </div>
    )
  }
  // La llave reinicia el cuerpo cuando cambia la ruta o la versión: los valores de los
  // planes se recalculan desde la tarifa nueva en vez de arrastrar los de antes.
  return (
    <CuerpoPropuesta
      key={tarifa ? `${tarifa.version.id}:${tarifa.ruta ?? ''}` : 'anterior'}
      {...props}
      tarifa={tarifa}
    />
  )
}

function CuerpoPropuesta({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  configExtra,
  userRole,
  tarifa,
}: Props & { tarifa: TarifaVigente | null }) {
  // Corrección del valor aprobado (no genera versión ni PDF: ver la action).
  const [corrigiendoValor, setCorrigiendoValor] = useState(false)
  // Una clave por intención: un reintento de la misma acción no la ejecuta dos veces.
  const intencion = useIntencion()
  const [valorCorregido, setValorCorregido] = useState('')
  // El % de la correccion vive aparte del precio, igual que en `PlanEditor`: los dos
  // se editan y cada uno reescribe al otro, y el que se teclea conserva su texto.
  const [descCorregidoStr, setDescCorregidoStr] = useState('')
  const [motivoCorreccion, setMotivoCorreccion] = useState('')
  const [planCorregido, setPlanCorregido] = useState<1 | 2 | null>(null)
  const [reCongelarServicio, setReCongelarServicio] = useState(false)
  // Reversión de la aprobación (sí reabre el bloque: ver la action).
  const [revirtiendo, setRevirtiendo] = useState(false)
  const [motivoReversion, setMotivoReversion] = useState('')
  const router = useRouter()
  // Generar una versión tarda (PDF + Drive) y cada intento crea una versión nueva: si la
  // respuesta se pierde, se relee la ficha en vez de ofrecer generarla otra vez.
  const [isPending, startTransition] = useTransitionTolerante({ releer: () => router.refresh() })
  const data = (instancia?.data ?? {}) as PropuestaData
  const precioBase = data.precio_base_con_iva ?? 0
  const versiones = (data.versiones ?? []).slice().sort((a, b) => b.n - a.n)
  const aprobada = !!data.aprobado_at
  // Gate de descuento alto: sobre el umbral, aprobar requiere rol gerencial.
  const umbralAprobacion = configExtra.umbral_aprobacion_pct ?? null
  const puedeAprobarAlto = ['owner', 'admin', 'supervisor'].includes(userRole ?? '')

  // ── Base de cada plan ─────────────────────────────────────────────────────
  // Esquema anterior: los dos planes parten del mismo precio base y el tope es el del
  // bloque. Con tarifas: cada plan parte de SU casilla (plan × ruta) y el tope es el de
  // la versión de tarifas. Un plan que no se ofrece para la ruta no se edita ni se aprueba.
  const conTarifas = tarifa !== null
  const cap = conTarifas ? tarifa.cap_descuento_pct : configExtra.cap_descuento_pct ?? 50
  const baseDe = (p: 1 | 2): number =>
    conTarifas ? tarifa.planes.find(x => x.n === p)?.valor ?? 0 : precioBase
  const ofrece = (p: 1 | 2): boolean =>
    conTarifas ? tarifa.planes.find(x => x.n === p)?.ofrece === true : true
  const nombrePlanTarifa = (p: 1 | 2, porDefecto: string): string =>
    conTarifas ? tarifa.planes.find(x => x.n === p)?.nombre ?? porDefecto : porDefecto

  // Rango de precio válido según el cap de descuento (con IVA).
  const precioMinDe = (p: 1 | 2) => Math.round(baseDe(p) * (1 - cap / 100)) // descuento = cap
  const precioMaxDe = (p: 1 | 2) => Math.round(baseDe(p))                    // descuento = 0
  // Conversores base ↔ % ↔ precio. El % conserva precisión (precio exacto manda).
  const valorDeDesc = (p: 1 | 2, d: number) => Math.round(baseDe(p) * (1 - d / 100))
  const descDeValor = (p: 1 | 2, v: number) =>
    baseDe(p) > 0 ? Math.round((1 - v / baseDe(p)) * 100 * 1e6) / 1e6 : 0

  // Inputs — defaults desde ultima version o desde data inicial
  const ultimaVersion = versiones[0]
  // Descuento canónico (número, precisión completa) — fuente de verdad interna.
  const [desc1, setDesc1] = useState<number>(
    ultimaVersion?.descuento_pct_plan1 ?? data.descuento_pct_plan1 ?? 0,
  )
  const [desc2, setDesc2] = useState<number>(
    ultimaVersion?.descuento_pct_plan2 ?? data.descuento_pct_plan2 ?? 0,
  )
  // Strings visibles de los 4 inputs (permiten teclear libremente).
  const [desc1Str, setDesc1Str] = useState<string>(pctStr(desc1))
  const [desc2Str, setDesc2Str] = useState<string>(pctStr(desc2))
  const [valor1Str, setValor1Str] = useState<string>(String(valorDeDesc(1, desc1)))
  const [valor2Str, setValor2Str] = useState<string>(String(valorDeDesc(2, desc2)))
  const planesAprobables = planesDe(ultimaVersion)
  const [planSeleccionado, setPlanSeleccionado] = useState<1 | 2>(
    planesAprobables.includes(2) ? 2 : planesAprobables[0] ?? 2,
  )

  // ── Handlers de edición bidireccional (%↔precio) ─────────────────────────
  // Editar el % recalcula el precio; editar el precio recalcula el %.
  // El campo que el usuario teclea conserva su texto; solo se reescribe el otro.
  const onDesc = (plan: 1 | 2, raw: string) => {
    const d = Number(raw) || 0
    if (plan === 1) {
      setDesc1Str(raw)
      setDesc1(d)
      setValor1Str(String(valorDeDesc(1, d)))
    } else {
      setDesc2Str(raw)
      setDesc2(d)
      setValor2Str(String(valorDeDesc(2, d)))
    }
  }
  const onValor = (plan: 1 | 2, raw: string) => {
    const v = Number(raw) || 0
    const d = descDeValor(plan, v)
    if (plan === 1) {
      setValor1Str(raw)
      setDesc1(d)
      setDesc1Str(pctStr(d))
    } else {
      setValor2Str(raw)
      setDesc2(d)
      setDesc2Str(pctStr(d))
    }
  }

  // ¿El plan elegido supera el umbral y el usuario no es gerencial?
  const descPlanSeleccionado = (planSeleccionado === 1
    ? ultimaVersion?.descuento_pct_plan1
    : ultimaVersion?.descuento_pct_plan2) ?? 0
  const requiereAprobacionAlta = umbralAprobacion != null && descPlanSeleccionado > umbralAprobacion
  const aprobacionBloqueada = requiereAprobacionAlta && !puedeAprobarAlto

  // Recalculo en vivo (desde el descuento canónico). El React Compiler lo
  // auto-memoiza; no usamos useMemo manual (rompe con los helpers de conversión).
  const plan1Valor = valorDeDesc(1, desc1)
  const plan2Valor = valorDeDesc(2, desc2)
  const calc = {
    plan1: plan1Valor,
    plan2: plan2Valor,
    plan1_anticipo: Math.round(plan1Valor / 2),
    plan1_exito_iva: Math.round(plan1Valor / 2),
    ahorro_plan1: baseDe(1) - plan1Valor,
    ahorro_plan2: baseDe(2) - plan2Valor,
    desc1,
    desc2,
    // Fuera de rango: descuento negativo (precio > base) o sobre el cap. Un plan que no
    // se ofrece no se valida: no viaja.
    invalid1: ofrece(1) && (desc1 < 0 || desc1 > cap),
    invalid2: ofrece(2) && (desc2 < 0 || desc2 > cap),
  }

  const invalido = calc.invalid1 || calc.invalid2

  // Con tarifas, una versión generada con OTRA ruta ya no vale: el valor de cada plan
  // depende de la ruta. Se pide una versión nueva (que recalcula) antes de aprobar.
  const rutaCambio = conTarifas && !!ultimaVersion?.tarifa_version_id
    && (ultimaVersion.servicio ?? null) !== (tarifa.ruta ?? null)
  const sinRuta = conTarifas && !tarifa.ruta
  const ningunPlan = conTarifas && !ofrece(1) && !ofrece(2)

  // Detectar cambio vs ultima version
  const hayCambios = !ultimaVersion
    || Math.abs(ultimaVersion.descuento_pct_plan1 - (ofrece(1) ? desc1 : 0)) > 0.0001
    || Math.abs(ultimaVersion.descuento_pct_plan2 - (ofrece(2) ? desc2 : 0)) > 0.0001
    || (conTarifas && ultimaVersion.tarifa_version_id !== tarifa.version.id)
    || rutaCambio

  const handleGenerar = () => {
    if (invalido) {
      toast.error(`El descuento de cada plan debe estar entre 0% y ${cap}%`)
      return
    }
    startTransition(async () => {
      const res = await generarVersionPropuesta(negocioBloqueId, {
        descuento_pct_plan1: ofrece(1) ? calc.desc1 : 0,
        descuento_pct_plan2: ofrece(2) ? calc.desc2 : 0,
      }, intencion.clave())
      intencion.cerrar()
      if (res.ok) {
        if (res.warning) {
          toast.warning(`Versión v${res.version?.n} guardada (sin PDF)`, {
            description: res.warning,
            duration: 6000,
          })
        } else {
          toast.success(`Versión v${res.version?.n} generada`)
        }
      } else {
        toast.error(res.error ?? 'Error generando PDF')
      }
    })
  }

  const handleAprobar = () => {
    const versionActiva = data.version_activa ?? ultimaVersion?.n
    if (!versionActiva || !ultimaVersion) {
      toast.error('No hay versión para aprobar')
      return
    }
    const valorPlan =
      planSeleccionado === 1 ? ultimaVersion.valor_final_plan1 : ultimaVersion.valor_final_plan2
    if (
      !confirm(
        `¿Aprobar v${versionActiva} con Plan ${planSeleccionado} por ${formatCOP(valorPlan)}? Esto cerrará el bloque y establecerá el precio del negocio.`,
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await aprobarVersionPropuesta(negocioBloqueId, versionActiva, planSeleccionado)
      if (res.ok) {
        toast.success(`Propuesta aprobada — Plan ${planSeleccionado}`)
      } else {
        toast.error(res.error ?? 'Error aprobando propuesta')
      }
    })
  }

  // ── Render solo lectura (modo visible o aprobada) ─────────────────────────
  if (modo === 'visible' || aprobada) {
    const versionMostrar = aprobada
      ? versiones.find(v => v.n === data.aprobado_version) ?? ultimaVersion
      : ultimaVersion
    const planAprobado = data.aprobado_plan
    // Lo que dice la VERSION para el plan aprobado: es lo que imprimio el PDF que
    // recibio el cliente, y no cambia nunca.
    const valorVersion = versionMostrar
      ? planAprobado === 1
        ? versionMostrar.valor_final_plan1
        : versionMostrar.valor_final_plan2
      : null
    // Lo APROBADO manda. `aprobado_honorario` es lo que `corregirAprobacion` escribe y
    // lo que el motor de plata cobra (`modelo-dinero`); el valor de la version es solo
    // el fallback para aprobaciones viejas que no lo persistieron.
    //
    // ⚠️ Antes esta pantalla recalculaba SIEMPRE desde la version e ignoraba el campo.
    // Resultado medido el 2026-09-01: cuatro negocios (V0048, V0259, V0422, V0445)
    // mostrando una cifra distinta de la que se les cobra, y una correccion que se
    // guardaba bien pero se veia como si no hubiera tomado.
    const valorAprobado = data.aprobado_honorario ?? valorVersion
    const corregido =
      valorAprobado !== null && valorVersion !== null && valorAprobado !== valorVersion
    const servicioAprobado = data.aprobado_servicio ?? null
    const servicioVigente = configExtra._servicioVigente ?? null
    const servicioDivergente =
      !!servicioAprobado && !!servicioVigente && servicioAprobado !== servicioVigente
    // Corrección: el descuento se mide contra la casilla del plan en la versión APROBADA
    // (con tarifas) o contra el precio base (esquema anterior), con el tope de cada uno.
    const versionConTarifas = !!versionMostrar?.tarifa_version_id
    const capCorr = versionConTarifas ? Number(versionMostrar!.cap_descuento_pct ?? cap) : cap
    const baseCorr = (p: 1 | 2): number =>
      versionConTarifas
        ? Number((p === 1 ? versionMostrar!.base_plan1 : versionMostrar!.base_plan2) ?? 0)
        : precioBase
    const planCorr: 1 | 2 = planCorregido ?? planAprobado ?? 2
    const valorDeDescCorr = (d: number) => Math.round(baseCorr(planCorr) * (1 - d / 100))
    // El plan va explícito porque al cambiarlo el estado todavía no se actualizó.
    const descDeValorCorr = (v: number, p: 1 | 2 = planCorr) =>
      baseCorr(p) > 0 ? Math.round((1 - v / baseCorr(p)) * 100 * 1e6) / 1e6 : 0
    return (
      <div className="space-y-3">
        {aprobada && versionMostrar && (
          <div className="space-y-1 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>
                Aprobada v{data.aprobado_version} — Plan {planAprobado} ·{' '}
                <strong>{valorAprobado !== null ? formatCOP(valorAprobado) : ''}</strong>
                {data.aprobado_at && ` · ${formatFechaCorta(data.aprobado_at)}`}
              </span>
            </div>
            {/* El servicio congelado al aprobar. El documento promete alcance distinto
                segun cual sea, asi que forma parte de lo aprobado, no del contexto. */}
            <p className="pl-6 text-xs text-green-800">
              Servicio: <strong>{nombreServicio(servicioAprobado)}</strong>
              {!servicioAprobado && ' (aprobada antes de que se congelara)'}
            </p>
            {corregido && (
              <p className="pl-6 text-xs text-green-800">
                Corregido después de emitir: el PDF v{data.aprobado_version} dice{' '}
                {formatCOP(valorVersion!)}.
              </p>
            )}
          </div>
        )}
        {servicioDivergente && (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              La propuesta se aprobó con <strong>{nombreServicio(servicioAprobado)}</strong> y
              hoy el negocio declara <strong>{nombreServicio(servicioVigente)}</strong>. El
              alcance y la tarifa que promete el PDF salieron del primero, y el valor aprobado
              no se recalcula solo.
            </span>
          </div>
        )}
        {versiones.length > 0 ? (
          <VersionList
            versiones={versiones}
            aprobadaN={data.aprobado_version}
            planAprobado={data.aprobado_plan ?? null}
            honorarioAprobado={data.aprobado_honorario ?? null}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Sin versiones generadas.</p>
        )}

        {/* Dos acciones de riesgo e intención distintas sobre el mismo bloque: revertir
            reabre la negociación completa, corregir solo ajusta un número mal cargado.
            Van en botones propios, cada uno en su renglón — texto subrayado suelto las
            hacía ilegibles como dos opciones separadas (quedaban pegadas). */}
        <div className="flex flex-col items-start gap-2 pt-1">
          {/* Revertir la aprobación: solo mientras el negocio siga en esta etapa (por eso
              `modo !== 'visible'`) y el servidor además exige que no haya pagos. Deja el
              bloque en pendiente para poder generar una versión nueva y elegir plan otra
              vez. Es distinto de "Corregir valor aprobado": aquello cambia el número
              registrado sin tocar lo que recibió el cliente; esto reabre la negociación. */}
          {aprobada && configExtra._puedeRevertirAprobacion && !revirtiendo && (
            <button
              type="button"
              onClick={() => setRevirtiendo(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-muted-foreground/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Revertir aprobación
            </button>
          )}

          {/* Corrección de la aprobación (valor y/o plan). Solo para quien está
              declarado en la config del workspace. No toca las versiones ni el PDF
              enviado. */}
          {aprobada && configExtra._puedeCorregirPrecio && !corrigiendoValor && (
            <button
              type="button"
              onClick={() => {
                const v = data.aprobado_honorario ?? valorAprobado ?? null
                setValorCorregido(v !== null ? String(v) : '')
                setDescCorregidoStr(v !== null ? pctStr(descDeValorCorr(v)) : '')
                setPlanCorregido(planAprobado ?? null)
                setReCongelarServicio(false)
                setCorrigiendoValor(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-muted-foreground/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
              Corregir aprobación
            </button>
          )}
        </div>
        {revirtiendo && (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-900">
              Deshace la aprobación para generar una propuesta nueva y volver a elegir plan.
              El PDF que ya recibió el cliente se conserva en el historial. Solo se puede
              mientras el negocio siga en esta etapa y no tenga pagos registrados.
            </p>
            <input
              type="text"
              value={motivoReversion}
              onChange={e => setMotivoReversion(e.target.value)}
              placeholder="¿Por qué se revierte?"
              className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || !motivoReversion.trim()}
                onClick={() => startTransition(async () => {
                  const r = await revertirAprobacionPropuesta(negocioBloqueId, motivoReversion)
                  if (!r.ok) { toast.error(r.error ?? 'No se pudo revertir'); return }
                  toast.success('Aprobación revertida — ya puedes generar una versión nueva')
                  setRevirtiendo(false)
                  setMotivoReversion('')
                })}
                className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Revertir aprobación
              </button>
              <button
                type="button"
                onClick={() => { setRevirtiendo(false); setMotivoReversion('') }}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {corrigiendoValor && (() => {
          // Valor que la version aprobada declara para cada plan: al cambiar de plan
          // se precarga, para que el numero que se guarda sea el que la persona ve.
          const valorDePlan = (p: 1 | 2) =>
            versionMostrar ? (p === 1 ? versionMostrar.valor_final_plan1 : versionMostrar.valor_final_plan2) : null
          const valorNum = Number(valorCorregido)
          const valorValido = Number.isFinite(valorNum) && valorNum > 0
          const cambiaValor = valorValido && valorNum !== (data.aprobado_honorario ?? valorAprobado ?? 0)
          const cambiaPlan = !!planCorregido && planCorregido !== (planAprobado ?? null)
          const cambiaServicio = reCongelarServicio && !!servicioVigente
          // ⚠️ El MISMO gate que exige la aprobacion, evaluado aqui para no ofrecer un
          // boton que el servidor va a rechazar. La regla vive en el servidor
          // (`gate-descuento`): esto es el aviso, no el control.
          const descCorregido = valorValido && baseCorr(planCorr) > 0 ? descDeValorCorr(valorNum) : null
          const fueraDeRango = descCorregido !== null && (descCorregido < 0 || descCorregido > capCorr)
          const sobreUmbral =
            descCorregido !== null && umbralAprobacion != null && descCorregido > umbralAprobacion
          const bloqueadoPorUmbral = sobreUmbral && !puedeAprobarAlto
          // Con tarifas, solo los planes que se ofrecían para la ruta aprobada.
          const PLANES: Array<{ n: 1 | 2; label: string }> = [
            { n: 1 as const, label: 'Plan 1 · 50/50' },
            { n: 2 as const, label: 'Plan 2 · pago anticipado' },
          ].filter(p => planesDe(versionMostrar).includes(p.n))
          // Editar el % reescribe el precio y viceversa, como en la creacion.
          const onValorCorr = (raw: string, p: 1 | 2 = planCorr) => {
            setValorCorregido(raw)
            const v = Number(raw)
            setDescCorregidoStr(Number.isFinite(v) && baseCorr(p) > 0 ? pctStr(descDeValorCorr(v, p)) : '')
          }
          const onDescCorr = (raw: string) => {
            setDescCorregidoStr(raw)
            const d = Number(raw)
            if (Number.isFinite(d) && baseCorr(planCorr) > 0) setValorCorregido(String(valorDeDescCorr(d)))
          }
          const puedeGuardar =
            !!motivoCorreccion.trim()
            && (cambiaValor || cambiaPlan || cambiaServicio)
            && !(cambiaValor && (fueraDeRango || bloqueadoPorUmbral))
          return (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs text-amber-900">
              Corrige lo que quedó mal registrado. No genera propuesta nueva ni cambia el PDF
              que ya recibió el cliente. Rige los mismos topes que la aprobación, queda
              registrado con tu nombre y se le avisa al comercial del negocio.
            </p>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-amber-900">Plan aprobado</span>
              <div className="flex flex-wrap gap-2">
                {PLANES.map(p => (
                  <button
                    key={p.n}
                    type="button"
                    onClick={() => {
                      setPlanCorregido(p.n)
                      const v = valorDePlan(p.n)
                      if (v !== null && v > 0) onValorCorr(String(v), p.n)
                    }}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${
                      planCorregido === p.n
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-amber-300 bg-white text-amber-900 hover:border-amber-500'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {cambiaPlan && (
                <span className="text-[11px] text-amber-800">
                  El plan cambia cuánto recaudo exige el sistema antes de pasar el caso a
                  operaciones: el Plan 1 pide la tarifa más la mitad del honorario; el Plan 2, el
                  honorario completo.
                </span>
              )}
            </div>

            {/* Valor y descuento sincronizados, con el mismo rango que la creacion:
                corregir un dato mal registrado y regalar un descuento se escriben
                igual en la base, y lo unico que los separa es este tope. */}
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium text-amber-900">Valor aprobado</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-amber-900/60">$</span>
                  <input
                    type="number"
                    step="1000"
                    inputMode="numeric"
                    value={valorCorregido}
                    onChange={e => onValorCorr(e.target.value)}
                    placeholder="Valor correcto"
                    className={`w-40 rounded-md border bg-white py-1.5 pl-5 pr-2 text-sm ${
                      fueraDeRango ? 'border-red-500' : 'border-amber-300'
                    }`}
                  />
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    value={descCorregidoStr}
                    onChange={e => onDescCorr(e.target.value)}
                    className={`w-24 rounded-md border bg-white py-1.5 pl-2 pr-6 text-sm ${
                      fueraDeRango ? 'border-red-500' : 'border-amber-300'
                    }`}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-amber-900/60">%</span>
                </div>
              </div>
              {baseCorr(planCorr) > 0 && (
                <span className="text-[11px] text-amber-800">
                  Rango {formatCOP(Math.round(baseCorr(planCorr) * (1 - capCorr / 100)))}–{formatCOP(baseCorr(planCorr))} · desc. máx {capCorr}%.
                </span>
              )}
              {fueraDeRango && (
                <span className="text-[11px] font-medium text-red-700">
                  Fuera del rango permitido por la línea.
                </span>
              )}
              {bloqueadoPorUmbral && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-red-700">
                  <Lock className="h-3 w-3 shrink-0" />
                  {pct2(descCorregido!)}% supera {umbralAprobacion}% — requiere un supervisor,
                  administrador o dueño, igual que al aprobar.
                </span>
              )}
              {sobreUmbral && puedeAprobarAlto && (
                <span className="text-[11px] text-amber-800">
                  {pct2(descCorregido!)}% supera el umbral de {umbralAprobacion}%; tu rol lo
                  autoriza.
                </span>
              )}
            </div>

            {/* El servicio NO se elige aqui: se declara en su bloque y esto solo vuelve
                a fotografiarlo. Dos lugares para decidir que contrato el cliente serian
                dos verdades, y la que decide la ruta del caso seguiria siendo la otra. */}
            {servicioDivergente && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-white px-2.5 py-2 text-[11px] text-amber-900">
                <input
                  type="checkbox"
                  checked={reCongelarServicio}
                  onChange={e => setReCongelarServicio(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Actualizar el servicio de la propuesta a{' '}
                  <strong>{nombreServicio(servicioVigente)}</strong>, que es lo que el negocio
                  declara hoy (quedó congelado como {nombreServicio(servicioAprobado)}).
                </span>
              </label>
            )}

            <input
              type="text"
              value={motivoCorreccion}
              onChange={e => setMotivoCorreccion(e.target.value)}
              placeholder="¿Por qué se corrige?"
              className="w-full rounded-md border border-amber-300 bg-white px-2 py-1.5 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={isPending || !puedeGuardar}
                onClick={() => startTransition(async () => {
                  // El honorario viaja siempre que el campo tenga un numero valido: lo
                  // que se guarda es lo que la persona esta viendo, no una derivacion
                  // que el servidor haga por su cuenta.
                  const cambios: { honorario?: number; plan?: 1 | 2; servicio?: string } = {}
                  if (valorValido) cambios.honorario = valorNum
                  if (cambiaPlan) cambios.plan = planCorregido!
                  if (cambiaServicio) cambios.servicio = servicioVigente!
                  const r = await corregirAprobacion(negocioId, cambios, motivoCorreccion)
                  if (!r.ok) { toast.error(r.error ?? 'No se pudo corregir'); return }
                  toast.success('Corrección guardada')
                  setCorrigiendoValor(false)
                  setMotivoCorreccion('')
                  setReCongelarServicio(false)
                })}
                className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Guardar corrección
              </button>
              <button
                type="button"
                onClick={() => {
                  setCorrigiendoValor(false)
                  setMotivoCorreccion('')
                  setReCongelarServicio(false)
                }}
                className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900"
              >
                Cancelar
              </button>
            </div>
          </div>
          )
        })()}
      </div>
    )
  }

  // ── Render editable ───────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {!conTarifas && precioBase === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            Sin precio base disponible. Verifica que la línea de negocio tenga un servicio
            asociado con <code>precio_estandar</code> configurado.
          </span>
        </div>
      ) : sinRuta || ningunPlan ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            {sinRuta
              ? 'Declara qué contrató el cliente: el valor de cada plan depende de la ruta del negocio.'
              : `La ruta «${tarifa?.rutaNombre ?? tarifa?.ruta ?? ''}» no tiene ningún plan en las tarifas v${tarifa?.version.version}. Revísalas en Mi negocio → Mis servicios.`}
          </span>
        </div>
      ) : (
        <>
          {/* Tarifa de referencia: la base única (esquema anterior) o la versión de
              tarifas que rige este negocio con su ruta. */}
          {conTarifas ? (
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Ruta del negocio</span>
                <span className="font-medium">{tarifa.rutaNombre ?? nombreServicio(tarifa.ruta)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Tarifas v{tarifa.version.version}, vigentes para negocios creados desde el{' '}
                {tarifa.version.vigente_desde.split('-').reverse().join('/')} · descuento máx {cap}%.
              </p>
            </div>
          ) : (
            <div className="flex items-baseline justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Tarifa base con IVA</span>
              <span className="font-medium">{formatCOP(precioBase)}</span>
            </div>
          )}

          {rutaCambio && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                La v{ultimaVersion?.n} se generó con <strong>{nombreServicio(ultimaVersion?.servicio)}</strong> y
                hoy el negocio declara <strong>{tarifa?.rutaNombre ?? nombreServicio(tarifa?.ruta)}</strong>. Los
                valores de abajo ya están recalculados: genera una versión nueva para poder aprobar.
              </span>
            </div>
          )}

          {/* Editor por plan: descuento % ↔ precio final (con IVA), sincronizados.
              Un plan que no se ofrece para la ruta no aparece. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {ofrece(1) && (
              <PlanEditor
                titulo={nombrePlanTarifa(1, 'Plan 1 (tarifa plena)')}
                tarifa={conTarifas ? baseDe(1) : null}
                descStr={desc1Str}
                valorStr={valor1Str}
                onDesc={raw => onDesc(1, raw)}
                onValor={raw => onValor(1, raw)}
                cap={cap}
                precioMin={precioMinDe(1)}
                precioMax={precioMaxDe(1)}
                invalid={calc.invalid1}
              />
            )}
            {ofrece(2) && (
              <PlanEditor
                titulo={nombrePlanTarifa(2, 'Plan 2 (pago anticipado)')}
                tarifa={conTarifas ? baseDe(2) : null}
                descStr={desc2Str}
                valorStr={valor2Str}
                onDesc={raw => onDesc(2, raw)}
                onValor={raw => onValor(2, raw)}
                cap={cap}
                precioMin={precioMinDe(2)}
                precioMax={precioMaxDe(2)}
                invalid={calc.invalid2}
              />
            )}
          </div>
          {conTarifas && (!ofrece(1) || !ofrece(2)) && (
            <p className="text-xs text-muted-foreground">
              {!ofrece(1) ? nombrePlanTarifa(1, 'El Plan 1') : nombrePlanTarifa(2, 'El Plan 2')} no se
              ofrece para esta ruta.
            </p>
          )}

          {invalido && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                El descuento de cada plan debe estar entre 0% y {cap}% de su tarifa.
              </span>
            </div>
          )}

          {/* Resumen calculado */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              {ofrece(1) && (
              <div>
                <p className="text-xs text-muted-foreground">
                  Plan 1 — Tarifa plena{calc.desc1 > 0 ? ` · ${pct2(calc.desc1)}% desc.` : ''}
                </p>
                <p className="text-base font-medium">{formatCOP(calc.plan1)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Anticipo 50%: {formatCOP(calc.plan1_anticipo)}
                  <br />
                  Éxito IVA 50%: {formatCOP(calc.plan1_exito_iva)}
                  {calc.desc1 > 0 && (
                    <>
                      <br />
                      <span className="text-green-700">Ahorro: {formatCOP(calc.ahorro_plan1)}</span>
                    </>
                  )}
                </p>
              </div>
              )}
              {ofrece(2) && (
              <div>
                <p className="text-xs text-muted-foreground">
                  Plan 2 — Pago anticipado{calc.desc2 > 0 ? ` · ${pct2(calc.desc2)}% desc.` : ''}
                </p>
                <p className="text-base font-medium text-green-700">{formatCOP(calc.plan2)}</p>
                <p className="mt-1 text-xs text-green-700">
                  Ahorro: {formatCOP(calc.ahorro_plan2)}
                </p>
              </div>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleGenerar}
              disabled={isPending || invalido || (!hayCambios && versiones.length > 0)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : versiones.length === 0 ? (
                <FileText className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {versiones.length === 0
                ? 'Generar PDF v1'
                : hayCambios
                  ? `Generar PDF v${(ultimaVersion?.n ?? 0) + 1}`
                  : `Sin cambios vs v${ultimaVersion?.n}`}
            </button>
            {versiones.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <fieldset className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs">
                  <legend className="px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Plan a aprobar
                  </legend>
                  {planesAprobables.includes(1) && (
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="plan-aprobar"
                      value={1}
                      checked={planSeleccionado === 1}
                      onChange={() => setPlanSeleccionado(1)}
                    />
                    <span>Plan 1 · {formatCOP(ultimaVersion!.valor_final_plan1)}</span>
                  </label>
                  )}
                  {planesAprobables.includes(2) && (
                  <label className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name="plan-aprobar"
                      value={2}
                      checked={planSeleccionado === 2}
                      onChange={() => setPlanSeleccionado(2)}
                    />
                    <span>Plan 2 · {formatCOP(ultimaVersion!.valor_final_plan2)}</span>
                  </label>
                  )}
                </fieldset>
                <button
                  onClick={handleAprobar}
                  disabled={isPending || aprobacionBloqueada || rutaCambio || !planesAprobables.includes(planSeleccionado)}
                  title={aprobacionBloqueada ? `Descuentos sobre ${umbralAprobacion}% requieren aprobación gerencial` : undefined}
                  className="inline-flex items-center gap-1.5 rounded-md border border-green-600 bg-green-50 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Aprobar v{ultimaVersion?.n} con Plan {planSeleccionado}
                </button>
              </div>
            )}
            {aprobacionBloqueada && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-700">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                El Plan {planSeleccionado} tiene {pct2(descPlanSeleccionado)}% de descuento — supera {umbralAprobacion}% y requiere aprobación de un supervisor, administrador o dueño.
              </p>
            )}
          </div>
        </>
      )}

      {/* Lista de versiones */}
      {versiones.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Historial de versiones
          </p>
          <VersionList
            versiones={versiones}
            aprobadaN={data.aprobado_version}
            planAprobado={data.aprobado_plan ?? null}
            honorarioAprobado={data.aprobado_honorario ?? null}
          />
        </div>
      )}
    </div>
  )
}

// ── Editor de un plan: descuento % ↔ precio final, enlazados ────────────────
function PlanEditor({
  titulo,
  tarifa = null,
  descStr,
  valorStr,
  onDesc,
  onValor,
  cap,
  precioMin,
  precioMax,
  invalid,
}: {
  titulo: string
  /** Valor de la casilla plan × ruta (con tarifas). `null` en el esquema anterior. */
  tarifa?: number | null
  descStr: string
  valorStr: string
  onDesc: (raw: string) => void
  onValor: (raw: string) => void
  cap: number
  precioMin: number
  precioMax: number
  invalid: boolean
}) {
  const borde = invalid ? 'border-red-500' : ''
  return (
    <div className="rounded-md border bg-background/50 p-3">
      <p className="mb-2 flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{titulo}</span>
        {tarifa != null && <span>Tarifa {formatCOP(tarifa)}</span>}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Descuento</label>
          <div className="relative">
            <input
              type="number"
              step="0.01"
              inputMode="decimal"
              value={descStr}
              onChange={e => onDesc(e.target.value)}
              className={`w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm ${borde}`}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-[11px] text-muted-foreground">Precio final</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              type="number"
              step="1000"
              inputMode="numeric"
              value={valorStr}
              onChange={e => onValor(e.target.value)}
              className={`w-full rounded-md border bg-background py-2 pl-6 pr-3 text-sm ${borde}`}
            />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Edita el % o el precio: se sincronizan. Rango {formatCOP(precioMin)}–{formatCOP(precioMax)} · desc. máx {cap}%.
      </p>
    </div>
  )
}

function VersionList({
  versiones,
  aprobadaN,
  planAprobado,
  honorarioAprobado = null,
}: {
  versiones: PropuestaVersion[]
  aprobadaN?: number | null
  planAprobado: 1 | 2 | null
  /** `aprobado_honorario`: manda sobre el valor de la version cuando existe. */
  honorarioAprobado?: number | null
}) {
  return (
    <ul className="space-y-1.5">
      {versiones.map(v => {
        const isAprobada = aprobadaN === v.n
        const valorVersion =
          isAprobada && planAprobado
            ? planAprobado === 1
              ? v.valor_final_plan1
              : v.valor_final_plan2
            : null
        // Igual que el banner: lo aprobado manda, la version es el fallback.
        const valorAprobado = isAprobada ? honorarioAprobado ?? valorVersion : null
        const corregido =
          valorAprobado !== null && valorVersion !== null && valorAprobado !== valorVersion
        return (
          <li
            key={v.n}
            className={`flex items-center gap-3 rounded-md border px-3 py-2 text-sm ${
              isAprobada ? 'border-green-300 bg-green-50' : ''
            }`}
          >
            <span className="inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md bg-foreground/10 px-2 text-xs font-mono">
              v{v.n}
            </span>
            <div className="min-w-0 flex-1">
              {isAprobada && valorAprobado !== null ? (
                <p className="font-medium">
                  Plan {planAprobado} · {formatCOP(valorAprobado)}
                  {corregido && (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      (el PDF dice {formatCOP(valorVersion!)})
                    </span>
                  )}
                </p>
              ) : (
                <p className="font-medium">
                  {planesDe(v).map(n => `Plan ${n}: ${formatCOP(n === 1 ? v.valor_final_plan1 : v.valor_final_plan2)}`).join(' · ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {planesDe(v).map(n => `P${n} ${pct2(n === 1 ? v.descuento_pct_plan1 : v.descuento_pct_plan2)}%`).join(' · ')}
                {v.tarifa_version != null && ` · tarifas v${v.tarifa_version}`} ·{' '}
                {formatFechaCorta(v.generated_at)}
                {isAprobada && <span className="ml-2 text-green-700">· Aprobada</span>}
              </p>
            </div>
            {v.pdf_url ? (
              <a
                href={hrefArchivo(v.pdf_url) ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5" />
                PDF
              </a>
            ) : (
              <span className="text-xs text-muted-foreground">Sin PDF</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}
