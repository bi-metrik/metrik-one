'use client';

import { useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import {
  listarBitacoraContraparte,
  listarTableroLiberaciones,
  registrarDecisionContraparte,
  type ContraparteConHallazgo,
  type ControlParaLiberacion,
  type TableroLiberaciones,
} from '@/lib/actions/compliance-liberaciones';
import {
  DECISION_LABEL,
  MOTIVO_LABEL,
  sumarMesesISO,
  VIGENCIAS_SUGERIDAS,
  type LiberacionConNombres,
  type LiberacionDecision,
  type MotivoCobertura,
} from '@/lib/compliance/liberaciones';
import { ETIQUETAS, diasEntreISO } from '@/lib/compliance/bandeja';
import type { CoberturaCatalogo } from '@/lib/actions/compliance-tier-catalogo';
import { formatBogotaFechaCortaAno, formatBogotaFechaHora, todayBogotaISO } from '@/lib/dates/bogota';

const ESTILO_MOTIVO: Record<MotivoCobertura, string> = {
  sin_registro: 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30',
  vigente: 'bg-[#ECFDF5] text-[#059669] border-[#10B981]/30',
  vencida: 'bg-[#FFFBEB] text-[#B45309] border-[#F59E0B]/30',
  rechazada: 'bg-[#1A1A1A] text-white border-[#1A1A1A]',
};

export default function LiberacionesClient({
  inicial,
  controles,
  cobertura,
}: {
  inicial: TableroLiberaciones;
  controles: ControlParaLiberacion[];
  /** Cobertura del catálogo de tier en los últimos 90 días (C5). */
  cobertura: CoberturaCatalogo | null;
}) {
  const [tablero, setTablero] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function recargar() {
    const r = await listarTableroLiberaciones();
    if (r.ok) setTablero(r.data);
    else setError(r.error);
  }

  function decidir(
    contraparte: ContraparteConHallazgo,
    decision: LiberacionDecision,
    justificacion: string,
    vigenteHasta: string | null,
    controlId: string | null,
  ) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const r = await registrarDecisionContraparte({
        consulta_id: contraparte.consulta_vigente_id,
        decision,
        justificacion,
        vigente_hasta: vigenteHasta,
        control_id: controlId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAviso(
        decision === 'liberada'
          ? `${contraparte.nombre ?? contraparte.documento_numero} queda liberada hasta el ${formatBogotaFechaCortaAno(vigenteHasta)}.`
          : `${contraparte.nombre ?? contraparte.documento_numero} queda rechazada. Cualquier liberación anterior deja de tener efecto.`,
      );
      setAbierta(null);
      await recargar();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-[#1A1A1A]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Liberación de contrapartes</h1>
          <p className="text-sm text-[#6B7280]">
            Las contrapartes que salieron reportadas en listas restrictivas y lo que decidiste sobre
            ellas. Es la evidencia de la debida diligencia: lo que viaja al área de compras es el
            documento de autorización, no esta pantalla.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {aviso && (
        <div className="p-3 rounded-lg bg-[#ECFDF5] border border-[#10B981]/30 text-[#059669] text-sm flex items-start gap-2">
          <Check className="h-4 w-4 mt-0.5 shrink-0" /> {aviso}
        </div>
      )}

      <Indicadores tablero={tablero} cobertura={cobertura} />

      <Seccion
        titulo={ETIQUETAS.sin_cobertura_vigente.titulo}
        descripcion={ETIQUETAS.sin_cobertura_vigente.descripcion}
        vacio="Ninguna contraparte está operando con la cobertura vencida."
        alarma
        contrapartes={tablero.sin_cobertura_vigente}
        abierta={abierta}
        onAbrir={setAbierta}
        onDecidir={decidir}
        controles={controles}
        pending={pending}
      />

      <Seccion
        titulo={ETIQUETAS.hallazgos_sin_decidir.titulo}
        descripcion={ETIQUETAS.hallazgos_sin_decidir.descripcion}
        vacio="Ningún hallazgo está esperando decisión."
        mostrarAntiguedad
        contrapartes={tablero.hallazgos_sin_decidir}
        abierta={abierta}
        onAbrir={setAbierta}
        onDecidir={decidir}
        controles={controles}
        pending={pending}
      />

      <Seccion
        titulo={ETIQUETAS.excepciones_vigentes.titulo}
        descripcion={ETIQUETAS.excepciones_vigentes.descripcion}
        vacio="Todavía no hay contrapartes liberadas."
        contrapartes={tablero.excepciones_vigentes}
        abierta={abierta}
        onAbrir={setAbierta}
        onDecidir={decidir}
        controles={controles}
        pending={pending}
      />

      <Seccion
        titulo={ETIQUETAS.rechazadas.titulo}
        descripcion={ETIQUETAS.rechazadas.descripcion}
        vacio="Ninguna contraparte ha sido rechazada."
        contrapartes={tablero.rechazadas}
        abierta={abierta}
        onAbrir={setAbierta}
        onDecidir={decidir}
        controles={controles}
        pending={pending}
      />

      {tablero.sin_documento.length > 0 && (
        <div className="bg-white rounded-lg border border-[#F59E0B]/40 p-5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-[#B45309] shrink-0" />
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A]">
                Hallazgos que no se pueden liberar por aquí ({tablero.sin_documento.length})
              </h2>
              <p className="text-sm text-[#6B7280] mt-1">
                Se consultaron solo por nombre. La vigencia se ata al documento, así que para
                decidir sobre ellos hay que volver a consultarlos con cédula o NIT. No se ocultan:
                siguen siendo hallazgos sin resolver.
              </p>
            </div>
          </div>
          <ul className="text-sm text-[#1A1A1A] space-y-1">
            {tablero.sin_documento.map((h) => (
              <li key={h.consulta_id} className="flex justify-between gap-3 border-t border-[#E5E7EB] pt-1.5">
                <span className="font-semibold">{h.nombre ?? 'Sin nombre'}</span>
                <span className="text-[#6B7280]">
                  {h.total_matches} coincidencia(s) · {formatBogotaFechaCortaAno(h.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Los dos números que un supervisor pide primero, y el contador de vigilancia
 * continua. Van arriba de las listas porque son el resumen del riesgo asumido.
 *
 * "Por vencer" todavía no se puede mostrar: depende de una fecha de
 * revalidación por consulta, que hoy no existe. Se deja fuera en vez de
 * aproximarlo — un indicador que mide algo distinto de lo que dice medir es
 * peor que no tenerlo.
 */
function Indicadores({
  tablero,
  cobertura,
}: {
  tablero: TableroLiberaciones;
  cobertura: CoberturaCatalogo | null;
}) {
  const { indicadores } = tablero;
  const expuestas = indicadores.sin_cobertura_vigente;
  const dias = indicadores.antiguedad_max_sin_decidir_dias;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Indicador
          valor={String(expuestas)}
          label="Operando sin cobertura vigente"
          nota="El objetivo es cero."
          alarma={expuestas > 0}
        />
        <Indicador
          valor={dias === null ? '—' : `${dias} d`}
          label="Hallazgo sin decidir más antiguo"
          nota={dias === null ? 'Nada represado.' : 'Cuánto lleva la empresa sabiendo sin decidir.'}
          alarma={dias !== null && dias > 30}
        />
        <Indicador
          valor={
            tablero.vigilancia_por_vencer > 0 || tablero.vigilancia_vencida > 0
              ? `${tablero.vigilancia_continua - tablero.vigilancia_por_vencer - tablero.vigilancia_vencida} · ${tablero.vigilancia_por_vencer + tablero.vigilancia_vencida}`
              : String(tablero.vigilancia_continua)
          }
          label={ETIQUETAS.vigilancia_continua.titulo}
          nota={
            tablero.vigilancia_vencida > 0
              ? `${tablero.vigilancia_vencida} pasaron su fecha de revalidación.`
              : tablero.vigilancia_por_vencer > 0
                ? `${tablero.vigilancia_por_vencer} por vencer en 30 días.`
                : 'Consultadas y sin hallazgo.'
          }
          alarma={tablero.vigilancia_vencida > 0}
        />
      </div>

      {tablero.sin_resultado > 0 && (
        <p className="text-xs text-[#B45309]">
          {tablero.sin_resultado} contraparte(s) con la última consulta fallida: no salieron
          limpias, no se supo. Hay que volver a consultarlas.
        </p>
      )}
      {tablero.truncado && (
        <p className="text-xs text-[#B45309]">
          La bandeja alcanzó el techo de lectura y no está mostrando todas las consultas del
          workspace.
        </p>
      )}
      {tablero.vigilancia_sin_vigencia > 0 && (
        <p className="text-xs text-[#6B7280]">
          {tablero.vigilancia_sin_vigencia} contraparte(s) limpias no tienen fecha de
          revalidación: se consultaron antes de que se configurara la periodicidad. No cuentan
          como vencidas, pero tampoco están programadas. Vuelven a entrar al ciclo con su
          próxima consulta.
        </p>
      )}
      {cobertura && cobertura.consultas_con_fuente_desconocida > 0 && (
        <p className="text-xs text-[#B45309]">
          {cobertura.consultas_con_fuente_desconocida} consulta(s) de los últimos 90 días trajeron
          una fuente que el catálogo no reconoce ({cobertura.fuentes.join(', ')}). Esas consultas
          quedan en el canal de mayor exigencia hasta que se clasifique la fuente: no se pierde
          nada, pero hay trabajo pendiente de catálogo.
        </p>
      )}
    </div>
  );
}

function Indicador({
  valor,
  label,
  nota,
  alarma,
}: {
  valor: string;
  label: string;
  nota: string;
  alarma: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        alarma ? 'bg-[#FEF2F2] border-[#EF4444]/40' : 'bg-white border-[#E5E7EB]'
      }`}
    >
      <div className={`text-2xl font-bold ${alarma ? 'text-[#B91C1C]' : 'text-[#1A1A1A]'}`}>
        {valor}
      </div>
      <div className="text-sm font-semibold text-[#1A1A1A] mt-0.5">{label}</div>
      <div className="text-xs text-[#6B7280] mt-0.5">{nota}</div>
    </div>
  );
}

function Seccion({
  titulo,
  descripcion,
  vacio,
  alarma = false,
  mostrarAntiguedad = false,
  contrapartes,
  abierta,
  onAbrir,
  onDecidir,
  controles,
  pending,
}: {
  titulo: string;
  descripcion: string;
  vacio: string;
  /** La alarma se pinta distinto y nunca se colapsa: es el único estado expuesto. */
  alarma?: boolean;
  /** La cola muestra cuántos días lleva cada hallazgo esperando decisión. */
  mostrarAntiguedad?: boolean;
  contrapartes: ContraparteConHallazgo[];
  abierta: string | null;
  onAbrir: (clave: string | null) => void;
  onDecidir: (
    c: ContraparteConHallazgo,
    decision: LiberacionDecision,
    justificacion: string,
    vigenteHasta: string | null,
    controlId: string | null,
  ) => void;
  controles: ControlParaLiberacion[];
  pending: boolean;
}) {
  const hoy = todayBogotaISO();

  return (
    <div
      className={`space-y-3 ${
        alarma && contrapartes.length > 0
          ? 'rounded-lg border border-[#EF4444]/40 bg-[#FEF2F2] p-4'
          : ''
      }`}
    >
      <div>
        <h2 className="text-base font-bold text-[#1A1A1A] flex items-center gap-2">
          {alarma && contrapartes.length > 0 && (
            <AlertTriangle className="h-4 w-4 text-[#B91C1C]" />
          )}
          {titulo} ({contrapartes.length})
        </h2>
        <p className="text-sm text-[#6B7280]">{descripcion}</p>
      </div>

      {contrapartes.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-center text-sm text-[#6B7280]">
          {vacio}
        </div>
      ) : (
        <div className="space-y-2">
          {contrapartes.map((c) => (
            <FilaContraparte
              key={c.clave}
              contraparte={c}
              diasEsperando={
                mostrarAntiguedad
                  ? diasEntreISO(c.ultima_consulta_fecha.slice(0, 10), hoy)
                  : null
              }
              expandida={abierta === c.clave}
              onToggle={() => onAbrir(abierta === c.clave ? null : c.clave)}
              onDecidir={onDecidir}
              controles={controles}
              pending={pending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilaContraparte({
  contraparte,
  diasEsperando,
  expandida,
  onToggle,
  onDecidir,
  controles,
  pending,
}: {
  contraparte: ContraparteConHallazgo;
  /** Días que lleva el hallazgo esperando decisión. Solo en la cola de trabajo. */
  diasEsperando: number | null;
  expandida: boolean;
  onToggle: () => void;
  onDecidir: (
    c: ContraparteConHallazgo,
    decision: LiberacionDecision,
    justificacion: string,
    vigenteHasta: string | null,
    controlId: string | null,
  ) => void;
  controles: ControlParaLiberacion[];
  pending: boolean;
}) {
  const { cobertura } = contraparte;

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-[#F5F4F2] transition-colors"
      >
        {expandida ? (
          <ChevronDown className="h-4 w-4 text-[#6B7280] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#6B7280] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[#1A1A1A] truncate">
            {contraparte.nombre ?? 'Sin nombre registrado'}
          </p>
          <p className="text-xs text-[#6B7280]">
            {contraparte.documento_tipo} {contraparte.documento_numero} ·{' '}
            {contraparte.total_matches} coincidencia(s) · última consulta{' '}
            {formatBogotaFechaCortaAno(contraparte.ultima_consulta_fecha)}
          </p>
        </div>
        {diasEsperando !== null && (
          <span
            className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${
              diasEsperando > 30
                ? 'bg-[#FEF2F2] text-[#B91C1C] border-[#EF4444]/30'
                : 'bg-[#F5F4F2] text-[#6B7280] border-[#E5E7EB]'
            }`}
            title="Días que lleva este hallazgo esperando decisión"
          >
            {diasEsperando} d
          </span>
        )}
        <span
          className={`shrink-0 text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full border ${ESTILO_MOTIVO[cobertura.motivo]}`}
        >
          {MOTIVO_LABEL[cobertura.motivo]}
        </span>
      </button>

      {expandida && (
        <DetalleContraparte
          contraparte={contraparte}
          onDecidir={onDecidir}
          controles={controles}
          pending={pending}
        />
      )}
    </div>
  );
}

function DetalleContraparte({
  contraparte,
  onDecidir,
  controles,
  pending,
}: {
  contraparte: ContraparteConHallazgo;
  onDecidir: (
    c: ContraparteConHallazgo,
    decision: LiberacionDecision,
    justificacion: string,
    vigenteHasta: string | null,
    controlId: string | null,
  ) => void;
  controles: ControlParaLiberacion[];
  pending: boolean;
}) {
  const hoy = todayBogotaISO();
  const [decision, setDecision] = useState<LiberacionDecision>('liberada');
  const [justificacion, setJustificacion] = useState('');
  const [vigenteHasta, setVigenteHasta] = useState(sumarMesesISO(hoy, 6));
  const [controlId, setControlId] = useState('');

  const [bitacora, setBitacora] = useState<LiberacionConNombres[] | null>(null);
  const [cargandoBitacora, setCargandoBitacora] = useState(false);

  const consultaVigente =
    contraparte.consultas.find((c) => c.consulta_id === contraparte.consulta_vigente_id) ??
    contraparte.consultas[0];

  async function verBitacora() {
    setCargandoBitacora(true);
    const r = await listarBitacoraContraparte({
      documento_tipo: contraparte.documento_tipo,
      documento_numero: contraparte.documento_numero,
    });
    setCargandoBitacora(false);
    if (r.ok) setBitacora(r.data);
  }

  return (
    <div className="border-t border-[#E5E7EB] p-4 space-y-5 bg-[#FAFAF9]">
      {/* Hallazgos: lo que el oficial tiene a la vista al decidir. */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
          Hallazgos de la consulta del {formatBogotaFechaHora(consultaVigente.created_at)}
        </h3>
        {consultaVigente.matches.length === 0 ? (
          <p className="text-sm text-[#6B7280]">
            La consulta reportó {consultaVigente.total_matches} coincidencia(s) sin detalle guardado.
          </p>
        ) : (
          <div className="rounded-lg border border-[#E5E7EB] overflow-hidden bg-white">
            <table className="w-full text-xs">
              <thead className="bg-[#1A1A1A] text-white">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Lista</th>
                  <th className="text-left px-3 py-2 font-semibold">Nombre coincidente</th>
                  <th className="text-left px-3 py-2 font-semibold">Documento</th>
                  <th className="text-left px-3 py-2 font-semibold">Fundamento</th>
                </tr>
              </thead>
              <tbody>
                {consultaVigente.matches.map((m, i) => (
                  <tr key={i} className="border-t border-[#E5E7EB]">
                    <td className="px-3 py-2 font-semibold text-[#1A1A1A]">{m.lista}</td>
                    <td className="px-3 py-2">{m.nombre}</td>
                    <td className="px-3 py-2">{m.documento ?? '—'}</td>
                    <td className="px-3 py-2 text-[#6B7280]">{m.fundamento ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {contraparte.consultas.length > 1 && (
          <p className="text-xs text-[#6B7280] mt-2">
            Esta contraparte tiene {contraparte.consultas.length} consultas con hallazgo. La decisión
            se registra sobre la más reciente.
          </p>
        )}
      </div>

      {/* Decisión vigente y su autorización descargable. */}
      {contraparte.cobertura.liberacion && (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
          <p className="text-[#1A1A1A]">
            <strong>{DECISION_LABEL[contraparte.cobertura.liberacion.decision]}</strong>
            {contraparte.cobertura.liberacion.vigente_hasta
              ? ` hasta el ${formatBogotaFechaCortaAno(contraparte.cobertura.liberacion.vigente_hasta)}`
              : ''}{' '}
            · registrada el {formatBogotaFechaHora(contraparte.cobertura.liberacion.created_at)}
          </p>
          <p className="text-[#6B7280] mt-1">{contraparte.cobertura.liberacion.justificacion}</p>
          {contraparte.cobertura.liberacion.decision === 'liberada' && (
            <a
              href={`/api/compliance/liberaciones/${contraparte.cobertura.liberacion.id}/autorizacion`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-3 h-9 px-4 rounded-lg border border-[#E5E7EB] text-[#1A1A1A] font-semibold hover:bg-[#F5F4F2] transition-colors text-xs"
            >
              <FileText className="h-3.5 w-3.5" />
              Autorización de contratación (PDF)
            </a>
          )}
        </div>
      )}

      {/* Formulario de decisión. */}
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-4 space-y-3">
        <h3 className="text-sm font-bold text-[#1A1A1A]">Registrar decisión</h3>
        <p className="text-xs text-[#6B7280]">
          Cada decisión queda escrita y no se puede editar ni borrar. Para cambiar de opinión se
          registra una nueva, y la más reciente es la que manda.
        </p>

        <div className="flex gap-2">
          {(['liberada', 'rechazada'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDecision(d)}
              className={`h-10 px-4 rounded-lg text-sm font-semibold border transition-colors ${
                decision === d
                  ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                  : 'bg-white text-[#1A1A1A] border-[#E5E7EB] hover:bg-[#F5F4F2]'
              }`}
            >
              {DECISION_LABEL[d]}
            </button>
          ))}
        </div>

        <div>
          <label
            htmlFor={`justificacion-${contraparte.clave}`}
            className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5"
          >
            Justificación (queda en el documento que verá compras)
          </label>
          <textarea
            id={`justificacion-${contraparte.clave}`}
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder="Qué revisaste, qué concluiste y con qué soporte."
            className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] text-sm"
          />
        </div>

        {decision === 'liberada' && (
          <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-end">
            <div>
              <span className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
                Vigencia
              </span>
              <div className="flex gap-2">
                {VIGENCIAS_SUGERIDAS.map((v) => (
                  <button
                    key={v.meses}
                    type="button"
                    onClick={() => setVigenteHasta(sumarMesesISO(hoy, v.meses))}
                    className={`h-10 px-3 rounded-lg text-xs font-semibold border transition-colors ${
                      vigenteHasta === sumarMesesISO(hoy, v.meses)
                        ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                        : 'bg-white text-[#1A1A1A] border-[#E5E7EB] hover:bg-[#F5F4F2]'
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label
                htmlFor={`vigencia-${contraparte.clave}`}
                className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5"
              >
                Vence el
              </label>
              <input
                id={`vigencia-${contraparte.clave}`}
                type="date"
                min={hoy}
                value={vigenteHasta}
                onChange={(e) => setVigenteHasta(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] text-sm"
              />
            </div>
          </div>
        )}

        {controles.length > 0 && (
          <div>
            <label
              htmlFor={`control-${contraparte.clave}`}
              className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5"
            >
              Control de la matriz que estás operando (opcional)
            </label>
            <select
              id={`control-${contraparte.clave}`}
              value={controlId}
              onChange={(e) => setControlId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
            >
              <option value="">Sin control asociado</option>
              {controles.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.referencia, c.nombre].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          disabled={pending || justificacion.trim().length === 0}
          onClick={() =>
            onDecidir(
              contraparte,
              decision,
              justificacion,
              decision === 'liberada' ? vigenteHasta : null,
              controlId || null,
            )
          }
          className="inline-flex items-center gap-2 h-11 px-5 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Registrar {DECISION_LABEL[decision].toLowerCase()}
        </button>
      </div>

      {/* Bitácora completa. */}
      <div>
        {bitacora === null ? (
          <button
            type="button"
            onClick={verBitacora}
            disabled={cargandoBitacora}
            className="text-xs font-semibold text-[#1A1A1A] underline underline-offset-2 hover:text-[#374151]"
          >
            {cargandoBitacora ? 'Cargando…' : 'Ver bitácora completa de esta contraparte'}
          </button>
        ) : bitacora.length === 0 ? (
          <p className="text-xs text-[#6B7280]">Todavía no hay decisiones registradas.</p>
        ) : (
          <div className="space-y-2">
            <h3 className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold">
              Bitácora ({bitacora.length})
            </h3>
            {bitacora.map((f) => (
              <div key={f.id} className="rounded-lg border border-[#E5E7EB] bg-white p-3 text-xs">
                <p className="text-[#1A1A1A]">
                  <strong>{DECISION_LABEL[f.decision]}</strong>
                  {f.vigente_hasta ? ` hasta ${formatBogotaFechaCortaAno(f.vigente_hasta)}` : ''} ·{' '}
                  {formatBogotaFechaHora(f.created_at)} ·{' '}
                  {f.liberada_por_nombre ?? 'Autor no resuelto'}
                </p>
                <p className="text-[#6B7280] mt-1">{f.justificacion}</p>
                {(f.control_referencia || f.control_nombre) && (
                  <p className="text-[#6B7280] mt-1">
                    Control: {[f.control_referencia, f.control_nombre].filter(Boolean).join(' · ')}
                  </p>
                )}
                {f.decision === 'liberada' && (
                  <a
                    href={`/api/compliance/liberaciones/${f.id}/autorizacion`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-[#1A1A1A] font-semibold underline underline-offset-2"
                  >
                    <FileText className="h-3 w-3" />
                    Autorización (PDF)
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
