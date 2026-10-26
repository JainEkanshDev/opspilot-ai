
import json
import logging
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ValidationError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "llama3.2:3b"

app = FastAPI(
    title="OpsPilot AI Service",
    description="Local AI service for task interpretation",
    version="0.2.0",
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
