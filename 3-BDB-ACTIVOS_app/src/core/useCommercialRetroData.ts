import { useCallback, useEffect, useState } from "react";
import { getCommercialRetroForAssets } from "../adapters/commercialRetroStore";
import { useCommercialRetroAccess } from "../auth/useCommercialRetroAccess";
import type { CommercialRetroRecord } from "../types/commercialRetro";

export interface CommercialRetroAssetRef {
  asset_id: string;
  isin?: string;
}

export function commercialRetroRequestKey(assets: CommercialRetroAssetRef[]): string {
  const normalized = assets
    .map((asset) => ({ asset_id: asset.asset_id.trim(), isin: asset.isin?.trim() || undefined }))
    .filter((asset) => asset.asset_id.length > 0)
    .sort((left, right) => `${left.asset_id}::${left.isin ?? ""}`.localeCompare(`${right.asset_id}::${right.isin ?? ""}`));

  return JSON.stringify(
    normalized.filter(
      (asset, index) => index === 0
        || asset.asset_id !== normalized[index - 1].asset_id
        || asset.isin !== normalized[index - 1].isin
    )
  );
}

export function useCommercialRetroData(assets: CommercialRetroAssetRef[]) {
  const requestKey = commercialRetroRequestKey(assets);
  // B4 / R-07: sin claim admin no se consulta Firestore (las reglas lo
  // rechazarían) y se devuelve «sin dato» en silencio; mientras el claim se
  // resuelve se espera con `loading`.
  const access = useCommercialRetroAccess();
  const [records, setRecords] = useState<Map<string, CommercialRetroRecord>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    const requestedAssets = JSON.parse(requestKey) as CommercialRetroAssetRef[];
    setRecords(new Map());
    setError(null);
    setLoading(requestedAssets.length > 0 && access !== "denied");

    if (requestedAssets.length === 0 || access !== "granted") {
      return () => {
        active = false;
      };
    }

    getCommercialRetroForAssets(requestedAssets)
      .then((loaded) => {
        if (active) setRecords(loaded);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setRecords(new Map());
        setError(cause instanceof Error ? cause : new Error("No se pudo cargar la base comercial."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [access, reloadKey, requestKey]);

  const retry = useCallback(() => setReloadKey((current) => current + 1), []);

  return { records, loading, error, retry };
}
