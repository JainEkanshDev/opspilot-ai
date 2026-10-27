
import { useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://localhost:3000'
const AI_SERVICE_URL = 'http://localhost:8000'
const USER_ID = 1
const MAX_PDF_SIZE = 10 * 1024 * 1024

type TaskStatus = 'pending' | 'in_progress' | 'completed'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

interface Task {
  id: number
  title: string
  description?: string | null
  status: TaskStatus
  priority: TaskPriority
  created_at?: string
  updated_at?: string
}

interface TaskEvent {
  id: number
  task_id: number
  event_type: string
  details?: unknown
  created_at: string
}

interface TaskActivityResponse {
  success: boolean
  events: TaskEvent[]
}

interface ApiTaskResponse {
  success: boolean
  data?: Task
  task?: Task
  message?: string
}

interface RagSource {
  label: string
  source: string
  chunk_index: number
  distance?: number
}

interface RagResponse {
  success: boolean
  answer: string
  sources: RagSource[]
}

interface UploadResponse {
  success: boolean
  filename: string
  message: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}))

  if (!response.ok) {
    const errorBody = body as { detail?: string; message?: string }
    throw new Error(
      errorBody.detail || errorBody.message || `Request failed (${response.status})`,
    )
  }

  return body as T
}

function formatStatus(status: TaskStatus): string {
  return status.replace('_', ' ')
}

function formatEventName(eventType: string): string {
  return eventType.replaceAll('_', ' ')
}

