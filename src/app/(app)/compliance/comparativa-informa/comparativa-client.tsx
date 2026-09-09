'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  ListChecks,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  listarConsultasDuales,
  obtenerConsultaDual,
  obtenerMetricsDuales,
  registrarVeredicto,
  type DualClasificacion,
  type DualDecision,
  type DualDetail,
  type DualListItem,
  type DualListResponse,
  type DualMetrics,
} from '@/lib/actions/compliance-dual';
import { formatFecha } from '@/lib/dates/bogota'

type TabKey = 'cronologico' | 'dashboard';

// Los siete valores del enum en la base de Valida. `auditable` marca los que un
// humano tiene que mirar: `zero_zero` es volumen y `error_*` es una llamada que
// nunca llego a comparar nada.
const CLASIFICACIONES: Array<{
  value: DualClasificacion;
  label: string;
  color: string;
  auditable: boolean;
}> = [
  { value: 'zero_zero', label: 'Sin matches', color: 'bg-acento/10 text-[var(--acento)] border-acento/30', auditable: false },
  { value: 'ambos_misma_entidad', label: 'Ambos — misma entidad', color: 'bg-tinta text-white border-tinta', auditable: true },
  { value: 'ambos_distinta_entidad', label: 'Ambos — distinta entidad', color: 'bg-[#8B5CF6]/10 text-[#5B21B6] border-[#8B5CF6]/30', auditable: true },
  { value: 'solo_informa', label: 'Solo Informa', color: 'bg-advertencia/10 text-[#92400E] border-advertencia/30', auditable: true },
  { value: 'solo_valida', label: 'Solo Valida', color: 'bg-[#3B82F6]/10 text-[#1E40AF] border-[#3B82F6]/30', auditable: true },
  { value: 'error_informa', label: 'Error Informa', color: 'bg-alerta/10 text-[#B91C1C] border-alerta/30', auditable: false },
  { value: 'error_valida', label: 'Error Valida', color: 'bg-alerta/10 text-[#B91C1C] border-alerta/30', auditable: false },
];

const AUDITABLES = CLASIFICACIONES.filter(c => c.auditable).map(c => c.value);

const DECISIONES: Array<{ value: DualDecision; label: string; descripcion: string }> = [
  { value: 'valida_correcto', label: 'Valida correcto', descripcion: 'Coincide con Informa o ambos sin matches válidos' },
  { value: 'valida_falso_negativo', label: 'Valida falso negativo', descripcion: 'Informa marcó, Valida no — y debió marcar' },
  { value: 'valida_falso_positivo', label: 'Valida falso positivo', descripcion: 'Valida marcó, pero la persona no es la misma' },
  { value: 'informa_falso_negativo', label: 'Informa falso negativo', descripcion: 'Valida marcó correctamente, Informa no detectó' },
  { value: 'informa_falso_positivo', label: 'Informa falso positivo', descripcion: 'Informa marcó pero la persona no era' },
  { value: 'inconcluso', label: 'Inconcluso', descripcion: 'Sin información suficiente para decidir' },
];

