/**
 * Elegir un activo para un movimiento: se busca por nombre, ISIN o símbolo entre los de la
 * cartera y los del catálogo de la plataforma. Si no está en ninguno, se crea como activo
 * propio (con sus precios a mano); un bono se crea con sus condiciones.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { Aviso } from "../../../components/ui/Aviso";
import { Button } from "../../../components/ui/Button";
import { Campo } from "../../../components/ui/Campo";
import { coincideConLoTecleado, esRespuestaExacta } from "../../../core/busquedaDeActivos";
import { activoDesdeElCatalogo, type ActivoDeCatalogo } from "../../mercado/fichas";
import { catalogoDeActivos } from "../../mercado/plataforma";
import { leerCifra, aTexto } from "../../motor/decimal";
import { esDia } from "../../motor/fechas";
import { NOMBRE_DEL_TIPO_DE_ACTIVO, nuevoId, type Activo, type BaseDeCalculo, type TipoDeActivo } from "../../motor/modelo";

const MAXIMO_DE_RESULTADOS = 8;
const SIN_TECLEAR = 4;
const TIPOS: TipoDeActivo[] = ["FONDO", "ETF", "ACCION", "BONO", "OTRO"];
const SINGULAR: Record<TipoDeActivo, string> = { FONDO: "Fondo", ETF: "ETF", ACCION: "Acción", BONO: "Bono", OTRO: "Otro" };
const DIVISAS = ["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "DKK", "CAD"];
const FORMA_DE_ISIN = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

interface Resultado {
  activo: Activo;
  /** «En la cartera», o lo que distingue al del catálogo (categoría, sector). */
  detalle: string;
  enCartera: boolean;
}

function buscar(texto: string, deLaCartera: readonly Activo[], catalogo: readonly ActivoDeCatalogo[]): Resultado[] {
  const propios: Resultado[] = deLaCartera
    .filter((activo) => coincideConLoTecleado({ nombre: activo.nombre, isin: activo.isin ?? "", ticker: activo.ticker }, texto))
    .map((activo) => ({ activo, detalle: "En la cartera", enCartera: true }));
  /* Sin nada tecleado se ofrecen solo unos pocos de la cartera, para elegir de un clic sin llenar el formulario. */
  if (texto.trim().length < 2) return propios.slice(0, SIN_TECLEAR);
  const yaEstan = new Set(deLaCartera.map((activo) => activo.isin).filter(Boolean));
  const delCatalogo = catalogo
    .filter((activo) => !yaEstan.has(activo.isin) && coincideConLoTecleado({ nombre: activo.nombre, isin: activo.isin, ticker: activo.ticker }, texto))
    /* Primero quien responde exactamente a lo tecleado (su símbolo o su ISIN), luego por nombre. */
    .sort((a, b) => Number(esRespuestaExacta({ nombre: b.nombre, isin: b.isin, ticker: b.ticker }, texto)) - Number(esRespuestaExacta({ nombre: a.nombre, isin: a.isin, ticker: a.ticker }, texto)) || a.nombre.localeCompare(b.nombre, "es"))
    .slice(0, MAXIMO_DE_RESULTADOS)
    .map((activo) => ({ activo: activoDesdeElCatalogo(activo), detalle: [NOMBRE_DEL_TIPO_DE_ACTIVO[activo.tipo], activo.detalle].filter(Boolean).join(" · "), enCartera: false }));
  return [...propios, ...delCatalogo].slice(0, MAXIMO_DE_RESULTADOS);
}

