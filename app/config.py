import os
from dotenv import load_dotenv
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_groq import ChatGroq
from langchain_core.tracers import LangChainTracer
from langsmith import Client

load_dotenv()

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
LANGSMITH_API_KEY = os.getenv("LANGSMITH_API_KEY")
LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "rag-pipeline")
LANGSMITH_ENDPOINT = os.getenv("LANGSMITH_ENDPOINT")

FAISS_INDEX_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "faiss_indexes")
DEFAULT_COLLECTION = "rag_documents"

EMBEDDING_MODEL = "gemini-embedding-2-preview"
LLM_MODEL = "openai/gpt-oss-120b"


def get_embeddings():
    return GoogleGenerativeAIEmbeddings(
        model=EMBEDDING_MODEL,
        google_api_key=os.getenv("GOOGLE_API_KEY"),
    )


def get_llm(temperature=0.0):
    return ChatGroq(
        model=LLM_MODEL,
        groq_api_key=GROQ_API_KEY,
        temperature=temperature,
    )


def get_tracer():
    return LangChainTracer(
        project_name=LANGSMITH_PROJECT,
    )


def get_langsmith_client():
    return Client(api_key=LANGSMITH_API_KEY)
