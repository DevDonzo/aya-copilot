import { useEffect, useRef, useState } from "react";

import type { ChatMessageResponse } from "../../lib/api";
import { formatAdminTime } from "../../lib/time";

type ChatThreadMessage =
  | {
      id: string;
      role: "user";
      text: string;
      createdAt: string;
    }
  | {
      id: string;
      role: "assistant";
      text: string;
      createdAt: string;
      intent?: string;
      clarificationRequired?: boolean;
      data?: unknown;
    };

type DailyBriefData = {
  employeeName?: string;
  date: string;
  snapshot: {
    openRecords: number;
    openAssignments: number;
    priorityItems: number;
    mentions: number;
    activityEvents: number;
  };
  assignments?: {
    items?: AssignmentItem[];
  };
  followUp?: {
    prioritized?: Array<{
      id: string;
      title: string;
      listTitle: string;
      reason: string;
    }>;
  };
  mentions?: {
    rows?: Array<{
      id: string;
      author_name: string | null;
      entity_title: string | null;
      summary: string;
    }>;
  };
  summary?: {
    summaryText?: string;
    latestEvents?: ActivityItem[];
  };
};

type NotificationFeedData = {
  employeeName?: string;
  unreadMentions?: MentionItem[];
  staleAssignedFiles?: AssignmentItem[];
  overdueChecklistItems?: TaskItem[];
  recentlyChangedAssignedFiles?: ActivityItem[];
};

type AssignmentItem = {
  id: string;
  title: string;
  listTitle?: string | null;
  dueAt?: string | null;
  updatedAt?: string | null;
  assigneeNames?: string[];
};

type MentionItem = {
  id: string;
  author_name: string | null;
  entity_title: string | null;
  summary: string;
};

type TaskItem = {
  id: string;
  title: string;
  dueAt?: string | null;
  updatedAt?: string | null;
  recordTitle?: string | null;
  checklistTitle?: string | null;
};

type ActivityItem = {
  id: string;
  action_type?: string;
  entity_title?: string | null;
  occurred_at?: string;
  summary?: string | null;
  title?: string;
  updatedAt?: string | null;
  listTitle?: string | null;
};

const DEMO_PROMPTS: Array<{
  label: string;
  message: string;
  kind: "read" | "write" | "safety";
  note: string;
}> = [
  {
    label: "Daily brief",
    message: "start my day",
    kind: "read",
    note: "Loads the employee home snapshot and daily brief.",
  },
  {
    label: "Notifications",
    message: "show my notifications",
    kind: "read",
    note: "Shows unread, stale, and recently changed assignment signals.",
  },
  {
    label: "Assignments",
    message: "show my assignments",
    kind: "read",
    note: "Lists Hamza's current open assigned files.",
  },
  {
    label: "Activity",
    message: "what did Hamza do today",
    kind: "read",
    note: "Shows the admin/operator activity summary for today.",
  },
  {
    label: "Reporting",
    message: "show reporting",
    kind: "read",
    note: "Shows saved reporting assets in the workspace.",
  },
  {
    label: "Add note",
    message:
      "add follow up note to AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22: demo note from local run",
    kind: "write",
    note: "Safe live write against the smoke-test record.",
  },
  {
    label: "Set due date",
    message:
      "set due date for AYA SMOKE TEST - OpenAI gpt-4o-mini - 2026-04-22 to 2026-05-14",
    kind: "write",
    note: "Safe due-date mutation against the smoke-test record.",
  },
  {
    label: "Safety refusal",
    message: "mark Usman - webworx done",
    kind: "safety",
    note: "Demonstrates that Aya now refuses ambiguous write targets.",
  },
];

