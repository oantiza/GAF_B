# Inventario de informes y exportaciones

*Anexo de la auditoría del 13-11-2026: todos los documentos que genera el programa, sus diferencias de diseño y de formato, y las piezas comunes que pide una plantilla única. Rutas relativas a `3-BDB-ACTIVOS_app`.*

## A. Inventario

### A.1 Documentos PDF

| # | Nombre que ve el usuario | Fichero y función | Destinatario | Pantalla y botón | Tema y tipografía | Página | Secciones, en orden | Datos | Líneas | Portada / cabecera / pie | Asesor | Marca |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Informe de cliente.** Metadato «Informe de Cartera - cliente» | `src/reports/informeDeClientePdf.tsx` · `downloadInformeDeClientePdf` | Cliente | Cartera › Informes, «Descargar informe de cliente» con diálogo de cliente y responsable (`PortfolioReport.tsx:579`). También desde X-Ray (`XrayPage.tsx:364`) | Propio sobre `clientReportTheme` (no usa `papelDeCliente`). Fraunces 300/400/600 + Roboto Flex | A4 vertical. Hojas `wrap={false}` en posición absoluta: 50 arriba, 45 a los lados, 40 abajo | Portada · 02 Cartera (20 filas por hoja) y reparto · 03 Cifras y geografía · 04 Evolución simulada y mapa riesgo/rentabilidad · 05 Crisis y solapamiento (hasta 3 hojas) · 06 Guía · 07 Histórico ampliado (opcional) | `resolveHorizonMetrics` (lo mismo que la pantalla). Recalcula exposición, geografía, importes por posición y la frase de riesgo de la referencia | 1.799 | Portada: sello, «Confidencial», «Informe personalizado», periodo, valoración, fecha, perfil y «Elaborado por». Cabecera: «NN · ANTETÍTULO», título y sello. Pie: cliente · «Rentabilidades pasadas…» · «P. n» | Nombre y correo, sin logotipo; por defecto «Oscar Antiza Algar» | «Independent Private Bankers» (l.289) en portada, cabecera y `author`. Familias de fuente llamadas «OAA …» |
| 2 | **Informe interno del asesor.** Título «Informe completo de cartera» | `internalPortfolioReportPdf.tsx` · `downloadInternalPortfolioReportPdf` | Interno | Informes, «Descargar informe interno», con la opción «anexo de fichas» (`PortfolioReport.tsx:606`). Oculto en Modo cliente | `PDF_FONT` y una paleta propia escrita a mano (l.96-113). Solo Instrument Sans | A4 vertical; hojas 2, 9 y 10 apaisadas. 66 / 54 / 42 | Portada con índice · 1 Resumen · 2 Posiciones · 3 Composición · 4 Subyacentes y solapamiento · 5 Rentabilidad · 6.1-6.2 Riesgo · 7 Correlaciones · 8.1 Frontera · 8.2 Mejora · 9 Costes · 10 Calidad · 11 Metodología · A Anexo | `buildInternalReportModel`. Recalcula el cono, las caídas, las regiones, el VaR en € y el mejor y peor año | 2.273 | Portada propia, con el pie copiado a mano. Cabecera: sello · «Uso interno del asesor» · sección. Pie: cartera · fecha · «Documento interno · no entregar al cliente» · «Página X de Y» | No | Sello en banda, portada y `author` (l.374, 915, 2223) |
| 3 | **Comparativa de carteras** | `comparePdf.tsx` · `downloadComparisonPdf` | Cliente | Informes, «Descargar comparativa» (`DialogoDeComparativa.tsx`). Comparar carteras, «Descargar informe PDF» (`PortfolioComparator.tsx:182`) | Copia local de los estilos de `papelDeCliente`. Fraunces + Roboto | A4. 46 / 57 / 45 | Portada · 01 Evolución · 02 Riesgo · 03 Composición · 04 Posiciones · 05 Método y anexo | Series del servidor; las métricas se recalculan con `comparisonMetrics`, la misma función que la pantalla | 570 | Portada: sello · «Confidencial» · «Informe personalizado» · cliente y elaborado por, si llegan. Cabecera: sección y sello. Pie: «Comparativa de carteras · Confidencial · Página x de y» | Nombre y correo, si llegan | Sello (l.227, 458, 460) |
| 4 | **Comparativa de activos**, en salida «cliente» o «interno» | `assetComparePdf.tsx` · `downloadAssetComparisonPdf` | Cliente o interno | Comparar activos, «Descargar informe PDF» y elección de la salida (`AssetComparison.tsx:724`) | `pdfTheme` con banda oscura. Newsreader + Instrument Sans | A4. 52 / 46 / 44 | Activos · Rentabilidad · Riesgo · Base 100 · Correlación · Aviso | Lo de la pantalla, sin gráficos | 600 | Sin portada. Banda «INDEPENDENT PRIVATE BANKERS» · «Comparativa de activos [· uso interno]». Pie: sello · tipo · fecha larga · «Página x de y» | No | Sello en banda, pie, aviso y `author` |
| 5 | **Informe de costes (Diseño).** Título «El coste de su cartera» | `costsPdf.tsx` · `downloadCostsPdf` | Cliente | Modal de costes, «Descargar informe de costes» (`CostsModal.tsx:433`). Informes, «Descargar informe de costes» | `papelDeCliente` | A4. 46 / 57 / 45 | Portada con cifras y composición del coste · Desglose (12 filas por hoja) · Guía de lectura | `calculatePortfolioCosts` (lo mismo que la pantalla) | 267 | Portada de `papelDeCliente`. Pie: «Independent Private Bankers · Informe de costes · estimación anual · Confidencial · Página x de y» | Nombre y correo, si llegan | Sello |
| 6 | **Ficha de activo**, normal o en Modo cliente | `fichaDeActivoPdf.tsx` · `downloadFichaDeActivoPdf` | Interno o cliente | Ficha, «Descargar ficha PDF» (`FichaDeActivo.tsx:275`) | `pdfTheme` con banda de 26 pt | A4. 50 / 58 / 44, dos columnas | Cabecera de identidad · tira de aptitudes (interno) · secciones en pares · secciones anchas · evolución · aviso legal | El mismo `FichaInstrumento` que la pantalla | 549 | Banda: sello · «Ficha de activo [· uso interno]». Pie: nombre e ISIN · «Generado el … · base de datos del … · para el cliente / modo interno» · «Página x de y» | No | Sello en banda, aviso y `author` |
| 7 | **Propuesta de mejora** | `improvementProposalPdf.tsx` · `downloadImprovementProposalPdf` | Interno | Mejorar cartera, «Exportar propuesta (PDF)» (`PortfolioImprovementPanel.tsx:504`). Informes, «Descargar propuesta de mejora» | Híbrida: Newsreader + Instrument con colores escritos a mano, entre ellos el caqui del papel de cliente y el fondo `#FFFEFC` | A4. 42 / 55 / 42 | Hoja 1: resumen, sustituciones, antes y después, validación. Hoja 2: equivalencia, descartes, método | Respuesta del servidor | 246 | Sin portada ni cabecera. Pie: «Propuesta de mejora de cartera · uso interno del asesor · …» · «Página x de y» | No | Ninguna (ni `author`) |
| 8 | **Propuesta de cambio** | `propuestaDeCambioPdf.tsx` · `downloadPropuestaDeCambioPdf` | Cliente | Informes, «Descargar propuesta» (`DialogoDePropuesta.tsx:193`) | `papelDeCliente` | A4. 46 / 57 / 45 | Portada con las dos composiciones y qué cambia · Rentabilidad, riesgo, crisis y coste · Motivo y plan | `core/propuestaDeCambio` | 317 | Portada de `papelDeCliente`; cabecera y pie suyos («Página x de y») | «Elaborado por» | Sello |
| 9 | **Rendimiento de cartera real** | `realPortfolioPdf.tsx` · `downloadRealPortfolioPdf` | Interno | Gestor › «Análisis rápido de extractos», «Descargar PDF» (`RealPortfolioPage.tsx:649`) | `COLORES_DEL_PAPEL`. Newsreader 700 + Instrument | A4. 34 / 30 / 34. Hojas fijadas por un plan propio | Resumen · Comparativa · Atribución · Actividad · Metodología | Respuesta del servidor, igual que la pantalla | 1.074 | Sin portada. Cabecera: «INDEPENDENT PRIVATE BANKERS / USO INTERNO» · título · sección · fecha. Pie: «Documento de análisis interno…» · **«x / y»** | No | Sello (l.206, 800) |
| 10 | **Seguimiento periódico** | `seguimientoPeriodicoPdf.tsx` · `downloadSeguimientoPeriodicoPdf` | Cliente | Informes, «Descargar seguimiento» (`DialogoDeSeguimiento.tsx:74`) | `papelDeCliente` | A4. 46 / 57 / 45 | Portada con patrimonio y rentabilidad · Frente a sus referencias · Qué no se ha medido · Cómo se lee | `core/seguimientoPeriodico` | 104 | Portada de `papelDeCliente`; «Página x de y» | «Elaborado por» | Sello |
| 11 | **Informe semanal o diario de estrategia** | `weeklyReportPdf.tsx` · `downloadWeeklyReportPdf` | Interno o cliente: se comparte, y en Modo cliente oculta el proveedor | Estrategia, «Descargar PDF» (`StrategyPage.tsx:511`) | `pdfTheme` con banda de 30 pt | A4. 52 / 46 / 44 | Titular · Resumen · Indicadores · Eventos · Asignación · RV por región · Informe completo · Fuentes · Aviso | Informe del servidor | 250 | Banda: sello · «Estrategia». Pie: «Independent Private Bankers · Estrategia · Página x de y» | No | Sello en banda, pie, aviso y `author` |
| 12 | **Su ingreso en la jubilación** | `jubilacionPdf.tsx` · `downloadJubilacionPdf` | Cliente | Planificación › Jubilación, «Informe para el cliente» y luego «Descargar informe» | `papelDeCliente` | A4. 46 / 57 / 45 | Portada con la respuesta y los escenarios · El plan año a año · El cobro (opcional) · Anexo de las cuentas · Anexo del método | `core/jubilacion/lectura` (lo mismo que la pantalla) | 507 | Portada de `papelDeCliente`. Pie: sello · «Simulación de jubilación» · «Página x de y» | «Elaborado por» | Sello |
| 13 | **Informe del cliente (Gestor).** Documento «Informe de su cartera» | `gestor/informes` · `descargarInformePdf("cliente")` | Cliente | Gestor de carteras › Informes, «Generar el PDF» (`DialogoDeInformes.tsx:32`) | Piezas propias (`papel/cliente.tsx`) con los estilos de `papelDeCliente` | A4. 46 / 57 / 45, cabecera fija a 22 | Portada · Vistazo · Resultado · Composición · Referencia · Riesgo · Movimientos (40) · Notas | `Analisis` del motor, lo mismo que la pantalla | unas 1.000 con las secciones | Portada con logotipo, «Confidencial», documento, cartera, cliente, periodo, «Datos a…» y «Elaborado por». Cabecera desde la hoja 2. Pie: firma · documento · «Confidencial» · «Página x de y» | Nombre, entidad, contacto y logotipo, guardados en ajustes | **Ninguna**, a propósito |
| 14 | **Informe de costes (Gestor)** | Lo mismo, con `"costes"` | Cliente | Lo mismo | Lo mismo | Lo mismo | Portada · Resumen · Servicio · Operaciones · Productos · Impuestos · Método | `Analisis` | unas 330 | Lo mismo | Lo mismo | Ninguna |
| 15 | **Informe del asesor (Gestor)** | Lo mismo, con `"asesor"` | Interno | Lo mismo | `papel/asesor.tsx` sobre `PDF_COLORS`. Newsreader + Instrument | A4 vertical o apaisado. 58 / 50 / 40 | Resumen · Avisos · Conciliación · Posiciones (apaisada) · Bonos · Rentabilidad · Ingresos y costes · Cerradas · Composición · Movimientos (apaisada) | `Analisis` | unas 900 | Sin portada. Banda: «Informe del asesor» · cartera · «uso interno…» · periodo. Pie: «Generado el … · datos a …» · «Página x de y» | Fila «Asesor» en el resumen | Ninguna |

