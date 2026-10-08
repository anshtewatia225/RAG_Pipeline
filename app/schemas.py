from typing import Optional

from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int = Field(default=5, ge=1, le=20)
    collection_name: Optional[str] = None
    conversation_id: Optional[str] = Field(default=None, max_length=128)


class Source(BaseModel):
    chunk_index: int
    source: str
    distance: float
    text: str
    page: Optional[int] = None


class ConversationMessage(BaseModel):
    role: str
    content: str
    sources: Optional[list[Source]] = None


class ConversationResponse(BaseModel):
    conversation_id: str
    messages: list[ConversationMessage]


class IngestFileReport(BaseModel):
    name: str
    chunks: int
    status: str = "success"
    error: Optional[str] = None


class IngestResponse(BaseModel):
    status: str
    files_ingested: list[str]
    files: list[IngestFileReport]
    total_chunks: int
    deduplicated: list[dict]
    chunk_config: dict
    collection: str


class CollectionStats(BaseModel):
    collection: str
    total_chunks: int
    file_count: int


class HealthResponse(BaseModel):
    status: str
