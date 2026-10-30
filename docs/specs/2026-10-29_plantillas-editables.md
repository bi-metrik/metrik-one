# Plantillas editables de documentos

**Fecha:** 2026-10-29 · **Origen:** proyecto SOENA, aprobado por Mauricio el 2026-10-29 · **Antecedente:** SOE-033 (#1329)

Un workspace edita por sí mismo el texto de los documentos que ONE genera en sus negocios. Hoy: **Declaración juramentada** (`declaracion-juramentada`) y **Relación de facturas** (`relacion-facturas`).

- El texto se edita en una pantalla de ONE (Configuración → «Plantillas de documentos», `/mi-negocio/plantillas`). No se sube un Word.
- El PDF sale por Chromium (`src/lib/pdf/chromium/render-chromium.ts`). La vista previa en vivo, el PDF de vista previa y el PDF generado salen del **mismo HTML** (`htmlDelDocumento`).
- Sin versión activa, el documento sale con el componente @react-pdf de siempre. Ningún workspace cambia hasta que alguien activa una versión.

## Modelo de datos

Migración `supabase/migrations/20261029203000_plantillas_documento.sql`.

| Tabla | Qué guarda | Con sesión (`authenticated`) |
|---|---|---|
| `plantillas_documento_editores` | `(workspace_id, user_id)` de quien puede editar. `user_id` es `profiles.id`. | Solo SELECT de su workspace. Se cambia por SQL. |
| `plantillas_documento_versiones` | Cada guardado: `tipo`, `version_n`, `contenido`, `nota`, `creada_por`, `creada_por_nombre`, `restaurada_de`, `created_at`. | SELECT de su workspace. INSERT solo si la persona está en la lista y `creada_por = auth.uid()`. **Sin UPDATE ni DELETE.** |
| `plantillas_documento_activas` | Una fila por `(workspace_id, tipo)` que apunta a la versión activa. | SELECT de su workspace. INSERT/UPDATE (upsert) solo si la persona está en la lista. Sin DELETE. |

- Guardar crea siempre una versión nueva (`version_n` siguiente); nunca se sobreescribe.
- Activar es un upsert de una sola fila, así que hay una sola activa a la vez. La llave foránea compuesta `(version_id, workspace_id, tipo)` impide que apunte a una versión de otro workspace o de otro documento.
- Restaurar crea una versión nueva igual a la elegida (`restaurada_de`) y la activa.
- El bloque generado guarda qué versión lo imprimió: `negocio_bloques.data.plantilla_version = { id, version_n }` (o `null` si salió con el formato de fábrica).
- Los documentos ya generados no cambian. Cambian solo los que se generen o regeneren después de activar.

## Permisos

**El permiso es una lista explícita de personas, no un rol.** Lo validan tres capas:

1. La página `/mi-negocio/plantillas` redirige a `/mi-negocio` a quien no está en la lista. El enlace en Configuración solo aparece para la lista.
2. Cada server action (`src/app/(app)/mi-negocio/plantillas/actions.ts`), también las de lectura, y la ruta `POST /api/plantillas-documento/vista-previa` verifican la lista con el usuario **real** de la sesión. En «Ver como» no se edita.
3. El RLS de las tablas lo vuelve a exigir al escribir: una persona fuera de la lista no puede insertar aunque llame a PostgREST directo.

### Agregar o quitar a una persona (sin deploy)

Por SQL (MCP `execute_sql`, con el filtro de workspace):

```sql
-- Agregar
insert into public.plantillas_documento_editores (workspace_id, user_id, nota)
select p.workspace_id, p.id, 'Agregada por <quién> el <fecha>'
from public.profiles p
where p.workspace_id = '<workspace_id>' and p.id = '<profile_id>'
on conflict do nothing;

-- Quitar
delete from public.plantillas_documento_editores
where workspace_id = '<workspace_id>' and user_id = '<profile_id>';
```

Lista inicial de SOENA (migración `20261029203100_plantillas_documento_soena_v1.sql`): Deisy Ramírez, Daniela Játiva, Diana Parra y Juan David Bruce. Leidy Llanos no entra.

## Sintaxis

Cerrada: lo que no está aquí es un error al guardar. Vive en `src/lib/plantillas-documento/sintaxis.ts`.

**Por renglón (bloques)**

| Marca | Efecto |
|---|---|
| `# Texto` / `## Texto` | Título (13 pt) / subtítulo (10 pt), en negrita |
| renglón en blanco | Separa párrafos. Un salto simple se respeta como salto de renglón |
| `\| a \| b \|` | Fila de tabla. Los renglones seguidos forman una tabla. `\|! texto` es una celda de etiqueta (sombreada), `\|# texto` es la franja de título (una sola celda). Una fila más corta estira su última celda |
| `---` | Raya de firma |
| `{{#centrado}}` `{{#justificado}}` `{{#derecha}}` … `{{/…}}` | Alineación de lo que encierran |
| `{{#junto}}` … `{{/junto}}` | No se parte entre hojas |
| `{{#firmas}}` … `{{/firmas}}` | Se repite por titular, en columnas, sin partirse |
| `{{#si condición}}` … `{{sino}}` … `{{/si}}` | Condicional de bloque |
| `{{#cada titular}}` … `{{/cada}}` | Repite por titular |

Regla: **una etiqueta sola en su renglón es de bloque**. Si está dentro del texto, es en línea.

**En línea:** `**negrita**`, `{{variable}}`, `{{#si condición}}…{{sino}}…{{/si}}` y `{{#cada titular}}…{{/cada}}`, todo dentro del mismo párrafo. La negrita no puede cruzar un `{{#si}}`.

**Escape:** todo texto (el de la plantilla y el de los datos) se escapa. La plantilla no puede producir etiquetas, estilos ni recursos. El documento lleva una CSP sin scripts ni red, Chromium imprime sin red y la vista previa va en un `iframe` con `sandbox` vacío.

## Validación

`validarPlantilla(tipo, contenido)` (`validar.ts`) devuelve:

- `errores` (bloquean el **guardado**): estructura mal cerrada o cruzada, `{{sino}}` suelto o repetido, negrita sin cerrar, etiqueta o bloque desconocido, variable o condición fuera del catálogo, `titular.*` fuera de `{{#cada titular}}`/`{{#firmas}}`, repetición anidada o que no es por titular, y llaves sueltas.
- `faltantes` (bloquean la **activación**, no el guardado): requisitos mínimos del documento que la plantilla no usa **fuera de cualquier `{{#si}}`**.

| Documento | Requisitos mínimos |
|---|---|
| Declaración juramentada | nombre del solicitante (`titular.nombre` o `nombre_solicitante`), cédula (`titular.cedula` o `numero_identificacion`), `numero_factura`, `valor_iva`, `iva_solicitado` y un bloque `{{#firmas}}` |
| Relación de facturas | nombre, cédula, `numero_factura`, `nit_proveedor_base`, `valor_sin_iva`, `valor_iva`, `iva_solicitado` y un bloque `{{#firmas}}` |

La generación vuelve a validar. Una plantilla activa con errores no imprime (no cae al formato viejo).

## Catálogo

`src/lib/plantillas-documento/catalogo.ts`. Los valores se calculan con las mismas funciones que los componentes @react-pdf (`formato.ts`, `titulares.ts`, `nitBaseYDv`), a partir de `datosFinal` de `generarFormularioCore`: `campos_fuente` + overrides, con los faltantes ya bloqueados.

- **Del expediente:** nombre, cédula, dirección y municipio del titular 1 (y nombre y cédula del 2), marca, línea, tipo de vehículo, proveedor (DJ) o nombre y NIT del proveedor (Relación), número y fecha de factura, radicado y fecha del certificado UPME. En la Relación también correo y celular.
- **Derivados:** `valor_sin_iva`, `valor_iva` e `iva_solicitado` en pesos; **`iva_solicitado` es el IVA exacto de la factura**, sin redondear al mil (decisión de Mauricio del 2026-10-29; no hay variable «aproximado al mil»). También `tarifa_iva` (IVA ÷ base), `nit_proveedor_base` y `nit_proveedor_dv` (DV calculado), `descripcion_bien`, `fecha_*_larga` («15 de marzo de 2026») y `fecha_*_corta` («15/03/2026»), `fecha_generacion_larga`/`_dia`/`_mes`/`_anio` en hora de Bogotá y `codigo_negocio`.
- **Concordancia (`titulares.ts`):** `frase_yo` (Yo/Nosotros), `frase_identificado`, `frase_domiciliado`, `frase_manifiesto`, `frase_declaro`, `frase_solicitante`, `frase_presento`, `frase_soy`, `frase_adquirente` y `frase_persona_natural`.
- **Por titular** (dentro de `{{#cada titular}}` o `{{#firmas}}`): `titular.nombre`, `titular.cedula`, `titular.direccion` y `titular.municipio` (DJ), y `titular.correo` y `titular.celular` (Relación).
- **Condiciones:** `dos_titulares`, `hay_radicado_upme` y `hay_fecha_certificado`. Por titular: `titular.es_primero` y `titular.es_ultimo`.
- **Marcadores:** si falta un dato opcional, sale el mismo marcador que imprime hoy el componente («[N.° DE CÉDULA]», «—»…).

## Versión 1 de SOENA

`src/lib/plantillas-documento/v1.ts` traduce lo que imprimen hoy `declaracion-juramentada-pdf.tsx` y `relacion-facturas-pdf.tsx`. La migración `20261029203100_*` la siembra en SOENA **sin activarla**. Lo que se probó:

- `v1.test.ts` compara el texto del PDF de @react-pdf con el del HTML (siempre) y con el del PDF de Chromium (con `CHROMIUM_EJECUTABLE`) en cuatro casos: completo, sin fecha de certificado, sin radicado y dos titulares.
- `plantillas-sql.test.ts` (PGlite) comprueba que el texto sembrado es byte a byte el de `v1.ts` (desde el 2026-10-30, la versión 2 de la DJ; la 1 conserva la frase quitada).
- **2026-10-29, plantilla v2 de Deisy:** el CUARTO de la DJ quita «, (valor aproximado como lo establece el artículo 577 del Estatuto Tributario)» porque la DIAN rechaza el trámite si el valor aparece aproximado. Cambia el componente @react-pdf y `v1.ts`; como las versiones son inmutables, la migración `20261030120000_plantillas_documento_soena_dj_v2.sql` agrega la versión 2 de la DJ de SOENA (sin activar). La Relación de facturas nunca tuvo la frase.
- Letra: Liberation Sans 2.1 embebida (SIL OFL 1.1), que tiene la métrica de Helvetica.

## Cómo agregar un documento nuevo

1. Que el documento ya se genere por `generarFormularioCore` con un `template` propio en `config_extra` y su componente @react-pdf.
2. En `catalogo.ts`, agregar el tipo a `TipoPlantilla` y una entrada a `DOCUMENTOS` con `variables`, `variablesTitular`, `condiciones`, `requisitos`, `pagina` (márgenes e interlineado), `ejemplo` y `valores(datos, ctx)`. Calcular los derivados con las mismas funciones que el componente.
3. Escribir la versión 1 en `v1.ts` y una prueba de equivalencia de texto contra el componente, como en `v1.test.ts`.
4. Si un workspace la quiere, sembrar su versión 1 y su lista de editores con una migración de datos aparte. El `CHECK` de `tipo` solo exige el formato del slug, así que no hace falta tocar el esquema.

`admitePlantillaEditable(template)` decide sola, con el catálogo, qué templates consultan la versión activa al generar.

## Riesgos conocidos

- **Tiempo de render.** Chromium tarda más que @react-pdf. En frío descomprime unos 67 MB en `/tmp`. Medido en la torre: unos 1,3 s el primer PDF y unos 0,2 s los siguientes, con el binario local. En Vercel el arranque en frío fue de varios segundos en el ensayo de la propuesta. Solo afecta a los workspaces con una versión activa.
- **Tamaño de función.** `/negocios/*` y `/api/plantillas-documento/*` llevan el binario de Chromium (`outputFileTracingIncludes`).
- **Si Chromium falla, no hay respaldo.** La generación devuelve error en vez de imprimir el texto viejo, porque el workspace activó otro.