### A.2 Exportaciones de datos y otras salidas

| # | Nombre | Fichero | Formato | Destinatario | Desde dónde | Nombre del fichero | Notas |
|---|---|---|---|---|---|---|---|
| 16 | **Datos en Excel (Gestor)** | `gestor/informes/excel/libro.ts` · `crearLibroExcel` | XLSX (SheetJS), 9 hojas | Interno | Gestor › Informes, «Generar el Excel» | `Datos - <cartera> - <desde> a <hasta>.xlsx` | Cifras como número con formato de celda. Lo que falta, como celda vacía |
| 17 | **Exportar a CSV** (la cartera en diseño) | `components/PortfolioBuilder.tsx:741` · `exportCsv` | CSV | Interno | Diseño de cartera, menú «Exportar a CSV» | `cartera.csv` | Separador `,`, decimal `.`, sin BOM |
| 18 | **Resumen de fondos y cesión** | `PositionsWorkbench.tsx:651` y `positionsShared.downloadCsv` | CSV | Interno | Posiciones / Extracto externo | `resumen_fondos_cesion.csv` | Separador `;`, decimal `,`, con BOM |
| 19 | **Posiciones globales** | `core/globalPositionsXlsx.ts` | XLSX | Interno; en Modo cliente, sin retrocesiones | Posiciones globales, exportar a Excel | (en `PositionsWorkbench`) | «N/D» como texto en columnas numéricas; formato `#,##0.00 "€"` |
| 20 | **Retrocesiones** | `core/commercialRetroXlsx.ts` y `AdminRetrocessions.tsx` | XLSX y CSV | Administración | Admin › Retrocesiones | `retrocesiones.xlsx`, `retrocesiones_plantilla.xlsx`, `commercial_retro.csv` | Fichero de trabajo, no informe |
| 21 | **Pasada en seco de retrocesiones** | `AdminRetrocessions.tsx:859` | CSV | Administración | «Descargar pasada en seco» | `retrocesiones_pasada_en_seco.csv` | |
| 22 | **Plantilla de movimientos** | `gestor/ui/importar/plantilla.ts` | CSV y XLSX | Interno | Importar › Documentos | `plantilla-de-movimientos.csv` / `.xlsx` | Entrada de datos, no informe |
| 23 | **Cartera del Gestor** (guardar) | `gestor/almacen/descarga.ts` | JSON | Interno | Gestor, guardar | `nombreDeFichero(cartera)` | Datos del usuario, no informe |
| 24 | **Impresión de pantalla** (Ctrl+P) | `styles/impresion.css` (176 líneas) | Impresión del navegador | Cualquiera | Ficha, Buscador, Mercado | — | Una columna, sin menú ni botones. No toca los PDF |
| 25 | **Comparativa de activos, salida interna** | La misma de la fila 4 | PDF | Interno | Lo mismo | `uso-interno-comparativa-activos-….pdf` | Va aparte porque cambian el pie y la columna «Retro» |

