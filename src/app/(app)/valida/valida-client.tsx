'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Search,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import {
  buscarNegociosParaValida,
  consultarValida,
  descargarPDFConsultaValida,
  descargarPlantillaValida,
  listarConsultasValida,
  type ConsultaHistorialItem,
  type FiltrosHistorial,
  type NegocioBusqueda,
  type Severidad,
  type TierLista,
  type TipoDocumento,
  type TipoPersona,
  type ValidaResultado,
} from '@/lib/actions/valida-consultas';
import TutorialTour from '@/components/tutorial/TutorialTour';
import TutorialButton from '@/components/tutorial/TutorialButton';
import { useFileDrop } from '@/hooks/use-file-drop';
import {
  cancelarLoteValida,
  crearLoteValida,
  loteVigenteValida,
  pdfLoteValida,
  progresoLoteValida,
  reanudarLoteValida,
  resultadosLoteValida,
  type LoteVista,
} from '@/lib/actions/valida-lotes';
import { TOPE_FILAS_LOTE, type AvisoTiposDocumento } from '@/lib/valida/lote';
import { esMotivoCorte, type MotivoCorte, type SaldoBolsa } from '@/lib/valida/corte-bolsa';
import { ActivaTuPlan, SaldoConsultas } from './activa-tu-plan';
import { FranjaPrueba, type PruebaEnPantalla } from './franja-prueba';
import { formatFecha } from '@/lib/dates/bogota'
import { mensajeErrorValida } from '@/lib/valida/mensajes-error'
import { PALETA } from '@/lib/marca/paleta'

type TabKey = 'puntual' | 'masiva' | 'historial';

const SEVERIDAD_CLASS: Record<Severidad, string> = {
  alto: 'bg-alerta text-white',
  medio: 'bg-advertencia text-tinta',
  bajo: 'bg-[#FBBF24] text-tinta',
  informativo: 'bg-tinta-suave text-white',
  sin_hallazgo: 'bg-acento text-white',
  error: 'bg-tinta text-white',
};

const SEVERIDAD_LABEL: Record<Severidad, string> = {
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
  informativo: 'Informativo',
  sin_hallazgo: 'Sin hallazgo',
  error: 'Error',
};

const TIER_CLASS: Record<TierLista, string> = {
  '1_vinculante': 'bg-alerta text-white',
  '2_obligatoria': 'bg-advertencia text-tinta',
  '3_referencia': 'bg-tinta-suave text-white',
  '4_kyc_nacional': 'bg-[#2980b9] text-white',
};

const TIER_LABEL: Record<TierLista, string> = {
  '1_vinculante': 'Vinculante',
  '2_obligatoria': 'Oblig. Colombia',
  '3_referencia': 'Referencia',
  '4_kyc_nacional': 'KYC Nacional',
};

function base64ToBlob(b64: string, mime: string): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type Props = {
  historialInicial: ConsultaHistorialItem[];
  errorHistorial: string | null;
  tutorialNuncaVisto?: boolean;
  negocioInicial?: NegocioBusqueda | null;
  /**
   * Modo vitrina (workspaces Valida-only, config_extra.modo_vitrina). Oculta toda
   * la mecánica de "asociar a negocio" (picker en consulta puntual + carga masiva,
   * filtro y columna en historial) y descarga la plantilla sin la columna
   * negocio_codigo. Default false → comportamiento íntegro (AFI conserva el picker).
   */
  modoVitrina?: boolean;
  /**
   * Lo que va debajo del título, antes de las pestañas: los avisos de plazo y mora que ven todos y,
   * a quien maneja la suscripción, la franja que lleva a Suscripción. Se pinta en el servidor.
   */
  encabezado?: React.ReactNode;
  /**
   * Lo que se muestra EN LUGAR de las consultas cuando Valida está pausada (mora de más de 30 días).
   */
  consultasEnPausa?: React.ReactNode;
  /**
   * Lo que se muestra EN LUGAR de los formularios de consulta puntual y masiva cuando las consultas
   * nuevas están restringidas por mora (cláusula 11.1): el historial y sus descargas siguen abiertos.
   */
  consultasRestringidas?: React.ReactNode;
  /**
   * Saldo de la bolsa (la prueba gratis del registro autogestionado, o una bolsa prepagada). null =
   * el espacio no consulta con bolsa y no se muestra contador. Agotada o vencida, «Activa tu plan»
   * reemplaza los formularios de consulta.
   */
  saldo?: SaldoBolsa | null;
  /**
   * La prueba gratis del registro autogestionado: con ella, el contador, la fecha y el cobro van en UNA
   * franja (`FranjaPrueba`) en vez de la línea del saldo. null = no es una prueba.
   */
  prueba?: PruebaEnPantalla | null;
  /** El lote del enlace del correo (`/valida?lote=<id>`): abre la carga masiva en ese lote. */
  loteInicialId?: string | null;
};

