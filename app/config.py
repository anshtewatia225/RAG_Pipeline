import os
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_groq import ChatGroq
from langchain_core.tracers import LangChainTracer

BASE_DIR = Path(__file__).resolve().parent.parent
FAISS_INDEX_DIR = BASE_DIR / "faiss_indexes"
DATA_DIR = BASE_DIR / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BASE_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_api_key: str
    groq_api_key: str

    langsmith_api_key: str | None = None
    langsmith_project: str = "rag-pipeline"
    langsmith_endpoint: str | None = None
    langsmith_tracing: bool = True

    cors_origins: str = "*"
    max_upload_mb: int = 20
    max_context_chars: int = 12000
    default_top_k: int = 5
    max_top_k: int = 20
    max_chunk_size: int = 4000

    default_collection: str = "rag_documents"
    embedding_model: str = "gemini-embedding-2-preview"
    llm_model: str = "openai/gpt-oss-120b"

    # Conversation memory
    conversation_db: str = ""
    max_history_chars: int = 6000
    history_max_turns: int = 20

    # Retrieval quality
    fetch_k: int = 20
    min_score: float = 0.0
    hybrid_search: bool = True
    mmr_enabled: bool = True
    mmr_lambda: float = 0.5
    bm25_weight: float = 0.4
    dense_weight: float = 0.6
    rerank_enabled: bool = True
    rerank_model: str = "ms-marco-MiniLM-L-12-v2"
    min_rerank_score: float = 0.0

    # Reliability / caching
    llm_cache: bool = True
    embedding_cache: bool = True
    llm_timeout: float = 60.0
    llm_max_retries: int = 2
    embedding_max_retries: int = 3

    @property
    def conversation_db_path(self) -> Path:
        if self.conversation_db:
            return Path(self.conversation_db)
        return DATA_DIR / "conversations.db"

    @property
    def llm_cache_path(self) -> Path:
        return DATA_DIR / "llm_cache.db"

    @property
    def embedding_cache_path(self) -> Path:
        return DATA_DIR / "embedding_cache.db"

    @field_validator("cors_origins")
    @classmethod
    def _validate_cors(cls, value: str) -> str:
        value = value.strip()
        return value or "*"

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    settings = Settings()

    if settings.langsmith_api_key:
        os.environ.setdefault("LANGSMITH_API_KEY", settings.langsmith_api_key)
        os.environ.setdefault("LANGSMITH_PROJECT", settings.langsmith_project)
        os.environ.setdefault(
            "LANGSMITH_TRACING", "true" if settings.langsmith_tracing else "false"
        )
        if settings.langsmith_endpoint:
            os.environ.setdefault("LANGSMITH_ENDPOINT", settings.langsmith_endpoint)

    return settings


DEFAULT_COLLECTION = get_settings().default_collection
EMBEDDING_MODEL = get_settings().embedding_model
LLM_MODEL = get_settings().llm_model


def _base_embeddings() -> GoogleGenerativeAIEmbeddings:
    settings = get_settings()
    return GoogleGenerativeAIEmbeddings(
        model=settings.embedding_model,
        google_api_key=settings.google_api_key,
    )


def get_embeddings():
    settings = get_settings()
    inner = _base_embeddings()
    if not settings.embedding_cache:
        return inner
    from app.caching import CachedEmbeddings

    return CachedEmbeddings(
        inner,
        db_path=settings.embedding_cache_path,
        model_name=settings.embedding_model,
        max_retries=settings.embedding_max_retries,
    )


def get_llm(temperature: float = 0.0) -> ChatGroq:
    settings = get_settings()
    return ChatGroq(
        model=settings.llm_model,
        groq_api_key=settings.groq_api_key,
        temperature=temperature,
        timeout=settings.llm_timeout,
        max_retries=settings.llm_max_retries,
    )


def configure_llm_cache() -> None:
    settings = get_settings()
    if not settings.llm_cache:
        return
    from langchain_core.globals import set_llm_cache
    from langchain_community.cache import SQLiteCache

    settings.llm_cache_path.parent.mkdir(parents=True, exist_ok=True)
    set_llm_cache(SQLiteCache(database_path=str(settings.llm_cache_path)))


def get_tracer() -> LangChainTracer | None:
    settings = get_settings()
    if not settings.langsmith_api_key:
        return None
    return LangChainTracer(project_name=settings.langsmith_project)