**Recuento:** 15 documentos PDF, contando la comparativa de activos y la ficha una vez cada una aunque tengan dos salidas; 9 exportaciones de datos (filas 16 a 23 y 25); y la hoja de impresión. **25 entradas.**

## B. Diferencias de diseño entre informes

Las cifras van en puntos. «Cliente» es `papelDeCliente.tsx` y lo comparten costes (Diseño), propuesta de cambio, seguimiento y jubilación.

### B.1 Página, márgenes, títulos y cuerpo

| | Márgenes (arriba / abajo / lados) | Título de hoja | Título de sección | Cuerpo | Notas |
|---|---|---|---|---|---|
| Cliente (`papelDeCliente`) | 46 / 57 / 45 | Fraunces 24 | Fraunces 14,5 | Roboto 9,3 / 1,5 | Portada 34 en Fraunces 300 |
| Comparativa de carteras | 46 / 57 / 45 (copia) | 24 | 14,5 | 9,3 | **Portada 45** |
| Informe de cliente | 50 / 40 / 45 (absoluto) | **19,5** | 12,5 | 9,3 / 1,45 | Portada 45 en Fraunces 300; número de la guía a 22, fuera de escala |
| Gestor, cliente y costes | 46 / 57 / 45, cabecera a 22 | Fraunces **17** con filete caqui de 36 | 11,5 | **8,8** | Portada 30 |
| Jubilación | 46 / 57 / 45 | 24 | 14,5 | 9,3 | Cifra respuesta a 50 |
| Informe interno | **66 / 54 / 42** | Instrument **20** en acero | h2 11 | 9 / 1,5 | **Sin serifa** en todo el documento |
| Rendimiento real | **34 / 30 / 34** | Newsreader 24 / 700 | 13 / 700 | 8,5 / 1,35 | |
| Comparativa de activos y estrategia | 52 / 46 / 44 | Newsreader 20 | Instrument 12 / 600 en acero | 9,5 / 1,4 | |
| Ficha | 50 / 58 / 44, dos columnas de 241,5 | Newsreader 21 | Newsreader 12 / 600 | 8,2 / 8,5 | Cifras en Newsreader, que tiene cifras tabulares |
| Propuesta de mejora | 42 / 55 / 42 | Newsreader **30** | Newsreader **18** | **10** | Fondo `#FFFEFC` |
| Gestor, asesor | 58 / 50 / 40 | Newsreader 15 / 600 en acero, filete | h3 9 / 600 | 8,4 | |