export default function ValidaClient({
  historialInicial,
  errorHistorial,
  tutorialNuncaVisto = false,
  negocioInicial = null,
  modoVitrina = false,
  encabezado = null,
  consultasEnPausa = null,
  consultasRestringidas: restringidasPorMora = null,
  saldo = null,
  prueba = null,
  loteInicialId = null,
}: Props) {
  const [saldoLocal, setSaldoLocal] = useState<SaldoBolsa | null>(saldo);
  const [corte, setCorte] = useState<MotivoCorte | null>(saldo?.bloqueada ? (saldo.motivo ?? 'bolsa_agotada') : null);
  // La mora manda (es un contrato con cuotas vencidas); si no, el corte de la bolsa.
  const consultasRestringidas =
    restringidasPorMora ?? (corte ? <ActivaTuPlan motivo={corte} esPrueba={saldoLocal?.esPrueba ?? false} /> : null);
  const [tab, setTab] = useState<TabKey>(
    negocioInicial || consultasRestringidas ? 'historial' : loteInicialId ? 'masiva' : 'puntual',
  );
  const [historial, setHistorial] = useState<ConsultaHistorialItem[]>(historialInicial);
  const [historialError, setHistorialError] = useState<string | null>(errorHistorial);
  const [tourTrigger, setTourTrigger] = useState(0);
  // Sin filtros, un historial vacío invita a la primera consulta; con filtros, dice que no hay resultados.
  const [conFiltros, setConFiltros] = useState(Boolean(negocioInicial));

  async function refrescarHistorial(filtros?: FiltrosHistorial) {
    setConFiltros(Boolean(filtros && Object.entries(filtros).some(([k, v]) => k !== 'limite' && v !== undefined && v !== '')));
    const r = await listarConsultasValida(filtros);
    if (r.ok) {
      setHistorial(r.consultas);
      setHistorialError(null);
    } else {
      setHistorialError(r.error);
    }
  }

  function dispararTutorial() {
    setTourTrigger(t => t + 1);
    setTab('puntual');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-acento" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-tinta">Valida</h1>
          <p className="text-sm text-tinta-suave">
            Consulta puntual o por cargue contra listas vinculantes SARLAFT (ONU, OFAC, UE, PEP, CSN).
          </p>
        </div>
        <TutorialButton onClick={dispararTutorial} />
      </div>

      {encabezado}
      {prueba && !consultasEnPausa && !restringidasPorMora ? (
        <FranjaPrueba saldo={saldoLocal} prueba={prueba} />
      ) : (
        saldoLocal && !corte && !consultasEnPausa && !restringidasPorMora && <SaldoConsultas saldo={saldoLocal} />
      )}

      <div className="space-y-6">
      {consultasEnPausa ? consultasEnPausa : (<>
      <div className="flex gap-1 border-b border-[#E5E7EB]">
        <TabButton
          active={tab === 'puntual'}
          onClick={() => setTab('puntual')}
          icon={<Search className="h-4 w-4" />}
        >
          Consulta puntual
        </TabButton>
        <TabButton
          active={tab === 'masiva'}
          onClick={() => setTab('masiva')}
          icon={<FileSpreadsheet className="h-4 w-4" />}
          dataTutorialTarget="tab-masiva"
        >
          Carga masiva
        </TabButton>
        <TabButton
          active={tab === 'historial'}
          onClick={() => setTab('historial')}
          icon={<History className="h-4 w-4" />}
          dataTutorialTarget="tab-historial"
        >
          Historial
        </TabButton>
      </div>

      {tab !== 'historial' && consultasRestringidas}
      {tab === 'puntual' && !consultasRestringidas && (
        <ConsultaPuntualForm
          onPersisted={() => refrescarHistorial()}
          modoVitrina={modoVitrina}
          onCorte={setCorte}
          onConsumidas={n => setSaldoLocal(s => (s ? { ...s, saldo: Math.max(0, s.saldo - n) } : s))}
        />
      )}
      {tab === 'masiva' && !consultasRestringidas && (
        <ConsultaMasivaForm
          onPersisted={() => refrescarHistorial()}
          modoVitrina={modoVitrina}
          onCorte={setCorte}
          onConsumidas={n => setSaldoLocal(s => (s ? { ...s, saldo: Math.max(0, s.saldo - n) } : s))}
          esPrueba={saldoLocal?.esPrueba ?? false}
         
          loteInicialId={loteInicialId}
        />
      )}
      {tab === 'historial' && (
        <Historial
          consultas={historial}
          error={historialError}
          onFiltrar={refrescarHistorial}
          negocioInicial={negocioInicial}
          modoVitrina={modoVitrina}
          textoVacio={conFiltros ? undefined : 'Haz tu primera consulta arriba.'}
        />
      )}
      </>)}
      </div>

      {!consultasEnPausa && !consultasRestringidas && (tutorialNuncaVisto || tourTrigger > 0) && (
        <TutorialTour slug="valida_standalone" forceStart={tourTrigger} />
      )}
    </div>
  );
}

// ─── Tabs UI ──────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  children,
  dataTutorialTarget,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  dataTutorialTarget?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tutorial-target={dataTutorialTarget}
      className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active ? 'border-tinta text-tinta' : 'border-transparent text-tinta-suave hover:text-tinta'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Consulta puntual ─────────────────────────────────────────────────────

type PropsForm = {
  onPersisted: () => void;
  modoVitrina?: boolean;
  /** La bolsa se cortó: el padre cambia los formularios por «Activa tu plan». */
  onCorte?: (motivo: MotivoCorte) => void;
  /** Consultas con resultado, para bajar el contador sin volver a leer el saldo. */
  onConsumidas?: (n: number) => void;
  /** La bolsa es la prueba gratis (cambia el texto del corte). */
  esPrueba?: boolean;
};

