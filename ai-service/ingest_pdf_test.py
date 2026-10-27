
from pathlib import Path

from rag_service import ingest_pdf, collection

pdf_path = (
    Path(__file__).resolve().parent
    / "documents"
    / "operations_guide.pdf"
)

try:
    result = ingest_pdf(str(pdf_path))
    print("\nPDF ingestion successful!")
    print(result)
    print(f"Total chunks in collection: {collection.count()}")

except Exception as exc:
    print(f"\nPDF ingestion failed: {exc}")
    raise
