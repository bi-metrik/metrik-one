'use server';

import { exigirModulo, REQUISITO } from '@/lib/modulos/exigir-modulo';

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

/**
 * Estas dos acciones usan la llave GLOBAL de MeTRIK (`VALIDA_API_KEY`): cada consulta se le
 * cobra a MeTRIK y el listado trae las consultas de todos los que la usan. Sirven a
 * `/compliance/validacion`, que es de Sustenta: la sesión no basta, el workspace tiene que
 * tener ese módulo. Un workspace de solo `valida_api` (4D SOFT) no consulta ni lista aquí.
 */
async function accesoLlaveGlobal(): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await exigirModulo(REQUISITO.sustenta);
  if (r.ok) return { ok: true };
  return { ok: false, error: r.error === 'no_autenticado' ? 'workspace_no_encontrado' : r.error };
}

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
  const acceso = await accesoLlaveGlobal();
  if (!acceso.ok) return acceso;

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
  // Sin sesion no se lista nada: con la llave global devolvia nombres y documentos
  // consultados a cualquiera que invocara la accion, con o sin cuenta.
  const acceso = await accesoLlaveGlobal();
  if (!acceso.ok) return acceso;

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

