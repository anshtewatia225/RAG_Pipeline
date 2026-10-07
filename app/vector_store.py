import json
import logging
import shutil
import threading
from pathlib import Path

from langchain_community.vectorstores import FAISS
from langchain_community.vectorstores.utils import DistanceStrategy
from langchain_core.documents import Document

from app.config import FAISS_INDEX_DIR, get_embeddings
from app.utils import collection_dir, validate_collection_name

logger = logging.getLogger(__name__)

_MANIFEST_NAME = "manifest.json"
_INDEX_NAME = "index"


class VectorStore:
    """Thin, thread-safe wrapper around LangChain's FAISS vector store.

    One instance is cached per collection so concurrent requests share the
    loaded index instead of reloading (and racing) from disk.
    """

    def __init__(self, collection_name: str):
        self.collection_name = validate_collection_name(collection_name)
        self._dir = collection_dir(self.collection_name)
        self._embeddings = get_embeddings()
        self._store: FAISS | None = None
        self._manifest: dict[str, dict] = {}
        self._lock = threading.RLock()
        self._load()

    # ------------------------------------------------------------------ load
    def _load(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        if (self._dir / f"{_INDEX_NAME}.pkl").exists():
            self._store = FAISS.load_local(
                str(self._dir),
                self._embeddings,
                allow_dangerous_deserialization=True,
            )
        manifest_path = self._dir / _MANIFEST_NAME
        if manifest_path.exists():
            try:
                self._manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                logger.warning("Corrupt manifest for collection %s", self.collection_name)

    def _save(self) -> None:
        if self._store is None:
            return
        self._store.save_local(str(self._dir), index_name=_INDEX_NAME)
        (self._dir / _MANIFEST_NAME).write_text(
            json.dumps(self._manifest), encoding="utf-8"
        )

    # ----------------------------------------------------------------- write
    def add_documents(
        self,
        documents: list[Document],
        ids: list[str],
        file_name: str | None = None,
        sha256: str | None = None,
    ) -> list[str]:
        if not documents:
            return []
        with self._lock:
            if self._store is None:
                self._store = FAISS.from_documents(
                    documents,
                    self._embeddings,
                    ids=ids,
                    distance_strategy=DistanceStrategy.MAX_INNER_PRODUCT,
                )
            else:
                self._store.add_documents(documents, ids=ids)

            if file_name is not None:
                self._manifest[file_name] = {"sha256": sha256, "ids": ids}
            self._save()
        return ids

    def find_duplicate_files(self, sha256: str) -> list[str]:
        with self._lock:
            return [
                name
                for name, entry in self._manifest.items()
                if entry.get("sha256") == sha256
            ]

    def get_file(self, file_name: str) -> dict | None:
        with self._lock:
            entry = self._manifest.get(file_name)
            return dict(entry) if entry else None

    # ------------------------------------------------------------------ read
    def query(self, query_text: str, top_k: int = 5) -> dict:
        with self._lock:
            if self._store is None or self._store.index.ntotal == 0:
                return {"documents": [], "metadatas": [], "distances": []}

            k = min(top_k, self._store.index.ntotal)
            results = self._store.similarity_search_with_score(query_text, k=k)

        documents: list[str] = []
        metadatas: list[dict] = []
        distances: list[float] = []
        for doc, score in results:
            documents.append(doc.page_content)
            metadatas.append(doc.metadata)
            distances.append(float(score))
        return {
            "documents": documents,
            "metadatas": metadatas,
            "distances": distances,
        }

    def similarity_search_with_score(
        self, query_text: str, k: int = 5
    ) -> list[tuple[Document, float]]:
        with self._lock:
            if self._store is None or self._store.index.ntotal == 0:
                return []
            k = min(k, self._store.index.ntotal)
            return self._store.similarity_search_with_score(query_text, k=k)

    def max_marginal_relevance_search(
        self, query_text: str, k: int = 5, fetch_k: int = 20, lambda_mult: float = 0.5
    ) -> list[Document]:
        with self._lock:
            if self._store is None or self._store.index.ntotal == 0:
                return []
            k = min(k, self._store.index.ntotal)
            return self._store.max_marginal_relevance_search(
                query_text, k=k, fetch_k=fetch_k, lambda_mult=lambda_mult
            )

    def all_documents(self) -> list[Document]:
        with self._lock:
            if self._store is None:
                return []
            docstore = getattr(self._store, "docstore", None)
            if docstore is None:
                return []
            store_dict = getattr(docstore, "_dict", None)
            if isinstance(store_dict, dict):
                return list(store_dict.values())
            return list(getattr(docstore, "yield_keys", lambda: [])())

    def revision(self) -> int:
        with self._lock:
            return self._store.index.ntotal if self._store is not None else 0

    def as_retriever(self, top_k: int = 5):
        with self._lock:
            if self._store is None:
                return None
            return self._store.as_retriever(search_kwargs={"k": top_k})

    # ---------------------------------------------------------------- delete
    def delete_document(self, file_name: str) -> dict:
        with self._lock:
            entry = self._manifest.get(file_name)
            ids = list(entry.get("ids", [])) if entry else []
            if ids and self._store is not None:
                self._store.delete(ids)
            self._manifest.pop(file_name, None)

            if self._store is None or self._store.index.ntotal == 0:
                self.clear()
                return {"remaining_chunks": 0}

            self._save()
            return {"remaining_chunks": self._store.index.ntotal}

    def clear(self) -> None:
        with self._lock:
            if self._dir.exists():
                shutil.rmtree(self._dir, ignore_errors=True)
            self._dir.mkdir(parents=True, exist_ok=True)
            self._store = None
            self._manifest = {}

    def get_collection_stats(self) -> dict:
        with self._lock:
            total = self._store.index.ntotal if self._store is not None else 0
            return {
                "collection": self.collection_name,
                "total_chunks": total,
                "file_count": len(self._manifest),
            }


# ---------------------------------------------------------------- registry
_STORES: dict[str, VectorStore] = {}
_STORES_LOCK = threading.Lock()


def get_vector_store(collection_name: str) -> VectorStore:
    name = validate_collection_name(collection_name)
    with _STORES_LOCK:
        store = _STORES.get(name)
        if store is None:
            store = VectorStore(name)
            _STORES[name] = store
        return store


def list_collections() -> list[str]:
    if not FAISS_INDEX_DIR.exists():
        return []
    return sorted(
        d.name
        for d in FAISS_INDEX_DIR.iterdir()
        if d.is_dir() and (d / f"{_INDEX_NAME}.faiss").exists()
    )


def delete_collection(name: str) -> None:
    name = validate_collection_name(name)
    target = collection_dir(name)
    with _STORES_LOCK:
        _STORES.pop(name, None)
    if target.exists():
        shutil.rmtree(target, ignore_errors=True)
