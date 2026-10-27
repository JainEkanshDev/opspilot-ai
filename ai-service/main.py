
import json
import logging
from typing import Literal
from rag_service import answer_question,ingest_pdf
import httpx
from fastapi import FastAPI, HTTPException,UploadFile, File
from pydantic import BaseModel, Field, ValidationError
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from uuid import uuid4
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2:3b"

app = FastAPI(
    title="OpsPilot AI Service",
    description="Local AI service for task interpretation",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class InterpretRequest(BaseModel):
    request: str = Field(min_length=3, max_length=2000)


class TaskInterpretation(BaseModel):
    intent: Literal["create_task", "unknown"]
    title: str = Field(min_length=1, max_length=200)
    priority: Literal["low", "medium", "high", "urgent"]
    status: Literal["pending"]


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "opspilot-ai-service",
        "model": OLLAMA_MODEL,
    }


@app.post("/api/interpret")
async def interpret_request(body: InterpretRequest):
    system_prompt = """
You are the request interpreter for OpsPilot, a task management system.

Convert the user's request into a JSON object with exactly these fields:
- intent: "create_task" or "unknown"
- title: a concise task title
- priority: "low", "medium", "high", or "urgent"
- status: always "pending"

Rules:
1. Use "create_task" only when the user clearly asks to create or add a task.
2. Use "unknown" when the intent is unclear or unrelated to task creation.
3. Remove command phrases and priority wording from the task title.
4. Choose "medium" if no priority is specified.
5. Never invent details that the user did not provide.
6. Return JSON only, with no Markdown or explanation.
"""

    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": body.request},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            response = await client.post(OLLAMA_URL, json=payload)
            response.raise_for_status()
            result = response.json()

        model_output = result["message"]["content"]
        parsed_output = json.loads(model_output)
        interpretation = TaskInterpretation.model_validate(parsed_output)

        return {
            "success": True,
            "data": interpretation.model_dump(),
            "ai_model_connected": True,
            "model": OLLAMA_MODEL,
        }

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Cannot connect to Ollama. Check that Ollama is running.",
        ) from None

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="The local AI model took too long to respond.",
        ) from None

    except (
        httpx.HTTPStatusError,
        KeyError,
        json.JSONDecodeError,
        ValidationError,
    ):
        logger.exception("Failed to obtain a valid interpretation from Ollama")
        raise HTTPException(
            status_code=502,
            detail="The AI model did not return a valid task interpretation.",
        ) from None


class RagQuestionRequest(BaseModel):
    question: str = Field(min_length=3, max_length=2000)


@app.post("/api/rag/ask")
def ask_rag_question(body: RagQuestionRequest):
    try:
        result = answer_question(body.question)

        return {
            "success": True,
            "answer": result["answer"],
            "sources": result["sources"],
        }

    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from None

    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Cannot connect to Ollama. Check that Ollama is running.",
        ) from None

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail="The AI service timed out while processing the question.",
        ) from None

    except httpx.HTTPStatusError:
        logger.exception("Ollama returned an HTTP error during RAG")
        raise HTTPException(
            status_code=502,
            detail="Ollama failed to process the RAG request.",
        ) from None

    except Exception:
        logger.exception("Unexpected error while processing RAG question")
        raise HTTPException(
            status_code=500,
            detail="Failed to process the RAG question.",
        ) from None


UPLOAD_DIR = Path(__file__).resolve().parent / "documents" / "uploads"
MAX_PDF_SIZE = 10 * 1024 * 1024  # 10 MB


@app.post("/api/rag/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Please select a PDF file.",
        )

    if Path(file.filename).suffix.lower() != ".pdf":
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported.",
        )

    content = await file.read(MAX_PDF_SIZE + 1)

    if len(content) > MAX_PDF_SIZE:
        raise HTTPException(
            status_code=413,
            detail="PDF must be 10 MB or smaller.",
        )

    if not content.startswith(b"%PDF-"):
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid PDF.",
        )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # Generate a unique filename to avoid overwriting existing files.
    saved_name = f"{uuid4().hex}.pdf"
    file_path = UPLOAD_DIR / saved_name

    try:
        file_path.write_bytes(content)

        # Reuse your existing PDF extraction, chunking,
        # embedding, and ChromaDB indexing pipeline.
        ingest_pdf(str(file_path))

        return {
            "success": True,
            "filename": file.filename,
            "message": "PDF uploaded and indexed successfully.",
        }

    except Exception as exc:
        # Do not leave a partially processed file behind.
        file_path.unlink(missing_ok=True)

        raise HTTPException(
            status_code=500,
            detail="Failed to process and index the PDF.",
        ) from exc

    finally:
        await file.close()
    
    
