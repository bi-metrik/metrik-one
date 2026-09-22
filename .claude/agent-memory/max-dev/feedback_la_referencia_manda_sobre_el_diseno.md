---
name: la-referencia-manda-sobre-el-diseno
description: Cuando un documento de diseño describe un artefacto real del cliente, el artefacto manda — el diseño suele estar escrito de memoria
metadata:
  type: feedback
---

Cuando un documento de diseño **describe** un artefacto real del cliente (un PDF que ya
manda, un Excel que ya usa, una pantalla que ya opera), el artefacto es la fuente y el
documento es una transcripción. Ante una diferencia, **gana el artefacto**, y conviene
abrirlo antes de construir sobre lo que dice el diseño.

**Why:** el 2026-09-22 el coordinador abrió el itinerario real de Trappvel
(`Itinerario_Viaje_Cancun_Ligia_Sanchez.pdf`) a mitad de un encargo y encontró que su
tabla de vuelos tiene **cinco** columnas, no las siete que decía la §2 de
`propuesta-visual.md`. Esa sección se había escrito el 17-sep **de memoria**, y sobre ella
ya se habían construido dos entregas: el #812 leyó y midió una `duracion` (18 de 18
correctas) que **el documento del cliente nunca mostró**. Trabajo bien hecho sobre una
premisa que nadie había comprobado contra el papel.

De paso, la corrección **simplificó** el encargo en vez de ampliarlo: quitó la columna que
desbordaba y con ella la pregunta de la medianoche y los husos horarios. Tres puntos del
brief se cerraron quitando cosas.

**How to apply:**
- Si el brief cita un artefacto por su nombre de archivo, **abrirlo** antes de tratar la
  descripción como especificación. Cuesta minutos.
- Al reportar, separar lo que salió del artefacto de lo que salió del documento de diseño,
  para que la próxima sesión sepa cuál de los dos re-verificar.
- Y al revés: cuando el artefacto **no** tiene algo que el cliente sí pidió con nombre
  propio (la ESCALA con su ciudad, §4.1), eso se queda. La referencia fija la forma, no
  recorta un requisito explícito.
- Corregir el documento de diseño no es tarea del agente, pero **dejar escrito en el código
  que esa sección está desactualizada** sí: es lo único que evita que la próxima entrega
  vuelva a construir sobre ella.

Relacionado: [[cifras-del-brief-caducan]], [[medir-antes-de-construir]],
[[tres-tarifas-y-tabla-de-vuelos]], [[horas-de-vuelo-trappvel]].
