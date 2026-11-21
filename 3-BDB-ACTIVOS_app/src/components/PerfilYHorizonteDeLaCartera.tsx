import { useState } from "react";
import {
  cifraDelHorizonte,
  leerHorizonte,
  NIVEL_DE_PERFIL_MAXIMO,
  NIVEL_DE_PERFIL_MINIMO,
  SIN_DEFINIR,
  type PerfilYHorizonte
} from "../core/perfilYHorizonte";
import { textoDelNivel } from "../core/textoDelNivelDePerfil";
import { Campo } from "./ui/Campo";

const NIVELES = Array.from(
  { length: NIVEL_DE_PERFIL_MAXIMO - NIVEL_DE_PERFIL_MINIMO + 1 },
  (_, indice) => NIVEL_DE_PERFIL_MINIMO + indice
);

/** Sin la clave cuando no hay valor: ausente es ausente, no `undefined` guardado. */
function con(valor: PerfilYHorizonte, campo: keyof PerfilYHorizonte, nuevo: number | undefined): PerfilYHorizonte {
  const siguiente = { ...valor };
  if (nuevo === undefined) delete siguiente[campo];
  else siguiente[campo] = nuevo;
  return siguiente;
}

/**
 * Nivel de perfil y horizonte de la cartera modelo (decisión 59), en la banda de los datos de la propuesta, junto al
 * nombre y el capital:
 * son de la misma clase, lo que define la cartera, y se guardan igual, con «Guardar».
 *
 * Ninguno viene puesto y ninguno se deduce del otro: «Sin definir» es un estado que se ve, no un hueco.
 * Todavía no avisan de nada; las reglas que comparan con el mercado objetivo del emisor llegan con él.
 */
export function PerfilYHorizonteDeLaCartera({
  valor,
  onChange
}: {
  valor: PerfilYHorizonte;
  onChange: (valor: PerfilYHorizonte) => void;
}) {
  const [texto, setTexto] = useState(() => cifraDelHorizonte(valor.horizon_years));
  const [error, setError] = useState<string | null>(null);
  /* Otra cartera, o «Nueva cartera», cambia el valor desde fuera: el campo lo sigue y el error de antes ya no vale. */
  const [visto, setVisto] = useState(valor.horizon_years);
  if (visto !== valor.horizon_years) {
    setVisto(valor.horizon_years);
    setTexto(cifraDelHorizonte(valor.horizon_years));
    setError(null);
  }

  function confirmarHorizonte() {
    const leido = leerHorizonte(texto);
    if ("error" in leido) {
      setError(leido.error);
      return;
    }
    setError(null);
    setTexto(cifraDelHorizonte(leido.valor));
    if (leido.valor !== valor.horizon_years) onChange(con(valor, "horizon_years", leido.valor));
  }

  return (
    <>
      <Campo rotulo="Perfil de riesgo">
        <select
          aria-label="Nivel de perfil de riesgo de la cartera"
          value={valor.risk_profile_level ?? ""}
          onChange={(evento) =>
            onChange(con(valor, "risk_profile_level", evento.target.value === "" ? undefined : Number(evento.target.value)))
          }
        >
          <option value="">{SIN_DEFINIR}</option>
          {NIVELES.map((nivel) => (
            <option key={nivel} value={nivel}>
              {textoDelNivel(nivel)}
            </option>
          ))}
        </select>
      </Campo>
      {/* El error se anuncia al aparecer y queda enlazado a su campo (lo hace `Campo`). La unidad, solo con una cifra
          escrita: sin ella, «años» junto a «Sin definir» diría que hay un horizonte. */}
      <Campo error={error ? <span role="alert">{error}</span> : undefined} pista={texto.trim() ? "En años" : undefined} rotulo="Horizonte">
        <input
          aria-label="Horizonte de la cartera en años"
          inputMode="decimal"
          onBlur={confirmarHorizonte}
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={(evento) => {
            if (evento.key === "Enter") confirmarHorizonte();
          }}
          placeholder={SIN_DEFINIR}
          type="text"
          value={texto}
        />
      </Campo>
    </>
  );
}
