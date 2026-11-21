import { useBenchmark } from "../app/BenchmarkContext";
import { BENCHMARK_PROFILES } from "../core/benchmarkProfiles";
import { Campo } from "./ui/Campo";

interface BenchmarkSelectProps {
  className?: string;
  disabled?: boolean;
  /**
   * `cabecera`: el selector de la cabecera de Análisis, junto al periodo. Sin rótulo encima: cada opción se lee «Referencia:
   * Equilibrada», que es lo que dice la maqueta, y su nombre accesible es «Cartera de referencia».
   * `campo` (por defecto): dentro de un `Campo`, con su rótulo, como en «Datos de los documentos» de Informes.
   */
  variante?: "campo" | "cabecera";
}

/**
 * La cartera de referencia gobierna Análisis y los informes, así que se elige a la vista, en la página que la consume. Un solo
 * control, un solo estado (`BenchmarkContext`, persistido).
 */
export function BenchmarkSelect({ className = "", disabled = false, variante = "campo" }: BenchmarkSelectProps) {
  const { benchmarkId, setBenchmarkId } = useBenchmark();
  if (variante === "cabecera") {
    return (
      <select
        aria-label="Cartera de referencia"
        className={`analisis-referencia ${className}`.trim()}
        disabled={disabled}
        onChange={(event) => setBenchmarkId(event.target.value)}
        value={benchmarkId}
      >
        {BENCHMARK_PROFILES.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {`Referencia: ${profile.name}`}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Campo className={className} rotulo="Cartera de referencia">
      <select disabled={disabled} onChange={(event) => setBenchmarkId(event.target.value)} value={benchmarkId}>
        {BENCHMARK_PROFILES.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </Campo>
  );
}
