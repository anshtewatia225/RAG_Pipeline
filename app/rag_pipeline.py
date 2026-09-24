import uuid
import time
from typing import Optional
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables import RunnablePassthrough
from app.config import get_llm, get_tracer
from app.vector_store import VectorStore


class RAGPipeline:
    def __init__(self, collection_name: str = "rag_documents"):
        self.vector_store = VectorStore(collection_name)
        self.tracer = get_tracer()

    def _get_splitter(self, chunk_size: int = 500, chunk_overlap: int = 50):
        return RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            add_start_index=True,
        )

    def ingest_documents(
        self,
        file_paths: list[str],
        file_names: list[str],
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        collection_name: Optional[str] = None,
    ) -> dict:
        all_chunks = []
        doc_metadata = []

        splitter = self._get_splitter(chunk_size, chunk_overlap)

        for file_path, file_name in zip(file_paths, file_names):
            if file_name.endswith(".pdf"):
                from langchain_community.document_loaders import PyPDFLoader
                loader = PyPDFLoader(file_path)
                docs = loader.load()
            else:
                from langchain_community.document_loaders import TextLoader
                loader = TextLoader(file_path, encoding="utf-8")
                docs = loader.load()

            for doc in docs:
                doc.metadata["source"] = file_name
                doc.metadata["file_name"] = file_name

            chunks = splitter.split_documents(docs)

            for i, chunk in enumerate(chunks):
                chunk_id = f"{file_name}_{uuid.uuid4().hex[:8]}"
                all_chunks.append(
                    {
                        "id": chunk_id,
                        "text": chunk.page_content,
                        "metadata": {
                            "source": file_name,
                            "chunk_index": i,
                            "chunk_size": chunk_size,
                            "chunk_overlap": chunk_overlap,
                            **{k: str(v) for k, v in chunk.metadata.items() if k != "source"},
                        },
                    }
                )

        ids = [c["id"] for c in all_chunks]
        texts = [c["text"] for c in all_chunks]
        metadatas = [c["metadata"] for c in all_chunks]

        self.vector_store.add_documents(ids, texts, metadatas)

        return {
            "status": "success",
            "files_ingested": file_names,
            "total_chunks": len(all_chunks),
            "chunk_config": {"chunk_size": chunk_size, "chunk_overlap": chunk_overlap},
            "collection": collection_name or self.vector_store.collection_name,
        }

    def query(
        self,
        question: str,
        top_k: int = 5,
        collection_name: Optional[str] = None,
    ) -> dict:
        start_time = time.time()

        results = self.vector_store.query(question, top_k=top_k)
        retrieval_time = time.time() - start_time

        context_chunks = results["documents"]
        source_metadatas = results["metadatas"]
        distances = results["distances"]

        if not context_chunks:
            return {
                "answer": "No documents have been uploaded yet. Please upload a document in the sidebar to begin asking questions.",
                "sources": [],
                "retrieval_latency_ms": round(retrieval_time * 1000, 2),
                "llm_latency_ms": 0,
                "total_latency_ms": round(retrieval_time * 1000, 2),
                "chunks_retrieved": 0,
                "top_k": top_k,
            }

        context_text = "\n\n---\n\n".join(context_chunks)

        prompt = ChatPromptTemplate.from_template(
            """You are a helpful assistant. Answer the question based on the following context.
If the context doesn't contain enough information, say so honestly.

Context:
{context}

Question: {question}

Answer:"""
        )

        llm = get_llm()

        chain = (
            {"context": RunnablePassthrough(), "question": RunnablePassthrough()}
            | prompt
            | llm
            | StrOutputParser()
        )

        llm_start = time.time()
        answer = chain.invoke(
            {"context": context_text, "question": question},
            config={"callbacks": [self.tracer]},
        )
        llm_time = time.time() - llm_start

        sources = []
        for i, (doc, meta, dist) in enumerate(
            zip(context_chunks, source_metadatas, distances)
        ):
            sources.append(
                {
                    "chunk_index": i + 1,
                    "source": meta.get("source", "unknown"),
                    "distance": round(dist, 4),
                    "text": doc[:300] + "..." if len(doc) > 300 else doc,
                }
            )

        return {
            "answer": answer,
            "sources": sources,
            "retrieval_latency_ms": round(retrieval_time * 1000, 2),
            "llm_latency_ms": round(llm_time * 1000, 2),
            "total_latency_ms": round((retrieval_time + llm_time) * 1000, 2),
            "chunks_retrieved": len(context_chunks),
            "top_k": top_k,
        }