### B.2 Colores

| | Fondo | Tinta | Acento | Positivo / negativo |
|---|---|---|---|---|
| Cliente | `#FFFFFF`: **no es crema**, aunque `AGENTS.md` lo llame «papel crema» (`clientReportTheme.ts:6`) | `#201E1B` / `#6B6459` | Granate `#A81E33` y caqui `#9C8459` | No colorea el signo |
| Informe de cliente | `#FFFFFF` | Lo mismo | Granate y caqui, más tonos escritos a mano: `#D13B31`, `#5368E8`, `#31455A`, grises azulados `#E4E9EF`/`#F7F9FB` | Rojo `#D13B31` en volatilidad y caída |
| Gestor, cliente | `#FFFFFF` | Lo mismo | Cartera en granate, comparación en acero | **Oliva `#5E6B57` / granate `#A81E33`** (`papel/cliente.tsx:34-35`) |
| `pdfTheme` (activos, estrategia, ficha, Gestor asesor) | `#FFFFFF`, banda `#20272E` | `#1E252B` / `#64727C` | **Acero `#3F6B82`, cobre `#B66A3C`** | Gestor asesor: `#1F6F4A` / `#B23A2E` |
| Informe interno | `#FFFFFF` | `#182632` / `#55636F` | **Acero `#143D66`, cobre `#B9862F`**: otro acero y otro cobre, escritos a mano | `#1F6F4A` / `#B23A2E` |
| Rendimiento real | `#FFFFFF` | `#0F1720` / `#55636F` | `#143D66` / `#B9862F` (`COLORES_DEL_PAPEL`) | Ninguno |
| Propuesta de mejora | `#FFFEFC` | `#243747` | Cabecera de tabla `#173D61`, caqui `#9C8459`, filetes `#DCD3C4` (los del cliente) | `#1F6F4A` / `#B23A2E` |

