/**
 * Formas de lo que devuelven las rutas `/api/one/v1/*` de Valida.
 *
 * Copiadas de la fuente de verdad en `bi-metrik/metrik-valida` (rama `main`):
 *   - `lib/one/llaves.ts`       → `LlaveOne`, `ListadoLlavesOne`, `cuerpoLlaveEmitida`
 *   - `lib/one/bolsas.ts`       → `BolsaEnEspera`
 *   - `lib/consumo/tipos.ts`    → `BolsaConsumo`, `CamposConsumo`
 *   - `lib/consumo/consumo.ts`  → `BolsaHistorial`
 *   - `app/api/one/v1/clientes/[cliente_id]/resumen/route.ts` → `ResumenValidaApi`
 *
 * Solo los campos que el módulo usa, y declarados opcionales donde Valida puede no mandarlos:
 * si un día un campo falta, la pantalla debe callar ese dato, no pintar `undefined`.
 */

export type EstadoLlave = 'activa' | 'en_retiro' | 'vencida' | 'revocada'
export type OrigenLlave = 'metrik' | 'portal' | 'one'

export interface LlaveValida {
  key_id: string
  key_prefix: string
  nombre: string | null
  creada_en: string
  ultima_uso_en: string | null
  vence_en: string | null
  revocada_en: string | null
  origen: OrigenLlave
  reemplaza_a: string | null
  estado: EstadoLlave
}

export interface ListadoLlaves {
  limite_vigentes: number
  gracia_horas: number
  llaves: LlaveValida[]
}

/**
 * Lo que vuelve al generar o regenerar. `llave` es la llave EN CLARO: viaja una sola vez, del
 * servidor al navegador de quien la pidió, y no se guarda ni se registra en ninguna parte.
 */
export interface LlaveEmitida {
  ok: true
  key_id: string
  key_prefix: string
  nombre: string
  regenerada: boolean
  llave: string
  aviso?: string
  anterior_key_id?: string
  anterior_deja_de_autenticar_en?: string
}

export interface LlaveRevocada {
  ok: true
  key_id: string
  ya_estaba_revocada: boolean
}

export type EstadoBolsa = 'vigente' | 'agotada' | 'vencida'

export interface BolsaVigente {
  bolsa_id: string
  secuencia: number
  estado: EstadoBolsa
  bloqueada: boolean
  activada_en: string
  vence_en: string
  dias_para_vencer: number
  consultas_compradas: number
  consumidas: number
  saldo: number
  precio_total: number
  pago_referencia: string
}

export interface BolsaEnEspera {
  en_espera_id: string
  consultas_compradas: number
  precio_total: number
  vigencia_meses: number
  pago_referencia: string
  origen: string
  encolada_en: string
}

export interface BolsaHistorial {
  bolsa_id: string
  secuencia: number
  estado: 'vigente' | 'agotada' | 'vencida' | 'cerrada'
  activada_en: string
  vence_en: string
  cerrada_en: string | null
  consultas_compradas: number
  consumidas: number
  saldo: number
  precio_total: number
  pago_referencia: string
}

export interface ConsumoValida {
  modalidad: 'mensual' | 'bolsa'
  bolsa: BolsaVigente | null
  consumo?: {
    consumidas: number
    incluidas: number
    restantes: number
    porcentaje: number | null
    estado: string
    actualizado_en: string
  }
}

export interface RenovacionValida {
  estado: 'sin_suscripcion' | 'en_curso' | 'rechazada' | 'pausada'
  [k: string]: unknown
}

export interface ResumenValidaApi {
  cliente_id: string
  consumo: ConsumoValida | null
  bolsa_en_espera: BolsaEnEspera | null
  bolsas: BolsaHistorial[]
  renovacion: RenovacionValida | null
}
