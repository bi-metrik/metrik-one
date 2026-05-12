'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  FileSpreadsheet,
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
  consultarValidaMasivo,
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
import TutorialEmptyState from '@/components/tutorial/TutorialEmptyState';

type TabKey = 'puntual' | 'masiva' | 'historial';

const SEVERIDAD_CLASS: Record<Severidad, string> = {
  alto: 'bg-[#EF4444] text-white',
  medio: 'bg-[#F59E0B] text-[#1A1A1A]',
  bajo: 'bg-[#FBBF24] text-[#1A1A1A]',
  informativo: 'bg-[#6B7280] text-white',
  sin_hallazgo: 'bg-[#10B981] text-white',
  error: 'bg-[#1A1A1A] text-white',
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
  '1_vinculante': 'bg-[#EF4444] text-white',
  '2_obligatoria': 'bg-[#F59E0B] text-[#1A1A1A]',
  '3_referencia': 'bg-[#6B7280] text-white',
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
};

export default function ValidaClient({
  historialInicial,
  errorHistorial,
  tutorialNuncaVisto = false,
}: Props) {
  const [tab, setTab] = useState<TabKey>('puntual');
  const [historial, setHistorial] = useState<ConsultaHistorialItem[]>(historialInicial);
  const [historialError, setHistorialError] = useState<string | null>(errorHistorial);
  const [tourTrigger, setTourTrigger] = useState(0);

  async function refrescarHistorial(filtros?: FiltrosHistorial) {
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

  const mostrarEmpty = historial.length === 0 && !historialError;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-[#10B981]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Valida</h1>
          <p className="text-sm text-[#6B7280]">
            Consulta puntual o masiva contra listas vinculantes SARLAFT (ONU, OFAC, UE, PEP, CSN).
          </p>
        </div>
        <TutorialButton onClick={dispararTutorial} />
      </div>

      {mostrarEmpty && (
        <TutorialEmptyState
          onStartDemo={dispararTutorial}
          onTryConsulta={() => setTab('puntual')}
        />
      )}

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

      {tab === 'puntual' && <ConsultaPuntualForm onPersisted={() => refrescarHistorial()} />}
      {tab === 'masiva' && <ConsultaMasivaForm onPersisted={() => refrescarHistorial()} />}
      {tab === 'historial' && (
        <Historial
          consultas={historial}
          error={historialError}
          onFiltrar={refrescarHistorial}
        />
      )}

      {/* Tutorial: auto-arranca si nunca lo vio, o forzado via boton "?" */}
      {(tutorialNuncaVisto || tourTrigger > 0) && (
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
        active ? 'border-[#1A1A1A] text-[#1A1A1A]' : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Consulta puntual ─────────────────────────────────────────────────────

function ConsultaPuntualForm({ onPersisted }: { onPersisted: () => void }) {
  const [tipo, setTipo] = useState<TipoPersona>('natural');
  const [nombre, setNombre] = useState('');
  const [docTipo, setDocTipo] = useState<TipoDocumento>('CC');
  const [docNumero, setDocNumero] = useState('');
  const [negocio, setNegocio] = useState<NegocioBusqueda | null>(null);
  const [resultado, setResultado] = useState<ValidaResultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultado(null);

    startTransition(async () => {
      const input: Parameters<typeof consultarValida>[0] = { tipo, nombre: nombre.trim() };
      if (docNumero.trim()) input.documento = { tipo: docTipo, numero: docNumero.trim() };
      const r = await consultarValida(input, { negocio_id: negocio?.id ?? null });
      if (r.ok) {
        setResultado(r.data);
        onPersisted();
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
                  ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                  : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:border-[#1A1A1A]'
              }`}
            >
              {t === 'natural' ? 'Persona natural' : 'Persona jurídica'}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
            {tipo === 'natural' ? 'Nombre completo' : 'Razón social'}
          </label>
          <input
            type="text"
            value={nombre}
            onChange={e => setNombre(e.target.value)}
            required
            minLength={2}
            placeholder={tipo === 'natural' ? 'Juan Pérez Gómez' : 'Acme Trading SAS'}
            className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
          />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              Tipo documento
            </label>
            <select
              value={docTipo}
              onChange={e => setDocTipo(e.target.value as TipoDocumento)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white"
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
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              Número <span className="font-light lowercase tracking-normal">(opcional)</span>
            </label>
            <input
              type="text"
              value={docNumero}
              onChange={e => setDocNumero(e.target.value)}
              placeholder="1077089147"
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
        </div>

        <div data-tutorial-target="negocio-picker">
          <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
            Asociar a negocio <span className="font-light lowercase tracking-normal">(opcional)</span>
          </label>
          <NegocioPicker value={negocio} onChange={setNegocio} />
          <p className="text-xs text-[#6B7280] mt-1.5">
            Útil para agrupar consultas por CDA. Incluye negocios cerrados.
          </p>
        </div>

        <button
          type="submit"
          disabled={pending || nombre.trim().length < 2}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando…' : 'Consultar'}
        </button>

        {error && <ErrorBox msg={error} />}
      </form>

      {resultado && (
        <div data-tutorial-target="resultado-zona">
          <ResultadoCard data={resultado} nombreConsultado={nombre} />
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
        className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] bg-white text-left text-sm flex items-center justify-between hover:border-[#1A1A1A] transition-colors"
      >
        {value ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs text-[#6B7280] shrink-0">{value.codigo}</span>
            <span className="truncate text-[#1A1A1A]">{value.nombre}</span>
            {value.estado === 'completado' && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F5F4F2] text-[#6B7280] shrink-0">
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
              className="p-1 rounded hover:bg-[#F5F4F2]"
            >
              <X className="h-3.5 w-3.5 text-[#6B7280]" />
            </button>
          )}
          <ChevronDown className="h-4 w-4 text-[#6B7280]" />
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
              className="w-full h-9 px-3 text-sm rounded-md border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="p-3 text-sm text-[#6B7280] text-center">Buscando…</div>
            ) : items.length === 0 ? (
              <div className="p-3 text-sm text-[#6B7280] text-center">Sin resultados</div>
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
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5F4F2] flex items-center gap-2"
                >
                  <span className="font-mono text-xs text-[#6B7280] shrink-0 w-20">{n.codigo}</span>
                  <span className="truncate text-[#1A1A1A] flex-1">{n.nombre}</span>
                  {n.estado === 'completado' && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F5F4F2] text-[#6B7280] shrink-0">
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

function ResultadoCard({ data, nombreConsultado }: { data: ValidaResultado; nombreConsultado: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Resultado</p>
          <h3 className="text-lg font-bold text-[#1A1A1A] mt-1">{nombreConsultado}</h3>
          <p className="text-xs text-[#6B7280] font-mono">ID: {data.consulta_id}</p>
        </div>
        <span
          className={`${SEVERIDAD_CLASS[data.severidad]} text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider`}
        >
          {SEVERIDAD_LABEL[data.severidad]}
        </span>
      </div>

      <div className="p-5 space-y-2">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
          Coincidencias ({data.total_matches})
        </p>
        {data.matches.length === 0 ? (
          <p className="text-sm text-[#10B981] font-medium">Sin coincidencias.</p>
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
                  <p className="text-sm font-semibold text-[#1A1A1A] truncate">{m.nombre_coincidencia}</p>
                  <p className="text-xs text-[#6B7280] truncate">{m.lista_nombre}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{(m.score * 100).toFixed(1)}%</p>
                  <p className="text-[10px] text-[#6B7280] uppercase">{m.resultado}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── Carga masiva ─────────────────────────────────────────────────────────

function ConsultaMasivaForm({ onPersisted }: { onPersisted: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [negocioLote, setNegocioLote] = useState<NegocioBusqueda | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingTpl, startTplTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!archivo) {
      setError('Selecciona un archivo XLSX');
      return;
    }
    const fd = new FormData();
    fd.append('archivo', archivo);
    startTransition(async () => {
      const r = await consultarValidaMasivo(fd, { negocio_id_lote: negocioLote?.id ?? null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const blob = base64ToBlob(
        r.data.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      triggerDownload(blob, r.data.filename);
      setInfo(`${r.data.total} consultas procesadas. Resultado descargado.`);
      setArchivo(null);
      const input = document.getElementById('archivo-batch') as HTMLInputElement | null;
      if (input) input.value = '';
      onPersisted();
    });
  }

  function descargarPlantilla() {
    setError(null);
    setInfo(null);
    startTplTransition(async () => {
      const r = await descargarPlantillaValida();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      const blob = base64ToBlob(
        r.data.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      triggerDownload(blob, r.data.filename);
    });
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-[#1A1A1A]">Carga masiva (XLSX)</h3>
          <p className="text-sm text-[#6B7280] mt-1">
            Sube un XLSX con la plantilla. Hasta 500 filas. Descarga el resultado con severidad por fila.
          </p>
        </div>
        <button
          type="button"
          onClick={descargarPlantilla}
          disabled={pendingTpl}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] disabled:opacity-50 transition-colors"
        >
          <Download className="h-4 w-4" />
          {pendingTpl ? 'Descargando…' : 'Descargar plantilla'}
        </button>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
            Asociar todo el lote a un negocio <span className="font-light lowercase tracking-normal">(opcional)</span>
          </label>
          <NegocioPicker value={negocioLote} onChange={setNegocioLote} />
          <p className="text-xs text-[#6B7280] mt-1.5">
            Si la columna <code className="bg-[#F5F4F2] px-1 rounded">negocio_codigo</code> tiene valor en el XLSX, sobrescribe esta selección fila por fila.
          </p>
        </div>

        <label
          htmlFor="archivo-batch"
          className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-[#E5E7EB] hover:border-[#1A1A1A] rounded-lg p-8 cursor-pointer transition-colors"
        >
          <Upload className="h-8 w-8 text-[#6B7280]" />
          <div className="text-center">
            <p className="text-sm font-semibold text-[#1A1A1A]">
              {archivo ? archivo.name : 'Arrastra o selecciona un archivo XLSX'}
            </p>
            <p className="text-xs text-[#6B7280] mt-1">Solo .xlsx — hasta 5 MB / 500 filas</p>
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
          disabled={pending || !archivo}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Upload className="h-4 w-4" />
          {pending ? 'Procesando…' : 'Consultar archivo'}
        </button>

        {error && <ErrorBox msg={error} />}
        {info && (
          <div className="p-3 rounded-lg bg-[#10B981]/10 border border-[#10B981]/30 text-[#065F46] text-sm flex items-center gap-2">
            <Check className="h-4 w-4" /> {info}
          </div>
        )}
      </form>
    </div>
  );
}

// ─── Historial con filtros ────────────────────────────────────────────────

function Historial({
  consultas,
  error,
  onFiltrar,
}: {
  consultas: ConsultaHistorialItem[];
  error: string | null;
  onFiltrar: (filtros: FiltrosHistorial) => Promise<void>;
}) {
  const [negocio, setNegocio] = useState<NegocioBusqueda | null>(null);
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
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Filtros</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
              Negocio
            </label>
            <NegocioPicker value={negocio} onChange={setNegocio} />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
              Severidad
            </label>
            <select
              value={severidad}
              onChange={e => setSeveridad(e.target.value as Severidad | '')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
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
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
              Tipo
            </label>
            <select
              value={tipo}
              onChange={e => setTipo(e.target.value as 'puntual' | 'masiva_item' | '')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
            >
              <option value="">Todos</option>
              <option value="puntual">Puntual</option>
              <option value="masiva_item">Masiva</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
              Desde
            </label>
            <input
              type="date"
              value={fechaDesde}
              onChange={e => setFechaDesde(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
              Hasta
            </label>
            <input
              type="date"
              value={fechaHasta}
              onChange={e => setFechaHasta(e.target.value)}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={aplicarFiltros}
            disabled={pending}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#1A1A1A] text-white text-sm font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] transition-colors"
          >
            <Search className="h-4 w-4" />
            {pending ? 'Aplicando…' : 'Aplicar'}
          </button>
          <button
            type="button"
            onClick={limpiarFiltros}
            disabled={pending}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
          >
            Limpiar
          </button>
        </div>
      </div>

      <HistorialTable consultas={consultas} error={error} mostrarNegocio />
    </div>
  );
}

export function HistorialTable({
  consultas,
  error,
  mostrarNegocio,
}: {
  consultas: ConsultaHistorialItem[];
  error: string | null;
  mostrarNegocio?: boolean;
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
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-center text-sm text-[#6B7280]">
        Sin consultas con los filtros aplicados.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F5F4F2] border-b border-[#E5E7EB]">
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Fecha
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Nombre
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Documento
              </th>
              {mostrarNegocio && (
                <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                  Negocio
                </th>
              )}
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Tipo
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Matches
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Severidad
              </th>
            </tr>
          </thead>
          <tbody>
            {consultas.map(c => (
              <tr key={c.id} className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F5F4F2]/60">
                <td className="px-4 py-2.5 text-[#6B7280] whitespace-nowrap text-xs">
                  {new Date(c.created_at).toLocaleDateString('es-CO', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="px-4 py-2.5 font-medium text-[#1A1A1A]">{c.nombre_consultado ?? '—'}</td>
                <td className="px-4 py-2.5 text-[#6B7280] font-mono text-xs">
                  {c.documento_tipo && c.documento_numero
                    ? `${c.documento_tipo} ${c.documento_numero}`
                    : '—'}
                </td>
                {mostrarNegocio && (
                  <td className="px-4 py-2.5 text-xs">
                    {c.negocio_codigo ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono text-[#6B7280]">{c.negocio_codigo}</span>
                        <span className="text-[#1A1A1A] truncate max-w-[140px] inline-block align-bottom">
                          {c.negocio_nombre}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#9CA3AF]">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-2.5 text-center text-[10px] uppercase tracking-wider text-[#6B7280]">
                  {c.tipo === 'puntual' ? 'Puntual' : 'Masiva'}
                </td>
                <td className="px-4 py-2.5 text-center font-semibold">{c.total_matches}</td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`${SEVERIDAD_CLASS[c.severidad]} text-[10px] font-bold px-2 py-0.5 rounded uppercase`}
                  >
                    {SEVERIDAD_LABEL[c.severidad]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
      <ShieldAlert className="h-4 w-4" /> {msg}
    </div>
  );
}

