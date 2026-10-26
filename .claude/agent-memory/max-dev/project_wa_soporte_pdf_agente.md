---
name: wa-soporte-pdf-agente
description: Bot ONE (modo agente) guarda y lee el soporte en foto o PDF (2026-10-21) — documento como clase 'otro', lectura en media jsonb, ventana de 5 s, corregir_gasto, arnés sin correr con llave
metadata:
  type: project
---

Desde feat/wa-soporte-pdf-agente (2026-10-21) el webhook recibe `document` (y `no_soportado` para video/sticker/contacto)
y el dominio ONE baja, sube a `gastos-soportes/<ws>/whatsapp/<fila>` y LEE cada foto/PDF antes del turno
(`prepararTurno`, `one/lectura-adjunto.ts`). Sin migración.

**Why:** caso real de Mauricio: el PDF del Uber con «Este fue la ida» se perdió sin rastro. Él: «El PDF ya debería ser el
soporte» y el bot lo lee; lo que dice la persona manda en destino/qué gasto, el documento en los datos duros.

**How to apply:**
- `wa_conversacion.clase` tiene CHECK sin `documento`: el PDF va como `otro`; lo que distingue es `media.tipo`. La lectura
  y la ref se guardan en la misma columna `media` (jsonb). Evita migración; no "arreglarlo" con una clase nueva sin migrar.
- La lectura es un llamado APARTE (no el archivo dentro del turno) a propósito: el verificador no deja salir cifras sin
  respaldo y lo leído como texto lo respalda; además no se vuelve a bajar en cada turno.
- Interruptor de proveedor: `LLM_PROVEEDOR_SOPORTES` (por defecto anthropic, respaldo Gemini con inlineData). Ojo: la
  lectura de documentos del resto de ONE va por `fetchModeloDocumentos` (Gemini por defecto, eval 2026-10-20).
- `ventanaAdjuntosMs` (5 s) hace que la cola ESPERE tras un adjunto y repita el turno si llega un adjunto mientras el
  modelo piensa. Cualquier dominio nuevo que la declare paga hasta 5 s por foto.
- Arnés `s-*` (casos-one.ts) listos con un recibo de Uber sintético hecho a mano (`arnes/soportes/pdf-minimo.ts`); el
  2026-10-21 NO se corrieron: no había llave de Anthropic en el entorno del subagente.
- Desde feat/wa-soportes-trappvel la preparación vive en `agente/adjuntos.ts` (común con la bandeja) y el lector en
  `crearLector(perfil)`.
Relacionado: [[agente-one-todo-workspace]], [[nucleo-conversacional]], [[bandeja-adjuntos-trappvel]].
