import type { SyncStateRow, WebhookSubscriptionRow } from "../../lib/api";
import { formatAdminTime } from "../../lib/time";

export function SyncControlCenter(input: {
  states: SyncStateRow[];
  webhooks: WebhookSubscriptionRow[];
  onWorkspaceIndexSync: (forceFull: boolean) => void;
  onEmployeeSync: () => void;
  onBlueActivitySync: () => void;
  runningAction: string | null;
}) {
  return (
    <section className="panel sync-panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">Read-only control</div>
          <h2>Refresh and inspect sync state</h2>
          <p className="muted">
            Refresh local reporting data from the main CRM and inspect sync watermarks without
            writing back to Blue.
          </p>
        </div>
      </div>

      <div className="sync-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => input.onWorkspaceIndexSync(false)}
          disabled={Boolean(input.runningAction)}
        >
          {input.runningAction === "workspace-index" ? "Running..." : "Sync Workspace Index"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => input.onWorkspaceIndexSync(true)}
          disabled={Boolean(input.runningAction)}
        >
          {input.runningAction === "workspace-index-full" ? "Running..." : "Force Full Reconcile"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={input.onEmployeeSync}
          disabled={Boolean(input.runningAction)}
        >
          {input.runningAction === "employees" ? "Running..." : "Sync Employees"}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={input.onBlueActivitySync}
          disabled={Boolean(input.runningAction)}
        >
          {input.runningAction === "activity" ? "Running..." : "Sync Activity"}
        </button>
      </div>

      <div className="sync-state-grid">
        {input.states.map((state) => (
          <article className="sync-state-card" key={state.entity_type}>
            <div className="sync-state-head">
              <strong>{state.entity_type}</strong>
              <span className={`status-chip ${state.last_incremental_sync_at ? "ok" : "bad"}`}>
                {state.last_incremental_sync_at ? "healthy" : "missing"}
              </span>
            </div>
            <div className="sync-meta-row">
              <span>Last incremental</span>
              <span>{formatAdminTime(state.last_incremental_sync_at)}</span>
            </div>
            <div className="sync-meta-row">
              <span>Last full</span>
              <span>{formatAdminTime(state.last_full_sync_at)}</span>
            </div>
            <div className="sync-meta-row">
              <span>Watermark</span>
              <span>{formatAdminTime(state.last_seen_updated_at)}</span>
            </div>
            <div className="sync-meta-row">
              <span>Last webhook</span>
              <span>{formatAdminTime(state.last_webhook_event_at)}</span>
            </div>
          </article>
        ))}
      </div>

      <div className="webhook-box">
        <h3>Webhook status</h3>
        {input.webhooks.length === 0 ? (
          <p className="muted">No Blue webhook subscription is currently registered.</p>
        ) : (
          input.webhooks.map((webhook) => (
            <div key={webhook.id} className="sync-meta-row">
              <span>{webhook.url}</span>
              <span>{webhook.enabled ? "enabled" : "disabled"}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
