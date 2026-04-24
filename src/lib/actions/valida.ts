'use server';

import { getWorkspace } from './get-workspace';

const VALIDA_API_BASE = process.env.VALIDA_API_BASE ?? 'https://api.valida.metrikone.co';

export type TierLista = '1_vinculante' | '2_obligatoria' | '3_referencia' | '4_kyc_nacional';
export type Resultado = 'exacto' | 'posible';
export type Severidad = 'alto' | 'medio' | 'bajo' | 'informativo' | 'sin_hallazgo';

export type ValidaMatch = {
  lista: string;
  lista_nombre: string;
  tier: TierLista;
  vinculante_colombia: boolean;
  nombre_coincidencia: string;
  score: number;
  resultado: Resultado;
  fundamento_legal: string | null;
};

export type ValidaResultado = {
  consulta_id: string;
  severidad: Severidad;
  total_matches: number;
  matches: ValidaMatch[];
  hash_reporte: string;
  fecha_reporte: string;
};

export type ValidaConsultaInput = {
  tipo: 'natural' | 'juridica';
  nombre: string;
  documento?: { tipo: 'CC' | 'CE' | 'NIT' | 'PAS'; numero: string };
  fecha_nacimiento?: string;
};

export type ConsultaResumen = {
  consulta_id: string;
  nombre_consultado: string;
  documento_consultado: string | null;
  severidad: Severidad;
  total_matches: number;
  creada_en: string;
};

function getApiKey(): string {
  const key = process.env.VALIDA_API_KEY;
  if (!key) {
    throw new Error('VALIDA_API_KEY no esta configurada en el env de ONE');
  }
  return key;
}

export async function validarPersona(input: ValidaConsultaInput): Promise<
  { ok: true; data: ValidaResultado } | { ok: false; error: string }
> {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) return { ok: false, error: 'workspace_no_encontrado' };

  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify(input),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as ValidaResultado;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

export async function listarConsultas(opts: { limite?: number; severidad?: Severidad } = {}): Promise<
  { ok: true; consultas: ConsultaResumen[] } | { ok: false; error: string }
> {
  try {
    const url = new URL(`${VALIDA_API_BASE}/api/v1/consultas`);
    url.searchParams.set('limite', String(opts.limite ?? 50));
    if (opts.severidad) url.searchParams.set('severidad', opts.severidad);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${getApiKey()}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }

    const data = await res.json();
    return { ok: true, consultas: data.consultas ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' };
  }
}