### B.3 Cabecera, pie y portada

| | Cabecera | Pie | Numeración | Portada |
|---|---|---|---|---|
| Cliente | Antetítulo, sello y título, fija | Sello · documento · «Confidencial» | «Página x de y» | Sí |
| Comparativa de carteras | Igual (copia) | «Comparativa de carteras · Confidencial» | «Página x de y» | Sí |
| Informe de cliente | «NN · ANTETÍTULO», título y sello | Cliente · aviso de rentabilidades | **«P. n»**, contada a mano | Sí |
| Gestor, cliente y costes | Documento · cartera · periodo, desde la hoja 2 | Firma · documento · «Confidencial» | «Página x de y» | Sí, con logotipo |
| Informe interno | Sello · uso interno · sección | Cartera · fecha · «no entregar al cliente» | «Página X de Y» | Sí, con índice enlazado |
| Rendimiento real | Sello y uso interno · título · sección · fecha | «Documento de análisis interno…» | **«x / y»**, números fijos | No |
| Activos y estrategia | Banda oscura de 30 con el sello en cobre | Sello · tipo · fecha | «Página x de y» | No |
| Ficha | Banda oscura de 26 | Nombre e ISIN · procedencia | «Página x de y» | No |
| Propuesta de mejora | Ninguna | Texto de uso interno | «Página x de y» | No |
| Gestor, asesor | Línea fina, sin fondo | «Generado el … · datos a …» | «Página x de y» | No; el resumen hace de portada |

### B.4 Tablas

| | Cabecera | Filetes | ¿Se repite la cabecera? | Fila de total | Cifras |
|---|---|---|---|---|---|
| Cliente (`Tabla`) | Caqui 6,3 en versalitas, filete 0,65 | 0,5 | **No** (`wrap={false}`, sin `fixed`) | Filete arriba, peso 500 | A la derecha, proporcionales |
| Gestor, cliente | Igual que el cliente | Igual | **Sí** (`fixed`) | Igual | Igual |
| Informe de cliente | Caqui 6,3 | 0,65 / 0,55 | No (paginada a mano, 20 filas) | «Total cartera» en Fraunces 10,5 granate | Proporcionales |
| Comparativa de carteras | Copia de la del cliente | Igual | No (paginada por alto estimado) | No | |
| Informe interno y Gestor asesor | Sin fondo, filete 0,75 en acero | 0,5 | **Sí** | Filete 0,75 arriba; las últimas filas van juntas con el total | Proporcionales |
| Activos, estrategia y propuesta de mejora | **Fondo oscuro con letra blanca** | 0,5 | No | No | |
| Rendimiento real | Filete 1 en `#143D66` | 1 | No (paginado a mano) | No | |
| Ficha | Filete 0,6 | 0,4 | **No** | No | **Tabulares** (Newsreader) |

### B.5 Gráficos

Todos se dibujan con las primitivas SVG de `@react-pdf`; ninguno es una imagen.

| Tipo de gráfico | Implementaciones | Dónde |
|---|---|---|
| Líneas | 7 distintas | `HistoryChart` (comparativa de carteras), `LineChart` (interno), `PerformanceChart` (rendimiento real), la curva del informe de cliente, `Evolucion` (ficha), `GraficoDeLineas` (Gestor), saldos de jubilación |
| Barras | Varias | Barras hechas con `View` en la comparativa, el informe de cliente y la ficha; barras apiladas en SVG en jubilación |
| Mapa del mundo | 2 | Informe de cliente e interno |
| Matriz de correlación o solapamiento | 2 | Interno e informe de cliente |
| Dispersión riesgo / rentabilidad | 3 | Comparativa de carteras, informe de cliente e interno |

- **Marcas del eje:** el algoritmo 1-2-2,5-5 está dos veces, en `fichaDeActivoPdf.marcasDelEje` y en `gestor/papel/graficos.cortesDelEje`.
- **Sin gráficos:** comparativa de activos (a propósito), estrategia, costes, propuesta de cambio y seguimiento.

### B.6 Avisos legales, fecha de generación y periodo

**Aviso «rentabilidades pasadas…»:** lo llevan todos, con al menos 6 redacciones distintas.