/** El pequeño formulario para dar de alta un activo que no está en el catálogo. */
function ActivoPropio({ nombreInicial, divisaBase, alCrear, alCancelar }: { nombreInicial: string; divisaBase: string; alCrear: (activo: Activo) => void; alCancelar: () => void }) {
  const [nombre, setNombre] = useState(FORMA_DE_ISIN.test(nombreInicial.trim().toUpperCase()) ? "" : nombreInicial.trim());
  const [isin, setIsin] = useState(FORMA_DE_ISIN.test(nombreInicial.trim().toUpperCase()) ? nombreInicial.trim().toUpperCase() : "");
  const [tipo, setTipo] = useState<TipoDeActivo>("FONDO");
  const [divisa, setDivisa] = useState(divisaBase);
  const [cupon, setCupon] = useState("");
  const [frecuencia, setFrecuencia] = useState<1 | 2 | 4 | 12>(1);
  const [vencimiento, setVencimiento] = useState("");
  const [base, setBase] = useState<BaseDeCalculo>("ACT/ACT");
  const [error, setError] = useState<string | null>(null);

  const crear = () => {
    if (!nombre.trim()) return setError("Falta el nombre del activo.");
    const isinLimpio = isin.trim().toUpperCase();
    if (isinLimpio && !FORMA_DE_ISIN.test(isinLimpio)) return setError("El ISIN no tiene la forma correcta: dos letras, nueve letras o cifras y un dígito.");
    const activo: Activo = { id: isinLimpio || `propio-${nuevoId().slice(0, 8)}`, nombre: nombre.trim(), tipo, divisa, origen: "manual" };
    if (isinLimpio) activo.isin = isinLimpio;
    if (tipo === "BONO") {
      const cuponLeido = leerCifra(cupon);
      if (!cuponLeido || cuponLeido.lt(0)) return setError("Falta el cupón anual del bono, en porcentaje (0 si es cupón cero).");
      if (!esDia(vencimiento)) return setError("Falta la fecha de vencimiento del bono.");
      activo.multiplicador = "0.01";
      activo.bono = { cupon: aTexto(cuponLeido.div(100)), frecuencia, vencimiento, base };
    }
    setError(null);
    alCrear(activo);
  };

  return (
    <div className="gestor-activo-propio stack stack--tight">
      <p className="cmp-note">Un activo propio no está en el catálogo: se valora con el precio de sus operaciones y con los precios que le pongas a mano.</p>
      <div className="gestor-campos">
        <Campo className="gestor-campos__ancho" rotulo="Nombre">
          <input autoFocus onChange={(evento) => setNombre(evento.target.value)} type="text" value={nombre} />
        </Campo>
        {/* Fondo, ETF, acción, bono u otro: lo que las pantallas llaman «Producto» (apartado 6 de SISTEMA_DISENO.md). */}
        <Campo rotulo="Producto">
          <select onChange={(evento) => setTipo(evento.target.value as TipoDeActivo)} value={tipo}>
            {TIPOS.map((opcion) => (
              <option key={opcion} value={opcion}>{SINGULAR[opcion]}</option>
            ))}
          </select>
        </Campo>
        <Campo rotulo="Divisa en la que cotiza">
          <select onChange={(evento) => setDivisa(evento.target.value)} value={divisa}>
            {[...new Set([divisaBase, ...DIVISAS])].map((codigo) => (
              <option key={codigo} value={codigo}>{codigo}</option>
            ))}
          </select>
        </Campo>
        <Campo opcional rotulo="ISIN">
          <input onChange={(evento) => setIsin(evento.target.value)} type="text" value={isin} />
        </Campo>
        {tipo === "BONO" ? (
          <>
            <Campo rotulo="Cupón anual (%)">
              <input inputMode="decimal" onChange={(evento) => setCupon(evento.target.value)} placeholder="3,25" type="text" value={cupon} />
            </Campo>
            <Campo rotulo="Pagos al año">
              <select onChange={(evento) => setFrecuencia(Number(evento.target.value) as 1 | 2 | 4 | 12)} value={frecuencia}>
                <option value={1}>Uno (anual)</option>
                <option value={2}>Dos (semestral)</option>
                <option value={4}>Cuatro (trimestral)</option>
                <option value={12}>Doce (mensual)</option>
              </select>
            </Campo>
            <Campo rotulo="Vencimiento">
              <input onChange={(evento) => setVencimiento(evento.target.value)} type="date" value={vencimiento} />
            </Campo>
            <Campo pista="Un bono cotiza en porcentaje del nominal: los «títulos» son el nominal y el precio, por ejemplo, 98,50." rotulo="Cómputo de días">
              <select onChange={(evento) => setBase(evento.target.value as BaseDeCalculo)} value={base}>
                <option value="ACT/ACT">ACT/ACT (deuda pública)</option>
                <option value="30/360">30/360</option>
                <option value="ACT/365">ACT/365</option>
                <option value="ACT/360">ACT/360</option>
              </select>
            </Campo>
          </>
        ) : null}
      </div>
      {error ? <Aviso tono="error">{error}</Aviso> : null}
      <div className="row">
        <Button onClick={crear} size="sm" variant="primary">Crear el activo</Button>
        <Button onClick={alCancelar} size="sm" variant="quiet">Cancelar</Button>
      </div>
    </div>
  );
}

