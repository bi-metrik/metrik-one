---
name: bloqueo-prueba-real-1029
description: #1326, 4 defectos de la prueba real del bloqueo Trappvel tras #1324 (INF, barra, edad del niño, marca del PDF); PDF recibe porPasos del llamador
metadata:
  type: project
---

Arreglo de los 4 defectos de la prueba real del bloqueo de Trappvel (2026-10-29), sin migración.

- La marca de borrador del PDF ahora sigue a «Enviar»: autorización de datos, paquete incompleto y P12 (`frenos-de-paquete-y-pasajero.ts`, compartido con `enviarPorPasos`). La autorización faltaba en el PDF desde #1257 (2026-10-25); el defecto es heredado, no del #1324.
- **Why:** el criterio N4 (`por-pasos-lectura-guard.test.ts`) prohíbe que el PDF importe el interruptor por pasos. Por eso P12 entra solo si el llamador pasa `generateCotizacionPDF(id, { porPasos })`: el editor y la ruta vista-previa lo hacen. La opción solo AGREGA la marca.
- La edad del niño se precarga en la tarjeta del paquete desde `edades_menores` (texto libre: «8 años», «7, 1.5»; bajo 2 años = infante si hay infantes). Entra a la cuenta solo con niños en el paquete, y desde el ajuste de Vera también en el freno (servidor, editor, PDF) vía `paquetesIncompletos(..., edadesMenores)`, sin esperar a Guardar. «6 meses» es infante, nunca 6 años.
- «Sigue:» deja la autorización de datos (depende del cliente) DESPUÉS de «Lee el texto»; lo demás rojo va antes (`impide` con clave).
- El doble `test/cotizacion-pdf-doble.ts` reconoce el embed `lineas_negocio(config_extra, etapas_negocio(...))` del PDF.

**How to apply:** si se agrega un freno nuevo a «Enviar», sumarlo también a `motivosDeBorrador` y al PDF, y a `primerImpide` de la barra, que ya lo toma de la lista única.