**Fecha de generación.** Faltan dos documentos y los demás la escriben de seis maneras:

| Documento | Cómo escribe la fecha |
|---|---|
| Rendimiento real | No la lleva |
| Propuesta de cambio | No la lleva; solo «Fecha de emisión» |
| Comparativa de carteras | «13/11/2026» |
| Comparativa de activos y estrategia | «viernes, 13 de noviembre de 2026», con el día de la semana |
| Costes, propuesta de mejora, interno, jubilación y Gestor | «13 de noviembre de 2026» |
| Ficha | «13 nov 2026, 21:52» |

**Periodo:**

| Formato del periodo | Documentos |
|---|---|
| «dd/mm/aaaa - dd/mm/aaaa» | Informe de cliente |
| «dd/mm/aaaa – dd/mm/aaaa» | Interno y cabeceras del Gestor |
| «dd/mm/aaaa a dd/mm/aaaa» | Rendimiento real |
| «Del 1 de enero de 2026 al 13 de noviembre de 2026» | Portada del Gestor |
| «3 años · métricas aproximadas» | Comparativa de carteras |

## C. Formato y vocabulario

### C.1 Funciones de formato

| Función | Fichero | Ejemplo de salida | La usan |
|---|---|---|---|
| `fmtPct` | `core/format.ts:18` | 0,123 → «12,30 %», con **espacio normal** antes del %; nulo → «N/D» | Casi todos |
| `fmtNum` | `core/format.ts:40` | 1234,5 → «**1234,50**», sin separador de miles por debajo de 10.000; negativo con «−» | Casi todos |
| `fmtEur` | `core/format.ts:77` | 1234,5 → «1.235 €», con espacio duro y miles siempre | Casi todos |
| `fmtDate` | `core/format.ts:122` | «13/11/2026» | Interno, comparativa de carteras, Gestor |
| `fmtDateLong` | `core/format.ts:138` | «**viernes, 13 de noviembre de 2026**» | Comparativa de activos, estrategia |
| `fmtDayShort` | `core/format.ts:185` | «13 nov 2026» | Comparativa de activos, ficha, propuesta de mejora, ejes de la comparativa de carteras |
| `pct`, `pctSigned`, `ratio`, `eur`, `pp`, `longDate`, `shortDate`, `mesLegible` | `internalPortfolioReportPdf.tsx:202-312` | «+12,3 %», «+1,2 p.p.», «13 de noviembre de 2026», «nov 26», «abr 2026» | Interno |
| `fmtPercentDecimal`, `fmtPercentValue`, `fmtNumber`, `fmtEuro` y un `fmtDate` propio | `informeDeClientePdf.tsx` (l.223 y siguientes) | «12,3 %», «1.234,50», «1.235 €», fecha en UTC | Informe de cliente |
| `signed`, `pp` | `comparePdf.tsx:94-96` | «+1,2 pp», con espacio normal | Comparativa de carteras |
| `signed` | `improvementProposalPdf.tsx:77` | «+0,43 pp» | Propuesta de mejora |
| `euros`, `porcentaje` | `costsPdf.tsx:31-32` | «< 1 €», «Falta el dato» | Costes (Diseño) |
| `formatMetric`, `formatEurValue`, `formatDate` | `realPortfolioPdf.tsx:211-223` | € sin decimales, «12,30 %»; la fecha sale en ISO crudo si no se puede leer | Rendimiento real |
| `conSigno` y eje compacto | `jubilacionPdf.tsx:137, 247` | «−1.235 €», «**−0 €**», «1,5 mil €» | Jubilación |
| `importe`, `importeConSigno`, `porcentaje`, `puntos`, `numero`, `titulos`, `precio`, `fechaLarga`, `fechaCorta` | `gestor/informes/formato.ts` | «+1.234,00 €» (2 decimales), «+1,23 p.p.» o «+1,23 puntos», «No disponible», «13 de noviembre de 2026» | Gestor |
| `ejeEnEuros`, `ejeEnBase100` | `gestor/informes/papel/graficos.tsx:130-132` | «150 mil €» | Gestor |
| `mesCorto`, `momentoDeGeneracion` | `fichaDeActivoPdf.tsx:88, 360` | «nov 26», «13 nov 2026, 21:52» | Ficha |
| `MESES_CORTOS` | `gestor/informes/formato.ts:156` | «**Ene**», «Feb»…, con mayúscula | Gestor |

Encima de `core/format.ts` hay **9 juegos de envoltorios locales**. Difieren en cinco cosas:

**1. Decimales de los importes.** Los informes de cartera escriben euros enteros; el Gestor escribe dos decimales, «1.234,56 €». El rendimiento real mezcla los dos en la misma hoja: patrimonio en la caja frente a la reconciliación.

