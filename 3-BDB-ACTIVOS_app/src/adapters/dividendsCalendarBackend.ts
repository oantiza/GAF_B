/**
 * Cableado a la callable `get_dividends_calendar` (backend).
 * Próximas fechas ex-dividendo de los valores del IBEX 35. La fuente real es Yahoo, que da la fecha
 * ex futura y, como importe, el último apunte de su serie: no el del próximo pago, que no se conoce.
 * Medido el 04-11-2026: 10 filas, ninguna con fecha de pago.
 */
import { callBackend } from "./callableBackend";
import {
  requireArray,
  requireNullableNumber,
  requireNullableString,
  requireObject
} from "./contractGuards";
import { optionalNullableIsoDay, parseCalendarEnvelope } from "./calendarContract";

export interface DividendItem {
  code?: string | null;
  name?: string | null;
  /** Fecha ex-dividendo (ISO). */
  ex_date?: string | null;
  /** Fecha de pago (ISO). Yahoo no la da. */
  payment_date?: string | null;
  /** Importe bruto por acción. Con Yahoo es el último dividendo, ya pasado; con EODHD o FMP, el de `ex_date`. */
  amount?: number | null;
  /**
   * La fecha ex de `amount` cuando es el último dividendo. El servidor aún no la envía: la tiene a
   * mano en el mismo apunte (`spanish_calendar.py`, `divs.index[-1]`). La pantalla ya la pinta si llega.
   */
  amount_ex_date?: string | null;
  /** Qué es `amount`: LAST_PAID = el último pago ya hecho, no el de `ex_date`. Ausente en un servidor sin actualizar. */
  amount_kind?: string | null;
  currency?: string | null;
  /** Frecuencia (Quarterly / Annual / …). */
  period?: string | null;
  /** Rentabilidad por dividendo (%), si la fuente la da. */
  yield?: number | null;
}

export interface DividendsCalendarResult {
  schema_version?: string;
  items: DividendItem[];
  from?: string;
  to?: string;
  source: string;
  note?: string;
  count: number;
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNullableString(value, field);
}

function optionalNullableNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNullableNumber(value, field);
}

export function parseDividendsCalendarResult(raw: unknown): DividendsCalendarResult {
  const data = requireObject(raw, "get_dividends_calendar response");
  const items = requireArray(data.items, "items").map((item, index) => {
    const row = requireObject(item, `items[${index}]`);
    return {
      code: optionalNullableString(row.code, `items[${index}].code`),
      name: optionalNullableString(row.name, `items[${index}].name`),
      ex_date: optionalNullableIsoDay(row.ex_date, `items[${index}].ex_date`),
      payment_date: optionalNullableIsoDay(row.payment_date, `items[${index}].payment_date`),
      amount: optionalNullableNumber(row.amount, `items[${index}].amount`),
      amount_ex_date: optionalNullableIsoDay(row.amount_ex_date, `items[${index}].amount_ex_date`),
      amount_kind: optionalNullableString(row.amount_kind, `items[${index}].amount_kind`),
      currency: optionalNullableString(row.currency, `items[${index}].currency`),
      period: optionalNullableString(row.period, `items[${index}].period`),
      yield: optionalNullableNumber(row.yield, `items[${index}].yield`)
    };
  });
  return {
    items,
    ...parseCalendarEnvelope(data, items.length)
  };
}

export async function fetchDividendsCalendar(
  opts?: { from?: string; to?: string }
): Promise<DividendsCalendarResult | null> {
  const raw = await callBackend<unknown>(
    "get_dividends_calendar",
    opts ?? {},
    "No se pudo cargar el calendario de dividendos."
  );
  return parseDividendsCalendarResult(raw);
}
