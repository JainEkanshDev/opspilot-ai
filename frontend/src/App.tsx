
import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://localhost:3000'
const USER_ID = 1 // Local development user

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
type Priority = 'low' | 'medium' | 'high' | 'urgent'

interface Task {
  id: number
  user_id: number
  title: string
  description: string | null
  status: TaskStatus
  priority: Priority
  created_at: string
}

interface ApiTaskResponse {
  success: boolean
  data: Task[]
  message?: string
}

interface TaskEvent {
  id: number
  task_id: number
  event_type: string
  details: Record<string, unknown> | string | null
  created_at: string
}

interface TaskActivityResponse {
  success: boolean
  taskId: number
  data: TaskEvent[]
  message?: string
}

interface ApiErrorResponse {
  success?: boolean
  message?: string
  detail?: string
}

const statuses: TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'failed',
]

function formatStatus(status: TaskStatus) {
  return status.replace('_', ' ')
}

function formatEventName(eventType: string) {
  if (eventType === 'created_by_ai') return 'Created by AI'
  if (eventType === 'status_changed') return 'Status changed'

  return eventType.replaceAll('_', ' ')
}

function formatEventDetails(
  details: TaskEvent['details'],
): string[] {
  let parsed: unknown = details

  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
  return typeof parsed === 'string' && parsed
    ? [parsed]
    : []
}
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed)
  ) {
    return []
  }

  return Object.entries(parsed as Record<string, unknown>).map(
    ([key, value]) => {
      const readableKey = key
        .replace(/([A-Z])/g, ' $1')
        .replaceAll('_', ' ')

      const readableValue =
        typeof value === 'string'
          ? value
          : JSON.stringify(value)

      return `${readableKey}: ${readableValue ?? '—'}`
    },
  )
}

