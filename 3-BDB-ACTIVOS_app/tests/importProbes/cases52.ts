// Copiado de scratchpad/informe1016/review5_fe/probe (cases52.ts) para la batería de
// aceptación de la sexta pasada (las 239 sondas con el juez estricto).
// Revisión de la tercera pasada: extractos sintéticos NUEVOS (ISIN inventados,
// salvo IE00B4L5Y983, público y ya usado en la app como ejemplo).
export const c: Record<string, string> = {};
// R1 · contravalor en USD junto a contravalor en EUR
c.R1a = "Producto;ISIN;Divisa;Contravalor USD;Contravalor EUR\nA;LU1234567891;EUR;93000;80000\nB;IE0098765432;USD;8736;7512,09";
// R1b · solo contravalor en USD y valor de mercado
c.R1b = "Producto;ISIN;Divisa;Valor de mercado;Contravalor USD\nA;LU1234567891;EUR;80000;93000\nB;IE0098765432;USD;8736;8736";
// R1c · contravalor en blanco para una posición en USD (respaldo = valor de mercado en USD)
c.R1c = "Producto;ISIN;Divisa;Valor de mercado;Contravalor EUR\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;";
// R1d · «Contravalor divisa» y «Contravalor EUR»
c.R1d = "Producto;ISIN;Divisa;Contravalor divisa;Contravalor EUR\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;7512,09";
// R1e · «Valor de mercado USD» y «Valor de mercado EUR»
c.R1e = "Producto;ISIN;Valor de mercado USD;Valor de mercado EUR\nA;LU1234567891;93000;80000\nB;IE0098765432;8736;7512,09";
// R2 · «Importe» sin divisa junto a «Valor de mercado EUR»
c.R2a = "Producto;ISIN;Divisa;Importe;Valor de mercado EUR\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;7512,09";
// R2b · «Importe» (EUR) y «Valor de mercado» (divisa de la posición) con Divisa USD
c.R2b = "Producto;ISIN;Divisa;Valor de mercado;Importe\nA;LU1234567891;EUR;80000;80000\nB;IE0098765432;USD;8736;7512,09";
// R3 · columnas en inglés
c.R3a = "Security;ISIN;Quantity;Price;Market value;Market value EUR\nFund A;LU1234567891;100;800;80000;80000\nETF B;IE00B4L5Y983;50;174,72;8736;7512,09";
c.R3b = "Security,ISIN,Currency,Quantity,Price,Market value EUR\nFund A,LU1234567891,EUR,100,800.00,80000.00\nETF B,IE00B4L5Y983,USD,50,174.72,7512.09";
c.R3c = 'Security,ISIN,Currency,Quantity,Price,Market value EUR\n"Fund A",LU1234567891,EUR,"1,000","80.00","80,000.00"\n"ETF B",IE00B4L5Y983,USD,50,"174.72","7,512.09"';
c.R3d = "Security;ISIN;Quantity;Price;Market value (local);Market value in EUR\nFund A;LU1234567891;100;800;80000;80000\nETF B;IE00B4L5Y983;50;174,72;8736;7512,09";
c.R3e = "ISIN;Name;Amount EUR;Accrued interest\nLU1234567891;Fund A;80000;0\nIE00B4L5Y983;ETF B;7512,09;0";
c.R3f = "Security,ISIN,Quantity,Market value EUR\nFund A,LU1234567891,100,\"80,000.00\"\nETF B,IE00B4L5Y983,50,\"7,512.09\"";
// R4 · fila de totales con ISIN vacío
c.R4a = "Producto;ISIN;Valor de mercado;Divisa\nA;LU1234567891;80000;EUR\nB;IE0098765432;120000;EUR\n;;200000;EUR";
c.R4b = "ISIN;Nombre;Importe\nLU1234567891;Fondo A;80000\nIE0098765432;Fondo B;120000\n;;200000";
c.R4c = "ISIN;Importe\nLU1234567891;80000\nIE0098765432;120000\n;200000";
c.R4d = "LU1234567891;80000\nIE0098765432;120000\n200000";
c.R4e = "Producto;ISIN;Títulos;Valor de mercado\nA;LU1234567891;100;80000\nLiquidez cuenta;;;5000\nB;IE0098765432;50;120000\nTOTAL;;;205000";
// R5 · ISIN en minúsculas
c.R5a = "isin;importe\nlu1234567891;80000\nie0098765432;120000";
c.R5b = "Producto;Código ISIN;Títulos;Contravalor EUR\nA;lu1234567891;100;80000\nB;ie0098765432;50;120000";
// R6 · cabeceras con saltos de línea dentro de la celda
c.R6a = 'Producto;ISIN;"Valor de\nmercado";"Contravalor\nEUR";Divisa\nA;LU1234567891;80000;80000;EUR\nB;IE0098765432;8736;7512,09;USD';
c.R6b = `<table><tr><th>Producto</th><th>ISIN</th><th>Valor de<br>mercado</th><th>Contravalor<br/>EUR</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>`;
c.R6c = 'Producto;ISIN;"Títulos\n(n.º)";"Contravalor\nEUR"\nA;LU1234567891;100;80000\nB;IE0098765432;50;7512,09';
c.R6d = 'ISIN;Producto;"Valor\nliquidativo";"Peso\n%"\nLU1234567891;A;12,34;91,4\nIE0098765432;B;5,67;8,6';
c.R6e = 'Producto;ISIN;"Valor de\nmercado";"Contravalor\nEUR";"Peso\n%"\nA;LU1234567891;80000;80000;91,4\nB;IE0098765432;8736;7512,09;8,6';
// R7 · HTML con thead/tbody/tfoot y th
c.R7a = `<table class="pos">
<thead><tr><th scope="col">Producto</th><th scope="col">ISIN</th><th scope="col">Títulos</th><th scope="col">Valor de mercado</th><th scope="col">Contravalor EUR</th></tr></thead>
<tbody>
<tr><th scope="row">Fondo A</th><td>LU1234567891</td><td class="num">100</td><td class="num">80.000,00</td><td class="num">80.000,00</td></tr>
<tr><th scope="row">ETF B</th><td>IE00B4L5Y983</td><td class="num">50</td><td class="num">8.736,00</td><td class="num">7.512,09</td></tr>
</tbody>
<tfoot><tr><th scope="row">Total</th><td></td><td></td><td></td><td>87.512,09</td></tr></tfoot>
</table>`;
c.R7b = `<TABLE><THEAD><TR><TH>ISIN</TH><TH>Producto</TH><TH>Contravalor EUR</TH></TR></THEAD>
<TBODY><TR><TD>LU1234567891</TD><TD>Fondo A</TD><TD>80.000,00 €</TD></TR>
<TR><TD>IE00B4L5Y983</TD><TD>ETF B</TD><TD>7.512,09 €</TD></TR></TBODY></TABLE>`;
// R7c · tabla HTML anidada (maquetación)
c.R7c = `<table><tr><td>Extracto</td></tr><tr><td>
<table><tr><th>Producto</th><th>ISIN</th><th>Valor de mercado</th><th>Contravalor EUR</th></tr>
<tr><td>A</td><td>LU1234567891</td><td>80.000,00</td><td>80.000,00</td></tr>
<tr><td>B</td><td>IE0098765432</td><td>8.736,00</td><td>7.512,09</td></tr></table>
</td></tr></table>`;
// R8 · tres columnas con el ISIN primero y la última que no es el importe (N-04)
c.R8a = "ISIN;Importe;Peso %\nLU1234567891;80000;40\nIE0098765432;120000;60";
c.R8b = "ISIN;Contravalor EUR;Rentabilidad\nLU1234567891;80000;5,2\nIE0098765432;120000;3,1";
c.R8c = "ISIN;Valor de mercado;Divisa\nLU1234567891;80000;EUR\nIE0098765432;120000;EUR";
c.R8d = "ISIN;Importe;Fecha\nLU1234567891;80000;15/10/2026\nIE0098765432;120000;15/10/2026";
c.R8e = "Nombre;ISIN;Importe\nFondo A;LU1234567891;80000\nApple;AAPL;500\nFondo B;IE0098765432;120000";
c.R8f = "ISIN;Importe;Peso\nLU1234567891;80000;0,4\nIE0098765432;120000;0,6";
c.R8g = "ISIN;Valor de mercado;Plusvalía\nLU1234567891;80000;4.290,05\nIE0098765432;120000;2.855,21";
// R9 · negativos contables y primera línea con importe ilegible
c.R9a = "Producto;ISIN;Valor de mercado\nA;LU1234567891;80.000,00\nB;IE0098765432;(1.234,00)\nC;XS1234567891;120.000,00";
c.R9b = "LU1234567891;80.000,00 EUR\nIE0098765432;120000";
c.R9c = "LU1234567891;(1.234)\nIE0098765432;120000\nXS1234567891;5000";
// R10 · subtotales de sección con rótulo en mayúsculas en la columna del ISIN
c.R10a = "ISIN;Nombre;Títulos;Valor de mercado\nFONDOS;;;80000\nLU1234567891;Fondo A;100;80000\nETF;;;120000\nIE0098765432;ETF B;50;120000\nTOTAL;;;200000";
// R11 · espacio fino / NBSP / menos tipográfico / divisa delante
c.R11a = "Producto;ISIN;Contravalor EUR\nA;LU1234567891;80\u202f000,00\nB;IE0098765432;EUR\u00a0120.000,00\nC;XS1234567891;−1.000,00";
c.R11b = "ISIN;Nombre;Importe\nLU1234567891;A;80\u202f000,00\nIE0098765432;B;€ 120.000\nXS1234567891;C;1.000 €";
// R12 · posición en dos filas visuales con rowspan en ISIN e importe
c.R12a = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Detalle</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo A</td><td rowspan="2">LU1234567891</td><td>Títulos: 100</td><td rowspan="2">80.000,00</td></tr>
<tr><td>Precio: 800,00</td></tr>
<tr><td rowspan="2">ETF B</td><td rowspan="2">IE0098765432</td><td>Títulos: 50</td><td rowspan="2">7.512,09</td></tr>
<tr><td>Precio: 150,24</td></tr>
</table>`;
// R12b · importe total de la posición con rowspan sobre dos cuentas (subcuentas sin importe)
c.R12b = `<table>
<tr><th>Producto</th><th>ISIN</th><th>Cuenta</th><th>Títulos</th><th>Contravalor EUR</th></tr>
<tr><td rowspan="2">Fondo A</td><td rowspan="2">LU1234567891</td><td>C1</td><td>60</td><td rowspan="2">80.000,00</td></tr>
<tr><td>C2</td><td>40</td></tr>
<tr><td>ETF B</td><td>IE0098765432</td><td>C1</td><td>50</td><td>120.000,00</td></tr>
</table>`;
// X · frontera de N-04 y exportaciones propias
c.X1 = "ISIN/ID;Nombre;Estado;Retro %;Coeficiente cesión;Cesión %;Importe EUR;Ingreso estimado EUR\nLU1234567891;Fondo A;Encontrado;0,5;0,5;0,25;80000;200\nPRIVADO-1;Vehículo privado;No encontrado;;0,5;;45000;";
c.X2 = "Fondo;ISIN;Importe EUR;Retrocesión %;Cesión %;Ingreso EUR;Estado\nFondo A;LU1234567891;80000;0,5;0,25;200;Encontrado\nVehículo;PRIVADO-1;45000;;;;No encontrado";
c.X3 = "Fondo;ISIN;Importe EUR;Estado\nFondo A;LU1234567891;80000;Encontrado\nVehículo;PRIVADO-1;45000;No encontrado\nOtro;fund-1;1000;No encontrado";
c.X4 = "Fondo A;LU1234567891;80000\nFondo B;IE0098765432;120000";
c.X5 = "Nombre;ISIN;Importe\nFondo A;LU1234567891;80000\nPrivado;fund-1;5000";
c.X6 = "ISIN/ID;Nombre;Importe EUR\nLU1234567891;Fondo A;80000\nPRIVADO-1;Privado;45000";
c.X7 = "ISIN\tImporte\tPeso %\nLU1234567891\t80000\t40\nIE0098765432\t120000\t60";
c.X8 = "Ticker;Nombre;Importe;Peso\nAAPL;Apple;1500;60\nMSFT;Microsoft;1000;40";
c.X9 = "Producto;Código;Títulos;Saldo;Peso %\nA;LU1234567891;100;80000;40\nB;IE0098765432;50;120000;60";