function formatEventDetails(details: unknown): string {
  if (details == null) return ''

  let parsed = details

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
    return typeof details === 'string' ? details : ''
  }
  }

  if (typeof parsed === 'object') {
    return Object.entries(parsed as Record<string, unknown>)
      .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`)
      .join(' · ')
  }

  return String(parsed)
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loadingTasks, setLoadingTasks] = useState(true)
  const [request, setRequest] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(null)
  const [pageError, setPageError] = useState('')
  const [notice, setNotice] = useState('')

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityError, setActivityError] = useState('')

  const [selectedPdf, setSelectedPdf] = useState<File | null>(null)
  const [uploadingPdf, setUploadingPdf] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')

  const [ragQuestion, setRagQuestion] = useState('')
  const [ragAnswer, setRagAnswer] = useState('')
  const [ragSources, setRagSources] = useState<RagSource[]>([])
  const [askingRag, setAskingRag] = useState(false)
  const [ragError, setRagError] = useState('')

  async function loadTasks() {
    setLoadingTasks(true)
    setPageError('')

    try {
      const response = await fetch(`${API_URL}/api/tasks`)
      const result = await readResponse<{ success: boolean; data?: Task[]; tasks?: Task[] }>(response)
      setTasks(result.data ?? result.tasks ?? [])
    } catch (error) {
      setPageError(getErrorMessage(error))
    } finally {
      setLoadingTasks(false)
    }
  }

  useEffect(() => {
    void loadTasks()
  }, [])

  async function createTask() {
    if (request.trim().length < 3) {
      setPageError('Enter a task request with at least 3 characters.')
      return
    }

    setCreatingTask(true)
    setPageError('')
    setNotice('')

    try {
      const response = await fetch(`${API_URL}/api/ai/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request.trim(), user_id: USER_ID }),
      })

      const result = await readResponse<ApiTaskResponse>(response)
      setRequest('')
      setNotice(result.message || 'Task created successfully.')
      await loadTasks()
    } catch (error) {
      setPageError(getErrorMessage(error))
    } finally {
      setCreatingTask(false)
    }
  }

  async function updateTaskStatus(task: Task, status: TaskStatus) {
    setUpdatingTaskId(task.id)
    setPageError('')
    setNotice('')

    try {
      const response = await fetch(`${API_URL}/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      await readResponse(response)
      setNotice(`Task #${task.id} marked ${formatStatus(status)}.`)
      await loadTasks()

      if (selectedTask?.id === task.id) {
        await viewActivity(task)
      }
    } catch (error) {
      setPageError(getErrorMessage(error))
    } finally {
      setUpdatingTaskId(null)
    }
  }

  async function viewActivity(task: Task) {
    setSelectedTask(task)
    setTaskEvents([])
    setActivityError('')
    setLoadingActivity(true)

    try {
      const response = await fetch(`${API_URL}/api/tasks/${task.id}/activity`)
      const result = await readResponse<TaskActivityResponse>(response)
      setTaskEvents(result.events ?? [])
    } catch (error) {
      setActivityError(getErrorMessage(error))
    } finally {
      setLoadingActivity(false)
    }
  }

  async function handlePdfUpload() {
    if (!selectedPdf) {
      setUploadError('Please select a PDF file first.')
      return
    }

    if (selectedPdf.size > MAX_PDF_SIZE) {
      setUploadError('The PDF must be 10 MB or smaller.')
      return
    }

    if (
      selectedPdf.type !== 'application/pdf' &&
      !selectedPdf.name.toLowerCase().endsWith('.pdf')
    ) {
      setUploadError('Please select a PDF file.')
      return
    }

    setUploadingPdf(true)
    setUploadMessage('')
    setUploadError('')

    const formData = new FormData()
    formData.append('file', selectedPdf)

    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/rag/upload`, {
        method: 'POST',
        body: formData,
      })

      const result = await readResponse<UploadResponse>(response)

      setUploadMessage(result.message || 'PDF uploaded and indexed successfully.')
      setSelectedPdf(null)

      const input = document.getElementById('pdf-upload') as HTMLInputElement | null
      if (input) input.value = ''
    } catch (error) {
      setUploadError(getErrorMessage(error))
    } finally {
      setUploadingPdf(false)
    }
  }

  async function askDocumentQuestion() {
    if (ragQuestion.trim().length < 3) {
      setRagError('Enter a question with at least 3 characters.')
      return
    }

    setAskingRag(true)
    setRagError('')
    setRagAnswer('')
    setRagSources([])

    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/rag/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: ragQuestion.trim() }),
      })

      const result = await readResponse<RagResponse>(response)
      setRagAnswer(result.answer)
      setRagSources(result.sources ?? [])
    } catch (error) {
      setRagError(getErrorMessage(error))
    } finally {
      setAskingRag(false)
    }
  }

  const completedTasks = tasks.filter((task) => task.status === 'completed').length
  const activeTasks = tasks.filter((task) => task.status === 'in_progress').length
  const pendingTasks = tasks.filter((task) => task.status === 'pending').length

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">O</div>
          <div>
            <strong>OpsPilot</strong>
            <span>AI WORKSPACE</span>
          </div>
        </div>

        <p className="sidebar-label">WORKSPACE</p>
        <a className="sidebar-link active" href="#overview">Overview</a>
        <a className="sidebar-link" href="#tasks">Tasks</a>
        <a className="sidebar-link" href="#documents">Knowledge base</a>

        <div className="sidebar-bottom">
          <div className="avatar">O</div>
          <div>
            <strong>Workspace user</strong>
            <span>Local development</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">OPERATIONS WORKSPACE</p>
            <h1>Good to see you</h1>
            <p className="muted">Manage work and get answers from your documents.</p>
          </div>
          <div className="status-pill">
            <span className="status-dot" />
            Local AI connected
          </div>
        </header>

        {pageError && <div className="error-banner" role="alert">{pageError}</div>}
        {notice && <div className="success-banner" role="status">{notice}</div>}

        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-label">Total tasks</span>
            <strong>{tasks.length}</strong>
            <span className="stat-caption">Across your workspace</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Pending</span>
            <strong>{pendingTasks}</strong>
            <span className="stat-caption">Waiting to start</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">In progress</span>
            <strong>{activeTasks}</strong>
            <span className="stat-caption">Currently underway</span>
          </article>
          <article className="stat-card">
            <span className="stat-label">Completed</span>
            <strong>{completedTasks}</strong>
            <span className="stat-caption">Successfully finished</span>
          </article>
        </section>

        <section className="panel task-create-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">AI TASK ASSISTANT</p>
              <h2>What needs to get done?</h2>
              <p className="muted">Describe the task in plain English and let AI structure it.</p>
            </div>
            <span className="feature-pill">AI powered</span>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void createTask()
            }}
          >
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="e.g. Investigate slow database queries and mark it as high priority..."
              rows={3}
              maxLength={2000}
            />
            <div className="form-footer">
              <span className="muted">Be as descriptive as you need.</span>
              <button type="submit" disabled={creatingTask || request.trim().length < 3}>
                {creatingTask ? 'Creating task...' : 'Create task →'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel upload-panel" id="documents">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">KNOWLEDGE BASE</p>
              <h2>Upload a document</h2>
              <p className="muted">Add a PDF to your local AI knowledge base.</p>
            </div>
            <span className="feature-pill">PDF · Max 10 MB</span>
          </div>

          <div className="upload-controls">
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf,application/pdf"
              disabled={uploadingPdf}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                setSelectedPdf(file)
                setUploadMessage('')
                setUploadError('')
              }}
            />

            <button
              type="button"
              onClick={() => void handlePdfUpload()}
              disabled={!selectedPdf || uploadingPdf}
            >
              {uploadingPdf ? 'Indexing PDF...' : 'Upload PDF →'}
            </button>
          </div>

          {selectedPdf && (
            <p className="upload-file-name">
              Selected: {selectedPdf.name} · {(selectedPdf.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          )}

          {uploadingPdf && (
            <p className="muted" role="status">
              Uploading and indexing your document. This may take a little while.
            </p>
          )}

          {uploadMessage && <p className="upload-success" role="status">{uploadMessage}</p>}
          {uploadError && <p className="upload-error" role="alert">{uploadError}</p>}
        </section>

        <section className="panel rag-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">KNOWLEDGE ASSISTANT</p>
              <h2>Ask your documents</h2>
              <p className="muted">Ask questions about indexed documents and get answers grounded in their content.</p>
            </div>
            <span className="feature-pill">RAG + LLAMA 3.2</span>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              void askDocumentQuestion()
            }}
          >
            <textarea
              value={ragQuestion}
              onChange={(event) => setRagQuestion(event.target.value)}
              placeholder="e.g. What should engineers do when database queries become slow?"
              rows={3}
              maxLength={2000}
            />
            <div className="form-footer">
              <span className="muted">Answers use locally indexed documents.</span>
              <button type="submit" disabled={askingRag || ragQuestion.trim().length < 3}>
                {askingRag ? 'Searching documents...' : 'Ask question →'}
              </button>
            </div>
          </form>

          {ragError && <p className="upload-error" role="alert">{ragError}</p>}

          {ragAnswer && (
            <div className="rag-answer">
              <h3>Answer</h3>
              <p className="rag-answer-text">{ragAnswer}</p>

              {ragSources.length > 0 && (
                <div className="rag-sources">
                  <h3>Sources</h3>
                  {ragSources.map((source, index) => (
                    <article
                      className="rag-source"
                      key={`${source.source}-${source.chunk_index}-${index}`}
                    >
                      <strong>{source.label}: {source.source}</strong>
                      <p>
                        Chunk {source.chunk_index}
                        {source.distance !== undefined
                          ? ` · Distance: ${source.distance.toFixed(3)}`
                          : ''}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="panel tasks-panel" id="tasks">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">YOUR WORK</p>
              <h2>Recent tasks</h2>
              <p className="muted">Track progress and review task activity.</p>
            </div>
            <span className="feature-pill">{tasks.length} tasks</span>
          </div>

          {loadingTasks ? (
            <p className="muted">Loading tasks...</p>
          ) : tasks.length === 0 ? (
            <div className="empty-state">
              <h3>No tasks yet</h3>
              <p>Create your first task using the AI assistant above.</p>
            </div>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <article className="task-item" key={task.id}>
                  <div className="task-main">
                    <div className="task-title-row">
                      <h3>{task.title}</h3>
                      <span className={`priority-badge priority-${task.priority}`}>
                        {task.priority}
                      </span>
                    </div>
                    {task.description && <p className="muted">{task.description}</p>}
                    <div className="task-meta">
                      <span>Task #{task.id}</span>
                      <span className={`status-badge status-${task.status}`}>
                        {formatStatus(task.status)}
                      </span>
                    </div>
                  </div>

                  <div className="task-actions">
                    <label className="sr-only" htmlFor={`status-${task.id}`}>
                      Update status for {task.title}
                    </label>
                    <select
                      id={`status-${task.id}`}
                      value={task.status}
                      disabled={updatingTaskId === task.id}
                      onChange={(event) => {
                        void updateTaskStatus(task, event.target.value as TaskStatus)
                      }}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>

                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => void viewActivity(task)}
                    >
                      Activity
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {selectedTask && (
          <section className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">TASK HISTORY</p>
                <h2>Activity · {selectedTask.title}</h2>
                <p className="muted">Task #{selectedTask.id}</p>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setSelectedTask(null)
                  setTaskEvents([])
                  setActivityError('')
                }}
              >
                Close
              </button>
            </div>

            {loadingActivity && <p className="muted">Loading activity...</p>}
            {activityError && <p className="upload-error" role="alert">{activityError}</p>}

            {!loadingActivity && !activityError && taskEvents.length === 0 && (
              <p className="muted">No activity has been recorded for this task yet.</p>
            )}

            {taskEvents.length > 0 && (
              <div className="activity-list">
                {taskEvents.map((event) => (
                  <article className="activity-item" key={event.id}>
                    <span className="activity-dot" />
                    <div className="activity-content">
                      <strong>{formatEventName(event.event_type)}</strong>
                      {event.details != null && (
                        <p>{formatEventDetails(event.details)}</p>
                      )}
                      <span className="muted">
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="app-footer">
          OpsPilot AI · Local development workspace
        </footer>
      </main>
    </div>
  )
}

export default App