async function getErrorMessage(response: Response) {
  try {
    const result: ApiErrorResponse = await response.json()

    return (
      result.message ||
      result.detail ||
      `Request failed with status ${response.status}.`
    )
  } catch {
    return `Request failed with status ${response.status}.`
  }
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [request, setRequest] = useState('')

  const [loadingTasks, setLoadingTasks] = useState(true)
  const [creatingTask, setCreatingTask] = useState(false)
  const [updatingTaskId, setUpdatingTaskId] = useState<number | null>(
    null,
  )

  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskEvents, setTaskEvents] = useState<TaskEvent[]>([])
  const [loadingActivity, setLoadingActivity] = useState(false)
  const [activityError, setActivityError] = useState('')

  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadTasks = useCallback(async () => {
    setLoadingTasks(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/tasks`)

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const result: ApiTaskResponse = await response.json()

      if (!result.success || !Array.isArray(result.data)) {
        throw new Error('The backend returned an invalid task list.')
      }

      setTasks(result.data)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Cannot connect to the backend. Make sure Node.js and MySQL are running.',
      )
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (request.trim().length < 3) return

    setCreatingTask(true)
    setError('')
    setNotice('')

    try {
      const response = await fetch(`${API_URL}/api/ai/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: USER_ID,
          request: request.trim(),
        }),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const result = await response.json()

      setNotice(`Task #${result.taskId} created successfully.`)
      setRequest('')

      await loadTasks()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'AI task creation failed.',
      )
    } finally {
      setCreatingTask(false)
    }
  }

  async function updateTaskStatus(
    taskId: number,
    status: TaskStatus,
  ) {
    setUpdatingTaskId(taskId)
    setError('')
    setNotice('')

    try {
      const response = await fetch(
        `${API_URL}/api/tasks/${taskId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        },
      )

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      setNotice(
        `Task #${taskId} updated to ${formatStatus(status)}.`,
      )

      await loadTasks()

      // Refresh activity too if this task's history panel is open.
      if (selectedTask?.id === taskId) {
        await viewActivity({ ...selectedTask, status })
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not update task status.',
      )
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
      const response = await fetch(
        `${API_URL}/api/tasks/${task.id}/activity`,
      )

      if (!response.ok) {
        throw new Error(await getErrorMessage(response))
      }

      const result: TaskActivityResponse = await response.json()

      if (!result.success || !Array.isArray(result.data)) {
        throw new Error('The backend returned invalid activity data.')
      }

      setTaskEvents(result.data)
    } catch (err) {
      setActivityError(
        err instanceof Error
          ? err.message
          : 'Could not load task activity.',
      )
    } finally {
      setLoadingActivity(false)
    }
  }

  function closeActivity() {
    setSelectedTask(null)
    setTaskEvents([])
    setActivityError('')
  }

  const pendingCount = tasks.filter(
    (task) => task.status === 'pending',
  ).length

  const activeCount = tasks.filter(
    (task) => task.status === 'in_progress',
  ).length

  const completedCount = tasks.filter(
    (task) => task.status === 'completed',
  ).length

  const urgentCount = tasks.filter(
    (task) =>
      task.priority === 'urgent' && task.status !== 'completed',
  ).length

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#dashboard">
          <span className="brand-icon">O</span>
          <span>
            OpsPilot<span className="brand-ai"> AI</span>
          </span>
        </a>

        <p className="nav-heading">WORKSPACE</p>

        <a className="nav-link active" href="#dashboard">
          <span>▦</span> Dashboard
        </a>

        <a className="nav-link" href="#tasks">
          <span>☷</span> My tasks
        </a>

        <a className="nav-link" href="#ai-assistant">
          <span>✳</span> AI assistant
        </a>

        <div className="sidebar-bottom">
          <span className="online-dot" />
          <div>
            <strong>Local AI</strong>
            <p>Ollama · Llama 3.2</p>
          </div>
        </div>
      </aside>

      <section className="main-content" id="dashboard">
        <header className="topbar">
          <div>
            <p className="eyebrow">WORKSPACE / OVERVIEW</p>
            <h1>Task dashboard</h1>
          </div>

          <button
            className="secondary-button"
            onClick={() => void loadTasks()}
            disabled={loadingTasks}
          >
            ↻ Refresh
          </button>
        </header>

        <section className="welcome-banner">
          <div className="welcome-copy">
            <span className="banner-label">YOUR AI WORKSPACE</span>
            <h2>Get things done, smarter.</h2>
            <p>
              Describe what needs to be done. Let your local AI
              interpret the request and create a task.
            </p>
            <a href="#ai-assistant" className="banner-link">
              Create with AI <span>→</span>
            </a>
          </div>

          <div className="banner-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="ai-core">✳</div>
            <span className="floating-chip chip-one">AI</span>
            <span className="floating-chip chip-two">✓</span>
          </div>
        </section>

        <section className="stats-grid" aria-label="Task summary">
          <article className="stat-card">
            <span className="stat-icon purple">▦</span>
            <p>Total tasks</p>
            <strong>{tasks.length}</strong>
            <span className="stat-caption">
              Across your workspace
            </span>
          </article>

          <article className="stat-card">
            <span className="stat-icon orange">◷</span>
            <p>Pending</p>
            <strong>{pendingCount}</strong>
            <span className="stat-caption">
              Waiting to be started
            </span>
          </article>

          <article className="stat-card">
            <span className="stat-icon blue">↗</span>
            <p>In progress</p>
            <strong>{activeCount}</strong>
            <span className="stat-caption">
              Currently being worked on
            </span>
          </article>

          <article className="stat-card">
            <span className="stat-icon green">✓</span>
            <p>Completed</p>
            <strong>{completedCount}</strong>
            <span className="stat-caption">
              {urgentCount} urgent task{urgentCount === 1 ? '' : 's'} open
            </span>
          </article>
        </section>

        <section className="ai-panel" id="ai-assistant">
          <div className="section-heading">
            <div>
              <span className="section-kicker">AI ASSISTANT</span>
              <h2>Create a task with natural language</h2>
              <p>
                No forms to fill out. Just tell OpsPilot what you need.
              </p>
            </div>

            <span className="model-badge">
              <span /> LLAMA 3.2
            </span>
          </div>

          <form onSubmit={createTask} className="prompt-form">
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              placeholder="e.g. Create a high-priority task to investigate slow database queries..."
              maxLength={2000}
              minLength={3}
              required
              rows={3}
              aria-label="Describe the task you want to create"
            />

            <div className="prompt-footer">
              <span>Powered by your local AI model</span>

              <button
                className="primary-button"
                type="submit"
                disabled={creatingTask || request.trim().length < 3}
              >
                {creatingTask ? 'Thinking...' : '✳ Create with AI →'}
              </button>
            </div>
          </form>

          {notice && (
            <p className="notice-message" role="status">
              {notice}
            </p>
          )}

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="tasks-section" id="tasks">
          <div className="section-heading task-heading">
            <div>
              <span className="section-kicker">YOUR WORK</span>
              <h2>Recent tasks</h2>
              <p>Review tasks and update their progress.</p>
            </div>

            <span className="task-count">
              {tasks.length} tasks
            </span>
          </div>

          {loadingTasks ? (
            <div className="empty-state">Loading your tasks...</div>
          ) : tasks.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">☷</span>
              <h3>No tasks yet</h3>
              <p>
                Use the AI assistant above to create your first task.
              </p>
            </div>
          ) : (
            <div className="task-list">
              {tasks.map((task) => (
                <article className="task-row" key={task.id}>
                  <span
                    className={`task-check ${
                      task.status === 'completed' ? 'checked' : ''
                    }`}
                  >
                    {task.status === 'completed' ? '✓' : '○'}
                  </span>

                  <div className="task-details">
                    <h3>{task.title}</h3>

                    {task.description && (
                      <p className="task-description">
                        {task.description}
                      </p>
                    )}

                    <div className="task-meta">
                      <span>#{task.id}</span>

                      <span
                        className={`priority priority-${task.priority}`}
                      >
                        {task.priority}
                      </span>

                      <span className="task-date">
                        {new Date(task.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <button
                    className="activity-button"
                    onClick={() => void viewActivity(task)}
                    disabled={loadingActivity && selectedTask?.id === task.id}
                  >
                    {loadingActivity && selectedTask?.id === task.id
                      ? 'Loading...'
                      : 'View activity'}
                  </button>

                  <div className="task-status-control">
                    <label
                      className="sr-only"
                      htmlFor={`status-${task.id}`}
                    >
                      Status for {task.title}
                    </label>

                    <select
                      id={`status-${task.id}`}
                      value={task.status}
                      disabled={updatingTaskId === task.id}
                      onChange={(event) =>
                        void updateTaskStatus(
                          task.id,
                          event.target.value as TaskStatus,
                        )
                      }
                    >
                      {statuses.map((status) => (
                        <option value={status} key={status}>
                          {formatStatus(status)}
                        </option>
                      ))}
                    </select>

                    {updatingTaskId === task.id && (
                      <span className="updating-label">Saving...</span>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {selectedTask && (
          <section
            className="activity-panel"
            aria-label="Task activity"
            aria-live="polite"
          >
            <div className="activity-header">
              <div>
                <span className="section-kicker">TASK HISTORY</span>
                <h2>{selectedTask.title}</h2>
                <p>Activity for task #{selectedTask.id}</p>
              </div>

              <button
                className="secondary-button"
                onClick={closeActivity}
              >
                Close
              </button>
            </div>

            {loadingActivity ? (
              <p className="activity-empty">Loading activity...</p>
            ) : activityError ? (
              <p className="error-message" role="alert">
                {activityError}
              </p>
            ) : taskEvents.length === 0 ? (
              <p className="activity-empty">
                No activity has been recorded for this task yet.
              </p>
            ) : (
              <div className="activity-list">
                {taskEvents.map((event) => (
                  <article className="activity-item" key={event.id}>
                    <span className="activity-dot" />

                    <div className="activity-content">
                      <h3>{formatEventName(event.event_type)}</h3>

                      {formatEventDetails(event.details).map(
                        (detail, index) => (
                          <p key={`${event.id}-${index}`}>
                            {detail}
                          </p>
                        ),
                      )}

                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleString()}
                      </time>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <footer className="app-footer">
          <span>OpsPilot AI</span>
          <span>Built with React, Node.js, Python & Ollama</span>
        </footer>
      </section>
    </main>
  )
}

export default App
