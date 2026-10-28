
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

const API_URL = 'http://localhost:3000'
const AI_SERVICE_URL = 'http://localhost:8000'
const USER_ID = 1

type TaskStatus = 'pending' | 'in_progress' | 'completed'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

interface Task {
  id: number
  title: string
  description?: string | null
  status: TaskStatus | string
  priority?: TaskPriority | string
  created_at?: string
  updated_at?: string
}

interface TaskEvent {
  id?: number
  event_type?: string
  event_name?: string
  details?: unknown
  created_at?: string
  timestamp?: string
  [key: string]: unknown
}

interface TaskActivityResponse {
  success?: boolean
  task?: Task
  events?: TaskEvent[]
  activity?: TaskEvent[]
  data?: TaskActivityResponse
  message?: string
}

interface RagSource {
  label?: string
  source?: string
  chunk_index?: number
  distance?: number
}

interface RagResponse {
  success?: boolean
  answer?: string
  sources?: RagSource[]
  detail?: string
  message?: string
}

interface UploadResponse {
  success?: boolean
  filename?: string
  message?: string
  detail?: string
}

interface AgentTool {
  name: string
  arguments: Record<string, unknown>
}

interface AgentChatResponse {
  success: boolean
  answer: string
  tools_used: AgentTool[]
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  let data: Record<string, unknown> = {}

  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('The server returned an invalid response.')
    }
  }

  if (!response.ok) {
    const message =
      typeof data.detail === 'string'
        ? data.detail
        : typeof data.message === 'string'
          ? data.message
          : `Request failed with status ${response.status}`

    throw new Error(message)
  }

  return data as T
}

