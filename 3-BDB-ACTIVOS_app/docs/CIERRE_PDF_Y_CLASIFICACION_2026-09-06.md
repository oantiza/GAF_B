# Fallo de fuentes en el segundo PDF, y clasificación de las discrepancias

6 de septiembre de 2026. Estado al emitir este informe: cambios locales sobre `0dea2b4`, todavía sin publicar.

> **Cierre posterior:** estos cambios están comiteados y publicados en `4980264`. Se han reparado y verificado los nueve activos del alcance ampliado. Véanse la copia, el despliegue y las comprobaciones reales en [el cierre de producción](docs/CORRECCION_AJUSTES_HISTORICOS_2026-09-06.md). El texto siguiente conserva el diagnóstico y el estado de aquella revisión.

---

## 1. Dos informes seguidos: el segundo perdía letras — reproducido, entendido y corregido

**Confirmado, y es peor de lo que parecía: no era un fallo de extracción de texto, se veía en el papel.**

Reproducción: dos informes en la misma ejecución, el segundo con nombres que el primero no usaba.

| | Primer informe | Segundo informe (antes) | Segundo informe (ahora) |
|---|---|---|---|
| ÁGUILA ÍNDICE | — | **GUILA ÍNDICE** | ÁGUILA ÍNDICE |
| ÍNDICE | — | **NDICE** | ÍNDICE |
| ÚNICO | — | **NICO** | ÚNICO |
| ÑOÑO KÜMMEL | — | **ÑO KÜMMEL** | ÑOÑO KÜMMEL |

Comprobado por tres vías independientes sobre el PDF generado: el extractor propio, `pdftotext` (Poppler) y la **página renderizada a imagen**. Las tres coinciden.

### La regla del fallo

Se pierden las letras que **el primer informe no usó**. Da igual la palabra: «BABA BABA», «COCA COLA» o «Amundi Amundi» salen bien; «ÁGUILA» sale mal porque la Á mayúscula no aparecía en el primero. Por eso pasaba desapercibido: en castellano casi todo el alfabeto sale en cualquier informe, y solo caen las mayúsculas acentuadas y la Ñ de un nombre propio.

### La causa

@react-pdf conserva entre documentos el objeto de fuente ya cargado. Ese objeto arrastra estado del primer render, y los glifos que el primero no pidió se codifican mal en el segundo. No es un problema de una tipografía concreta: afecta igual al papel OAA (Newsreader / Instrument Sans) y al informe Andbank (Fraunces / Roboto Flex).

Volver a llamar a `Font.register` **no** sirve: añade fuentes a la familia en vez de reemplazarlas, y se sigue resolviendo la vieja. `Font.clear()` tampoco: se llevaría por delante las familias del informe Andbank, que registra las suyas aparte.

### La corrección

`forgetPdfFontFamilies(...)` olvida solo las familias indicadas, y cada generador pide fuentes nuevas antes de renderizar: `createRealPortfolioPdfBlob`, `createComparisonPdfBlob`, `createAssetComparisonPdfBlob`, `createWeeklyReportPdfBlob`, `createXrayReportPdfBlob` y `createAndbankPortfolioReportPdfBlob`. El coste es volver a cargar unas tipografías de pocas decenas de kB por informe.

### Comprobado también en el navegador

Levantado el servidor de desarrollo y generados **dos informes seguidos en Chrome**. El segundo, descargado y examinado: `pdftotext` devuelve «ÁGUILA ÍNDICE», «ÑOÑO KÜMMEL» y «ÚNICO ÖSTER» completos, y la hoja 3 renderizada los muestra enteros. La página de diagnóstico y los ficheros temporales se han borrado.

### Prueba de regresión

`tests/pdfFontsAcrossDocuments.test.tsx` genera dos informes en la misma ejecución y lee el PDF resultante. Verificada al revés: **quitando la corrección, la prueba falla**.

---

## 2. El barrido, rehecho con la resolución de divisa corregida

Astra tenía razón y el efecto era grande. Los 1.296 documentos que el barrido anterior daba por «sin precios del proveedor» eran, en su inmensa mayoría, un fallo propio de resolución de divisa.

Re-contrastados los **660 activos** que habían quedado sin verificar (1.320 documentos muestreados):

| | Barrido anterior | Ahora |
|---|---:|---:|
| Documentos verificados correctos | 0 de esos 1.320 | **1.277** |
| Sin verificar | 1.320 | **42** |
| «Sin precios del proveedor» | 1.296 | **3** (sin cotización para la fecha) |