export function SelectorDeActivo({ rotulo, elegido, activosDeLaCartera, divisaBase, alElegir, ayuda }: {
  rotulo: string;
  elegido: Activo | undefined;
  activosDeLaCartera: readonly Activo[];
  divisaBase: string;
  /** El activo elegido: de la cartera, del catálogo (aún sin dar de alta) o recién creado. `undefined` para quitarlo. */
  alElegir: (activo: Activo | undefined) => void;
  ayuda?: string;
}) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [catalogo, setCatalogo] = useState<readonly ActivoDeCatalogo[]>([]);
  const [creando, setCreando] = useState(false);
  const [sinCatalogo, setSinCatalogo] = useState(false);

  useEffect(() => {
    let vigente = true;
    catalogoDeActivos()
      .then((activos) => {
        if (vigente) setCatalogo(activos);
      })
      .catch(() => {
        if (vigente) setSinCatalogo(true);
      });
    return () => {
      vigente = false;
    };
  }, []);

  const resultados = useMemo(() => buscar(texto, activosDeLaCartera, catalogo), [texto, activosDeLaCartera, catalogo]);

  if (elegido) {
    return (
      <div className="field">
        <span className="field__label">{rotulo}</span>
        <div className="gestor-elegido">
          <span className="gestor-elegido__nombre">
            {elegido.nombre}
            <span className="gestor-elegido__detalle">{[SINGULAR[elegido.tipo], elegido.isin, elegido.divisa, elegido.origen === "manual" ? "activo propio" : undefined].filter(Boolean).join(" · ")}</span>
          </span>
          <Button onClick={() => alElegir(undefined)} size="sm" variant="quiet">Cambiar</Button>
        </div>
      </div>
    );
  }

  if (creando) {
    return (
      <div className="field">
        <span className="field__label">{rotulo}: activo nuevo</span>
        <ActivoPropio
          alCancelar={() => setCreando(false)}
          alCrear={(activo) => {
            setCreando(false);
            alElegir(activo);
          }}
          divisaBase={divisaBase}
          nombreInicial={texto}
        />
      </div>
    );
  }

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{rotulo}</label>
      <input aria-describedby={ayuda ? `${id}-pista` : undefined} autoComplete="off" id={id} onChange={(evento) => setTexto(evento.target.value)} placeholder="Nombre, ISIN o símbolo" type="search" value={texto} />
      {ayuda ? <p className="field__hint" id={`${id}-pista`}>{ayuda}</p> : null}
      {resultados.length > 0 ? (
        <ul className="gestor-resultados">
          {resultados.map((resultado) => (
            <li key={resultado.activo.id}>
              <button className="gestor-resultado" onClick={() => alElegir(resultado.activo)} type="button">
                <span className="gestor-resultado__nombre">{resultado.activo.nombre}</span>
                <span className="gestor-resultado__detalle">{[resultado.detalle, resultado.activo.isin, resultado.activo.divisa].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {texto.trim().length >= 2 ? (
        <p className="cmp-note">
          {resultados.length === 0 ? (sinCatalogo ? "No se ha podido leer el catálogo. " : "No está en la cartera ni en el catálogo. ") : "¿No es ninguno? "}
          <button className="gestor-enlace" onClick={() => setCreando(true)} type="button">Crearlo como activo propio</button>
        </p>
      ) : null}
    </div>
  );
}
