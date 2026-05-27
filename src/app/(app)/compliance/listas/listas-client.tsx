'use client';

import { Fragment, useEffect, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  History,
  ListChecks,
  Search,
  Upload,
  User,
  Users,
} from 'lucide-react';
import TutorialTour from '@/components/tutorial/TutorialTour';
import TutorialButton from '@/components/tutorial/TutorialButton';
import {
  consultaDualPersistente,
  descargarPlantillaBatch,
  listarHistorialDual,
  prepararLoteDual,
  type DualConsultaPersistida,
  type DualFilaPreparada,
  type DualHistorialFiltros,
  type DualHistorialItem,
  type DualSeveridad,
  type DualTipo,
  type InformaMatch,
} from '@/lib/actions/compliance-dual';

const SEVERIDAD_CLASS: Record<DualSeveridad, string> = {
  alto: 'bg-[#EF4444] text-white',
  sin_hallazgo: 'bg-[#10B981] text-white',
  error: 'bg-[#1A1A1A] text-white',
};

const SEVERIDAD_LABEL: Record<DualSeveridad, string> = {
  alto: 'Alto',
  sin_hallazgo: 'Sin hallazgo',
  error: 'Error',
};

type TabKey = 'puntual' | 'masiva' | 'historial';

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

type ListasClientProps = {
  tutorialNuncaVisto?: boolean;
};

export default function ListasClient({ tutorialNuncaVisto = false }: ListasClientProps) {
  const [tab, setTab] = useState<TabKey>('puntual');
  const [tourTrigger, setTourTrigger] = useState(0);

  function dispararTutorial() {
    setTourTrigger(t => t + 1);
    setTab('puntual');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-6 w-6 text-[#1A1A1A]" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-[#1A1A1A]">Consulta de Listas Restrictivas</h1>
          <p className="text-sm text-[#6B7280]">
            Consulta puntual o masiva contra listas vinculantes y de referencia.
          </p>
        </div>
        <TutorialButton onClick={dispararTutorial} />
      </div>

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
          Carga masiva (XLSX)
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

      {tab === 'puntual' && <ConsultaPuntualForm />}
      {tab === 'masiva' && <ConsultaMasivaForm />}
      {tab === 'historial' && <HistorialPanel />}

      {(tutorialNuncaVisto || tourTrigger > 0) && (
        <TutorialTour slug="compliance_listas_dual" forceStart={tourTrigger} />
      )}
    </div>
  );
}

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
        active
          ? 'border-[#1A1A1A] text-[#1A1A1A]'
          : 'border-transparent text-[#6B7280] hover:text-[#1A1A1A]'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Tab: Consulta puntual (formulario unificado) ──────────────────────────

function ConsultaPuntualForm() {
  const [tipo, setTipo] = useState<DualTipo>('natural');
  const [identificacion, setIdentificacion] = useState('');
  const [nombre, setNombre] = useState('');
  const [resultado, setResultado] = useState<DualConsultaPersistida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const idTrim = identificacion.trim();
  const nombreTrim = nombre.trim();
  const isEmpty = idTrim.length === 0 && nombreTrim.length === 0;

  const labelDocumento = tipo === 'juridica' ? 'NIT' : 'Cédula';
  const placeholderDocumento = tipo === 'juridica' ? '900123456' : '1077089147';
  const labelNombre = tipo === 'juridica' ? 'Razón social' : 'Nombre completo';
  const placeholderNombre =
    tipo === 'juridica' ? 'Acme Trading SAS' : 'Juan Pérez Gómez';

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setValidation(null);
    setResultado(null);

    if (isEmpty) {
      setValidation('Debes llenar al menos uno de los dos campos.');
      return;
    }

    startTransition(async () => {
      const r = await consultaDualPersistente({
        tipo,
        ...(idTrim ? { identificacion: idTrim } : {}),
        ...(nombreTrim ? { nombre: nombreTrim } : {}),
      });
      if (r.ok) setResultado(r.data);
      else setError(r.error);
    });
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={onSubmit}
        data-tutorial-target="consulta-puntual-form"
        className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-4"
      >
        <SelectorTipoPersona
          tipo={tipo}
          onChange={(t) => {
            setTipo(t);
            setValidation(null);
          }}
        />

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              {labelDocumento}{' '}
              <span className="text-[#9CA3AF] normal-case font-medium">(opcional)</span>
            </label>
            <input
              type="text"
              value={identificacion}
              onChange={(e) => {
                setIdentificacion(e.target.value);
                if (validation) setValidation(null);
              }}
              placeholder={placeholderDocumento}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              {labelNombre}{' '}
              <span className="text-[#9CA3AF] normal-case font-medium">(opcional)</span>
            </label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value);
                if (validation) setValidation(null);
              }}
              placeholder={placeholderNombre}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
          </div>
        </div>

        <p className="text-xs text-[#6B7280]">
          Llena al menos uno de los dos. Mejor si llenas ambos: la coincidencia es más precisa.
        </p>

        <button
          type="submit"
          disabled={pending || isEmpty}
          className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
        >
          <Search className="h-4 w-4" />
          {pending ? 'Consultando…' : 'Consultar'}
        </button>

        {validation && <ErrorBox msg={validation} />}
        {error && <ErrorBox msg={error} />}
      </form>

      {resultado && (
        <div data-tutorial-target="resultado-zona">
          <ResultadoConsulta data={resultado} nombreConsultado={nombreTrim || idTrim} />
        </div>
      )}
    </div>
  );
}

