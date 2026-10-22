/**
 * Novedades de MéTRIK ONE: lo que cambió y le sirve saber a quien usa el producto.
 *
 * PUBLICAR UNA NOVEDAD = agregar una entrada a `NOVEDADES` (arriba la más reciente) y mergear.
 * No hay tabla, ni CMS, ni migración: el menú la cuenta en el numerito de «Novedades» de cada
 * persona que no la haya visto.
 *
 * Reglas de la entrada:
 *   - `id`: slug estable y ÚNICO. Es lo que se recuerda como «visto»: si se cambia, la novedad
 *     vuelve a salir como nueva para todos. Corregir el texto no la reactiva.
 *   - `fecha`: 'YYYY-MM-DD', el día en que el cambio llega al cliente. Ordena la lista.
 *   - `titulo` corto; `texto` de 1 a 3 frases en lenguaje llano, de cara al cliente (pasa por
 *     revisión: nada de nombres de clientes, códigos internos ni léxico vetado).
 *   - `producto` (opcional): el módulo a quien aplica (`IdModulo` de `lib/modulos/catalogo`).
 *     Sin él, la ven todos los espacios.
 */
import type { IdModulo } from '@/lib/modulos/catalogo'

export interface Novedad {
  id: string
  fecha: string
  titulo: string
  texto: string
  producto?: IdModulo
}

export const NOVEDADES: readonly Novedad[] = [
  {
    id: 'valida-consultas-mas-seguras',
    fecha: '2026-10-21',
    titulo: 'Consultas más seguras',
    texto:
      'Valida ahora detecta coincidencias aunque la cédula tenga un dígito de diferencia o dos dígitos invertidos, y busca por nombre y documento a la vez. Si una lista no se pudo revisar completa, la consulta muestra un error en lugar de "sin hallazgo": vuelve a intentarla.',
    producto: 'valida',
  },
]