**2. Espacio antes de la unidad.** `fmtEur` pone un espacio duro. `fmtPct`, `pp` y `puntos` ponen un espacio normal, y la unidad puede pasar a la línea siguiente. `costsPdf.tsx:204` lo arregla a mano: `.replace(/ %/g, " %")`.

**3. Signo «+».** Lo pone cada informe por su cuenta, con 5 reglas distintas para el cero.

**4. Fechas.** Hay 7 formatos:
- «13/11/2026»;
- «13 nov 2026»;
- «13 de noviembre de 2026»;
- «viernes, 13 de noviembre de 2026»;
- «nov 26», «sept 26» o «Sep», en los ejes;
- «abr 2026»;
- la fecha ISO en crudo.

**5. Lo que falta.** Hay 8 formas de escribirlo:

| Texto | Dónde |
|---|---|
| «N/D» | `core/format` y casi todos los papeles internos |
| «Falta el dato» y «No aplica» | `textoDeAusencia`, en costes, comparativa e informe de cliente |
| «No disponible» | Gestor |
| «—» | Gestor asesor `rentabilidad.tsx:30`; Gestor cliente `movimientos.tsx:35` |
| «» (vacío) | Meses de la tabla del Gestor; Excel |
| «Sin datos.» | Interno y Gestor asesor `composicion.tsx:25` |
| «No declarado» y «Pendiente» | Interno |
| «N/D» como texto | Celdas numéricas del Excel de posiciones globales |

### C.2 El mismo concepto con nombres distintos

| Concepto | Cómo se escribe en cada sitio |
|---|---|
| Máxima caída | «Caída máxima» (pantalla de Comparar carteras), «Máxima caída del periodo» (comparativa de carteras), «Máx. caída» (activos), «Máxima caída» (propuesta de mejora y Gestor asesor), «Mayor caída» (Gestor cliente), «caída desde máximos» (interno) |
| Diferencia en puntos | « pp» (comparativa), « p.p.» (interno y Gestor asesor), «puntos» (Gestor cliente y frases de la comparativa), «pp» (propuesta de mejora). El Excel la guarda como porcentaje |
| Coste del fondo | «Coste corriente» (costes, comparativa, propuesta), «Corriente» (columna de costes), «Gastos corrientes» (Gestor), «TER» (código de la propuesta de mejora) |
| Comparador | «Benchmark» (comparativa de activos), «referencia» (todos los demás), «Cartera de referencia» (interno) |
| Rentabilidad anual | «Rentabilidad anualizada», «Rentabilidad por año» (Gestor cliente), «Rentabilidad (TWR), anual» (Gestor asesor), «Por año» |
| Volatilidad | «Volatilidad anual», «Volatilidad anualizada», «Volatilidad», «Vol 3A» |
| Documento para el cliente | «Informe de Cartera» (con mayúscula), «Informe de su cartera» (Gestor), «Informe del cliente» (fichero del Gestor), «Informe de cliente» (botón) |
| Documento de costes | «El coste de su cartera · Informe de costes · estimación anual» (Diseño) frente a «Informe de costes» (Gestor, a posteriori): dos documentos distintos con el mismo nombre |

## E. Propuesta de piezas comunes

Una plantilla en `src/reports/plantilla/` con dos variantes de color, **cliente** e **interna**, que cambien solo las fichas de color y el texto de uso del pie. La estructura, la escala de letra, los formatos y el vocabulario son los mismos.

