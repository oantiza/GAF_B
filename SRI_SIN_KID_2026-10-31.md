# Fondos y ETF que publican SRI sin un KID de PRIIPs detras

Medido el 31-10-2026 sobre los 1.097 activos de la maestra.

775 activos publican un SRI del KID. De ellos, 738 tienen detras el documento
con su fecha y su sha256, y **37 no**. De esos 37:

- **30 no tienen el KID en ninguna parte** (los de esta lista): ni en el canonico,
  ni en la ficha del extractor, ni en la cache. Cinco tienen un PDF guardado que no
  sirve porque es un KIID de UCITS, cuyo indicador es el SRRI y no el SRI.
- 6 tienen el KID pero sin fecha legible en el texto.
- 1 lo tiene sin procedencia oficial.

Lo que falta es el **KID de PRIIPs por ISIN de clase**, en PDF o con su fecha y su
hash, para poder ensenar de donde sale el SRI que publica la ficha. Los nueve ETF
son el grupo mas dificil: no se distribuyen por la ficha de la CNMV ni por los
buscadores de las comercializadoras espanolas.

| ISIN | Tipo | SRI publicado | Nombre |
|---|---|---|---|
| IE0002PG6CA6 | ETF | 6 | VanEck Rare Earth and Strategic Metals UCITS ETF A USD Acc |
| IE000DR59CI3 | ETF | 4 | iShares Energy Storage & Hydrogen UCITS ETF USD (Acc) |
| IE000M7V94E1 | ETF | 5 | VanEck Uranium and Nuclear Technologies UCITS ETF A USD Acc |
| IE000X59ZHE2 | ETF | 5 | iShares AI Infrastructure UCITS ETF USD (Acc) |
| IE00B0M62Q58 | ETF | 4 | iShares MSCI World UCITS ETF USD (Dist) |
| IE00B3XXRP09 | ETF | 4 | Vanguard S&P 500 UCITS ETF |
| IE00B4L5Y983 | ETF | 4 | iShares Core MSCI World UCITS ETF USD (Acc) |
| IE00B53L3W79 | ETF | 4 | iShares VII PLC - iShares Core EURO STOXX 50 ETF EUR Acc |
| IE00B5BMR087 | ETF | 4 | iShares Core S&P 500 UCITS ETF USD (Acc) |
| FR0013219243 | FUND | 3 | EdR SICAV - Equity Euro Solve A EUR |
| LU0137009238 | FUND | 2 | Vontobel Fund - TwentyFour Euro Short Term Bond C EUR Cap |
| LU0251661590 | FUND | 3 | AXA World Funds - Euro Long Duration Bonds E Capitalisation EU |
| LU0323041763 | FUND | 4 | Chahine Funds - Equity Europe R |
| LU0571100824 | FUND | 3 | Groupama Europe Convertible NC |
| LU0571101558 | FUND | 3 | Groupama Euro High Yield NC |
| LU0772958525 | FUND | 4 | Nordea 1 - North American Sustainable Stars Equity Fund BP USD |
| LU0835722488 | FUND | 3 | RAM (Lux) Systematic Funds - Emerging Markets Equities OP EUR |
| LU0935222900 | FUND | 2 | Natixis AM Funds - Ostrum Euro Inflation R/A (EUR) |
| LU1127969597 | FUND | 4 | T. Rowe Price Funds SICAV - Global Focused Growth Equity Fund  |
| LU1299311164 | FUND | 4 | Carmignac Portfolio Investissement A EUR Acc |
| LU1299311834 | FUND | 4 | Carmignac Portfolio Investissement E EUR Acc |
| LU1317704135 | FUND | 3 | Carmignac Portfolio Long-Short European Equities E EUR Acc |
| LU1333148903 | FUND | 4 | Azvalor Lux SICAV Azvalor International R |
| LU1717592262 | FUND | 2 | Groupama Global Inflation Short Duration NC |
| LU1814994353 | FUND | 4 | Azvalor Lux SICAV Altum Faith - Consistent Equity R |
| LU1897556517 | FUND | 5 | Groupama Global Disruption NC |
| LU2050411763 | FUND | 4 | BlackRock Global Funds - Emerging Markets Equity Income Fund A |
| LU2697545163 | FUND | 2 | BlackRock Global Funds - Euro High Yield Fixed Maturity Bond F |
| LU2743151057 | FUND | 4 | Natixis International Funds (Lux) I - Ossiam Shiller Barclays  |
| IE00B4ND3602 | OTHER | 4 | iShares Physical Gold ETC |

Total: 30 activos.
