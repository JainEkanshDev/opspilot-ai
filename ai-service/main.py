from fastapi import FastAPI

app = FastAPI(
    title="OpsPilot AI Service",
    description="AI service for restaurant booking investigations",
    version="0.1.0",
)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "opspilot-ai-service",
    }