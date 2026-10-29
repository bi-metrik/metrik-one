/**
 * Las integraciones que el dueño puede conectar desde la bóveda de llaves (Configuración → Bóveda de llaves). Pura y
 * sin valores: la usan la pantalla y el servidor. Una integración nueva (Drive, Siigo…) es una fila más aquí y, si
 * tiene prueba de conexión, un caso en `boveda-servidor.ts`.
 */

export interface ClaveBoveda {
  clave: string
  etiqueta: string
  /** Al reemplazarla, el valor anterior se guarda como `<clave>_anterior` (solo para verificar firmas unos días). */
  conservarAnterior?: boolean
}

export interface IntegracionBoveda {
  id: string
  nombre: string
  para: string
  claves: readonly ClaveBoveda[]
  /** Lo que se borra al desconectar: sus claves y las anteriores. */
  clavesAlBorrar: readonly string[]
  probarConexion: boolean
}

export const INTEGRACIONES_BOVEDA: readonly IntegracionBoveda[] = [
  {
    id: 'bold',
    nombre: 'Bold',
    para: 'Links de pago a nombre de tu negocio',
    claves: [
      { clave: 'bold_identity_key', etiqueta: 'Llave de identidad' },
      { clave: 'bold_secret_key', etiqueta: 'Llave secreta', conservarAnterior: true },
    ],
    clavesAlBorrar: ['bold_identity_key', 'bold_secret_key', 'bold_secret_key_anterior'],
    probarConexion: true,
  },
]

export function integracionBoveda(id: string): IntegracionBoveda | null {
  return INTEGRACIONES_BOVEDA.find((i) => i.id === id) ?? null
}

/** Una llave que se puede guardar: sin espacios, de 8 a 500 caracteres. */
export function llaveConForma(valor: string): boolean {
  return /^\S{8,500}$/.test(valor)
}

export interface EstadoClave {
  clave: string
  etiqueta: string
  configurada: boolean
  ultimos4: string | null
  actualizadoAt: string | null
}

export interface EstadoIntegracion {
  id: string
  nombre: string
  para: string
  probarConexion: boolean
  claves: EstadoClave[]
}

export interface EntradaAuditoria {
  clave: string
  accion: 'cargar' | 'reemplazar' | 'borrar'
  actor: string
  createdAt: string
}