// ─── Tab: Masiva (XLSX) ────────────────────────────────────────────────────

type EstadoCargue =
  | { fase: 'inicial' }
  | { fase: 'preparando' }
  | {
      fase: 'procesando';
      loteId: string;
      total: number;
      procesadas: number;
      severidades: Record<DualSeveridad, number>;
      tituloLote: string | null;
    }
  | {
      fase: 'completado';
      loteId: string;
      total: number;
      severidades: Record<DualSeveridad, number>;
      tituloLote: string | null;
    }
  | { fase: 'error'; mensaje: string };

function severidadesIniciales(): Record<DualSeveridad, number> {
  return { alto: 0, sin_hallazgo: 0, error: 0 };
}

function ConsultaMasivaForm() {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState('');
  const [estado, setEstado] = useState<EstadoCargue>({ fase: 'inicial' });
  const [pendingTpl, startTplTransition] = useTransition();

  function descargarPlantilla() {
    startTplTransition(async () => {
      const r = await descargarPlantillaBatch();
      if (!r.ok) {
        setEstado({ fase: 'error', mensaje: r.error });
        return;
      }
      const blob = base64ToBlob(
        r.data.base64,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      triggerDownload(blob, r.data.filename);
    });
  }

  async function iniciarCargue(e: React.FormEvent) {
    e.preventDefault();
    if (!archivo) {
      setEstado({ fase: 'error', mensaje: 'Selecciona un archivo XLSX' });
      return;
    }
    setEstado({ fase: 'preparando' });

    const fd = new FormData();
    fd.append('archivo', archivo);
    const prep = await prepararLoteDual(fd);

    if (!prep.ok) {
      setEstado({ fase: 'error', mensaje: prep.error });
      return;
    }

    const { lote_id, total, filas } = prep.data;
    const tituloLote = titulo.trim().length > 0 ? titulo.trim() : null;
    const severidades = severidadesIniciales();

    setEstado({ fase: 'procesando', loteId: lote_id, total, procesadas: 0, severidades, tituloLote });

    let procesadas = 0;
    for (const fila of filas) {
      const sev = await procesarFila(fila, lote_id, tituloLote);
      procesadas += 1;
      severidades[sev] = (severidades[sev] ?? 0) + 1;
      setEstado({
        fase: 'procesando',
        loteId: lote_id,
        total,
        procesadas,
        severidades: { ...severidades },
        tituloLote,
      });
    }

    setEstado({ fase: 'completado', loteId: lote_id, total, severidades, tituloLote });
  }

  async function procesarFila(
    fila: DualFilaPreparada,
    loteId: string,
    tituloLote: string | null,
  ): Promise<DualSeveridad> {
    if (fila.error) {
      await consultaDualPersistente(fila.input, {
        lote_id: loteId,
        titulo_lote: tituloLote,
        tipo: 'masiva_item',
      });
      return 'error';
    }
    const r = await consultaDualPersistente(fila.input, {
      lote_id: loteId,
      titulo_lote: tituloLote,
      tipo: 'masiva_item',
    });
    return r.ok ? r.data.severidad : 'error';
  }

  function reiniciar() {
    setArchivo(null);
    setTitulo('');
    setEstado({ fase: 'inicial' });
    const input = document.getElementById('archivo-batch') as HTMLInputElement | null;
    if (input) input.value = '';
  }

  const procesando = estado.fase === 'preparando' || estado.fase === 'procesando';

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-bold text-[#1A1A1A]">Carga masiva (XLSX)</h3>
          <p className="text-sm text-[#6B7280] mt-1">
            Sube un XLSX con la plantilla. Hasta 500 filas. Cada fila se procesa y queda
            registrada en el historial.
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

      {estado.fase === 'completado' ? (
        <ResumenCargueCompletado estado={estado} onReiniciar={reiniciar} />
      ) : procesando ? (
        <ProgresoCargue estado={estado} />
      ) : (
        <form onSubmit={iniciarCargue} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-[#6B7280] font-semibold mb-2">
              Título del cargue{' '}
              <span className="font-light lowercase tracking-normal">
                (opcional, queda en el historial)
              </span>
            </label>
            <input
              type="text"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Cargue contrapartes mayo 2026"
              maxLength={200}
              className="w-full h-11 px-4 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A]"
            />
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
            disabled={!archivo}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-lg bg-[#1A1A1A] text-white font-semibold hover:bg-[#374151] disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
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

function ProgresoCargue({ estado }: { estado: EstadoCargue }) {
  if (estado.fase === 'preparando') {
    return (
      <div className="py-10 text-center space-y-3">
        <Dona total={1} procesadas={0} pulsante />
        <p className="text-sm font-semibold text-[#1A1A1A]">Preparando cargue…</p>
        <p className="text-xs text-[#6B7280]">Leyendo el archivo y validando filas.</p>
      </div>
    );
  }
  if (estado.fase !== 'procesando') return null;

  const pct = estado.total === 0 ? 0 : Math.round((estado.procesadas / estado.total) * 100);

  return (
    <div className="py-6 space-y-5">
      <div className="flex items-center justify-center">
        <Dona total={estado.total} procesadas={estado.procesadas} />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-[#6B7280]">
          <span className="font-semibold">
            {estado.procesadas} / {estado.total} consultas
          </span>
          <span className="font-mono">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-[#E5E7EB] overflow-hidden">
          <div
            className="h-full bg-[#10B981] transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <DistribucionSeveridadDual sev={estado.severidades} />
      <p className="text-[11px] text-center text-[#6B7280]">
        No cierres esta pestaña hasta que el cargue termine. Las consultas se guardan en el
        historial conforme avanzan.
      </p>
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
        <circle cx="64" cy="64" r={radio} fill="none" stroke="#E5E7EB" strokeWidth={stroke} />
        <circle
          cx="64"
          cy="64"
          r={radio}
          fill="none"
          stroke="#10B981"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-[#1A1A1A] leading-none">{pctTexto}%</span>
        <span className="text-[10px] uppercase tracking-wider text-[#6B7280] mt-0.5 font-semibold">
          procesado
        </span>
      </div>
    </div>
  );
}

function DistribucionSeveridadDual({ sev }: { sev: Record<DualSeveridad, number> }) {
  const items: DualSeveridad[] = ['alto', 'sin_hallazgo', 'error'];
  const visibles = items.filter(s => (sev[s] ?? 0) > 0);
  if (visibles.length === 0) {
    return (
      <p className="text-[11px] text-center text-[#6B7280]">
        Aún sin resultados — los primeros aparecen pronto.
      </p>
    );
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

function ResumenCargueCompletado({
  estado,
  onReiniciar,
}: {
  estado: Extract<EstadoCargue, { fase: 'completado' }>;
  onReiniciar: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-[#ECFDF5] border border-[#10B981]/30 p-5">
        <div className="flex items-center gap-2 text-[#059669] font-semibold">
          <Check className="h-5 w-5" />
          Cargue completado
        </div>
        <p className="text-sm text-[#1A1A1A] mt-1">
          {estado.total} consultas procesadas{estado.tituloLote ? ` · ${estado.tituloLote}` : ''}.
          Las puedes revisar en el tab Historial.
        </p>
        <div className="mt-3">
          <DistribucionSeveridadDual sev={estado.severidades} />
        </div>
      </div>

      <button
        type="button"
        onClick={onReiniciar}
        className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
      >
        Nuevo cargue
      </button>
    </div>
  );
}

// ─── Componentes compartidos ───────────────────────────────────────────────

function SelectorTipoPersona({
  tipo,
  onChange,
}: {
  tipo: DualTipo;
  onChange: (t: DualTipo) => void;
}) {
  return (
    <div className="flex gap-2">
      {(
        [
          { v: 'natural', label: 'Persona natural', icon: <User className="h-4 w-4" /> },
          { v: 'juridica', label: 'Persona jurídica', icon: <Users className="h-4 w-4" /> },
        ] as const
      ).map(o => {
        const active = tipo === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              active
                ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]'
                : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:border-[#1A1A1A]'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function ResultadoConsulta({
  data,
  nombreConsultado,
}: {
  data: DualConsultaPersistida;
  nombreConsultado: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Resultado</p>
          <h3 className="text-lg font-bold text-[#1A1A1A] mt-1 truncate">
            {nombreConsultado || '—'}
          </h3>
          <p className="text-xs text-[#6B7280] font-mono">ID: {data.consulta_local_id}</p>
        </div>
        <span
          className={`${SEVERIDAD_CLASS[data.severidad]} text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider`}
        >
          {SEVERIDAD_LABEL[data.severidad]}
        </span>
      </div>

      <div className="p-5 space-y-3">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">
          Coincidencias ({data.total_matches})
        </p>
        {data.matches.length === 0 ? (
          <p className="text-sm text-[#10B981] font-medium flex items-center gap-1.5">
            <Check className="h-4 w-4" />
            La consulta no arrojó coincidencias en las listas restrictivas evaluadas.
          </p>
        ) : (
          <ListaCoincidencias matches={data.matches} />
        )}
      </div>
    </div>
  );
}

function ListaCoincidencias({ matches }: { matches: InformaMatch[] }) {
  return (
    <ul className="divide-y divide-[#E5E7EB]">
      {matches.slice(0, 20).map((m, i) => (
        <li key={i} className="py-3 flex flex-col sm:flex-row sm:items-start sm:gap-4">
          <div className="sm:w-32 shrink-0">
            <p className="text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold">
              Lista
            </p>
            <p className="text-sm font-semibold text-[#1A1A1A] mt-0.5 break-words">{m.lista}</p>
          </div>
          <div className="flex-1 min-w-0 mt-2 sm:mt-0">
            <p className="text-sm font-medium text-[#1A1A1A]">{m.nombre}</p>
            {m.documento && (
              <p className="text-xs text-[#6B7280] font-mono mt-0.5">{m.documento}</p>
            )}
            {m.fundamento && (
              <p className="text-xs text-[#6B7280] mt-1.5 leading-relaxed">{m.fundamento}</p>
            )}
          </div>
        </li>
      ))}
      {matches.length > 20 && (
        <li className="py-3 text-xs text-[#6B7280] text-center italic">
          Mostrando 20 de {matches.length} coincidencias.
        </li>
      )}
    </ul>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="p-3 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#B91C1C] text-sm flex items-center gap-2">
      <AlertTriangle className="h-4 w-4" /> {msg}
    </div>
  );
}

// ─── Tab: Historial ────────────────────────────────────────────────────────

function HistorialPanel() {
  const [consultas, setConsultas] = useState<DualHistorialItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, startTransition] = useTransition();
  const [severidad, setSeveridad] = useState<DualSeveridad | ''>('');
  const [tipo, setTipo] = useState<'puntual' | 'masiva_item' | ''>('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  async function cargar(filtros: DualHistorialFiltros = {}) {
    const r = await listarHistorialDual(filtros);
    if (r.ok) {
      setConsultas(r.data);
      setError(null);
    } else {
      setError(r.error);
    }
    setLoading(false);
  }

  useEffect(() => {
    startTransition(() => {
      cargar();
    });
  }, []);

  function aplicarFiltros() {
    startTransition(async () => {
      await cargar({
        severidad: severidad || undefined,
        tipo: tipo || undefined,
        fecha_desde: fechaDesde || undefined,
        fecha_hasta: fechaHasta || undefined,
      });
    });
  }

  function limpiarFiltros() {
    setSeveridad('');
    setTipo('');
    setFechaDesde('');
    setFechaHasta('');
    startTransition(() => cargar({}));
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-5 space-y-4">
        <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Filtros</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[#6B7280] font-semibold mb-1.5">
              Severidad
            </label>
            <select
              value={severidad}
              onChange={e => setSeveridad(e.target.value as DualSeveridad | '')}
              className="w-full h-11 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#1A1A1A] bg-white text-sm"
            >
              <option value="">Todas</option>
              <option value="alto">Alto</option>
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
              <option value="masiva_item">Cargue</option>
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

      {loading ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-center text-sm text-[#6B7280]">
          Cargando historial…
        </div>
      ) : error ? (
        <ErrorBox msg={`Error cargando historial: ${error}`} />
      ) : consultas.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E5E7EB] p-8 text-center text-sm text-[#6B7280]">
          Sin consultas con los filtros aplicados.
        </div>
      ) : (
        <HistorialTablaDual consultas={consultas} />
      )}
    </div>
  );
}

function HistorialTablaDual({ consultas }: { consultas: DualHistorialItem[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#F5F4F2] border-b border-[#E5E7EB]">
              <th className="w-8" />
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Fecha
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Nombre
              </th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Documento
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Tipo
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Coincidencias
              </th>
              <th className="text-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                Severidad
              </th>
            </tr>
          </thead>
          <tbody>
            {consultas.map(c => {
              const isOpen = expanded.has(c.id);
              const canExpand = c.total_matches > 0 || c.error_mensaje;
              return (
                <Fragment key={c.id}>
                  <tr
                    className={`border-b border-[#E5E7EB] last:border-0 ${canExpand ? 'hover:bg-[#F5F4F2]/60 cursor-pointer' : ''}`}
                    onClick={() => canExpand && toggle(c.id)}
                  >
                    <td className="px-2 py-2.5 text-[#6B7280] text-center">
                      {canExpand ? (
                        isOpen ? (
                          <ChevronDown className="h-4 w-4 inline" />
                        ) : (
                          <ChevronRight className="h-4 w-4 inline" />
                        )
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-[#6B7280] whitespace-nowrap text-xs">
                      {new Date(c.created_at).toLocaleDateString('es-CO', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-[#1A1A1A]">
                      {c.nombre_consultado ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-[#6B7280] font-mono text-xs">
                      {c.documento_tipo && c.documento_numero
                        ? `${c.documento_tipo} ${c.documento_numero}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-center text-[10px] uppercase tracking-wider text-[#6B7280]">
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
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-[#E5E7EB] bg-[#F5F4F2]/40">
                      <td />
                      <td colSpan={6} className="px-4 py-4">
                        {c.error_mensaje && (
                          <div className="mb-3 text-xs text-[#B91C1C]">
                            Error: {c.error_mensaje}
                          </div>
                        )}
                        {c.matches.length > 0 && <ListaCoincidencias matches={c.matches} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
