"""Read-only Firestore reader for portfolio optimization price series."""
from readmodel.firestore_client import FirestoreReader, get_master_db
from google.api_core.retry import Retry
import threading


class FirestoreOptimizationReader:
    """Reads only root assets and asset-price-series documents."""

    # gRPC's client is thread-safe; cap parallel I/O independently of asset count.
    max_parallel_reads = 6
    read_timeout_seconds = 15

    def __init__(self, db=None):
        self.db = db or get_master_db()
        self._asset_reader = FirestoreReader(self.db, read_timeout=self.read_timeout_seconds)
        self.read_count = 0
        self.write_count = 0
        self._count_lock = threading.Lock()

    def get_asset(self, asset_id: str):
        # Comparte la cache TTL de raices entre optimizacion, backtest y analisis.
        # Evita releer el mismo activo en cada callable de una instancia caliente.
        return self._asset_reader.get_asset(asset_id)

    def get_assets_many(self, asset_ids: list[str]) -> dict:
        return self._asset_reader.get_assets_many(asset_ids)

    def get_price_series(self, asset_id: str) -> list:
        docs = []
        stream = (
            self.db.collection("assets")
            .document(asset_id)
            .collection("price_series")
            .stream(timeout=self.read_timeout_seconds, retry=Retry(deadline=self.read_timeout_seconds))
        )
        for snap in stream:
            data = snap.to_dict() or {}
            data.setdefault("document_id", snap.id)
            docs.append(data)
        with self._count_lock:
            self.read_count += max(1, len(docs))
        return docs