function ConsultaPuntualForm({ onPersisted, modoVitrina = false, onCorte, onConsumidas }: PropsForm) {
  const [tipo, setTipo] = useState<TipoPersona>('natural');
  const [nombre, setNombre] = useState('');
  const [docTipo, setDocTipo] = useState<TipoDocumento>('CC');
  const [docNumero, setDocNumero] = useState('');
  const [negocio, setNegocio] = useState<NegocioBusqueda | null>(null);
  const [resultado, setResultado] = useState<{ data: ValidaResultado; valida_id: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultado(null);

    startTransition(async () => {
      const input: Parameters<typeof consultarValida>[0] = { tipo };
      if (nombre.trim()) input.nombre = nombre.trim();
      if (docNumero.trim()) input.documento = { tipo: docTipo, numero: docNumero.trim() };
      const r = await consultarValida(input, { negocio_id: negocio?.id ?? null });
      if (r.ok) {
        setResultado({ data: r.data, valida_id: r.data.consulta_id });
        onConsumidas?.(1);
        onPersisted();
      } else if (esMotivoCorte(r.error)) {
        onCorte?.(r.error);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        data-tutorial-target="consulta-puntual-form"
        className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4"
      >
        <div className="flex gap-2">
          {(['natural', 'juridica'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                tipo === t
                  ? 'bg-tinta text-white border-tinta'
                  : 'bg-white text-tinta-suave border-[#E5E7EB] hover:border-tinta'
              }`}
            >
              {t === 'natural' ? 'Persona natural' : 'Persona jurídica'}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
            {tipo === 'natural' ? 'Nombre completo' : 'Razón social'}{' '}
            <span className="font-light lowercase tracking-normal">(nombre o documento)</span>
          </label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            minLength={2}
            placeholder={tipo === 'natural' ? 'Juan Pérez Gómez' : 'Acme Trading SAS'}
            className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta"
          />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Tipo documento
            </label>
            <select
              value={docTipo}
              onChange={e => setDocTipo(e.target.value as TipoDocumento)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white"
            >
              {tipo === 'natural' ? (
                <>
                  <option value="CC">CC</option>
                  <option value="CE">CE</option>
                  <option value="PAS">Pasaporte</option>
                </>
              ) : (
                <option value="NIT">NIT</option>
              )}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Número <span className="font-light lowercase tracking-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={docNumero}
              onChange={e => setDocNumero(e.target.value)}
              placeholder="1077089147"
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta"
            />
          </div>
        </div>

        {!modoVitrina && (
          <div data-tutorial-target="negocio-picker">
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Asociar a negocio <span className="font-light lowercase tracking-normal">(opcional)</span>
            </label>
            <NegocioPicker value={negocio} onChange={setNegocio} />
            <p className="text-xs text-tinta-suave mt-1.5">
              Útil para agrupar consultas por CDA. Incluye negocios cerrados.
            </p>
          </div>
        )}

        {(nombre.trim().length >= 2) !== (docNumero.trim().length >= 3) && (nombre.trim() || docNumero.trim()) ? (
          <div className="p-3 rounded-lg bg-[#FFFBEB] border-l-[3px] border-advertencia text-tinta text-xs leading-relaxed">
            Estás consultando con un solo dato ({nombre.trim().length >= 2 ? 'nombre' : 'documento'}). Es posible que no se
            detecten todas las coincidencias. Si una coincidencia aporta el dato faltante, Valida revalida automáticamente
            contra el resto de listas. Para máxima cobertura, ingresa nombre y documento.
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending || (nombre.trim().length < 2 && docNumero.trim().length < 3)}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-tinta text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando…' : 'Consultar'}
        </button>

        {error && <ErrorBox msg={error} />}
      </form>

      {resultado && (
        <div data-tutorial-target="resultado-zona">
          <ResultadoCard
            data={resultado.data}
            nombreConsultado={nombre}
            validaConsultaId={resultado.valida_id}
          />
        </div>
      )}
    </div>
  );
}

// ─── Buscador de negocios (incluye cerrados) ──────────────────────────────

function NegocioPicker({
  value,
  onChange,
}: {
  value: NegocioBusqueda | null;
  onChange: (n: NegocioBusqueda | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<NegocioBusqueda[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      const r = await buscarNegociosParaValida(query);
      if (!cancelled) {
        setItems(r.ok ? r.negocios : []);
        setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] bg-white text-left text-sm flex items-center justify-between hover:border-tinta transition-colors"
      >
        {value ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs text-tinta-suave shrink-0">{value.codigo}</span>
            <span className="truncate text-tinta">{value.nombre}</span>
            {value.estado === 'completado' && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-papel text-tinta-suave shrink-0">
                Cerrado
              </span>
            )}
          </span>
        ) : (
          <span className="text-[#9CA3AF]">Sin asociar</span>
        )}
        <span className="flex items-center gap-1 shrink-0">
          {value && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onChange(null);
              }}
              className="p-1 rounded hover:bg-papel"
            >
              <X className="h-3.5 w-3.5 text-tinta-suave" />
            </button>
          )}
          <ChevronDown className="h-4 w-4 text-tinta-suave" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-[#E5E7EB] rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-[#E5E7EB]">
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar por código o nombre…"
              className="w-full h-9 px-3 text-sm rounded-md border border-[#E5E7EB] focus:outline-none focus:border-tinta"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-sm text-tinta-suave text-center">Buscando…</div>
            ) : items.length === 0 ? (
              <div className="p-3 text-sm text-tinta-suave text-center">Sin resultados</div>
            ) : (
              items.map(n => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    onChange(n);
                    setOpen(false);
                    setQuery('');
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-papel flex items-center gap-2"
                >
                  <span className="font-mono text-xs text-tinta-suave shrink-0 w-20">{n.codigo}</span>
                  <span className="truncate text-tinta flex-1">{n.nombre}</span>
                  {n.estado === 'completado' && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-papel text-tinta-suave shrink-0">
                      Cerrado
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resultado puntual ────────────────────────────────────────────────────

function ResultadoCard({
  data,
  nombreConsultado,
  validaConsultaId,
}: {
  data: ValidaResultado;
  nombreConsultado: string;
  validaConsultaId: string | null;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">Resultado</p>
          <h3 className="text-lg font-bold text-tinta mt-1">{nombreConsultado.trim() || 'Consulta por documento'}</h3>
          <p className="text-xs text-tinta-suave font-mono">ID: {data.consulta_id}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`${SEVERIDAD_CLASS[data.severidad]} text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider`}
          >
            {SEVERIDAD_LABEL[data.severidad]}
          </span>
          {validaConsultaId && <BotonPDFConsulta validaConsultaId={validaConsultaId} variante="primario" />}
        </div>
      </div>

      <div className="p-5 space-y-2">
        {data.consulta_parcial && (
          <div className="p-3 mb-2 rounded-lg bg-[#FFFBEB] border-l-[3px] border-advertencia text-tinta text-xs leading-relaxed">
            Consulta con un solo dato identificador — es posible que no se detecten todas las coincidencias. Cuando una
            coincidencia aporta el dato que faltaba, se revalida contra el resto de listas (marcado como “derivada”).
          </div>
        )}
        <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
          Coincidencias ({data.total_matches})
        </p>
        {data.matches.length === 0 ? (
          <p className="text-sm text-acento font-medium">Sin coincidencias.</p>
        ) : (
          <ul className="space-y-2">
            {data.matches.slice(0, 20).map((m, i) => (
              <li key={i} className="flex items-center gap-3 py-2 border-b border-[#E5E7EB] last:border-0">
                <span
                  className={`${TIER_CLASS[m.tier]} text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider min-w-[110px] text-center`}
                >
                  {TIER_LABEL[m.tier]}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-tinta truncate">{m.nombre_coincidencia}</p>
                  <p className="text-xs text-tinta-suave truncate">{m.lista_nombre}</p>
                  {m.documento_coincidencia?.numero && (
                    <p className="text-[11px] text-acento truncate">
                      Documento en la lista: {m.documento_coincidencia.tipo} {m.documento_coincidencia.numero}
                      {m.documento_coincidencia.pais ? ` (${m.documento_coincidencia.pais})` : ''}
                    </p>
                  )}
                  {m.derivado && m.derivado_de && (
                    <p className="text-[10px] text-tinta-suave uppercase tracking-wider">
                      Coincidencia derivada · {m.derivado_de.tipo} hallado en {m.derivado_de.lista_nombre}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{(m.score * 100).toFixed(1)}%</p>
                  <p className="text-[10px] text-tinta-suave uppercase">
                    {m.resultado === 'exacto' ? 'Exacto' : 'Posible'} · Puntaje
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Boton descargar PDF de una consulta ──────────────────────────────────

function BotonPDFConsulta({
  validaConsultaId,
  variante = 'compacto',
}: {
  validaConsultaId: string;
  variante?: 'compacto' | 'primario';
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function descargar() {
    setError(null);
    startTransition(async () => {
      const r = await descargarPDFConsultaValida(validaConsultaId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const blob = base64ToBlob(r.data.base64, 'application/pdf');
      triggerDownload(blob, r.data.filename);
    });
  }

  if (variante === 'primario') {
    return (
      <button
        type="button"
        onClick={descargar}
        disabled={pending}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-acento text-white font-semibold text-xs uppercase tracking-wider hover:bg-acento-hover disabled:opacity-50 transition-colors"
        title={error ?? 'Descargar reporte PDF'}
      >
        <FileText className="h-3.5 w-3.5" />
        {pending ? 'Generando…' : 'Reporte PDF'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={descargar}
      disabled={pending}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider text-tinta hover:bg-papel disabled:opacity-40 transition-colors"
      title={error ?? 'Descargar reporte PDF'}
    >
      <FileText className="h-3.5 w-3.5" />
      {pending ? '…' : 'PDF'}
    </button>
  );
}

// ─── Carga masiva (procesada en el servidor) ──────────────────────────────
//
// Desde el 2026-10-15 el lote lo procesa el servidor (`@/lib/valida/lote-servidor`): el archivo se
// sube una vez, y esta pantalla solo pregunta el progreso. Se puede cerrar la pestaña y volver: al
// abrir la carga masiva se retoma el último lote sin terminar (o el del enlace del correo).

type EstadoCargue =
  | { fase: 'inicial' }
  | { fase: 'preparando' }
  | { fase: 'confirmar_saldo'; alcanzan: number; consultables: number; total: number }
  | { fase: 'confirmar_tipos'; aviso: AvisoTiposDocumento; total: number }
  | { fase: 'lote'; lote: LoteVista }
  | { fase: 'error'; mensaje: string };

/** Cada cuánto se pregunta el progreso mientras el lote corre. */
const INTERVALO_PROGRESO_MS = 2_500;

function sinCorte(motivo: string | null): MotivoCorte | null {
  return esMotivoCorte(motivo) ? motivo : null;
}

function conResultado(sev: Record<string, number>): number {
  return Object.entries(sev).reduce((a, [s, n]) => (s === 'error' ? a : a + n), 0);
}

type PropsMasiva = PropsForm & { loteInicialId?: string | null };

function ConsultaMasivaForm({
  onPersisted,
  modoVitrina = false,
  onCorte,
  onConsumidas,
  esPrueba = false,
  loteInicialId = null,
}: PropsMasiva) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState('');
  const [negocioLote, setNegocioLote] = useState<NegocioBusqueda | null>(null);
  const [estado, setEstado] = useState<EstadoCargue>({ fase: 'inicial' });
  const [pendingTpl, startTplTransition] = useTransition();
  const [descargando, setDescargando] = useState<string | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [accion, setAccion] = useState(false);
  // Lo ya descontado del contador de la bolsa por este lote, para no descontarlo dos veces.
  const descontadas = useRef<Record<string, number>>({});
  // La persona ya aceptó que las filas con un tipo de documento no reconocido no se consulten: el
  // paso de la bolsa, si viene después, no vuelve a preguntarlo.
  const tiposAceptados = useRef(false);

  const loteId = estado.fase === 'lote' ? estado.lote.id : null;
  const activo = estado.fase === 'lote' && (estado.lote.estado === 'en_cola' || estado.lote.estado === 'procesando' || estado.lote.estado === 'preparando');

  // Al abrir: el lote del enlace del correo, o el último sin terminar del espacio.
  useEffect(() => {
    let vivo = true;
    loteVigenteValida(loteInicialId).then(r => {
      if (vivo && r.ok && r.lote) {
        descontadas.current[r.lote.id] = conResultado(r.lote.severidades);
        setEstado(e => (e.fase === 'inicial' ? { fase: 'lote', lote: r.lote! } : e));
      }
    });
    return () => {
      vivo = false;
    };
  }, [loteInicialId]);

  function recibir(lote: LoteVista) {
    const antes = descontadas.current[lote.id] ?? 0;
    const ahora = conResultado(lote.severidades);
    if (ahora > antes) {
      descontadas.current[lote.id] = ahora;
      onConsumidas?.(ahora - antes);
    }
    setEstado({ fase: 'lote', lote });
  }

  // Mientras el lote corre, el progreso. Una pregunta a la vez (los server actions van en fila).
  useEffect(() => {
    if (!loteId || !activo) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const preguntar = async () => {
      const r = await progresoLoteValida(loteId).catch(() => null);
      if (!vivo) return;
      if (r?.ok) {
        recibir(r.lote);
        if (r.lote.estado !== 'en_cola' && r.lote.estado !== 'procesando' && r.lote.estado !== 'preparando') {
          onPersisted();
          return;
        }
      } else if (r && !r.ok) {
        setEstado({ fase: 'error', mensaje: r.error });
        return;
      }
      timer = setTimeout(preguntar, INTERVALO_PROGRESO_MS);
    };
    timer = setTimeout(preguntar, INTERVALO_PROGRESO_MS);
    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteId, activo]);

  const drop = useFileDrop({
    onFiles: f => setArchivo(f[0] ?? null),
    disabled: estado.fase === 'preparando' || activo,
  });

  async function descargarPlantilla() {
    startTplTransition(async () => {
      const r = await descargarPlantillaValida({ sinNegocio: modoVitrina });
      if (!r.ok) {
        setEstado({ fase: 'error', mensaje: r.error });
        return;
      }
      const blob = base64ToBlob(
        r.data.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      triggerDownload(blob, r.data.filename);
    });
  }

  async function crear(limite: number | null) {
    if (!archivo) {
      setEstado({ fase: 'error', mensaje: 'Selecciona un archivo XLSX' });
      return;
    }
    setEstado({ fase: 'preparando' });
    const fd = new FormData();
    fd.append('archivo', archivo);
    const r = await crearLoteValida(fd, {
      negocio_id_lote: negocioLote?.id ?? null,
      titulo: titulo.trim() || null,
      limite,
      aceptarTiposDocumento: tiposAceptados.current,
    });
    if (r.ok) {
      descontadas.current[r.lote.id] = 0;
      setEstado({ fase: 'lote', lote: r.lote });
      return;
    }
    if ('corte' in r && esMotivoCorte(r.error)) {
      onCorte?.(r.error);
      setEstado({ fase: 'inicial' });
      return;
    }
    if ('aviso' in r) {
      setEstado({ fase: 'confirmar_tipos', aviso: r.aviso, total: r.total });
      return;
    }
    if ('alcanzan' in r) {
      setEstado({ fase: 'confirmar_saldo', alcanzan: r.alcanzan, consultables: r.consultables, total: r.total });
      return;
    }
    setEstado({ fase: 'error', mensaje: r.error });
  }

  function iniciarCargue(e: React.FormEvent) {
    e.preventDefault();
    tiposAceptados.current = false;
    void crear(null);
  }

  async function reanudar() {
    if (!loteId) return;
    setAccion(true);
    const r = await reanudarLoteValida(loteId);
    setAccion(false);
    if (r.ok) recibir(r.lote);
    else if (r.corte && esMotivoCorte(r.error)) onCorte?.(r.error);
    else setEstado({ fase: 'error', mensaje: r.error });
  }

  async function cancelar() {
    if (!loteId) return;
    setAccion(true);
    const r = await cancelarLoteValida(loteId);
    setAccion(false);
    if (r.ok) {
      recibir(r.lote);
      onPersisted();
    } else setEstado({ fase: 'error', mensaje: r.error });
  }

  async function descargarPdf(parte: number) {
    if (!loteId) return;
    setDescargando(`pdf-${parte}`);
    setErrorDescarga(null);
    const r = await pdfLoteValida(loteId, parte);
    setDescargando(null);
    if (!r.ok) {
      setErrorDescarga(r.error);
      return;
    }
    triggerDownload(base64ToBlob(r.data.base64, 'application/pdf'), r.data.filename);
  }

  async function descargarResultados() {
    if (!loteId) return;
    setDescargando('xlsx');
    setErrorDescarga(null);
    const r = await resultadosLoteValida(loteId);
    setDescargando(null);
    if (!r.ok) {
      setErrorDescarga(r.error);
      return;
    }
    triggerDownload(
      base64ToBlob(r.data.base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
      r.data.filename,
    );
  }

  function reiniciar() {
    // Tras un cargue cortado por la bolsa, «Nuevo cargue» lleva a «Activa tu plan»: otro no pasaría.
    const corte = estado.fase === 'lote' ? sinCorte(estado.lote.motivoPausa) : null;
    if (corte) {
      onCorte?.(corte);
      return;
    }
    setArchivo(null);
    setTitulo('');
    setNegocioLote(null);
    setEstado({ fase: 'inicial' });
    setErrorDescarga(null);
    const input = document.getElementById('archivo-batch') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-tinta">Carga masiva (XLSX)</h3>
          <p className="text-sm text-tinta-suave mt-1">
            Sube un XLSX con la plantilla. Hasta {TOPE_FILAS_LOTE.toLocaleString('es-CO')} filas. El cargue corre en el servidor: puedes cerrar
            esta pestaña y volver. Al finalizar generas un reporte PDF del cargue con marca verificable.
          </p>
        </div>
        <button
          type="button"
          onClick={descargarPlantilla}
          disabled={pendingTpl}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel disabled:opacity-50 transition-colors"
        >
          <Download className="h-4 w-4" />
          {pendingTpl ? 'Descargando…' : 'Descargar plantilla'}
        </button>
      </div>

      {estado.fase === 'lote' && !activo ? (
        <ResumenLote
          lote={estado.lote}
          esPrueba={esPrueba}
         
          descargando={descargando}
          errorDescarga={errorDescarga}
          accion={accion}
          onDescargarPdf={descargarPdf}
          onDescargarResultados={descargarResultados}
          onReanudar={reanudar}
          onCancelar={cancelar}
          onReiniciar={reiniciar}
        />
      ) : estado.fase === 'lote' ? (
        <ProgresoCargue lote={estado.lote} accion={accion} onCancelar={cancelar} />
      ) : estado.fase === 'preparando' ? (
        <div className="py-10 text-center space-y-3">
          <Dona total={1} procesadas={0} pulsante />
          <p className="text-sm font-semibold text-tinta">Preparando cargue…</p>
          <p className="text-xs text-tinta-suave">Leyendo el archivo, validando filas y revisando tu saldo.</p>
        </div>
      ) : estado.fase === 'confirmar_tipos' ? (
        <AvisoTipos
          aviso={estado.aviso}
          total={estado.total}
          onProcesar={() => {
            tiposAceptados.current = true;
            void crear(null);
          }}
          onCancelar={() => setEstado({ fase: 'inicial' })}
        />
      ) : estado.fase === 'confirmar_saldo' ? (
        <div data-cargue-saldo className="rounded-lg border border-[#E5E7EB] p-5 space-y-3">
          <p className="text-sm font-semibold text-tinta">
            Tu bolsa alcanza para {estado.alcanzan} de las {estado.consultables} consultas del archivo.
          </p>
          <p className="text-sm text-tinta-suave">
            Puedes procesar las primeras {estado.alcanzan} filas que se consultan; el resto no se procesa ni se cobra.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            {estado.alcanzan > 0 && (
              <button
                type="button"
                onClick={() => void crear(estado.alcanzan)}
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-tinta text-white font-semibold hover:bg-[#374151] transition-colors"
              >
                Procesar las primeras {estado.alcanzan}
              </button>
            )}
            <button
              type="button"
              onClick={() => setEstado({ fase: 'inicial' })}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={iniciarCargue} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Título del cargue <span className="font-light lowercase tracking-normal">(opcional, queda en el reporte)</span>
            </label>
            <input
              type="text"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Cargue CDA mayo 2026"
              maxLength={200}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta"
            />
          </div>

          {!modoVitrina && (
          <div>
            <label className="block text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
              Asociar todo el lote a un negocio <span className="font-light lowercase tracking-normal">(opcional)</span>
            </label>
            <NegocioPicker value={negocioLote} onChange={setNegocioLote} />
            <p className="text-xs text-tinta-suave mt-1.5">
              Si la columna <code className="bg-papel px-1 rounded">negocio_codigo</code> tiene valor en el XLSX, sobrescribe esta selección fila por fila.
            </p>
          </div>
          )}

          <label
            htmlFor="archivo-batch"
            {...drop.dropProps}
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${
              drop.isDragging
                ? 'border-acento bg-acento/5'
                : 'border-[#E5E7EB] hover:border-tinta'
            }`}
          >
            <Upload className={`h-8 w-8 ${drop.isDragging ? 'text-acento' : 'text-tinta-suave'}`} />
            <div className="text-center">
              <p className="text-sm font-semibold text-tinta">
                {drop.isDragging
                  ? 'Suelta el archivo aquí'
                  : archivo
                  ? archivo.name
                  : 'Arrastra o selecciona un archivo XLSX'}
              </p>
              <p className="text-xs text-tinta-suave mt-1">Solo .xlsx — hasta 5 MB / {TOPE_FILAS_LOTE.toLocaleString('es-CO')} filas</p>
            </div>
            <input
              id="archivo-batch"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={e => setArchivo(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>

          <button
            type="submit"
            disabled={!archivo}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-tinta text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
          >
            <Upload className="h-4 w-4" />
            Procesar cargue
          </button>

          {estado.fase === 'error' && <ErrorBox msg={estado.mensaje} />}
        </form>
      )}
    </div>
  );
}

function AvisoTipos({
  aviso,
  total,
  onProcesar,
  onCancelar,
}: {
  aviso: AvisoTiposDocumento;
  total: number;
  onProcesar: () => void;
  onCancelar: () => void;
}) {
  const una = aviso.filas === 1;
  return (
    <div data-cargue-tipos className="rounded-lg border border-[#E5E7EB] p-5 space-y-3">
      <p className="text-sm font-semibold text-tinta">
        {una ? '1 fila' : `${aviso.filas} filas`} de {total} {una ? 'tiene' : 'tienen'} un tipo de documento que Valida no
        consulta.
      </p>
      <p className="text-sm text-tinta-suave">
        En la columna <code className="bg-papel px-1 rounded">tipo_documento</code> usa CC, CE, NIT o PAS. También se
        entienden «Cédula», «Pasaporte», «PP» o «PA». Si procesas así, esas filas no se consultan ni se cobran.
      </p>
      <ul className="text-xs text-tinta-suave space-y-1">
        {aviso.ejemplos.map((e) => (
          <li key={e.fila}>
            <span className="font-semibold text-tinta">Fila {e.fila}</span> ({e.valor || 'vacío'}): {e.mensaje}
          </li>
        ))}
        {aviso.filas > aviso.ejemplos.length && <li>Y {aviso.filas - aviso.ejemplos.length} más.</li>}
      </ul>
      <div className="flex flex-col sm:flex-row gap-2">
        <button
          type="button"
          onClick={onCancelar}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-tinta text-white font-semibold hover:bg-[#374151] transition-colors"
        >
          Corregir el archivo
        </button>
        <button
          type="button"
          onClick={onProcesar}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel transition-colors"
        >
          Procesar de todas formas
        </button>
      </div>
    </div>
  );
}

function ProgresoCargue({ lote, accion, onCancelar }: { lote: LoteVista; accion: boolean; onCancelar: () => void }) {
  const pct = lote.total === 0 ? 0 : Math.round((lote.procesadas / lote.total) * 100);
  return (
    <div className="py-6 space-y-5">
      <div className="flex items-center justify-center">
        <Dona total={lote.total} procesadas={lote.procesadas} pulsante={lote.estado !== 'procesando'} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-tinta-suave">
          <span className="font-semibold">
            {lote.procesadas} / {lote.total} consultas{lote.titulo ? ` · ${lote.titulo}` : ''}
          </span>
          <span className="font-mono">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
          <div className="h-full bg-acento transition-[width] duration-200 ease-out" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <DistribucionSeveridad sev={lote.severidades as Record<Severidad, number>} />
      <p className="text-[11px] text-center text-tinta-suave">
        {lote.estado === 'procesando' ? 'Procesando en el servidor.' : 'En cola: empieza en unos segundos.'} Puedes cerrar esta pestaña:
        el cargue sigue y lo retomas al volver a Carga masiva.
        {lote.avisaPorCorreo ? ' Te avisamos por correo al terminar.' : ''}
      </p>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onCancelar}
          disabled={accion}
          className="text-xs font-semibold text-tinta-suave hover:text-tinta underline disabled:opacity-50"
        >
          Cancelar cargue
        </button>
      </div>
    </div>
  );
}

function Dona({ total, procesadas, pulsante }: { total: number; procesadas: number; pulsante?: boolean }) {
  const radio = 52;
  const stroke = 10;
  const circ = 2 * Math.PI * radio;
  const pct = total === 0 ? 0 : procesadas / total;
  const offset = circ * (1 - pct);
  const pctTexto = total === 0 ? 0 : Math.round(pct * 100);

  return (
    <div className={`relative h-32 w-32 ${pulsante ? 'animate-pulse' : ''}`}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle
          cx="64"
          cy="64"
          r={radio}
          fill="none"
          stroke="#E5E7EB"
          strokeWidth={stroke}
        />
        <circle
          cx="64"
          cy="64"
          r={radio}
          fill="none"
          stroke={PALETA.acento}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-tinta leading-none">{pctTexto}%</span>
        <span className="text-[10px] uppercase tracking-wider text-tinta-suave mt-0.5 font-semibold">
          procesado
        </span>
      </div>
    </div>
  );
}

function DistribucionSeveridad({ sev }: { sev: Record<Severidad, number> }) {
  const items: Severidad[] = ['alto', 'medio', 'bajo', 'informativo', 'sin_hallazgo', 'error'];
  const visibles = items.filter(s => (sev[s] ?? 0) > 0);
  if (visibles.length === 0) {
    return <p className="text-[11px] text-center text-tinta-suave">Aún sin resultados — los primeros aparecen pronto.</p>;
  }
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {visibles.map(s => (
        <span
          key={s}
          className={`${SEVERIDAD_CLASS[s]} text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider`}
        >
          {SEVERIDAD_LABEL[s]} · {sev[s]}
        </span>
      ))}
    </div>
  );
}

function ResumenLote({
  lote,
  esPrueba,
  descargando,
  errorDescarga,
  accion,
  onDescargarPdf,
  onDescargarResultados,
  onReanudar,
  onCancelar,
  onReiniciar,
}: {
  lote: LoteVista;
  esPrueba: boolean;
  descargando: string | null;
  errorDescarga: string | null;
  accion: boolean;
  onDescargarPdf: (parte: number) => void;
  onDescargarResultados: () => void;
  onReanudar: () => void;
  onCancelar: () => void;
  onReiniciar: () => void;
}) {
  const pausado = lote.estado === 'pausado';
  const cancelado = lote.estado === 'cancelado';
  const sinConsultar = Math.max(0, lote.total - lote.procesadas);
  const corte = sinCorte(lote.motivoPausa);
  const titulo = pausado ? 'Cargue detenido' : cancelado ? 'Cargue cancelado' : 'Cargue completado';

  return (
    <div className="space-y-5">
      <div className={`rounded-lg border p-5 ${pausado || cancelado ? 'bg-papel border-[#E5E7EB]' : 'bg-acento-tinte border-acento/30'}`}>
        <div className={`flex items-center gap-2 font-semibold ${pausado || cancelado ? 'text-tinta' : 'text-acento'}`}>
          <Check className="h-5 w-5" />
          {titulo}
        </div>
        <p className="text-sm text-tinta mt-1">
          {lote.procesadas} consultas procesadas{lote.titulo ? ` · ${lote.titulo}` : ''}.
          {lote.omitidas > 0 ? ` ${lote.omitidas} filas del archivo no entraron porque la bolsa no alcanzaba.` : ''}
        </p>
        <div className="mt-3">
          <DistribucionSeveridad sev={lote.severidades as Record<Severidad, number>} />
        </div>
      </div>

      {(pausado || cancelado) && sinConsultar > 0 && (
        <div data-cargue-cortado className="space-y-2">
          <p className="text-sm text-tinta">
            {sinConsultar === 1
              ? '1 fila quedó sin consultar y no se cobró.'
              : `${sinConsultar} filas quedaron sin consultar y no se cobraron.`}
          </p>
          {pausado && lote.textoPausa && !corte && <p className="text-sm text-tinta-suave">{lote.textoPausa}</p>}
          {corte && <ActivaTuPlan motivo={corte} esPrueba={esPrueba} />}
          {pausado && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={onReanudar}
                disabled={accion}
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-tinta text-white font-semibold hover:bg-[#374151] disabled:opacity-50 transition-colors"
              >
                Reanudar cargue
              </button>
              <button
                type="button"
                onClick={onCancelar}
                disabled={accion}
                className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel disabled:opacity-50 transition-colors"
              >
                Cancelar lo que falta
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap gap-2">
        {Array.from({ length: lote.partesPdf }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onDescargarPdf(i)}
            disabled={descargando !== null}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-acento text-white font-semibold hover:bg-acento-hover disabled:opacity-50 transition-colors"
          >
            <FileText className="h-4 w-4" />
            {descargando === `pdf-${i}`
              ? 'Generando reporte…'
              : lote.partesPdf > 1
              ? `Reporte PDF · parte ${i + 1} de ${lote.partesPdf}`
              : 'Descargar reporte del cargue (PDF)'}
          </button>
        ))}
        <button
          type="button"
          onClick={onDescargarResultados}
          disabled={descargando !== null}
          className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel disabled:opacity-50 transition-colors"
        >
          <FileSpreadsheet className="h-4 w-4" />
          {descargando === 'xlsx' ? 'Preparando…' : 'Resultados (XLSX)'}
        </button>
        {!pausado && (
          <button
            type="button"
            onClick={onReiniciar}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel transition-colors"
          >
            Nuevo cargue
          </button>
        )}
      </div>

      {errorDescarga && <ErrorBox msg={errorDescarga} />}
    </div>
  );
}

// ─── Historial con filtros ────────────────────────────────────────────────

function Historial({
  consultas,
  error,
  onFiltrar,
  negocioInicial = null,
  modoVitrina = false,
  textoVacio,
}: {
  consultas: ConsultaHistorialItem[];
  error: string | null;
  onFiltrar: (filtros: FiltrosHistorial) => Promise<void>;
  negocioInicial?: NegocioBusqueda | null;
  modoVitrina?: boolean;
  /** Lo que dice la tabla vacía. Por defecto, «Sin consultas con los filtros aplicados.». */
  textoVacio?: string;
}) {
  const [negocio, setNegocio] = useState<NegocioBusqueda | null>(negocioInicial);
  const [severidad, setSeveridad] = useState<Severidad | ''>('');
  const [tipo, setTipo] = useState<'puntual' | 'masiva_item' | ''>('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [pending, startTransition] = useTransition();

  function aplicarFiltros() {
    startTransition(async () => {
      await onFiltrar({
        negocio_id: negocio?.id,
        severidad: severidad || undefined,
        tipo: tipo || undefined,
        fecha_desde: fechaDesde || undefined,
        fecha_hasta: fechaHasta || undefined,
      });
    });
  }

  function limpiarFiltros() {
    setNegocio(null);
    setSeveridad('');
    setTipo('');
    setFechaDesde('');
    setFechaHasta('');
    startTransition(async () => {
      await onFiltrar({});
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">Filtros</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {!modoVitrina && (
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5">
                Negocio
              </label>
              <NegocioPicker value={negocio} onChange={setNegocio} />
            </div>
          )}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5">
              Severidad
            </label>
            <select
              value={severidad}
              onChange={e => setSeveridad(e.target.value as Severidad | '')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white text-sm"
            >
              <option value="">Todas</option>
              <option value="alto">Alto</option>
              <option value="medio">Medio</option>
              <option value="bajo">Bajo</option>
              <option value="informativo">Informativo</option>
              <option value="sin_hallazgo">Sin hallazgo</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5">
              Tipo
            </label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as 'puntual' | 'masiva_item' | '')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white text-sm"
            >
              <option value="">Todos</option>
              <option value="puntual">Puntual</option>
              <option value="masiva_item">Cargue</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5">
              Desde
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={e => setFechaDesde(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1.5">
              Hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={e => setFechaHasta(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-tinta bg-white text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={aplicarFiltros}
            disabled={pending}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-tinta text-white text-sm font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] transition-colors"
          >
            <Search className="h-4 w-4" />
            {pending ? 'Aplicando…' : 'Aplicar'}
          </button>
          <button
            type="button"
            onClick={limpiarFiltros}
            disabled={pending}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel transition-colors"
          >
            Limpiar
          </button>
        </div>
      </div>

      <HistorialTable consultas={consultas} error={error} mostrarNegocio={!modoVitrina} textoVacio={textoVacio} />
    </div>
  );
}

export function HistorialTable({
  consultas,
  error,
  mostrarNegocio,
  textoVacio = 'Sin consultas con los filtros aplicados.',
}: {
  consultas: ConsultaHistorialItem[];
  error: string | null;
  mostrarNegocio?: boolean;
  textoVacio?: string;
}) {
  if (error) {
    return (
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 text-sm text-[#B91C1C]">
        Error cargando historial: {error}
      </div>
    );
  }
  if (consultas.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-center text-sm text-tinta-suave">
        {textoVacio}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-papel border-b border-[#E5E7EB]">
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Fecha
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Nombre
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Documento
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Consultado por
              </th>
              {mostrarNegocio && (
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                  Negocio
                </th>
              )}
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Tipo
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Coincidencias
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Severidad
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave">
                Reporte
              </th>
            </tr>
          </thead>
          <tbody>
            {consultas.map(c => (
              <tr key={c.id} className="border-b border-[#E5E7EB] last:border-0 hover:bg-papel/60">
                <td className="px-4 py-2.5 text-tinta-suave whitespace-nowrap text-xs">
                  {formatFecha(c.created_at, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-2.5 font-medium text-tinta">{c.nombre_consultado ?? '—'}</td>
                <td className="px-4 py-2.5 text-tinta-suave font-mono text-xs">
                  {c.documento_tipo && c.documento_numero
                    ? `${c.documento_tipo} ${c.documento_numero}`
                    : '—'}
                </td>
                <td className="px-4 py-2.5 text-tinta text-xs">{c.consultado_por ?? '—'}</td>
                {mostrarNegocio && (
                  <td className="px-4 py-2.5 text-xs">
                    {c.negocio_codigo ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono text-tinta-suave">{c.negocio_codigo}</span>
                        <span className="text-tinta truncate max-w-[140px] inline-block align-bottom">
                          {c.negocio_nombre}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#9CA3AF]">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-2.5 text-center text-[10px] uppercase tracking-wider text-tinta-suave">
                  {c.tipo === 'puntual' ? 'Puntual' : 'Cargue'}
                </td>
                <td className="px-4 py-2.5 text-center font-semibold">{c.total_matches}</td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`${SEVERIDAD_CLASS[c.severidad]} text-[10px] font-bold px-2 py-0.5 rounded uppercase`}
                  >
                    {SEVERIDAD_LABEL[c.severidad]}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  {c.valida_consulta_id ? (
                    <BotonPDFConsulta validaConsultaId={c.valida_consulta_id} />
                  ) : (
                    <span className="text-[10px] text-[#9CA3AF] uppercase tracking-wider">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * El error de una consulta, un cargue o una descarga, en llano: nunca el código crudo del motor o de
 * ONE (`mensajeErrorValida`). El código, si lo hay, va pequeño como detalle técnico para soporte.
 */
export function ErrorBox({ msg }: { msg: string }) {
  const { mensaje, codigo } = mensajeErrorValida(msg);
  return (
    <div
      role="alert"
      data-error-valida={codigo ?? ''}
      className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-start gap-2"
    >
      <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p>{mensaje}</p>
        {codigo && <p className="mt-1 text-[11px] text-[#B91C1C]/70 break-all">Detalle técnico: {codigo}</p>}
      </div>
    </div>
  );
}
