from rag_service import answer_question
from pathlib import Path

from rag_service import (
    chunk_text,
    generate_embeddings,
    collection,
)

# 1. Verify text chunking.
sample_text = """
OpsPilot AI helps teams manage operational tasks.
High-priority tasks should be investigated promptly.
Task activity history records status changes and events.
"""

chunks = chunk_text(sample_text, chunk_size=80, overlap=15)

print("\n--- CHUNKING TEST ---")
print(f"Chunks created: {len(chunks)}")

for index, chunk in enumerate(chunks, start=1):
    print(f"\nChunk {index}: {chunk}")

# 2. Generate real embeddings using Ollama.
print("\n--- EMBEDDING TEST ---")
embeddings = generate_embeddings(chunks)

print(f"Embeddings generated: {len(embeddings)}")
print(f"Vector dimensions: {len(embeddings[0])}")

# 3. Store the sample chunks in ChromaDB.
collection.upsert(
    ids=[f"rag-test-{i}" for i in range(len(chunks))],
    documents=chunks,
    embeddings=embeddings,
    metadatas=[
        {"source": "test_document", "chunk_index": i}
        for i in range(len(chunks))
    ],
)

print("\n--- STORAGE TEST ---")
print(f"Total stored records: {collection.count()}")

# 4. Search using a real query embedding.
query = "How does OpsPilot track task progress?"
query_embedding = generate_embeddings([query])[0]

results = collection.query(
    query_embeddings=[query_embedding],
    n_results=min(2, collection.count()),
    include=["documents", "distances", "metadatas"],
)

print("\n--- RETRIEVAL TEST ---")

for document, distance, metadata in zip(
    results["documents"][0],
    results["distances"][0],
    results["metadatas"][0],
):
    print(f"\nDocument: {document}")
    print(f"Distance: {distance:.4f}")
    print(f"Metadata: {metadata}")

print("\nRAG component test completed.")

print("\n--- RAG QUESTION-ANSWERING TEST ---")

result = answer_question(
    "How does OpsPilot track task progress?"
)

print("\nAnswer:")
print(result["answer"])

print("\nRetrieved sources:")
for source in result["sources"]:
    print(source)