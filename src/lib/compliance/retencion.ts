/**
 * El plazo de conservación de los datos personales del expediente de
 * vinculación, en UN solo lugar.
 *
 * ── El plazo y de dónde sale ──────────────────────────────────────────────
 *
 * Diez (10) años contados desde el fin del vínculo. El fundamento es la **Ley
 * 962 de 2005, artículo 28**, al que remiten la **Resolución 2328 de 2025 de
 * la Superintendencia de Transporte** (art. 5.6.11.4) y la **Circular Externa
 * 100-000016 de 2020 de la Superintendencia de Sociedades** (num. 5.5).
 * Fijado por Emilio el 2026-09-10; la regla canónica vive en
 * `cerebro/reglas/retencion-diez-anios-datos-personales.md`.
 *
 * ── Por qué una constante y no el número escrito en cada sitio ────────────
 *
 * Porque ya pasó al revés. El 2026-09-10 se subió el plazo de cinco a diez
 * años en el texto que FIRMA la contraparte, y quedaron en cinco los
 * docstrings de arquitectura que explican por qué el dato no se copia a ONE
 * (tres archivos, cuatro menciones). Dos semanas después apareció una quinta
 * superficie —el copy del tutorial— que tampoco se había movido. Ninguna de
 * las tres la vio el guardián que ya existía, porque ese guardián mira el
 * texto firmado y nada más.
 *
 * El número vive aquí; lo que se pueda interpolar, se interpola; y lo que no
 * (la prosa de los comentarios) lo vigila `retencion.test.ts`, que barre el
 * repo entero y falla si alguna superficie declara un plazo distinto.
 *
 * ⚠️ Cambiar este valor NO alcanza para cambiar el plazo: `retencion.test.ts`
 * lo fija contra los diez años con su fundamento legal, así que un cambio
 * silencioso de la constante hace caer la prueba. Es a propósito — si la
 * prueba solo comparara las superficies contra la constante, mover la
 * constante dejaría todo en verde y el control no probaría nada.
 */

/** Años de conservación, en número. */
export const RETENCION_ANIOS = 10;

/** Los mismos años, en letras, para el texto legal («diez (10) años»). */
export const RETENCION_ANIOS_EN_LETRAS = 'diez';

/** La norma que impone el plazo. Se cita en el texto que firma el titular. */
export const RETENCION_FUNDAMENTO = 'Ley 962 de 2005, artículo 28';
