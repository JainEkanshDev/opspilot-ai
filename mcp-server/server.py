
import json

import httpx
from mcp.server import MCPServer

NODE_API_URL = "http://localhost:3000"
AI_SERVICE_URL = "http://localhost:8000"

mcp = MCPServer("OpsPilot MCP Server")


async def get_json(url: str) -> dict | list:
    """Request JSON from an existing OpsPilot API."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.get(url)
        response.raise_for_status()
        return response.json()


@mcp.tool()
async def list_tasks() -> str:
    """List tasks currently available in the OpsPilot workspace."""
    try:
        data = await get_json(f"{NODE_API_URL}/api/tasks")
        return json.dumps(data, ensure_ascii=False)
    except httpx.HTTPError as exc:
        return f"Could not retrieve tasks: {exc}"


@mcp.tool()
async def get_task_activity(task_id: int) -> str:
    """Get the activity history for an OpsPilot task by its numeric ID."""
    if task_id <= 0:
        return "Invalid task ID. Provide a positive integer."

    try:
        data = await get_json(
            f"{NODE_API_URL}/api/tasks/{task_id}/activity"
        )
        return json.dumps(data, ensure_ascii=False)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return f"Task {task_id} was not found."
        return f"Could not retrieve task activity: HTTP {exc.response.status_code}"
    except httpx.HTTPError as exc:
        return f"Could not retrieve task activity: {exc}"


@mcp.tool()
async def ask_documents(question: str) -> str:
    """Ask a question about PDFs indexed in the OpsPilot knowledge base."""
    question = question.strip()

    if len(question) < 3:
        return "Please provide a question containing at least 3 characters."

    if len(question) > 2000:
        return "The question must not exceed 2000 characters."

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{AI_SERVICE_URL}/api/rag/ask",
                json={"question": question},
            )
            response.raise_for_status()
            return json.dumps(response.json(), ensure_ascii=False)
    except httpx.HTTPError as exc:
        return f"Could not query the document knowledge base: {exc}"


if __name__ == "__main__":
    mcp.run(
        transport="streamable-http",
        host="127.0.0.1",
        port=8100,
    )
