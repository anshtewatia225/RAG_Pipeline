import hashlib
import json
import logging
import sqlite3
import threading
from pathlib import Path

from langchain_core.embeddings import Embeddings
from tenacity import Retrying, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class CachedEmbeddings(Embeddings):
    """Embeddings wrapper backed by a small SQLite cache.

    ``CacheBackedEmbeddings`` was removed from current LangChain, so we keep a
    minimal content-addressed cache keyed by model + text hash. Only cache
    misses are sent to the upstream provider, and calls are retried.
    """

    def __init__(
        self,
        inner: Embeddings,
        db_path: Path,
        model_name: str,
        max_retries: int = 3,
    ):
        self._inner = inner
        self._model = model_name
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(
            str(self._path), check_same_thread=False, timeout=30
        )
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS embeddings "
            "(key TEXT PRIMARY KEY, vector TEXT NOT NULL)"
        )
        self._conn.commit()
        self._retry = Retrying(
            stop=stop_after_attempt(max(1, max_retries)),
            wait=wait_exponential(multiplier=1, min=1, max=10),
            reraise=True,
        )

    def _key(self, text: str) -> str:
        return hashlib.sha256(f"{self._model}\x00{text}".encode("utf-8")).hexdigest()

    def _get(self, keys: list[str]) -> dict[str, list[float]]:
        if not keys:
            return {}
        found: dict[str, list[float]] = {}
        with self._lock:
            for i in range(0, len(keys), 500):
                batch = keys[i : i + 500]
                placeholders = ",".join("?" for _ in batch)
                rows = self._conn.execute(
                    f"SELECT key, vector FROM embeddings WHERE key IN ({placeholders})",
                    batch,
                ).fetchall()
                for key, vector in rows:
                    try:
                        found[key] = json.loads(vector)
                    except json.JSONDecodeError:
                        continue
        return found

    def _put(self, items: dict[str, list[float]]) -> None:
        if not items:
            return
        with self._lock:
            self._conn.executemany(
                "INSERT OR REPLACE INTO embeddings (key, vector) VALUES (?, ?)",
                [(k, json.dumps(v)) for k, v in items.items()],
            )
            self._conn.commit()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        keys = [self._key(t) for t in texts]
        cached = self._get(keys)

        missing: dict[str, str] = {}
        for key, text in zip(keys, texts):
            if key not in cached and key not in missing:
                missing[key] = text

        if missing:
            missing_keys = list(missing.keys())
            missing_texts = [missing[k] for k in missing_keys]
            vectors = self._retry(self._inner.embed_documents, missing_texts)
            fresh = dict(zip(missing_keys, vectors))
            self._put(fresh)
            cached.update(fresh)

        return [cached[key] for key in keys]

    def embed_query(self, text: str) -> list[float]:
        key = self._key(text)
        cached = self._get([key])
        if key in cached:
            return cached[key]
        vector = self._retry(self._inner.embed_query, text)
        self._put({key: vector})
        return vector