Las 42 restantes, ya con causa dicha: 16 el proveedor publica una divisa no válida, 13 el documento no dice de qué listado viene, 10 sin EUR/divisa para la fecha, 3 sin cotización. Ninguna de ellas exige buscar otro proveedor sin mirarla antes una por una.

En ese re-contraste apareció **un solo error real**: HSBC (`GB0005405286`), el error de escala de peniques ya conocido, factor 100. El verificador lo sigue cazando.

---

## 3. Las 55 discrepancias: separadas en tres cosas distintas

Se han revisado los 41 activos con hallazgo, con más documentos por activo (163 en total) y contrastando también contra el **cierre sin ajustar** del proveedor, no solo contra el ajustado. El verificador tiene ahora un estado propio, `REVISAR_BASE_PRECIO`, para no mezclar una base de precio distinta con un error de divisa.

**a) Errores de divisa confirmados — los ya diagnosticados, ninguno nuevo.**

| Activo | Símbolo | Patrón |
|---|---|---|
| IE000M7V94E1 | NUKL.XETRA | cotiza en EUR y se divide otra vez por EUR/USD (factor 0,86) |
| IE00B5BMR087 | SXR8.XETRA | ídem |
| IE00B3YCGJ38 | P500.XETRA | ídem |
| IE000X59ZHE2 | AIFS.XETRA | ídem |
| IE0002PG6CA6 | VVMX.XETRA | ídem |
| IE000DR59CI3 | STOR.AS | cotiza en USD y se guarda sin convertir (factor 1,15) |
| GB0005405286 | HSBA.LSE | peniques tratados como libras (factor 100) |

**b) Base de precio, no divisa — la mayoría de la renta variable.** Factores pequeños, **mayores en las fechas antiguas y decrecientes hacia hoy**: eso es ajuste por dividendos, no divisa. Naturgy 1,208 en 2011 → 1,020 en 2026; Repsol 1,025 constante; Pernod 1,038; Enel 1,026; Iberdrola 1,020. En 16 activos el precio guardado **cuadra exactamente con el cierre sin ajustar** del proveedor, que es la confirmación directa. La hipótesis de los dividendos queda respaldada por los números, no solo enunciada.

**c) Dos casos que no son ni una cosa ni otra y hay que mirar aparte.**

- `US0320951017` (APH.US): factor **2,004 constante** desde 2002. Un desdoblamiento 2:1 sin aplicar. A diferencia de un ajuste por dividendos, un split no aplicado **sí** rompe la rentabilidad en la fecha del desdoblamiento.
- `ES0130670112` (ELE.MC, Endesa): factor 2,52 en 2011 y 2,41 en 2012. Compatible con el dividendo extraordinario de 2014, pero conviene confirmarlo antes de darlo por cerrado.

**Lo que esto cambia en el plan:** el inventario de reparación por divisa son **7 activos**, no 41. El resto es una cuestión distinta —qué base de precio queremos en la maestra, cierre o total return— que merece decisión propia y no debe mezclarse con la reparación de divisas.

**Lo que falta para cerrarlo:** comprobar, en los activos del grupo (b), si la serie guardada es homogénea o mezcla tramos con dos bases. Si el histórico está sin ajustar y el refresco diario añade puntos ajustados, aparece un salto artificial en la unión. Es la comprobación que decide si (b) es cosmético o afecta a las rentabilidades.

---

## Estado de las pruebas

| Suite | Contenedor | PC |
|---|---:|---:|
| Python | 399 pasan, 5 omitidas | 402 antes del último cambio del verificador |
| TypeScript | 728 pasan, 2 omitidas | **728 pasan, 2 omitidas** |
| `tsc --noEmit` | limpio | limpio |

## Ficheros tocados en esta tanda

```
src/reports/pdfTheme.ts                        (forgetPdfFontFamilies / refreshOaaPdfFonts)
src/reports/realPortfolioPdf.tsx
src/reports/comparePdf.tsx
src/reports/assetComparePdf.tsx
src/reports/weeklyReportPdf.tsx
src/reports/xrayPdf.tsx
src/reports/andbankPortfolioReportPdf.tsx
tests/pdfFontsAcrossDocuments.test.tsx         (nuevo)
scripts/verify_price_currency.py               (base de precio + --assets-file)
functions_python/tests/test_verify_price_currency.py
```
