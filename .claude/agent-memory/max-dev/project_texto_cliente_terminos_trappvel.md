---
name: texto-cliente-terminos-trappvel
description: "#841 — términos en el panel del texto (config_extra.terminos_base, propuesta NO guardada sola), dónde sale cada campo, validador de estilo que marca sin reescribir, few-shot con iniciales en código, y Trappvel sin resumen fiscal; los datos de config los carga la sesión principal"
metadata:
  type: project
---

**PR [#841](https://github.com/bi-metrik/metrik-one/pull/841)** (2026-09-23), brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-texto-cliente-2026-09-23.md` con el ajuste de
C4 de Mauricio del mismo día. Sin migración. Nada escrito en producción: el texto base y los
ejemplos los carga la sesión principal.

**Why:** ensayo de COT-2026-0009 (hallazgos 33-35): los términos del cuadro no salían en el PDF
de Trappvel, el panel no decía dónde sale cada campo y el texto sonaba a folleto.

**How to apply:**
- **Las dos claves, en la línea «Viaje a medida»** (`42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887`):
  `config_extra.terminos_base` (texto con saltos; renglón suelto antes de viñetas = subtítulo,
  `- ` = viñeta, dos espacios + `- ` = sub-viñeta) y `config_extra.ejemplos_texto` (lista de
  textos sueltos = presentación, u objetos con los cuatro campos). ⚠️ `ejemplos_texto` AUSENTE
  usa tres ejemplos iniciales que viven en código (`EJEMPLOS_TEXTO_INICIALES`); una lista vacía
  los apaga. No es lo mismo quitar la clave que dejarla en `[]`.
- ⚠️⚠️ **La propuesta de términos NO se guarda sola.** Se propone al abrir el panel de un borrador
  sin términos y se guarda con «Guardar texto revisado». Si nadie abre el panel, el PDF sale sin
  términos. La única señal es el punto ámbar «Términos sin guardar» del botón «Texto». Si Edgar
  reporta PDFs sin términos, la salida es copiarlos al crear la cotización, y eso es decisión de
  Mauricio (el brief eligió «al abrir el panel»).
- **El PDF nunca lee `terminos_base`**: imprime la copia de `terminos_condiciones`. Así un
  documento enviado no cambia si cambia el texto base.
- **El validador cuenta el entusiasmo por FRASE, no por palabra**: la apertura real
  «¡Prepárese para vivir una experiencia única en Chile!» trae dos expresiones permitidas y es
  UNA frase entusiasta. Contarlas por palabra marcaría los propios ejemplos de Trappvel.
- **Marca, no corrige**: `documento_cliente.estilo_por_revisar` solo existe si hay algo (la clave
  se omite en un texto limpio, para que los documentos viejos se lean igual).
- **Hallazgo 33 cuelga del registro de plantillas** (`plantillaMuestraResumenFiscal`), como el
  panel. Al ocultar el resumen se conserva suelto el aviso de IVA sin calcular: es lo único de
  ese bloque que cambia el PDF.
- Fixture del texto base: `src/lib/cotizaciones/__fixtures__/terminos-base-trappvel.ts` (idéntico
  byte a byte al .md del cliente, verificado con `diff`).

Relacionado: [[texto-cliente-trappvel]], [[pruebas-por-mutacion]], [[worktree-git-bloqueado]].
