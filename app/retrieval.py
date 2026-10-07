import logging
import threading

from langchain_core.documents import Document

from app.config import Settings
from app.vector_store import VectorStore

logger = logging.getLogger(__name__)

_RRF_K = 60


class HybridRetriever:
    """Dense + BM25 retrieval with optional MMR and cross-encoder reranking.

    Pipeline: dense candidates (MMR-diversified when enabled) + BM25 candidates
    fused with reciprocal rank fusion, then optionally reranked by a local
    Flashrank cross-encoder, then thresholded.
    """

    def __init__(self, store: VectorStore, settings: Settings):
        self._store = store
        self._settings = settings
        self._bm25 = None
        self._bm25_revision = -1
        self._reranker = None
        self._rerank_failed = False

    # ------------------------------------------------------------- components
    def _get_bm25(self):
        revision = self._store.revision()
        if self._bm25 is not None and revision == self._bm25_revision:
            return self._bm25
        documents = self._store.all_documents()
        if not documents:
            self._bm25 = None
            return None
        try:
            from langchain_community.retrievers import BM25Retriever

            self._bm25 = BM25Retriever.from_documents(documents)
            self._bm25_revision = revision
        except Exception:
            logger.warning("BM25 unavailable; falling back to dense-only retrieval", exc_info=True)
            self._bm25 = None
        return self._bm25

    def _get_reranker(self):
        if not self._settings.rerank_enabled or self._rerank_failed:
            return None
        if self._reranker is None:
            try:
                from langchain_community.document_compressors import FlashrankRerank

                top_n = max(self._settings.fetch_k, self._settings.max_top_k)
                self._reranker = FlashrankRerank(
                    model=self._settings.rerank_model, top_n=top_n
                )
            except Exception:
                self._rerank_failed = True
                logger.warning("Reranker unavailable; skipping rerank", exc_info=True)
                return None
        return self._reranker

    # ---------------------------------------------------------------- helpers
    def _dense_candidates(self, query: str, fetch_k: int) -> list[Document]:
        settings = self._settings
        if settings.mmr_enabled:
            docs = self._store.max_marginal_relevance_search(
                query,
                k=fetch_k,
                fetch_k=max(fetch_k * 2, fetch_k),
                lambda_mult=settings.mmr_lambda,
            )
            if docs:
                return docs
        return [doc for doc, _ in self._store.similarity_search_with_score(query, k=fetch_k)]

    @staticmethod
    def _reciprocal_rank_fusion(
        dense: list[Document],
        sparse: list[Document],
        dense_weight: float,
        sparse_weight: float,
    ) -> list[Document]:
        fused: dict[str, float] = {}
        docs: dict[str, Document] = {}

        for ranked, weight in ((dense, dense_weight), (sparse, sparse_weight)):
            for rank, doc in enumerate(ranked):
                key = doc.page_content
                docs.setdefault(key, doc)
                fused[key] = fused.get(key, 0.0) + weight / (_RRF_K + rank + 1)

        ordered = sorted(fused, key=lambda k: fused[k], reverse=True)
        return [docs[k] for k in ordered]

    # ---------------------------------------------------------------- retrieve
    def retrieve(self, query: str, top_k: int) -> list[dict]:
        settings = self._settings
        if self._store.revision() == 0:
            return []

        fetch_k = max(top_k, settings.fetch_k)
        dense = self._dense_candidates(query, fetch_k)
        candidates = dense

        if settings.hybrid_search:
            bm25 = self._get_bm25()
            if bm25 is not None:
                bm25.k = fetch_k
                try:
                    sparse = bm25.invoke(query)
                except Exception:
                    logger.warning("BM25 query failed", exc_info=True)
                    sparse = []
                if sparse:
                    candidates = self._reciprocal_rank_fusion(
                        dense, sparse, settings.dense_weight, settings.bm25_weight
                    )

        score_map = {
            doc.page_content: float(score)
            for doc, score in self._store.similarity_search_with_score(query, k=fetch_k)
        }

        reranked = False
        reranker = self._get_reranker()
        if reranker is not None and candidates:
            try:
                sheet = candidates[: max(fetch_k, top_k)]
                candidates = list(reranker.compress_documents(sheet, query))
                reranked = True
            except Exception:
                logger.warning("Rerank failed; using fused order", exc_info=True)
                reranked = False

        results: list[dict] = []
        for doc in candidates:
            meta = dict(doc.metadata)
            rerank_score = meta.pop("relevance_score", None)
            score = float(rerank_score) if rerank_score is not None else score_map.get(doc.page_content, 0.0)
            results.append(
                {"content": doc.page_content, "metadata": meta, "score": score}
            )

        if reranked and settings.min_rerank_score > 0:
            results = [r for r in results if r["score"] >= settings.min_rerank_score]
        elif not reranked and settings.min_score > 0:
            results = [r for r in results if r["score"] >= settings.min_score]

        return results[:top_k]


_RETRIEVERS: dict[str, HybridRetriever] = {}
_RETRIEVERS_LOCK = threading.Lock()


def get_retriever(store: VectorStore, settings: Settings) -> HybridRetriever:
    """Return a cached retriever for a collection so BM25/reranker are reused."""
    key = store.collection_name
    with _RETRIEVERS_LOCK:
        retriever = _RETRIEVERS.get(key)
        if retriever is None or retriever._store is not store:
            retriever = HybridRetriever(store, settings)
            _RETRIEVERS[key] = retriever
        return retriever