| Pieza | Qué debe hacer | La mejor base actual |
|---|---|---|
| **Documento** | `language="es"`, título, autor igual al asesor, `creator`, registro de fuentes y descarga con nombre saneado | `gestor/informes/documento.tsx` (metadatos completos) y `gestor/informes/nombres.ts` y `index.ts` (nombre y descarga a 60 s) |
| **Registro de secciones** | Secciones con `procede`, `comienzo`, `apaisada` y `juntoAlTitulo`; no deja títulos ni hojas vacías | `gestor/informes/registro.ts` y `hojas.ts`: es la única arquitectura que ya separa contenido y maqueta. Se recomienda para todos |
| **Página** | A4 vertical o apaisada, una sola escala de márgenes (46 / 57 / 45) y sin interlineado en la página | `papelDeCliente.estilos.page` |
| **Portada** | Tipo de documento, título, cliente, periodo, «Datos a…», generado, firma del asesor con logotipo y frase de presentación, **sin sello de entidad** | `gestor/informes/secciones/cliente/portada.tsx` (`crearPortada`) |
| **Cabecera** | Documento · cartera · periodo, desde la hoja 2 | `gestor/informes/papel/cliente.tsx` (`HojaDelCliente`, cabecera con `render`) |
| **Pie** | Firma · documento · «Confidencial» o «Uso interno, no entregar al cliente» · «Página x de y» con `render` | `papelDeCliente.PieDeHoja` y `HojaDelAsesor` (el texto de uso interno) |
| **Título de sección** | `wrap={false}` y `minPresenceAhead`, con marcador del PDF y número de página para el índice | `TituloDelCliente` y `SectionHead` del interno (marcadores e índice con páginas medidas) |
| **Texto** | Una sola cadena por `Text`, saneado siempre (`textoAjeno` o `safeText` según la familia) y sin guiones de sílaba | `papelDeCliente.T` junto con `textoAjeno` / `textoAjenoEnSerifa` |
| **Tabla** | Cabecera `fixed`, filas `wrap={false}`, cola pegada al total, alineación por columna y sub-línea | `gestor/informes/papel/asesor.tsx` (`TablaDelAsesor`), con el estilo de filetes de `papelDeCliente.Tabla` |
| **Fila de total** | Filete arriba, peso 500 y nota de redondeo cuando la suma de redondeados puede no cuadrar | `TablaDelAsesor` (`total`) y la nota de `costsPdf.tsx:233` |
| **Cifra destacada** | Rótulo, cifra, detalle y frase; la ausencia a tamaño menor | `gestor/informes/papel/cliente.tsx` (`Cifras`) y `costsPdf.Cifra` (`valorFalta`) |
| **Rejilla de datos (interna)** | Rótulo, valor y motivo cuando no hay valor | `HojaDelAsesor.Rejilla` |
| **Gráfico de líneas** | Cortes redondos, aclarado de puntos, huecos que parten la línea, comparación discontinua y leyenda con el trazo | `gestor/informes/papel/graficos.tsx` (`GraficoDeLineas`), más los huecos de `fichaDeActivoPdf.Evolucion` y la leyenda de trazo de `jubilacionPdf` |
| **Barras** | Barra horizontal con su cifra escrita y pista clara | Las barras de `fichaDeActivoPdf.Fila` (con `peso`) |
| **Tarta o reparto** | Hoy no hay ninguna tarta: los repartos van en tabla o barras. Se recomienda no añadirla y usar barras con la cifra | — |
| **Matriz** | Rampa de 7 pasos y la cifra siempre impresa | `CLIENT_REPORT_OVERLAP_RAMP` y la matriz con `nombreEnLineas` del informe de cliente |
| **Mapa de riesgo y rentabilidad** | Puntos con etiqueta directa y no solo color | `RiskMap` de `comparePdf`, con etiqueta |
| **Aviso o nota** | Filete izquierdo de 1,5 y cuerpo de nota | `papelDeCliente.estilos.note` y `gestor Nota` |
| **Nota legal** | Un único texto por tipo de documento, en un sitio | Hoy hay al menos 6 versiones. Se recomienda una constante `AVISO_LEGAL` por destinatario |
| **Formato** | Importe, porcentaje y puntos con espacio duro; número con miles; fecha corta «13/11/2026» y larga «13 de noviembre de 2026»; mes de eje; sin signo en cero; ausencia | `gestor/informes/formato.ts` (`sinSignoEnCero`, `puntos`, `fechaLarga`, `NO_DISPONIBLE` cambiado por `textoDeAusencia`), corrigiendo el espacio de `fmtPct` |
| **Glifos** | Una sola tabla de lo que imprime cada familia | `papelDeCliente.LO_QUE_IMPRIMEN_LAS_DOS` y `pdfTheme.safeText` |
| **Fichas de color** | Dos juegos, cliente e interno, con tinta, tinta 2, filete, acento, serie 1, serie 2, positivo, negativo, aviso y fondo de aviso; un solo acero y un solo cobre | `CLIENT_REPORT_PALETTE` para cliente; para el interno, decidir entre `PDF_COLORS` y `COLORES_DEL_PAPEL` |
| **Exportación de datos** | CSV con BOM, `;` y decimal `,`; Excel con celdas numéricas, vacío donde falta y formato con unidad | `positionsShared.csvCell` y `downloadCsv`; `gestor/informes/excel/` (`celdas.ts` y `libro.ts`) |

**Decisiones que necesita Óscar antes de unificar:**

1. ¿Se quita el sello «Independent Private Bankers» de todos los informes y firma el asesor, como en el Gestor?
2. ¿Una o dos parejas de tipografía? Recomendación: una sola, Fraunces + Roboto Flex, que cubre más alfabetos, con las dos variantes solo de color. Hoy el papel interno no tiene ni griego ni cirílico.
3. ¿Fondo crema de verdad para el cliente, o blanco, como hoy? El código dice crema y pinta `#FFFFFF`.
4. ¿Euros con decimales o enteros? Recomendación: enteros en patrimonio y estimaciones, y dos decimales en movimientos y costes a posteriori, decidido por tipo de cifra y no por informe.
