# Catálogo de servicios: lo que va al cerebro, preparado y sin instalar

Entrega **A2** de `proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md` (§3.2).

Esta carpeta guarda las piezas que **viven en el repositorio del cerebro**
(`bi-metrik/metrik-system`) y que MéTRIK ONE no puede instalar por sí solo:

| Aquí | Va a, en el cerebro | Quién lo pone |
|---|---|---|
| `cerebro/.github/workflows/catalogo-servicios.yml` | `.github/workflows/catalogo-servicios.yml` | Mik (dueño de hooks y workflows) |
| `cerebro/scripts/sync-catalogo-servicios.mjs` | `scripts/sync-catalogo-servicios.mjs` | Mik |
| `cerebro/catalogo/servicios/*.md` | `cerebro/catalogo/servicios/*.md` | **Kaori** (regla: solo Kaori escribe en `cerebro/`) |

**Nada de esto está instalado ni se ha corrido.** El encargo de A2 era prepararlo.

## Por qué las piezas del cerebro se versionan en metrik-one

Porque el contrato entre las dos puntas se rompe si alguien cambia un solo lado: la firma
(`x-one-firma`), la forma del cuerpo y los códigos de respuesta los define
`src/lib/catalogo/firma.ts` y las rutas de `src/app/api/catalogo/`. Teniéndolas en el mismo PR
que su receptor, un cambio en una obliga a mirar la otra. Cuando Mik las instale, esta carpeta
queda como la copia de referencia; si se separan, la que manda es la del cerebro y hay que
volver a alinearlas.

## Antes de instalar

1. **El secreto.** `CATALOGO_SYNC_SECRET` tiene que existir con el **mismo valor** en los dos
   lados: en Vercel (proyecto de ONE, entorno de producción) y en los *secrets* del repositorio
   del cerebro. Y `ONE_URL` como *variable* del repositorio (`https://metrikone.co`).
   Mientras no exista en ONE, la ruta responde **503 a todo el mundo**, que es el
   comportamiento correcto: un valor ausente nunca autoriza.
2. **La migración de ONE.** `supabase/migrations/20260916120000_catalogo_y_servicios_contratados.sql`
   **no está aplicada**. Sin ella la ruta responde 500. Va antes del primer `publicar`.
3. **Las decisiones citadas.** Cada archivo de catálogo cita en `precios_lista_fuente` y en
   `tratamiento_iva_fuente` un slug del cerebro, y **el script falla si el archivo citado no
   existe**. Hoy falta uno:

   - `decisiones/2026-09-15_comisiones-afi-por-tipo-de-servicio`, citado por
     `valida-cda-licencia.md`. La decisión existe (fila del 2026-09-15 de
     `proyectos/metrik/one/decisions.md`: licencia de CDA $150.000, AFI $50.000 fijos; paquetes
     de Valida API 20 %) pero **no está capturada en el cerebro**. Kaori.

   Los otros tres slugs sí existen: `decisiones/2026-09-16_suscripciones-sin-iva-cloud-computing-excluido`,
   `decisiones/2026-09-07_escalera-pricing-volumen-valida` y `reglas/pricing-one`.

## Cómo probarlo sin tocar producción

`ONE_URL` puede apuntar a un preview de Vercel. ⚠️ Los previews del equipo están detrás del SSO
del team, así que el `fetch` del script recibiría el HTML del login y no un 401 del código; para
probar contra un preview hay que abrirlo primero. Contra producción, el modo `revisar` es de
solo lectura y es el que conviene correr primero.

## Qué valida cada lado, y por qué así

| | Valida | No valida |
|---|---|---|
| **Action (cerebro)** | que las decisiones citadas existan como archivo | el esquema del frontmatter |
| **ONE** | el esquema completo, el slug contra el nombre del archivo, la huella y el conflicto de versión | nada del sistema de archivos del cerebro, que no ve |

El esquema vive **solo** en ONE (`src/lib/catalogo/definicion.ts`). Dos esquemas en dos repos se
desincronizan, y el síntoma sería un archivo que pasa en el cerebro y rebota en ONE — o peor,
uno que pasa en los dos queriendo decir cosas distintas. Cuando un archivo está mal, ONE
responde 422 **con los motivos** y el script los imprime: quien corrige no tiene que abrir
código.

## Reglas que los archivos de catálogo hacen cumplir

- **Nada nace con IVA del 19 %.** `tratamiento_iva` es obligatorio y sin valor por defecto, y
  un `gravado` sin su `iva_pct` se rechaza (decisión del 2026-09-16: toda suscripción se vende
  como servicio de computación en la nube, excluido por el art. 476 ET). Los cuatro archivos
  dicen `excluido`.
- **La comisión no vive en el catálogo.** N3 del 2026-09-15: el monto o el porcentaje lo define
  cada negocio o contrato, no un valor global. Un archivo con `comision` se rechaza con el
  motivo. Vive en `servicios_contratados.comision`, la calcula
  `src/lib/servicios/comision.ts` y la base rechaza una comisión declarada a medias.
- **Una versión publicada es inmutable.** Cambiar un precio obliga a subir la versión: si no,
  ONE responde 409 y no toca nada. Es lo que impide que las condiciones de un contrato ya
  firmado cambien por debajo.
