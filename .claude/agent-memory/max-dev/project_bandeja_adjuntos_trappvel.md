---
name: bandeja-adjuntos-trappvel
description: Bandeja de Trappvel lee foto/PDF (2026-10-21, feat/wa-soportes-trappvel) — soporte = comentario en activity_log con link_url one://; interruptor leer_adjuntos; Estado ONE cruza gastos con la base
metadata:
  type: project
---

PR feat/wa-soportes-trappvel (2026-10-21), sin migración, sin mergear al escribir esto. Arnés `--conjunto adjuntos`
y regresión con llave SIN correr (no había llave en el subagente).

**Why:** Mauricio: «llévalo a Trappvel» (lo del #1228). En la bandeja no hay gastos: se cargan viajes, así que el
«soporte» es el archivo del cliente que respalda lo cargado en el viaje.

**How to apply:**
- Soporte en Trappvel = fila `activity_log` tipo `comentario` del negocio con `link_url = one://gastos-soportes/<ws>/whatsapp/<fila>`.
  `activity-log.tsx` lo abre con `hrefArchivo` («Ver archivo»). No hay tabla de archivos por negocio (el repositorio
  `/negocios/<id>/archivos` solo existe con almacenamiento externo).
- El reglamento de Trappvel vive en la base (`bot_reglamentos`): la conducta nueva va en el Estado (`lineasAdjuntos`) y
  en el prompt de extracción (`PARRAFO_DOCUMENTOS`), SOLO cuando hay archivos. Sin archivos todo es idéntico (probado).
- Los reenvíos (también foto/PDF) no pasan por el modelo: la cola los lee DESPUÉS del acuse (`cola.ts`, paso 2).
- Interruptor sin desplegar: `bot_conversacional.agente_config.leer_adjuntos = false`.
- Dominio ONE: el Estado cruza los G1, G2… de la traza con `gastosPorId` (borrados → «ya no están en ONE», candado
  `gasto_borrado`). Un soporte usado por un gasto borrado sigue contando como usado (`fotosUsadas` es pura).
- Aviso de datos de Trappvel no se tocó: ahora se mandan documentos (incl. pasaportes) a Anthropic/Gemini → legal.
Relacionado: [[wa-soporte-pdf-agente]], [[bandeja-hibrida]].
