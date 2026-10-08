import asyncio
import hashlib
import logging
import time
import uuid
from pathlib import Path
from typing import AsyncGenerator, Optional

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser

from app.config import get_llm, get_tracer, get_settings
from app.memory import get_conversation_repository
from app.retrieval import get_retriever
from app.vector_store import get_vector_store

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a helpful AI assistant answering questions about the user's "
    "documents. Use ONLY the numbered context blocks provided. If the answer "
    "is not in the context, say so honestly. Cite the blocks you use with "
    "bracketed numbers, e.g. [1]."
)
USER_TEMPLATE = """Context:
{context}

Question: {question}

Answer:"""

CONDENSE_TEMPLATE = """Given the conversation so far and a follow-up question, \
rewrite the follow-up into a single standalone question that captures all the \
needed context. Return only the rewritten question with no preamble.

Chat history:
{history}

Follow-up question: {question}
Standalone question:"""

EMPTY_STORE_MESSAGE = (
    "No documents have been uploaded yet. Please upload a document in the "
    "sidebar to begin asking questions."
)
NO_MATCH_MESSAGE = (
    "I couldn't find sufficiently relevant information in the uploaded "
    "documents to answer that question."
)


class RAGPipeline:
    def __init__(self, collection_name: str = "rag_documents"):
        self.settings = get_settings()
        self.vector_store = get_vector_store(collection_name)
        self.retriever = get_retriever(self.vector_store, self.settings)
        self.tracer = get_tracer()

    def _get_splitter(self, chunk_size: int, chunk_overlap: int) -> RecursiveCharacterTextSplitter:
        return RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            length_function=len,
            add_start_index=True,
        )

    @staticmethod
    def _load_documents(file_path: str, file_name: str) -> list[Document]:
        if file_name.lower().endswith(".pdf"):
            from langchain_community.document_loaders import PyPDFLoader

            docs = PyPDFLoader(file_path).load()
        else:
            from langchain_community.document_loaders import TextLoader

            docs = TextLoader(file_path, encoding="utf-8").load()
        for doc in docs:
            doc.metadata["source"] = file_name
            doc.metadata["file_name"] = file_name
        return docs

    def ingest_documents(
        self,
        file_paths: list[str],
        file_names: list[str],
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        collection_name: Optional[str] = None,
    ) -> dict:
        splitter = self._get_splitter(chunk_size, chunk_overlap)
        collection = collection_name or self.vector_store.collection_name

        files_report: list[dict] = []
        deduplicated: list[dict] = []
        total_chunks = 0

        for file_path, file_name in zip(file_paths, file_names):
            sha256 = hashlib.sha256(Path(file_path).read_bytes()).hexdigest()
            duplicates = self.vector_store.find_duplicate_files(sha256)
            if duplicates:
                deduplicated.append({"name": file_name, "duplicate_of": duplicates[0]})
                files_report.append(
                    {
                        "name": file_name,
                        "chunks": 0,
                        "status": "duplicate",
                        "error": f"Identical file already uploaded as '{duplicates[0]}'.",
                    }
                )
                continue

            existing = self.vector_store.get_file(file_name)
            if existing is not None:
                self.vector_store.delete_document(file_name)

            docs = self._load_documents(file_path, file_name)
            chunks = splitter.split_documents(docs)

            if not chunks:
                extracted_chars = sum(len(doc.page_content.strip()) for doc in docs)
                logger.warning(
                    "No extractable text in %s (%d pages, %d non-whitespace chars)",
                    file_name,
                    len(docs),
                    extracted_chars,
                )
                message = (
                    "No pages could be read from this PDF."
                    if not docs
                    else "No extractable text found. This looks like a scanned or "
                    "image-only PDF; OCR is not supported."
                )
                files_report.append(
                    {"name": file_name, "chunks": 0, "status": "error", "error": message}
                )
                continue

            documents: list[Document] = []
            ids: list[str] = []
            for i, chunk in enumerate(chunks):
                chunk_id = uuid.uuid4().hex
                ids.append(chunk_id)
                metadata = {
                    "source": file_name,
                    "file_name": file_name,
                    "chunk_index": i,
                    "chunk_size": chunk_size,
                    "chunk_overlap": chunk_overlap,
                }
                if "page" in chunk.metadata:
                    metadata["page"] = chunk.metadata["page"]
                if "start_index" in chunk.metadata:
                    metadata["start_index"] = chunk.metadata["start_index"]
                documents.append(
                    Document(id=chunk_id, page_content=chunk.page_content, metadata=metadata)
                )

            self.vector_store.add_documents(
                documents, ids=ids, file_name=file_name, sha256=sha256
            )
            files_report.append(
                {"name": file_name, "chunks": len(documents), "status": "success"}
            )
            total_chunks += len(documents)

        return {
            "status": "success",
            "files_ingested": [
                f["name"] for f in files_report if f["chunks"] > 0
            ],
            "files": files_report,
            "total_chunks": total_chunks,
            "deduplicated": deduplicated,
            "chunk_config": {"chunk_size": chunk_size, "chunk_overlap": chunk_overlap},
            "collection": collection,
        }

    def _prepare_context(self, chunks: list[dict]) -> tuple[str, list[dict]]:
        """Deduplicate retrieved chunks and enforce the context budget."""
        max_chars = self.settings.max_context_chars
        seen: set[str] = set()
        blocks: list[str] = []
        sources: list[dict] = []
        used = 0

        for item in chunks:
            content = item["content"]
            if content in seen:
                continue
            seen.add(content)
            remaining = max_chars - used
            if remaining <= 0:
                break
            text = content if len(content) <= remaining else content[:remaining]
            blocks.append(f"[{len(blocks) + 1}] {text}")
            used += len(text)

            meta = item.get("metadata", {})
            source: dict = {
                "chunk_index": len(blocks),
                "source": meta.get("source", "unknown"),
                "distance": round(float(item.get("score", 0.0)), 4),
                "text": content[:300] + "..." if len(content) > 300 else content,
            }
            if meta.get("page") is not None:
                source["page"] = meta["page"]
            sources.append(source)
        return "\n\n---\n\n".join(blocks), sources

    async def _condense_question(self, question: str, history: list[dict]) -> str:
        rendered = "\n".join(
            f"{'User' if turn['role'] == 'user' else 'Assistant'}: {turn['content']}"
            for turn in history
        )
        prompt = ChatPromptTemplate.from_template(CONDENSE_TEMPLATE)
        chain = prompt | get_llm() | StrOutputParser()
        try:
            condensed = await chain.ainvoke({"history": rendered, "question": question})
            condensed = condensed.strip()
            return condensed or question
        except Exception:
            logger.warning("Question condensation failed; using raw question", exc_info=True)
            return question

    async def query_stream(
        self,
        question: str,
        top_k: int = 5,
        collection_name: Optional[str] = None,
        conversation_id: Optional[str] = None,
    ) -> AsyncGenerator[dict, None]:
        start_time = time.time()

        history: list[dict] = []
        if conversation_id:
            repo = get_conversation_repository()
            history = await asyncio.to_thread(
                repo.get_history,
                conversation_id,
                self.settings.max_history_chars,
                self.settings.history_max_turns,
            )

        search_query = question
        if history:
            search_query = await self._condense_question(question, history)

        chunks = await asyncio.to_thread(self.retriever.retrieve, search_query, top_k)
        retrieval_time = time.time() - start_time

        context_text, sources = self._prepare_context(chunks)

        yield {
            "type": "metadata",
            "sources": sources,
            "retrieval_latency_ms": round(retrieval_time * 1000, 2),
            "chunks_retrieved": len(chunks),
            "top_k": top_k,
        }

        if not chunks:
            message = (
                EMPTY_STORE_MESSAGE
                if self.vector_store.revision() == 0
                else NO_MATCH_MESSAGE
            )
            yield {"type": "token", "content": message}
            return

        history_messages = [
            ("human" if turn["role"] == "user" else "ai", turn["content"])
            for turn in history
        ]
        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", SYSTEM_PROMPT),
                MessagesPlaceholder("history", optional=True),
                ("human", USER_TEMPLATE),
            ]
        )
        chain = prompt | get_llm() | StrOutputParser()

        config = {"callbacks": [self.tracer]} if self.tracer else {}
        parts: list[str] = []
        async for chunk in chain.astream(
            {
                "context": context_text,
                "question": question,
                "history": history_messages,
            },
            config=config,
        ):
            parts.append(chunk)
            yield {"type": "token", "content": chunk}

        if conversation_id and parts:
            repo = get_conversation_repository()
            answer = "".join(parts)
            await asyncio.to_thread(repo.append, conversation_id, "user", question)
            await asyncio.to_thread(
                repo.append, conversation_id, "assistant", answer, sources
            )