export default function ComparativaClient() {
  const [tab, setTab] = useState<TabKey>('cronologico');

  return (
    <div className="space-y-6">
      <div className="flex gap-1 border-b border-[#E5E7EB]">
        <TabButton active={tab === 'cronologico'} onClick={() => setTab('cronologico')} icon={<ListChecks className="h-4 w-4" />}>
          Cronológico
        </TabButton>
        <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={<BarChart3 className="h-4 w-4" />}>
          Dashboard
        </TabButton>
      </div>

      {tab === 'cronologico' && <CronologicoTab />}
      {tab === 'dashboard' && <DashboardTab />}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? 'border-acento text-tinta'
          : 'border-transparent text-tinta-suave hover:text-tinta'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

// ─── Tab Cronologico ──────────────────────────────────────────────────────

function CronologicoTab() {
  const [data, setData] = useState<DualListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [clasificacionFilter, setClasificacionFilter] = useState<DualClasificacion[]>([]);
  const [workspaceFilter, setWorkspaceFilter] = useState('');
  const [auditadaFilter, setAuditadaFilter] = useState<'all' | 'true' | 'false'>('all');
  // Por defecto la bitacora esconde el stub. Una comparacion contra datos
  // sembrados no dice nada sobre Valida, y mezclada con las reales solo engorda
  // el conteo.
  const [stubFilter, setStubFilter] = useState<'all' | 'true' | 'false'>('false');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function cargar(p = page) {
    setError(null);
    startTransition(async () => {
      const r = await listarConsultasDuales({
        page: p,
        pageSize,
        clasificacion: clasificacionFilter.length > 0 ? clasificacionFilter : undefined,
        workspace: workspaceFilter.trim() || undefined,
        desde: desde || undefined,
        hasta: hasta || undefined,
        auditada: auditadaFilter,
        stub: stubFilter,
      });
      if (r.ok) setData(r.data);
      else setError(r.error);
    });
  }

  useEffect(() => {
    cargar(1);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clasificacionFilter, workspaceFilter, auditadaFilter, stubFilter, desde, hasta]);

  function toggleClasificacion(v: DualClasificacion) {
    setClasificacionFilter(prev => (prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]));
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg border border-[#E5E7EB] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-tinta-suave" />
          <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
            Filtros
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setClasificacionFilter(prev =>
                AUDITABLES.every(v => prev.includes(v)) && prev.length === AUDITABLES.length
                  ? []
                  : [...AUDITABLES]
              )
            }
            className="px-3 py-1.5 rounded-full text-xs font-bold border border-acento text-[var(--acento)] bg-acento/10 hover:bg-acento/20 transition-colors"
          >
            Solo auditables
          </button>
          <span className="h-4 w-px bg-[#E5E7EB]" />
          {CLASIFICACIONES.map(c => {
            const active = clasificacionFilter.includes(c.value);
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => toggleClasificacion(c.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  active
                    ? c.color
                    : 'bg-white text-tinta-suave border-[#E5E7EB] hover:border-acento'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
              Workspace
            </label>
            <input
              type="text"
              value={workspaceFilter}
              onChange={e => setWorkspaceFilter(e.target.value)}
              placeholder="ej: alma-afi"
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
              Desde
            </label>
            <input
              type="date"
              value={desde}
              onChange={e => setDesde(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
              Hasta
            </label>
            <input
              type="date"
              value={hasta}
              onChange={e => setHasta(e.target.value)}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
              Auditada
            </label>
            <select
              value={auditadaFilter}
              onChange={e => setAuditadaFilter(e.target.value as 'all' | 'true' | 'false')}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm bg-white"
            >
              <option value="all">Todas</option>
              <option value="true">Auditadas</option>
              <option value="false">Pendientes</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
              Informa
            </label>
            <select
              value={stubFilter}
              onChange={e => setStubFilter(e.target.value as 'all' | 'true' | 'false')}
              className="w-full h-9 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm bg-white"
            >
              <option value="false">Solo reales</option>
              <option value="true">Solo stub</option>
              <option value="all">Reales y stub</option>
            </select>
          </div>
        </div>

        {stubFilter !== 'false' && (
          <p className="text-xs text-[#92400E] bg-advertencia/10 border border-advertencia/30 rounded-lg px-3 py-2">
            Estas viendo consultas con Informa en modo stub: la respuesta es sembrada, la
            comparacion no mide a Valida.
          </p>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB] flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
            {data
              ? `${data.total} consultas · mostrando ${data.items.length}`
              : 'Cargando…'}
          </p>
          <button
            type="button"
            onClick={() => cargar(page)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-semibold text-tinta hover:bg-papel disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-papel border-b border-[#E5E7EB]">
                <Th>Fecha</Th>
                <Th>Workspace</Th>
                <Th>Modo</Th>
                <Th>Identificación / Nombre</Th>
                <Th align="center">Informa</Th>
                <Th align="center">Valida</Th>
                <Th>Clasificación</Th>
                <Th align="center">Auditada</Th>
                <Th>Decisión</Th>
                <Th align="center">Informa</Th>
              </tr>
            </thead>
            <tbody>
              {!data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-sm text-tinta-suave">
                    {pending ? 'Cargando…' : 'Sin consultas con los filtros actuales.'}
                  </td>
                </tr>
              ) : (
                data.items.map(item => (
                  <ConsultaRow key={item.dual_id} item={item} onSelect={() => setSelectedId(item.dual_id)} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {data && data.total > data.page_size && (
          <div className="p-3 border-t border-[#E5E7EB] flex items-center justify-between gap-2">
            <p className="text-xs text-tinta-suave">
              Página {data.page} de {totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || pending}
                onClick={() => {
                  const np = page - 1;
                  setPage(np);
                  cargar(np);
                }}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#E5E7EB] hover:bg-papel disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages || pending}
                onClick={() => {
                  const np = page + 1;
                  setPage(np);
                  cargar(np);
                }}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-[#E5E7EB] hover:bg-papel disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedId && (
        <DetalleModal
          dualId={selectedId}
          onClose={() => setSelectedId(null)}
          onAudited={() => {
            setSelectedId(null);
            cargar(page);
          }}
        />
      )}
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'center' | 'right' }) {
  return (
    <th
      className={`text-${align} px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-tinta-suave whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function ConsultaRow({
  item,
  onSelect,
}: {
  item: DualListItem;
  onSelect: () => void;
}) {
  const clasifConfig = CLASIFICACIONES.find(c => c.value === item.clasificacion);
  const decisionLabel = item.decision
    ? DECISIONES.find(d => d.value === item.decision)?.label ?? item.decision
    : null;

  return (
    <tr
      onClick={onSelect}
      className="border-b border-[#E5E7EB] last:border-0 hover:bg-papel/60 cursor-pointer"
    >
      <td className="px-4 py-2.5 text-tinta-suave whitespace-nowrap text-xs">
        {formatFecha(item.fecha, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </td>
      <td className="px-4 py-2.5 text-tinta font-medium text-xs">{item.workspace_origen}</td>
      <td className="px-4 py-2.5 text-tinta-suave text-xs">{item.modo}</td>
      <td className="px-4 py-2.5 text-tinta text-sm max-w-[220px] truncate">
        {item.identificacion || item.nombre || '—'}
      </td>
      <td className="px-4 py-2.5 text-center font-semibold">{item.count_informa}</td>
      <td className="px-4 py-2.5 text-center font-semibold">{item.count_valida}</td>
      <td className="px-4 py-2.5">
        {clasifConfig && (
          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${clasifConfig.color}`}>
            {clasifConfig.label}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-center">
        {item.auditada ? (
          <Check className="inline h-4 w-4 text-acento" />
        ) : (
          <Clock className="inline h-4 w-4 text-tinta-suave" />
        )}
      </td>
      <td className="px-4 py-2.5 text-tinta-suave text-xs max-w-[180px] truncate">
        {decisionLabel ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-center">
        {item.stub_mode ? (
          <span
            className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase border bg-advertencia/10 text-[#92400E] border-advertencia/30"
            title="Informa respondio con datos sembrados: esta comparacion no mide a Valida."
          >
            Stub
          </span>
        ) : (
          <span className="text-[10px] text-tinta-suave">real</span>
        )}
      </td>
    </tr>
  );
}

// ─── Detalle modal ────────────────────────────────────────────────────────

function DetalleModal({
  dualId,
  onClose,
  onAudited,
}: {
  dualId: string;
  onClose: () => void;
  onAudited: () => void;
}) {
  const [detail, setDetail] = useState<DualDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(async () => {
      const r = await obtenerConsultaDual(dualId);
      if (r.ok) setDetail(r.data);
      else setError(r.error);
    });
  }, [dualId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-lg border border-[#E5E7EB] max-w-5xl w-full my-8 shadow-xl">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
              Detalle de consulta dual
            </p>
            <h2 className="text-lg font-bold text-tinta mt-0.5 font-mono">{dualId}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-papel text-tinta-suave"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {pending && !detail && (
          <div className="p-12 text-center text-sm text-tinta-suave">Cargando…</div>
        )}

        {error && (
          <div className="m-5 p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        {detail && <DetalleContent detail={detail} onAudited={onAudited} />}
      </div>
    </div>
  );
}

function DetalleContent({
  detail,
  onAudited,
}: {
  detail: DualDetail;
  onAudited: () => void;
}) {
  const informaCount = detail.informa.matches.length;
  const validaCount = detail.valida.matches.length;
  const divergencia = (informaCount > 0) !== (validaCount > 0);

  return (
    <div className="p-5 space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat label="Workspace" value={detail.workspace_origen} />
        <Stat label="Modo" value={detail.modo} />
        <Stat label="Tipo" value={detail.tipo} />
        <Stat
          label="Clasificación"
          value={CLASIFICACIONES.find(c => c.value === detail.clasificacion)?.label ?? detail.clasificacion}
        />
        <Stat label="Auditada" value={detail.auditada ? 'Sí' : 'No'} />
      </div>

      <div>
        <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-1">
          Consultado
        </p>
        <p className="text-base font-bold text-tinta">
          {detail.identificacion || detail.nombre || '—'}
        </p>
        <p className="text-xs text-tinta-suave mt-0.5">
          {formatFecha(detail.fecha, { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>

      {detail.stub_mode && (
        <div className="p-3 rounded-lg bg-advertencia/10 border border-advertencia/30 text-[#92400E] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Informa en modo stub:</strong> la respuesta de la izquierda es sembrada.
            Un veredicto sobre esta fila no dice nada sobre Valida.
          </span>
        </div>
      )}

      {divergencia && (
        <div className="p-3 rounded-lg bg-advertencia/10 border border-advertencia/30 text-[#92400E] text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Divergencia detectada:</strong> Informa retornó {informaCount} matches y Valida {validaCount}.
            Revisa cuidadosamente antes de registrar veredicto.
          </span>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <PanelMatches
          titulo="Informa"
          subtitulo="Competencia (300+ listas)"
          color="var(--tinta)"
          count={informaCount}
        >
          {detail.informa.matches.length === 0 ? (
            <EmptyMatches />
          ) : (
            <ul className="space-y-2">
              {detail.informa.matches.map((m, i) => (
                <li key={i} className="p-3 rounded-md bg-papel border border-[#E5E7EB]">
                  <p className="text-xs text-tinta-suave font-semibold uppercase">{m.lista}</p>
                  <p className="text-sm text-tinta font-medium mt-0.5">{m.nombre}</p>
                  <p className="text-xs text-tinta-suave font-mono mt-0.5">{m.documento ?? '—'}</p>
                  {m.fundamento && (
                    <p className="text-xs text-tinta-suave mt-1 leading-relaxed">{m.fundamento}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PanelMatches>

        <PanelMatches
          titulo="Valida"
          subtitulo="Motor MéTRIK"
          color="var(--acento)"
          count={validaCount}
        >
          {detail.valida.matches.length === 0 ? (
            <EmptyMatches />
          ) : (
            <ul className="space-y-2">
              {detail.valida.matches.map((m, i) => (
                <li key={i} className="p-3 rounded-md bg-acento/5 border border-acento/20">
                  <p className="text-xs text-[var(--acento)] font-semibold uppercase">{m.lista_slug}</p>
                  <p className="text-sm text-tinta font-medium mt-0.5">{m.nombre_principal}</p>
                  <p className="text-xs text-[var(--acento)] mt-0.5 font-bold">
                    Score: {(m.score_final * 100).toFixed(1)}%
                  </p>
                </li>
              ))}
            </ul>
          )}
        </PanelMatches>
      </div>

      <AuditForm detail={detail} onAudited={onAudited} />
    </div>
  );
}

function PanelMatches({
  titulo,
  subtitulo,
  color,
  count,
  children,
}: {
  titulo: string;
  subtitulo: string;
  color: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
      <div className="p-3 border-b border-[#E5E7EB] flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold" style={{ color }}>{titulo}</p>
          <p className="text-[10px] text-tinta-suave uppercase tracking-wider">{subtitulo}</p>
        </div>
        <span
          className="inline-flex items-center justify-center h-7 min-w-[28px] px-2 rounded-full text-xs font-bold text-white"
          style={{ backgroundColor: color }}
        >
          {count}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyMatches() {
  return (
    <div className="py-6 text-center">
      <Check className="inline-block h-5 w-5 text-acento mb-1" />
      <p className="text-xs text-tinta-suave">Sin coincidencias</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="p-3 rounded-lg bg-papel border border-[#E5E7EB]">
      <p className="text-[10px] uppercase tracking-wider text-tinta-suave font-semibold">{label}</p>
      <p className="text-sm font-bold text-tinta mt-0.5">{value ?? '—'}</p>
    </div>
  );
}

// ─── Audit Form ───────────────────────────────────────────────────────────

function AuditForm({
  detail,
  onAudited,
}: {
  detail: DualDetail;
  onAudited: () => void;
}) {
  const [decision, setDecision] = useState<DualDecision | ''>(detail.decision ?? '');
  const [notas, setNotas] = useState(detail.notas ?? '');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!decision) {
      setError('Selecciona una decisión');
      return;
    }
    setError(null);
    setInfo(null);
    startTransition(async () => {
      const r = await registrarVeredicto({
        dualId: detail.dual_id,
        decision,
        notas: notas.trim() || undefined,
      });
      if (r.ok) {
        setInfo('Veredicto registrado.');
        setTimeout(() => onAudited(), 600);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="bg-papel rounded-lg border border-[#E5E7EB] p-4 space-y-3">
      <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
        Registrar veredicto auditor
      </p>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
          Decisión
        </label>
        <select
          value={decision}
          onChange={e => setDecision(e.target.value as DualDecision | '')}
          className="w-full h-10 px-3 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm bg-white"
        >
          <option value="">— Selecciona —</option>
          {DECISIONES.map(d => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        {decision && (
          <p className="text-[11px] text-tinta-suave mt-1">
            {DECISIONES.find(d => d.value === decision)?.descripcion}
          </p>
        )}
      </div>

      <div>
        <label className="block text-[10px] uppercase tracking-wider text-tinta-suave font-semibold mb-1">
          Notas (opcional)
        </label>
        <textarea
          value={notas}
          onChange={e => setNotas(e.target.value)}
          rows={3}
          className="w-full px-3 py-2 rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-acento text-sm bg-white"
          placeholder="Observaciones del auditor…"
        />
      </div>

      <button
        type="submit"
        disabled={pending || !decision}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-acento text-white text-sm font-semibold hover:bg-acento-hover disabled:bg-[#9CA3AF] disabled:cursor-not-allowed transition-colors"
      >
        <Check className="h-4 w-4" />
        {pending ? 'Guardando…' : 'Registrar veredicto'}
      </button>

      {error && (
        <div className="p-2.5 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-xs flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}
      {info && (
        <div className="p-2.5 rounded-lg bg-acento/10 border border-acento/30 text-[var(--acento)] text-xs flex items-center gap-2">
          <Check className="h-3.5 w-3.5" /> {info}
        </div>
      )}
    </form>
  );
}

// ─── Tab Dashboard ────────────────────────────────────────────────────────

function DashboardTab() {
  const [metrics, setMetrics] = useState<DualMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [incluirStub, setIncluirStub] = useState(false);
  const [pending, startTransition] = useTransition();

  function cargar(stub = incluirStub) {
    setError(null);
    startTransition(async () => {
      const r = await obtenerMetricsDuales(stub);
      if (r.ok) setMetrics(r.data);
      else setError(r.error);
    });
  }

  useEffect(() => {
    cargar(incluirStub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incluirStub]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-tinta-suave">
          Métricas agregadas — alimentan los umbrales de validación de Vera.
        </p>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-tinta-suave cursor-pointer">
            <input
              type="checkbox"
              checked={incluirStub}
              onChange={e => setIncluirStub(e.target.checked)}
              className="h-3.5 w-3.5 accent-advertencia"
            />
            Incluir consultas en stub
          </label>
        <button
          type="button"
          onClick={() => cargar()}
          disabled={pending}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-[#E5E7EB] text-xs font-semibold text-tinta hover:bg-papel disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {!metrics && !error && (
        <div className="p-12 text-center text-sm text-tinta-suave">Cargando métricas…</div>
      )}

      {metrics && <DashboardContent metrics={metrics} />}
    </div>
  );
}

function DashboardContent({ metrics }: { metrics: DualMetrics }) {
  const cumple = metrics.cumple_umbral_vera;
  const faltan = Math.max(0, 100 - metrics.positivos_auditados);
  const formatPct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(1)}%`);
  const veredictosArray = useMemo(
    () =>
      DECISIONES.map(d => ({
        decision: d,
        count: metrics.veredictos[d.value] ?? 0,
      })),
    [metrics.veredictos]
  );

  return (
    <div className="space-y-5">
      <div
        className={`p-4 rounded-lg border-2 flex items-center gap-3 ${
          cumple
            ? 'bg-acento/10 border-acento text-[var(--acento)]'
            : 'bg-alerta/10 border-alerta text-[#B91C1C]'
        }`}
      >
        {cumple ? (
          <Check className="h-6 w-6 shrink-0" />
        ) : (
          <AlertTriangle className="h-6 w-6 shrink-0" />
        )}
        <div>
          <p className="text-base font-bold">
            Valida confiable: {cumple ? 'SÍ' : 'NO'}
          </p>
          <p className="text-xs mt-0.5">
            Umbral Vera agregado: ≥100 positivos auditados, recall global ≥95% y precision ≥95%.
          </p>
          {!cumple && (
            <p className="text-xs mt-1 font-semibold">
              {faltan > 0
                ? `Faltan ${faltan} positivos auditados para poder siquiera medir: van ${metrics.positivos_auditados} de 100.`
                : 'Hay muestra suficiente, pero recall o precision estan por debajo del 95%.'}
            </p>
          )}
        </div>
      </div>

      {metrics.stub_excluidas > 0 && !metrics.incluye_stub && (
        <div className="p-3 rounded-lg bg-advertencia/10 border border-advertencia/30 text-[#92400E] text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>{metrics.stub_excluidas} consultas con Informa en stub quedaron fuera.</strong>{' '}
            Comparan contra respuestas sembradas: sumarlas inflaría el denominador con
            evidencia falsa. Todo lo de abajo se calculó sobre {metrics.total_consultas}{' '}
            consultas reales.
          </span>
        </div>
      )}

      {metrics.incluye_stub && (
        <div className="p-3 rounded-lg bg-alerta/10 border border-alerta/30 text-[#B91C1C] text-xs flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            <strong>Las consultas en stub están incluidas.</strong> Estos números sirven para
            revisar el tubo, no para decidir si Valida reemplaza a Informa.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total consultas" value={metrics.total_consultas.toString()} />
        <KpiCard label="% sin matches" value={`${(metrics.pct_zero_zero * 100).toFixed(1)}%`} />
        <KpiCard label="% divergencia" value={`${(metrics.pct_divergencia * 100).toFixed(1)}%`} />
        <KpiCard label="Pendientes auditoría" value={metrics.pendientes_auditoria.toString()} />
        <KpiCard label="Recall" value={formatPct(metrics.recall)} accent />
        <KpiCard label="Precision" value={formatPct(metrics.precision)} accent />
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB]">
          <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
            Veredictos por categoría
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-papel border-b border-[#E5E7EB]">
                <Th>Categoría</Th>
                <Th>Descripción</Th>
                <Th align="center">Total</Th>
              </tr>
            </thead>
            <tbody>
              {veredictosArray.map(v => (
                <tr key={v.decision.value} className="border-b border-[#E5E7EB] last:border-0">
                  <td className="px-4 py-2.5 text-tinta font-semibold text-sm">
                    {v.decision.label}
                  </td>
                  <td className="px-4 py-2.5 text-tinta-suave text-xs leading-relaxed">
                    {v.decision.descripcion}
                  </td>
                  <td className="px-4 py-2.5 text-center font-bold text-tinta">{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E5E7EB] overflow-hidden">
        <div className="p-3 border-b border-[#E5E7EB]">
          <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold">
            Por lista — umbral Vera ≥30 positivos auditados, recall ≥95% y precision ≥95%
          </p>
        </div>
        {metrics.por_lista.length === 0 ? (
          <p className="p-6 text-center text-sm text-tinta-suave">
            Sin datos por lista: no hay ningún veredicto registrado todavía. Esta tabla se
            llena a medida que el auditor decide en la pestaña Cronológico.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-papel border-b border-[#E5E7EB]">
                  <Th>Lista</Th>
                  <Th align="center">Nombrada por</Th>
                  <Th align="center">Positivos auditados</Th>
                  <Th align="center">Recall</Th>
                  <Th align="center">Precision</Th>
                  <Th align="center">Cumple</Th>
                </tr>
              </thead>
              <tbody>
                {metrics.por_lista.map(l => (
                  <tr key={l.lista} className="border-b border-[#E5E7EB] last:border-0">
                    <td className="px-4 py-2.5 text-tinta font-semibold text-sm">{l.lista}</td>
                    <td className="px-4 py-2.5 text-center text-tinta-suave text-xs">{l.origen}</td>
                    <td className="px-4 py-2.5 text-center text-tinta">{l.positivos_auditados}</td>
                    <td className="px-4 py-2.5 text-center text-tinta">{formatPct(l.recall)}</td>
                    <td className="px-4 py-2.5 text-center text-tinta">{formatPct(l.precision)}</td>
                    <td className="px-4 py-2.5 text-center">
                      {l.cumple_umbral ? (
                        <Check className="inline h-4 w-4 text-acento" />
                      ) : (
                        <X className="inline h-4 w-4 text-alerta" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-[#E5E7EB] bg-papel p-4">
        <p className="text-xs uppercase tracking-wider text-tinta-suave font-semibold mb-2">
          Cómo se calcula
        </p>
        <ul className="text-xs text-[#374151] space-y-1.5 leading-relaxed list-disc list-inside">
          <li>
            <strong>Recall</strong> = positivos verdaderos / (positivos verdaderos + falsos negativos
            de Valida).
          </li>
          <li>
            <strong>Precision</strong> = positivos verdaderos / (positivos verdaderos + falsos positivos
            de Valida).
          </li>
          <li>
            <strong>Umbral por lista:</strong> ≥30 positivos auditados, recall y precision ≥95%.
          </li>
          <li>
            <strong>Umbral agregado:</strong> ≥100 positivos auditados, recall global y precision ≥95%.
            Define si Valida está lista para sustituir Informa.
          </li>
          <li>
            <strong>Los nombres de lista no se cruzan:</strong> Informa y Valida no comparten
            nomenclatura. La columna &quot;Nombrada por&quot; dice cuál de los dos usó ese nombre;
            equipararlos sería inventar una equivalencia que nadie fijó.
          </li>
        </ul>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`p-3 rounded-lg border ${
        accent ? 'bg-acento/5 border-acento/30' : 'bg-white border-[#E5E7EB]'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-tinta-suave font-semibold">
        {label}
      </p>
      <p className={`text-xl font-bold mt-1 ${accent ? 'text-acento' : 'text-tinta'}`}>
        {value}
      </p>
    </div>
  );
}
