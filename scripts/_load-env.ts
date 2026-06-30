// Carga .env.local ANTES de cualquier import que lea process.env en su top-level
// (los imports ESM se evalúan antes del cuerpo del módulo, así que dotenv debe
// correr como side-effect de un módulo importado primero).
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })
