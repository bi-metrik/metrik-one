---
name: documento-esperado-bloque
description: Un bloque puede declarar qué documento espera y rechazar otro — el control es ASIMÉTRICO y el lector es una llamada aparte; la config de SOENA va como archivo SIN aplicar
metadata:
  type: project
---

Un bloque documental puede declarar `config_extra.documento_esperado` (uno o varios de un catálogo **cerrado de 14 tipos**, `src/lib/documentos/tipo-documento.ts`). Un lector aparte identifica el archivo y, si es otro documento conocido, **el bloque no se guarda**. PR de la sesión 2026-09-18.

**Why:** en SOENA (V0497/V0498) un certificado de Cámara cargado en el bloque `rut` hizo que el modelo **inventara 15 de 22 campos con confianza 0.95**, y uno de ellos sembró la seccional de la DIAN del negocio. Ni la confianza ni el campo vacío sirven de señal: el `responseSchema` de `extract-fields` marca todo `required`, así que **el modelo nunca devuelve un campo ausente**.

**How to apply — cuatro decisiones que no se leen del código:**

- ⚠️⚠️ **El veredicto es ASIMÉTRICO y no se debe "arreglar".** Rechaza SOLO con identificación positiva de otro tipo conocido con confianza ≥ 0,70. `otro`, `ilegible` y la duda **dejan pasar** y quedan anotados en `data._documento`. Un falso rechazo frena a un operador sobre un documento correcto con cientos de casos abiertos; un falso acepte deja las cosas como estaban. El lado seguro de un control NUEVO no es el de un gate.
- ⚠️ **El lector (`src/lib/ai/reconocer-documento.ts`) es una llamada APARTE y ciega a la expectativa.** La extracción ya recibe los campos del bloque, o sea que sabe qué documento se supone que lee: pedirle en la misma llamada «y dime qué es» la ancla y la respuesta deja de valer como control. Por eso cuesta una llamada más, y solo en los bloques que declaran.
- ⚠️ **El corte va ANTES de Drive.** `procesarDocumento` **borra el archivo anterior de Drive antes de subir el nuevo**: comprobar después dejaría al negocio sin el bueno y sin el malo. Cualquier control nuevo sobre la carga tiene que entrar en el mismo sitio (paso 2b). `reprocesarDocumento` también pasa por él: reescribe todos los campos y re-siembra la seccional.
- **El RUT de una persona jurídica ES un RUT y pasa.** El control es sobre el DOCUMENTO, no sobre la persona. De la persona se encarga el aviso `no_aplica` (ver abajo).

**Medido contra producción el 2026-09-18** (la cifra caduca, se re-mide): 25 RUT reales de la línea (V0012 … V0454) → los 25 `rut` con 0,98-0,99, **0 falsos rechazos**; los 3 certificados de Cámara que viven en el bloque `rut` (V0497, V0498, V0253) → los 3 `camara_comercio` con 0,98-0,99. 3,4-4,5 s por archivo.

⚠️ **La configuración de SOENA está SIN APLICAR**: `sql/soena/2026-09-18_documento-esperado-rut-y-no-aplica-juridica.sql`. Hasta que se aplique **todo esto es inerte**. El deploy del código va antes que el SQL.

Relacionado: [[no-aplica-por-linea]], [[seccional-origen]], [[reproceso-documentos-migrados]].