export function ChatWorkspace(input: {
  isSending: boolean;
  onSend: (message: string) => Promise<ChatMessageResponse>;
}) {
  const [draft, setDraft] = useState("");
  const [thread, setThread] = useState<ChatThreadMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Ask Aya to run your daily brief, check mentions, show assignments, search clients, pull comments, move a file in the pilot workspace, or explain what changed today.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [homeBrief, setHomeBrief] = useState<DailyBriefData | null>(null);
  const [homeNotifications, setHomeNotifications] = useState<NotificationFeedData | null>(null);
  const [isHydratingHome, setIsHydratingHome] = useState(false);
  const didHydrateHome = useRef(false);

  useEffect(() => {
    if (didHydrateHome.current) {
      return;
    }

    didHydrateHome.current = true;
    setIsHydratingHome(true);
    setError(null);

    void input
      .onSend("start my day")
      .then((response) => {
        syncHomeStateFromResponse(response, setHomeBrief, setHomeNotifications);
        return input.onSend("show my notifications");
      })
      .then((response) => {
        syncHomeStateFromResponse(response, setHomeBrief, setHomeNotifications);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Could not load Aya home");
      })
      .finally(() => {
        setIsHydratingHome(false);
      });
  }, [input]);

  const sendMessage = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || input.isSending) {
      return;
    }

    const createdAt = new Date().toISOString();
    setError(null);
    setThread((current) => [
      ...current,
      {
        id: `user-${createdAt}`,
        role: "user",
        text: trimmed,
        createdAt,
      },
    ]);
    setDraft("");

    void input
      .onSend(trimmed)
      .then((response) => {
        syncHomeStateFromResponse(response, setHomeBrief, setHomeNotifications);
        setThread((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            text: response.responseText,
            createdAt: new Date().toISOString(),
            intent: response.intent,
            clarificationRequired: response.clarificationRequired,
            data: response.data,
          },
        ]);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Chat request failed");
      });
  };

  return (
    <section className="chat-layout">
      <section className="panel chat-hero-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Aya chat</div>
            <h2>Local chatbot workspace</h2>
            <p className="muted">
              This is the employee-facing Aya chat, loaded locally on top of the existing
              backend session.
            </p>
          </div>
        </div>

        <div className="chat-demo-banner">
          <div>
            <div className="eyebrow">Demo mode</div>
            <strong>Use the smoke-test record for live write actions.</strong>
            <p className="muted">
              The prompts below are tied to queries already proven on this local Aya instance.
            </p>
          </div>
        </div>

        <div className="chat-prompt-row">
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("show my open files")}
          >
            Show my open files
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("start my day")}
          >
            Start my day
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("show my mentions")}
          >
            Show my mentions
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("show my assignments")}
          >
            Show my assignments
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("show my notifications")}
          >
            Show my notifications
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("what needs my attention today")}
          >
            Attention today
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("what changed today")}
          >
            What changed today
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("search for client Omar Bay")}
          >
            Search for client Omar Bay
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("show recent comments for Sarah Khan")}
          >
            Show Sarah Khan comments
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("mark Usman - webworx done")}
          >
            Mark file done
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() => setDraft("set due date for Usman - webworx to 2026-05-12")}
          >
            Set due date
          </button>
          <button
            type="button"
            className="report-chip report-chip-button"
            onClick={() =>
              setDraft("add follow up note to Usman - webworx: waiting on updated docs")
            }
          >
            Add follow-up note
          </button>
        </div>
      </section>

      <section className="panel chat-demo-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Demo script</div>
            <h2>Demo-ready prompts</h2>
            <p className="muted">
              Use these in order for a clean walkthrough. Read actions are safe. Write
              actions target the smoke-test record only.
            </p>
          </div>
        </div>

        <div className="chat-demo-grid">
          {DEMO_PROMPTS.map((prompt) => (
            <article key={prompt.label} className={`chat-demo-card kind-${prompt.kind}`}>
              <div className="chat-home-card-head">
                <strong>{prompt.label}</strong>
                <span
                  className={`status-chip ${
                    prompt.kind === "read"
                      ? "info"
                      : prompt.kind === "write"
                        ? "ok"
                        : "warn"
                  }`}
                >
                  {prompt.kind}
                </span>
              </div>
              <code>{prompt.message}</code>
              <p>{prompt.note}</p>
              <div className="chat-inline-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setDraft(prompt.message)}
                >
                  Load prompt
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => sendMessage(prompt.message)}
                  disabled={input.isSending}
                >
                  Run now
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel chat-home-panel">
        <div className="panel-head">
          <div>
            <div className="eyebrow">Aya employee home</div>
            <h2>
              {homeBrief?.employeeName ?? homeNotifications?.employeeName ?? "Your"} workday
              snapshot
            </h2>
            <p className="muted">
              Daily brief, alerts, assignments, and recent changes pulled from the live Aya
              backend.
            </p>
          </div>
          <div className="chat-home-head-meta">
            <span className="status-chip info">
              {homeBrief?.date ?? new Date().toISOString().slice(0, 10)}
            </span>
            {isHydratingHome ? <span className="status-chip neutral">loading</span> : null}
          </div>
        </div>

        <div className="summary-strip">
          <article className="metric-card">
            <div className="metric-label">Open records</div>
            <div className="metric-value">{homeBrief?.snapshot.openRecords ?? 0}</div>
          </article>
          <article className="metric-card">
            <div className="metric-label">Assignments</div>
            <div className="metric-value">{homeBrief?.snapshot.openAssignments ?? 0}</div>
          </article>
          <article className="metric-card">
            <div className="metric-label">Priority items</div>
            <div className="metric-value">{homeBrief?.snapshot.priorityItems ?? 0}</div>
          </article>
          <article className="metric-card">
            <div className="metric-label">Unread mentions</div>
            <div className="metric-value">
              {homeNotifications?.unreadMentions?.length ?? homeBrief?.snapshot.mentions ?? 0}
            </div>
          </article>
        </div>

        <div className="chat-home-grid">
          <section className="chat-home-card">
            <div className="chat-home-card-head">
              <strong>Assignments</strong>
              <span className="status-chip neutral">
                {homeBrief?.assignments?.items?.length ?? 0}
              </span>
            </div>
            <div className="chat-home-list">
              {(homeBrief?.assignments?.items ?? []).slice(0, 4).map((item) => (
                <article key={item.id} className="chat-home-list-item">
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.listTitle ?? "Unsorted"} </small>
                  </div>
                  <div className="chat-inline-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setDraft(`mark ${item.title} done`)}
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setDraft(
                          `add follow up note to ${item.title}: waiting on next client update`,
                        )
                      }
                    >
                      Add note
                    </button>
                  </div>
                  <small>
                    Due {formatShortDate(item.dueAt)} · Updated {formatShortDate(item.updatedAt)}
                  </small>
                </article>
              ))}
              {!(homeBrief?.assignments?.items?.length ?? 0) ? (
                <div className="empty-state">No open assignments right now.</div>
              ) : null}
            </div>
          </section>

          <section className="chat-home-card">
            <div className="chat-home-card-head">
              <strong>Priority queue</strong>
              <span className="status-chip warn">
                {homeBrief?.followUp?.prioritized?.length ?? 0}
              </span>
            </div>
            <div className="chat-home-list">
              {(homeBrief?.followUp?.prioritized ?? []).slice(0, 4).map((item) => (
                <article key={item.id} className="chat-home-list-item">
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.listTitle} · {item.reason}
                    </small>
                  </div>
                  <div className="chat-inline-actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => setDraft(`mark ${item.title} done`)}
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        setDraft(`set due date for ${item.title} to ${nextBusinessDate()}`)
                      }
                    >
                      Reschedule
                    </button>
                  </div>
                </article>
              ))}
              {!(homeBrief?.followUp?.prioritized?.length ?? 0) ? (
                <div className="empty-state">No urgent follow-ups in the current brief.</div>
              ) : null}
            </div>
          </section>

          <section className="chat-home-card">
            <div className="chat-home-card-head">
              <strong>Notifications</strong>
              <span className="status-chip info">
                {countNotificationRows(homeNotifications)}
              </span>
            </div>
            <div className="chat-home-list">
              {(homeNotifications?.unreadMentions ?? []).slice(0, 3).map((item) => (
                <article key={item.id} className="chat-home-list-item">
                  <div>
                    <strong>{item.author_name ?? "Someone"} mentioned you</strong>
                    <small>{item.entity_title ?? "Record update"}</small>
                  </div>
                  <small>{item.summary}</small>
                </article>
              ))}
              {(homeNotifications?.staleAssignedFiles ?? []).slice(0, 2).map((item) => (
                <article key={item.id} className="chat-home-list-item">
                  <div>
                    <strong>Stale assigned file</strong>
                    <small>{item.title}</small>
                  </div>
                  <small>Last touched {formatShortDate(item.updatedAt)}</small>
                </article>
              ))}
              {countNotificationRows(homeNotifications) === 0 ? (
                <div className="empty-state">No unread mentions or stale assignment alerts.</div>
              ) : null}
            </div>
          </section>

          <section className="chat-home-card">
            <div className="chat-home-card-head">
              <strong>Recent changes</strong>
              <span className="status-chip neutral">
                {homeNotifications?.recentlyChangedAssignedFiles?.length ??
                  homeBrief?.summary?.latestEvents?.length ??
                  0}
              </span>
            </div>
            <div className="chat-home-list">
              {(homeNotifications?.recentlyChangedAssignedFiles ??
                homeBrief?.summary?.latestEvents ??
                []
              )
                .slice(0, 4)
                .map((item) => (
                  <article key={item.id} className="chat-home-list-item">
                    <div>
                      <strong>{item.entity_title ?? item.title ?? "Changed file"}</strong>
                      <small>{item.summary ?? item.action_type ?? "Recent activity"}</small>
                    </div>
                    <small>{formatShortDate(item.occurred_at ?? item.updatedAt)}</small>
                  </article>
                ))}
              {!(
                (homeNotifications?.recentlyChangedAssignedFiles?.length ?? 0) ||
                (homeBrief?.summary?.latestEvents?.length ?? 0)
              ) ? (
                <div className="empty-state">No recent assigned-file changes to review.</div>
              ) : null}
            </div>
          </section>
        </div>

        {homeBrief?.summary?.summaryText ? (
          <div className="chat-home-banner">
            <strong>Today’s activity</strong>
            <p>{homeBrief.summary.summaryText}</p>
          </div>
        ) : null}
      </section>

      <section className="panel chat-thread-panel">
        <div className="chat-thread">
          {thread.map((message) => (
            <article
              key={message.id}
              className={`chat-bubble ${message.role === "user" ? "user" : "assistant"}`}
            >
              <div className="chat-bubble-meta">
                <span>{message.role === "user" ? "You" : "Aya"}</span>
                <span>{formatAdminTime(message.createdAt)}</span>
              </div>
              <p>{message.text}</p>
              {message.role === "assistant" ? (
                <StructuredAssistantCard intent={message.intent} data={message.data} />
              ) : null}
              {message.role === "assistant" && message.intent ? (
                <div className="chat-bubble-foot">
                  <span className="status-chip neutral">{message.intent}</span>
                  {message.clarificationRequired ? (
                    <span className="status-chip warn">clarification</span>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage(draft);
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask Aya something..."
            rows={4}
          />
          <div className="chat-composer-actions">
            <span className="muted">
              Uses your current local session against Aya’s `/messages` API.
            </span>
            <button type="submit" className="primary-button" disabled={input.isSending}>
              {input.isSending ? "Sending..." : "Send"}
            </button>
          </div>
        </form>
      </section>
    </section>
  );
}

function syncHomeStateFromResponse(
  response: ChatMessageResponse,
  setHomeBrief: (value: DailyBriefData | null) => void,
  setHomeNotifications: (value: NotificationFeedData | null) => void,
) {
  if (!response.data || typeof response.data !== "object") {
    return;
  }

  if (response.intent === "brief.daily") {
    setHomeBrief(response.data as DailyBriefData);
  }

  if (response.intent === "notifications.feed") {
    setHomeNotifications(response.data as NotificationFeedData);
  }
}

function countNotificationRows(data: NotificationFeedData | null) {
  if (!data) {
    return 0;
  }

  return (
    (data.unreadMentions?.length ?? 0) +
    (data.staleAssignedFiles?.length ?? 0) +
    (data.overdueChecklistItems?.length ?? 0)
  );
}

function formatShortDate(value: string | null | undefined) {
  if (!value) {
    return "none";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().slice(0, 10);
}

function nextBusinessDate() {
  const value = new Date();
  value.setDate(value.getDate() + 2);
  return value.toISOString().slice(0, 10);
}

function StructuredAssistantCard(input: {
  intent?: string;
  data?: unknown;
}) {
  if (input.intent !== "brief.daily" || !input.data || typeof input.data !== "object") {
    return null;
  }

  const data = input.data as DailyBriefData;
  const metrics = [
    ["Open records", String(data.snapshot?.openRecords ?? 0)],
    ["Open assignments", String(data.snapshot?.openAssignments ?? 0)],
    ["Priority items", String(data.snapshot?.priorityItems ?? 0)],
    ["Mentions", String(data.snapshot?.mentions ?? 0)],
    ["Activity today", String(data.snapshot?.activityEvents ?? 0)],
  ];

  return (
    <section className="chat-brief-card">
      <div className="chat-brief-head">
        <strong>Daily brief snapshot</strong>
        <span>{data.date}</span>
      </div>
      <div className="chat-brief-metrics">
        {metrics.map(([label, value]) => (
          <div key={label} className="chat-brief-metric">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {data.followUp?.prioritized?.length ? (
        <div className="chat-brief-section">
          <strong>Top priorities</strong>
          <ul>
            {data.followUp.prioritized.slice(0, 3).map((item) => (
              <li key={item.id}>
                <span>{item.title}</span>
                <small>
                  {item.listTitle} · {item.reason}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.mentions?.rows?.length ? (
        <div className="chat-brief-section">
          <strong>Recent mentions</strong>
          <ul>
            {data.mentions.rows.slice(0, 3).map((item) => (
              <li key={item.id}>
                <span>
                  {item.author_name ?? "Someone"} on {item.entity_title ?? "a file"}
                </span>
                <small>{item.summary}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
