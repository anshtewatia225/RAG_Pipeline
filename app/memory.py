import json
import logging
from datetime import datetime, timezone
from functools import lru_cache
from typing import Optional

from sqlalchemy import DateTime, Index, String, Text, create_engine, event, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

from app.config import get_settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    __table_args__ = (
        Index("ix_messages_conversation_created", "conversation_id", "id"),
    )


class ConversationRepository:
    """SQLAlchemy-backed store for conversation history.

    Uses SQLite now but the session/engine abstraction lets the same code point
    at Postgres later by changing the connection URL.
    """

    def __init__(self, db_path):
        url = f"sqlite:///{db_path}"
        self._engine = create_engine(
            url, connect_args={"check_same_thread": False}, pool_pre_ping=True
        )

        @event.listens_for(self._engine, "connect")
        def _set_pragma(dbapi_connection, _record):  # pragma: no cover - driver glue
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()

        Base.metadata.create_all(self._engine)
        self._sessionmaker = sessionmaker(bind=self._engine, expire_on_commit=False)

    def _session(self) -> Session:
        return self._sessionmaker()

    def append(
        self,
        conversation_id: str,
        role: str,
        content: str,
        sources: Optional[list[dict]] = None,
    ) -> None:
        meta = json.dumps(sources) if sources else None
        with self._session() as session:
            session.add(
                Message(
                    conversation_id=conversation_id,
                    role=role,
                    content=content,
                    meta=meta,
                )
            )
            session.commit()

    def list_messages(self, conversation_id: str) -> list[dict]:
        with self._session() as session:
            rows = session.scalars(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.id)
            ).all()
            return [self._to_dict(row) for row in rows]

    def get_history(
        self,
        conversation_id: str,
        max_chars: int,
        max_turns: int,
    ) -> list[dict]:
        """Return recent history, chronological, bounded by chars and turns."""
        with self._session() as session:
            rows = session.scalars(
                select(Message)
                .where(Message.conversation_id == conversation_id)
                .order_by(Message.id.desc())
                .limit(max(1, max_turns))
            ).all()

        selected: list[dict] = []
        used = 0
        for row in rows:
            size = len(row.content)
            if selected and used + size > max_chars:
                break
            selected.append({"role": row.role, "content": row.content})
            used += size

        selected.reverse()
        return selected

    def delete(self, conversation_id: str) -> int:
        with self._session() as session:
            deleted = (
                session.query(Message)
                .filter(Message.conversation_id == conversation_id)
                .delete()
            )
            session.commit()
            return int(deleted)

    @staticmethod
    def _to_dict(row: Message) -> dict:
        item: dict = {"role": row.role, "content": row.content}
        if row.meta:
            try:
                item["sources"] = json.loads(row.meta)
            except json.JSONDecodeError:
                pass
        return item


@lru_cache
def get_conversation_repository() -> ConversationRepository:
    settings = get_settings()
    db_path = settings.conversation_db_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return ConversationRepository(db_path)
