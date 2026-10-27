
from rag_service import collection

before = collection.count()

# Remove the temporary chunks used in our first retrieval test.
collection.delete(where={"source": "test_document"})

after = collection.count()

print(f"Records before cleanup: {before}")
print(f"Records after cleanup:  {after}")
print(f"Records removed:        {before - after}")
