
from rag_service import answer_question

questions = [
    "What should engineers do when database queries become slow?",
    "What are the priority levels in OpsPilot?",
    "What is the procedure for resetting employee passwords?",
]

for question in questions:
    print("\n" + "=" * 60)
    print(f"QUESTION: {question}")

    result = answer_question(question, top_k=4)

    print("\nANSWER:")
    print(result["answer"])

    print("\nSOURCES:")
    for source in result["sources"]:
        print(source)
