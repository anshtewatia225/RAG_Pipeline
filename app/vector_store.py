import os
import json
import shutil
import faiss
import numpy as np
from app.config import get_embeddings, FAISS_INDEX_DIR


class VectorStore:
    def __init__(self, collection_name: str = "rag_documents"):
        self.collection_name = collection_name
        self._embedding_fn = get_embeddings()
        self._index_dir = os.path.join(FAISS_INDEX_DIR, collection_name)
        self._index_path = os.path.join(self._index_dir, "index.faiss")
        self._meta_path = os.path.join(self._index_dir, "metadata.json")
        self._documents: list[str] = []
        self._metadatas: list[dict] = []
        self._index: faiss.IndexFlatIP | None = None
        self._load_or_create()

    def _load_or_create(self):
        os.makedirs(self._index_dir, exist_ok=True)
        if os.path.exists(self._index_path):
            self._index = faiss.read_index(self._index_path)
            with open(self._meta_path, "r") as f:
                data = json.load(f)
                self._documents = data["documents"]
                self._metadatas = data["metadatas"]
        else:
            self._index = faiss.IndexFlatIP(3072)

    def add_documents(self, ids: list[str], documents: list[str], metadatas: list[dict]):
        embeddings = self._embedding_fn.embed_documents(documents)
        vectors = np.array(embeddings, dtype=np.float32)
        faiss.normalize_L2(vectors)
        self._index.add(vectors)
        self._documents.extend(documents)
        self._metadatas.extend(metadatas)
        self._save()

    def query(self, query_text: str, top_k: int = 5) -> dict:
        query_embedding = self._embedding_fn.embed_query(query_text)
        query_vector = np.array([query_embedding], dtype=np.float32)
        faiss.normalize_L2(query_vector)

        k = min(top_k, self._index.ntotal)
        distances, indices = self._index.search(query_vector, k)

        documents = []
        metadatas = []
        for idx in indices[0]:
            if idx < len(self._documents):
                documents.append(self._documents[idx])
                metadatas.append(self._metadatas[idx])

        return {
            "documents": documents,
            "metadatas": metadatas,
            "distances": distances[0].tolist(),
        }

    def _save(self):
        faiss.write_index(self._index, self._index_path)
        with open(self._meta_path, "w") as f:
            json.dump({"documents": self._documents, "metadatas": self._metadatas}, f)

    def get_collection_stats(self) -> dict:
        return {"collection": self.collection_name, "total_chunks": self._index.ntotal}

    def list_collections(self) -> list[str]:
        if not os.path.exists(FAISS_INDEX_DIR):
            return []
        return [
            d for d in os.listdir(FAISS_INDEX_DIR)
            if os.path.isdir(os.path.join(FAISS_INDEX_DIR, d))
        ]

    def delete_collection(self, name: str = None):
        target = name or self.collection_name
        path = os.path.join(FAISS_INDEX_DIR, target)
        if os.path.exists(path):
            shutil.rmtree(path)
