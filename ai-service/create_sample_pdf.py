
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

output_path = (
    Path(__file__).resolve().parent
    / "documents"
    / "operations_guide.pdf"
)

output_path.parent.mkdir(parents=True, exist_ok=True)

pdf = canvas.Canvas(str(output_path), pagesize=letter)
text = pdf.beginText(50, 740)
text.setFont("Helvetica", 11)

content = [
    "OpsPilot AI - Operations Guide",
    "",
    "Task Management",
    "Every task has a title, description, priority, and status.",
    "The available statuses are pending, in progress, completed, and failed.",
    "",
    "Priority Levels",
    "Low priority tasks can be handled during normal working hours.",
    "Medium priority tasks should be addressed as part of regular planning.",
    "High priority tasks require prompt investigation.",
    "Urgent tasks should be handled as soon as possible.",
    "",
    "Task Activity History",
    "OpsPilot records task status changes in its activity history.",
    "AI-created tasks can record the original request and the AI model used.",
    "Activity records include timestamps so teams can review task progress.",
    "",
    "Database Incident Procedure",
    "When database queries become slow, investigate query execution plans.",
    "Review database indexes and identify queries that scan too many rows.",
    "Test any optimization before deploying it to production.",
]

for line in content:
    text.textLine(line)

pdf.drawText(text)
pdf.save()

print(f"Sample PDF created: {output_path}")