function formatStatus(status?: string): string {
  if (!status) return 'Unknown'

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatEventName(event: TaskEvent): string {
  const name = event.event_type ?? event.event_name ?? 'Activity'

  return name
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatEventDetails(details: unknown): string {
  if (details == null || details === '') return ''

  if (typeof details === 'string') {
    try {
      const parsed: unknown = JSON.parse(details)

      if (typeof parsed === 'object' && parsed !== null) {
        return Object.entries(parsed)
          .map(([key, value]) => `${formatStatus(key)}: ${String(value)}`)
          .join(' · ')
      }

      return String(parsed)
    } catch {
      return details
    }
  }

  if (typeof details === 'object') {
    return Object.entries(details as Record<string, unknown>)
      .map(([key, value]) => `${formatStatus(key)}: ${String(value)}`)
      .join(' · ')
  }

  return String(details)
}

function getStatusClass(status?: string): string {
  switch (status?.toLowerCase()) {
    case 'completed':
      return 'completed'
    case 'in_progress':
      return 'in-progress'
    default:
      return 'pending'
  }
}

function getPriorityClass(priority?: string): string {
  switch (priority?.toLowerCase()) {
    case 'urgent':
      return 'urgent'
    case 'high':
      return 'high'
    case 'medium':
      return 'medium'
    default:
      return 'low'
  }
}

function formatDate(value?: string): string {
  if (!value) return 'Date unavailable'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString()
}

function extractTasks(payload: unknown): Task[] {
  if (Array.isArray(payload)) return payload as Task[]

  if (typeof payload === 'object' && payload !== null) {
    const data = payload as Record<string, unknown>

    if (Array.isArray(data.tasks)) return data.tasks as Task[]
    if (Array.isArray(data.data)) return data.data as Task[]
    if (
      typeof data.data === 'object' &&
      data.data !== null &&
      Array.isArray((data.data as Record<string, unknown>).tasks)
    ) {
      return (data.data as { tasks: Task[] }).tasks
    }
  }

  return []
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [tasksLoading, setTasksLoading] = useState(true)
  const [tasksError, setTasksError] = useState('')
  const [notice, setNotice] = useState('')

  // Natural-language task creation
  const [taskRequest, setTaskRequest] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)

  // Task activity
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskActivity, setTaskActivity] = useState<TaskEvent[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState('')

  // PDF upload
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')

  // Document Q&A (RAG)
  const [ragQuestion, setRagQuestion] = useState('')
  const [ragLoading, setRagLoading] = useState(false)
  const [ragResponse, setRagResponse] = useState<RagResponse | null>(null)
  const [ragError, setRagError] = useState('')

  // MCP-powered AI chat
  const [agentQuestion, setAgentQuestion] = useState('')
  const [agentAnswer, setAgentAnswer] = useState<AgentChatResponse | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [agentError, setAgentError] = useState('')

  const loadTasks = useCallback(async () => {
    setTasksLoading(true)
    setTasksError('')

    try {
      const response = await fetch(`${API_URL}/api/tasks`)
      const payload: unknown = await readResponse(response)
      setTasks(extractTasks(payload))
    } catch (error) {
      setTasksError(
        error instanceof Error ? error.message : 'Unable to load tasks.',
      )
    } finally {
      setTasksLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const request = taskRequest.trim()

    if (request.length < 3) {
      setNotice('Please describe the task in a little more detail.')
      return
    }

    setCreatingTask(true)
    setNotice('')
    setTasksError('')

    try {
      const response = await fetch(`${API_URL}/api/ai/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request,
          user_id: USER_ID,
        }),
      })

      await readResponse(response)
      setTaskRequest('')
      setNotice('Task created successfully.')
      await loadTasks()
    } catch (error) {
      setTasksError(
        error instanceof Error ? error.message : 'Unable to create task.',
      )
    } finally {
      setCreatingTask(false)
    }
  }

  async function handleStatusChange(
    task: Task,
    status: TaskStatus,
  ) {
    setNotice('')
    setTasksError('')

    try {
      const response = await fetch(
        `${API_URL}/api/tasks/${task.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )

      await readResponse(response)
      setNotice(`Task #${task.id} updated to ${formatStatus(status)}.`)

      await loadTasks()

      if (selectedTask?.id === task.id) {
        await openTaskActivity({ ...task, status })
      }
    } catch (error) {
      setTasksError(
        error instanceof Error ? error.message : 'Unable to update task.',
      )
    }
  }

  async function openTaskActivity(task: Task) {
    setSelectedTask(task)
    setTaskActivity([])
    setActivityError('')
    setActivityLoading(true)

    try {
      const response = await fetch(
        `${API_URL}/api/tasks/${task.id}/activity`,
      )

      const payload = await readResponse<TaskActivityResponse>(response)
      const result = payload.data ?? payload

      setTaskActivity(result.events ?? result.activity ?? [])
    } catch (error) {
      setActivityError(
        error instanceof Error
          ? error.message
          : 'Unable to load task activity.',
      )
    } finally {
      setActivityLoading(false)
    }
  }

  async function handlePdfUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setUploadMessage('')
    setUploadError('')

    if (!selectedFile) {
      setUploadError('Please select a PDF file first.')
      return
    }

    if (!selectedFile.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are supported.')
      return
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setUploadError('The PDF must be no larger than 10 MB.')
      return
    }

    setUploadLoading(true)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const response = await fetch(`${AI_SERVICE_URL}/api/rag/upload`, {
        method: 'POST',
        body: formData,
      })

      const result = await readResponse<UploadResponse>(response)

      setUploadMessage(
        result.message ?? `Uploaded and indexed ${selectedFile.name}.`,
      )
      setSelectedFile(null)

      const input = document.getElementById(
        'pdf-upload',
      ) as HTMLInputElement | null

      if (input) input.value = ''
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : 'PDF upload failed.',
      )
    } finally {
      setUploadLoading(false)
    }
  }

  async function handleRagQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const question = ragQuestion.trim()

    if (question.length < 3) {
      setRagError('Please enter a question with at least 3 characters.')
      return
    }

    setRagLoading(true)
    setRagError('')
    setRagResponse(null)

    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/rag/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      const result = await readResponse<RagResponse>(response)
      setRagResponse(result)
    } catch (error) {
      setRagError(
        error instanceof Error
          ? error.message
          : 'Unable to query your documents.',
      )
    } finally {
      setRagLoading(false)
    }
  }

  async function handleAgentChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const question = agentQuestion.trim()

    if (question.length < 3) {
      setAgentError('Please enter a question with at least 3 characters.')
      return
    }

    setAgentLoading(true)
    setAgentError('')
    setAgentAnswer(null)

    try {
      const response = await fetch(`${AI_SERVICE_URL}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      const result = await readResponse<AgentChatResponse>(response)

      setAgentAnswer(result)
      setAgentQuestion('')
    } catch (error) {
      setAgentError(
        error instanceof Error
          ? error.message
          : 'Unable to contact the OpsPilot AI agent.',
      )
    } finally {
      setAgentLoading(false)
    }
  }

  const completedCount = tasks.filter(
    (task) => task.status === 'completed',
  ).length

  const pendingCount = tasks.filter(
    (task) => task.status === 'pending',
  ).length

  const inProgressCount = tasks.filter(
    (task) => task.status === 'in_progress',
  ).length

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">O</div>
          <div>
            <h1>OpsPilot</h1>
            <span>AI Operations Hub</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#overview">
            <span>◫</span> Overview
          </a>
          <a className="nav-item" href="#tasks">
            <span>☷</span> Tasks
          </a>
          <a className="nav-item" href="#documents">
            <span>▤</span> Knowledge Base
          </a>
          <a className="nav-item" href="#agent-chat">
            <span>✧</span> AI Assistant
          </a>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-status-dot" />
          <div>
            <strong>Local environment</strong>
            <span>OpsPilot services</span>
          </div>
        </div>
      </aside>

      <main className="main-content" id="overview">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace / Overview</span>
            <h1>Operations Dashboard</h1>
          </div>

          <button
            className="refresh-button"
            type="button"
            onClick={() => void loadTasks()}
            disabled={tasksLoading}
          >
            {tasksLoading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </header>

        {notice && (
          <div className="notice-message" role="status">
            {notice}
          </div>
        )}

        {tasksError && (
          <div className="error-message" role="alert">
            {tasksError}
          </div>
        )}

        <section className="stats-grid" aria-label="Task statistics">
          <article className="stat-card">
            <div className="stat-card-top">
              <span>Total Tasks</span>
              <span className="stat-icon purple">☷</span>
            </div>
            <strong>{tasks.length}</strong>
            <span className="stat-caption">Tasks in your workspace</span>
          </article>

          <article className="stat-card">
            <div className="stat-card-top">
              <span>Pending</span>
              <span className="stat-icon orange">◷</span>
            </div>
            <strong>{pendingCount}</strong>
            <span className="stat-caption">Waiting to be started</span>
          </article>

          <article className="stat-card">
            <div className="stat-card-top">
              <span>In Progress</span>
              <span className="stat-icon blue">↗</span>
            </div>
            <strong>{inProgressCount}</strong>
            <span className="stat-caption">Currently being worked on</span>
          </article>

          <article className="stat-card">
            <div className="stat-card-top">
              <span>Completed</span>
              <span className="stat-icon green">✓</span>
            </div>
            <strong>{completedCount}</strong>
            <span className="stat-caption">Successfully completed</span>
          </article>
        </section>

        <section className="dashboard-card ai-task-card">
          <div className="section-heading">
            <div>
              <span className="section-eyebrow">AI AUTOMATION</span>
              <h2>Create a task with AI</h2>
              <p>Describe what needs to be done in natural language.</p>
            </div>
            <div className="section-icon">✧</div>
          </div>

          <form className="task-create-form" onSubmit={handleCreateTask}>
            <input
              value={taskRequest}
              onChange={(event) => setTaskRequest(event.target.value)}
              placeholder="e.g. Investigate slow database queries with high priority"
              maxLength={2000}
              disabled={creatingTask}
              aria-label="Describe a task"
            />
            <button type="submit" disabled={creatingTask}>
              {creatingTask ? 'Creating...' : '✧ Create Task'}
            </button>
          </form>
        </section>

        <section className="agent-chat" id="agent-chat">
          <div className="agent-chat-header">
            <div>
              <span className="agent-chat-eyebrow">OPS INTELLIGENCE</span>
              <h2>Ask OpsPilot AI</h2>
              <p>
                Ask about tasks, task history, or your operations documents.
                The AI can select MCP tools to help answer your question.
              </p>
            </div>
            <div className="agent-chat-icon">AI</div>
          </div>

          <form className="agent-chat-form" onSubmit={handleAgentChat}>
            <textarea
              value={agentQuestion}
              onChange={(event) => setAgentQuestion(event.target.value)}
              placeholder="e.g. Show me all pending tasks or how should I investigate slow database queries?"
              rows={3}
              maxLength={2000}
              disabled={agentLoading}
              aria-label="Ask OpsPilot AI a question"
            />

            <div className="agent-chat-form-footer">
              <span>Powered by Ollama and MCP</span>
              <button type="submit" disabled={agentLoading}>
                {agentLoading ? 'Thinking...' : 'Ask OpsPilot'}
              </button>
            </div>
          </form>

          {agentError && (
            <div className="agent-chat-error" role="alert">
              {agentError}
            </div>
          )}

          {agentLoading && (
            <p className="agent-chat-loading" role="status">
              OpsPilot is analyzing your question and checking available tools...
            </p>
          )}

          {agentAnswer && (
            <div className="agent-chat-answer">
              <h3>Answer</h3>
              <p className="agent-answer-text">{agentAnswer.answer}</p>

              {agentAnswer.tools_used?.length > 0 && (
                <div className="agent-tools-used">
                  <h4>Tools used</h4>
                  <div className="agent-tool-list">
                    {agentAnswer.tools_used.map((tool, index) => (
                      <span
                        className="agent-tool-chip"
                        key={`${tool.name}-${index}`}
                        title={JSON.stringify(tool.arguments)}
                      >
                        {tool.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        <div className="dashboard-two-column">
          <section className="dashboard-card" id="documents">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">KNOWLEDGE BASE</span>
                <h2>Upload an operations document</h2>
                <p>Upload a PDF to add it to your RAG knowledge base.</p>
              </div>
              <div className="section-icon">▤</div>
            </div>

            <form className="upload-form" onSubmit={handlePdfUpload}>
              <label className="file-picker" htmlFor="pdf-upload">
                <span className="file-picker-icon">↑</span>
                <span>
                  <strong>
                    {selectedFile ? selectedFile.name : 'Choose a PDF file'}
                  </strong>
                  <small>PDF format · Maximum 10 MB</small>
                </span>
              </label>

              <input
                id="pdf-upload"
                type="file"
                accept=".pdf,application/pdf"
                onChange={(event) => {
                  setSelectedFile(event.target.files?.[0] ?? null)
                  setUploadMessage('')
                  setUploadError('')
                }}
              />

              <button type="submit" disabled={uploadLoading}>
                {uploadLoading ? 'Uploading and indexing...' : 'Upload PDF'}
              </button>
            </form>

            {uploadMessage && (
              <p className="success-message" role="status">
                {uploadMessage}
              </p>
            )}

            {uploadError && (
              <p className="error-message" role="alert">
                {uploadError}
              </p>
            )}

            <div className="subsection-divider" />

            <div className="section-heading compact-heading">
              <div>
                <h3>Document Q&amp;A</h3>
                <p>Ask a question directly against indexed documents.</p>
              </div>
            </div>

            <form className="rag-form" onSubmit={handleRagQuestion}>
              <textarea
                value={ragQuestion}
                onChange={(event) => setRagQuestion(event.target.value)}
                placeholder="e.g. What are the steps for investigating database performance?"
                rows={3}
                maxLength={2000}
                disabled={ragLoading}
                aria-label="Ask a document question"
              />

              <button type="submit" disabled={ragLoading}>
                {ragLoading ? 'Searching documents...' : 'Ask Documents'}
              </button>
            </form>

            {ragError && (
              <p className="error-message" role="alert">
                {ragError}
              </p>
            )}

            {ragResponse && (
              <div className="rag-answer">
                <h4>Answer</h4>
                <p>{ragResponse.answer ?? 'No answer was returned.'}</p>

                {ragResponse.sources && ragResponse.sources.length > 0 && (
                  <div className="rag-sources">
                    <strong>Sources</strong>
                    {ragResponse.sources.map((source, index) => (
                      <div
                        className="rag-source"
                        key={`${source.source ?? source.label ?? 'source'}-${index}`}
                      >
                        <span>
                          {source.label ?? source.source ?? 'Document'}
                        </span>
                        {typeof source.chunk_index === 'number' && (
                          <small>Chunk {source.chunk_index}</small>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="dashboard-card activity-card">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">TASK HISTORY</span>
                <h2>
                  {selectedTask
                    ? `Activity · Task #${selectedTask.id}`
                    : 'Task activity'}
                </h2>
                <p>
                  {selectedTask
                    ? selectedTask.title
                    : 'Select a task to inspect its activity history.'}
                </p>
              </div>

              {selectedTask && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setSelectedTask(null)
                    setTaskActivity([])
                    setActivityError('')
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {!selectedTask && (
              <div className="empty-state">
                <span className="empty-state-icon">◷</span>
                <p>Choose View Activity on a task below.</p>
              </div>
            )}

            {activityLoading && (
              <p className="loading-message">Loading task activity...</p>
            )}

            {activityError && (
              <p className="error-message" role="alert">
                {activityError}
              </p>
            )}

            {selectedTask && !activityLoading && !activityError && (
              <div className="activity-list">
                {taskActivity.length === 0 ? (
                  <p className="empty-state">
                    No activity events were returned for this task.
                  </p>
                ) : (
                  taskActivity.map((item, index) => (
                    <article
                      className="activity-item"
                      key={item.id ?? `${item.event_type}-${index}`}
                    >
                      <div className="activity-timeline-dot" />
                      <div className="activity-item-content">
                        <strong>{formatEventName(item)}</strong>
                        {item.details != null && (
                          <p>{formatEventDetails(item.details)}</p>
                        )}
                        <small>
                          {formatDate(item.created_at ?? item.timestamp)}
                        </small>
                      </div>
                    </article>
                  ))
                )}
              </div>
            )}
          </section>
        </div>

        <section className="dashboard-card tasks-card" id="tasks">
          <div className="section-heading">
            <div>
              <span className="section-eyebrow">WORK MANAGEMENT</span>
              <h2>Recent Tasks</h2>
              <p>View tasks, update statuses, and inspect their history.</p>
            </div>

            <button
              className="text-button"
              type="button"
              onClick={() => void loadTasks()}
              disabled={tasksLoading}
            >
              View latest
            </button>
          </div>

          {tasksLoading ? (
            <div className="empty-state">
              <p>Loading tasks...</p>
            </div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state-icon">☷</span>
              <p>No tasks are available. Create one using the AI form above.</p>
            </div>
          ) : (
            <div className="tasks-list">
              {tasks.map((task) => (
                <article className="task-row" key={task.id}>
                  <div className="task-main">
                    <div className="task-title-line">
                      <h3>{task.title}</h3>
                      <span className="task-id">#{task.id}</span>
                    </div>

                    {task.description && (
                      <p className="task-description">{task.description}</p>
                    )}

                    <div className="task-meta">
                      {task.priority && (
                        <span
                          className={`priority-badge ${getPriorityClass(task.priority)}`}
                        >
                          {formatStatus(task.priority)} priority
                        </span>
                      )}

                      <span
                        className={`status-badge ${getStatusClass(task.status)}`}
                      >
                        {formatStatus(task.status)}
                      </span>
                    </div>
                  </div>

                  <div className="task-actions">
                    <label
                      className="status-select-label"
                      htmlFor={`status-${task.id}`}
                    >
                      Status
                    </label>

                    <select
                      id={`status-${task.id}`}
                      value={task.status}
                      onChange={(event) =>
                        void handleStatusChange(
                          task,
                          event.target.value as TaskStatus,
                        )
                      }
                      aria-label={`Change status for task ${task.id}`}
                    >
                      <option value="pending">Pending</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                    </select>

                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void openTaskActivity(task)}
                    >
                      View Activity
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <footer className="app-footer">
          <span>OpsPilot AI</span>
          <span>Local AI · MCP · RAG · Task Automation</span>
        </footer>
      </main>
    </div>
  )
}

export default App
