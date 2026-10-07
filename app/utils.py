import re
from pathlib import Path

from app.config import FAISS_INDEX_DIR

_COLLECTION_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_CONVERSATION_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def validate_collection_name(name: str) -> str:
    if not isinstance(name, str) or not _COLLECTION_RE.match(name.strip()):
        raise ValueError(
            "Invalid collection name. Use 1-64 characters of letters, digits, '-' or '_'."
        )
    return name.strip()


def validate_conversation_id(conversation_id: str) -> str:
    if not isinstance(conversation_id, str) or not _CONVERSATION_RE.match(
        conversation_id.strip()
    ):
        raise ValueError(
            "Invalid conversation id. Use 1-128 characters of letters, digits, '-' or '_'."
        )
    return conversation_id.strip()


def collection_dir(name: str) -> Path:
    name = validate_collection_name(name)
    base = FAISS_INDEX_DIR.resolve()
    target = (base / name).resolve()
    if target != base and base not in target.parents:
        raise ValueError("Invalid collection path.")
    return target
