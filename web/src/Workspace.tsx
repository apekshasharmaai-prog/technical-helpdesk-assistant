import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  getGetHelpdeskTicketsQueryKey,
  useCreateHelpdeskTicket,
  useGetHelpdeskTickets,
  useProcessHelpdeskTicket,
  type HelpdeskResult,
  type HelpdeskTicket,
} from "./api";
import "./_group.css";

type SummaryField = { label: string; value: string };
type CaseResult = Omit<HelpdeskResult, "case_summary"> & { case_summary: SummaryField[] };
type Ticket = HelpdeskTicket & { result?: CaseResult; error?: string };
type Filter = "all" | "pending" | "processed" | "review";
type SavedWorkspace = {
  version: 1;
  tickets: Ticket[];
  drafts: Record<string, string>;
  activeId: string | null;
  selectedIds: string[];
};
type LoadedWorkspace = { saved: boolean; value: SavedWorkspace | null; warning: string };

const STORAGE_KEY = "technical-helpdesk-workspace-v1";
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "processed", label: "Processed" },
  { id: "review", label: "Review" },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSummary(value: unknown): value is SummaryField[] {
  return Array.isArray(value) && value.every((item) =>
    isRecord(item) && typeof item.label === "string" && typeof item.value === "string");
}

function validResult(value: unknown): value is CaseResult {
  return isRecord(value)
    && typeof value.category === "string"
    && typeof value.priority === "string"
    && typeof value.language === "string"
    && typeof value.resolution_type === "string"
    && validSummary(value.case_summary)
    && typeof value.recommended_action === "string"
    && typeof value.requires_human === "boolean"
    && typeof value.resolution_reason === "string"
    && typeof value.response === "string";
}

function validTicket(value: unknown): value is Ticket {
  return isRecord(value)
    && typeof value.ticket_id === "string"
    && typeof value.customer_name === "string"
    && typeof value.ticket === "string"
    && (value.result === undefined || validResult(value.result))
    && (value.error === undefined || typeof value.error === "string");
}

function readWorkspace(): LoadedWorkspace {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { saved: false, value: null, warning: "" };
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed)
      || parsed.version !== 1
      || !Array.isArray(parsed.tickets)
      || !parsed.tickets.every(validTicket)
      || !isRecord(parsed.drafts)
      || !Object.values(parsed.drafts).every((draft) => typeof draft === "string")
      || !(parsed.activeId === null || typeof parsed.activeId === "string")
      || !Array.isArray(parsed.selectedIds)
      || !parsed.selectedIds.every((id) => typeof id === "string")
    ) {
      return {
        saved: false,
        value: null,
        warning: "Saved browser data could not be validated. A fresh workspace will load; the invalid saved record may be replaced when new changes are saved.",
      };
    }
    return {
      saved: true,
      value: parsed as SavedWorkspace,
      warning: "",
    };
  } catch {
    return {
      saved: false,
      value: null,
      warning: "Saved browser data could not be read. A fresh workspace will load; the saved record may be replaced when new changes are saved.",
    };
  }
}

function summaryFields(caseSummary: string): SummaryField[] {
  try {
    const parsed: unknown = JSON.parse(caseSummary);
    if (validSummary(parsed)) return parsed;
    if (isRecord(parsed)) {
      const fields = Object.entries(parsed).map(([label, value]) => ({
        label: label.replaceAll("_", " "),
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));
      if (fields.length) return fields;
    }
    if (typeof parsed === "string" && parsed.trim()) return [{ label: "Case summary", value: parsed }];
  } catch {
    if (caseSummary.trim()) return [{ label: "Case summary", value: caseSummary }];
  }
  return [{ label: "Case summary", value: "No summary was returned." }];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === "string") return error.message;
  return "The request could not be completed. Please try again.";
}

function Glyph({ name, size = 16 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "mark") return <svg {...common}><path d="M5 17.5V6.7c0-.9.8-1.7 1.7-1.7H17"/><path d="M8 20h9.3c.9 0 1.7-.8 1.7-1.7V8"/><path d="m8 15 3-3 2 2 4-5"/><path d="M15 9h2v2"/></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
  if (name === "search") return <svg {...common}><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg>;
  if (name === "layers") return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></svg>;
  if (name === "copy") return <svg {...common}><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>;
  if (name === "spark") return <svg {...common}><path d="m12 3 1.5 6.5L20 12l-6.5 1.5L12 20l-1.5-6.5L4 12l6.5-2.5L12 3Z"/><path d="m19 3 .5 2.5L22 6l-2.5.5L19 9l-.5-2.5L16 6l2.5-.5L19 3Z"/></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6"/></svg>;
  if (name === "alert") return <svg {...common}><path d="m10.3 4.2-7.4 13a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3l-7.4-13a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/></svg>;
}

export function Workspace() {
  const loaded = useRef<LoadedWorkspace | null>(null);
  if (!loaded.current) loaded.current = readWorkspace();
  const initial = loaded.current;
  const [tickets, setTickets] = useState<Ticket[]>(initial.value?.tickets ?? []);
  const [activeId, setActiveId] = useState<string | null>(initial.value?.activeId ?? null);
  const [selectedIds, setSelectedIds] = useState<string[]>(initial.value?.selectedIds ?? []);
  const [drafts, setDrafts] = useState<Record<string, string>>(initial.value?.drafts ?? {});
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [copyError, setCopyError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ completed: number; total: number; current: string } | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(initial.saved);
  const [storageError, setStorageError] = useState("");
  const [loadWarning, setLoadWarning] = useState(initial.warning);
  const seeded = useRef(initial.saved);
  const createTicket = useCreateHelpdeskTicket();
  const processTicket = useProcessHelpdeskTicket();
  const sampleQuery = useGetHelpdeskTickets({
    query: {
      enabled: !initial.saved,
      queryKey: getGetHelpdeskTicketsQueryKey(),
    },
  });

  useEffect(() => {
    if (!seeded.current && sampleQuery.data) {
      const samples = sampleQuery.data.map((ticket) => ({ ...ticket }));
      seeded.current = true;
      setTickets(samples);
      setActiveId(samples[0]?.ticket_id ?? null);
      setSelectedIds(samples[0] ? [samples[0].ticket_id] : []);
      setWorkspaceReady(true);
    }
  }, [sampleQuery.data]);

  useEffect(() => {
    if (!workspaceReady) return;
    try {
      const snapshot: SavedWorkspace = { version: 1, tickets, drafts, activeId, selectedIds };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
      setStorageError("");
    } catch {
      setStorageError("Browser storage is unavailable or full. Tickets and drafts are not being saved.");
    }
  }, [tickets, drafts, activeId, selectedIds, workspaceReady]);

  const pendingCount = tickets.filter((ticket) => !ticket.result).length;
  const processedCount = tickets.filter((ticket) => ticket.result).length;
  const reviewCount = tickets.filter((ticket) => ticket.result?.requires_human).length;
  const activeTicket = tickets.find((ticket) => ticket.ticket_id === activeId) ?? null;
  const visibleTickets = useMemo(() => tickets.filter((ticket) => {
    const matchesFilter = filter === "all"
      || (filter === "pending" && !ticket.result)
      || (filter === "processed" && !!ticket.result)
      || (filter === "review" && !!ticket.result?.requires_human);
    const term = query.trim().toLowerCase();
    const matchesQuery = !term || `${ticket.ticket_id} ${ticket.customer_name} ${ticket.ticket}`.toLowerCase().includes(term);
    return matchesFilter && matchesQuery;
  }), [tickets, filter, query]);
  const selectedPending = selectedIds.filter((id) => tickets.some((ticket) => ticket.ticket_id === id && !ticket.result));

  function toggleSelected(ticket: Ticket, checked: boolean) {
    if (ticket.result || processing) return;
    setSelectedIds((current) => checked
      ? [...new Set([...current, ticket.ticket_id])]
      : current.filter((id) => id !== ticket.ticket_id));
    setActiveId(ticket.ticket_id);
  }

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      setFormError("Add the customer’s message before submitting.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const payload = {
        ticket: cleanMessage,
        ...(customerName.trim() ? { customer_name: customerName.trim() } : {}),
      };
      const created = await createTicket.mutateAsync({ data: payload });
      setTickets((current) => [created, ...current.filter((item) => item.ticket_id !== created.ticket_id)]);
      setActiveId(created.ticket_id);
      setSelectedIds((current) => [created.ticket_id, ...current.filter((id) => id !== created.ticket_id)]);
      setCustomerName("");
      setMessage("");
      setFilter("all");
      setQuery("");
      setComposerOpen(false);
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function processSelected() {
    if (processing) return;
    const batch = tickets.filter((ticket) => selectedIds.includes(ticket.ticket_id) && !ticket.result);
    if (!batch.length) return;
    setProcessing(true);
    setProgress({ completed: 0, total: batch.length, current: batch[0].ticket_id });
    let completed = 0;
    const succeeded: string[] = [];
    for (const ticket of batch) {
      setProgress({ completed, total: batch.length, current: ticket.ticket_id });
      try {
        const result = await processTicket.mutateAsync({
          data: {
            ticket_id: ticket.ticket_id,
            customer_name: ticket.customer_name,
            ticket: ticket.ticket,
          },
        });
        const processed: CaseResult = { ...result, case_summary: summaryFields(result.case_summary) };
        setTickets((current) => current.map((item) => item.ticket_id === ticket.ticket_id
          ? { ...item, result: processed, error: undefined }
          : item));
        setDrafts((current) => ({ ...current, [ticket.ticket_id]: result.response }));
        succeeded.push(ticket.ticket_id);
      } catch (error) {
        const reason = errorMessage(error);
        setTickets((current) => current.map((item) => item.ticket_id === ticket.ticket_id
          ? { ...item, error: reason }
          : item));
      }
      completed += 1;
      setProgress({ completed, total: batch.length, current: ticket.ticket_id });
    }
    setSelectedIds((current) => current.filter((id) => !succeeded.includes(id)));
    setProcessing(false);
    window.setTimeout(() => setProgress(null), 1600);
  }

  async function copyDraft(ticketId: string, value: string) {
    setCopyError("");
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(ticketId);
      window.setTimeout(() => setCopiedId((current) => current === ticketId ? null : current), 1800);
    } catch {
      setCopiedId(null);
      setCopyError("Clipboard access was blocked. Select and copy the draft text manually.");
    }
  }

  function statusFor(ticket: Ticket) {
    if (ticket.error && !ticket.result) return <span className="th-status th-status-error">Needs retry</span>;
    if (ticket.result) return <span className="th-status th-status-processed"><Glyph name="check" size={11} /> Processed</span>;
    return <span className="th-status th-status-pending">Pending</span>;
  }

  if (!initial.saved && !workspaceReady && sampleQuery.isLoading) {
    return (
      <div className="th-workspace">
        <div className="th-shell th-loading-shell" role="status" aria-live="polite">
          <header className="th-topbar">
            <div className="th-brand"><div className="th-brand-mark"><Glyph name="mark" size={20} /></div><div><div className="th-brand-name">Apeksha’s Helpdesk</div><div className="th-brand-sub">TECHNICAL SUPPORT WORKBENCH</div></div></div>
          </header>
          <div className="th-loading-card"><div className="th-skeleton th-skeleton-title" /><div className="th-skeleton" /><div className="th-skeleton th-skeleton-short" /><p>Loading educational sample tickets…</p></div>
        </div>
      </div>
    );
  }

  if (!initial.saved && !workspaceReady && sampleQuery.isError) {
    return (
      <div className="th-workspace">
        <div className="th-shell">
          <header className="th-topbar"><div className="th-brand"><div className="th-brand-mark"><Glyph name="mark" size={20} /></div><div><div className="th-brand-name">Apeksha’s Helpdesk</div><div className="th-brand-sub">TECHNICAL SUPPORT WORKBENCH</div></div></div></header>
          <section className="th-load-error" role="alert">
            <Glyph name="alert" size={18} />
            <div><strong>Sample tickets could not be loaded.</strong><p>{errorMessage(sampleQuery.error)}</p><button type="button" className="th-button th-button-primary" onClick={() => sampleQuery.refetch()}>Retry loading</button></div>
          </section>
          {loadWarning && <p className="th-storage-warning" role="status">{loadWarning}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="th-workspace">
      <div className="th-shell">
        <header className="th-topbar">
          <div className="th-brand">
            <div className="th-brand-mark"><Glyph name="mark" size={20} /></div>
            <div>
              <div className="th-brand-name">Apeksha’s Helpdesk</div>
              <div className="th-brand-sub">TECHNICAL SUPPORT WORKBENCH</div>
            </div>
          </div>
          <div className="th-top-actions">
            <span className="th-demo-pill"><span className="th-demo-dot" /> AI-assisted · human review</span>
          </div>
        </header>

        <section className="th-intro">
          <div>
            <div className="th-eyebrow">Support operations / Inbox</div>
            <h1 className="th-title">Review the request. Shape the response.</h1>
            <p className="th-subtitle">Triage a customer case and prepare a draft for a human to review.</p>
          </div>
          <div className="th-intro-note">Recommendations support case review. No customer action is executed here.</div>
        </section>

        {(loadWarning || storageError) && (
          <div className="th-storage-warning" role="status">
            <Glyph name="alert" size={14} />
            <span>{storageError || loadWarning}</span>
          </div>
        )}

        <section className="th-metrics" aria-label="Ticket counts">
          <div className="th-metric" data-testid="metric-submitted"><div className="th-metric-label">Submitted tickets</div><div className="th-metric-value">{tickets.length}</div></div>
          <div className="th-metric" data-testid="metric-pending"><div className="th-metric-label">Awaiting review</div><div className="th-metric-value">{pendingCount}</div></div>
          <div className="th-metric" data-testid="metric-processed"><div className="th-metric-label">Processed</div><div className="th-metric-value">{processedCount}</div></div>
          <div className="th-metric" data-testid="metric-human-review"><div className="th-metric-label">Flagged for human review</div><div className="th-metric-value is-review">{reviewCount}</div></div>
        </section>

        <div className="th-workbench">
          <aside className="th-panel th-queue" aria-label="Submitted ticket queue">
            <div className="th-queue-head">
              <div className="th-section-heading">
                <h2 className="th-section-title">Ticket queue</h2>
                <span className="th-small-count">{visibleTickets.length} shown</span>
              </div>
              <label className="th-search-wrap">
                <span className="th-search-icon"><Glyph name="search" size={15} /></span>
                <span className="sr-only">Search tickets</span>
                <input className="th-search" data-testid="input-ticket-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ID, customer, or message" />
              </label>
              <div className="th-filter-row" role="group" aria-label="Filter tickets">
                {filters.map((item) => <button key={item.id} type="button" className={`th-filter${filter === item.id ? " is-active" : ""}`} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} data-testid={`filter-${item.id}`}>{item.label}</button>)}
              </div>
            </div>

            <button type="button" className="th-compose-toggle" aria-expanded={composerOpen} onClick={() => { setComposerOpen((open) => !open); setFormError(""); }} data-testid="button-open-ticket-form">
              <Glyph name={composerOpen ? "check" : "plus"} size={14} /> {composerOpen ? "Close new ticket" : "Submit a new ticket"}
            </button>
            {composerOpen && (
              <form className="th-compose-form" onSubmit={submitTicket} noValidate>
                <label className="th-field-label" htmlFor="th-customer-name">Customer name <span>(optional)</span></label>
                <input id="th-customer-name" className="th-input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Name or leave blank" data-testid="input-customer-name" />
                <label className="th-field-label" htmlFor="th-ticket-message">Ticket message <span>(required)</span></label>
                <textarea id="th-ticket-message" className="th-textarea" value={message} onChange={(event) => { setMessage(event.target.value); setFormError(""); }} placeholder="What does the customer need help with?" data-testid="input-ticket-message" />
                <p className="th-form-help">Ticket text is sent to the configured AI model when you process it. Use educational content only.</p>
                <button type="submit" className="th-button th-button-primary" disabled={submitting} data-testid="button-submit-ticket"><Glyph name="arrow" size={14} /> {submitting ? "Adding ticket…" : "Add to queue"}</button>
                {formError && <p className="th-form-error" role="alert">{formError}</p>}
              </form>
            )}

            <div className="th-queue-toolbar">
              <label className="th-select-all">
                <input
                  type="checkbox"
                  aria-label="Select all pending tickets shown"
                  checked={visibleTickets.filter((ticket) => !ticket.result).length > 0 && visibleTickets.filter((ticket) => !ticket.result).every((ticket) => selectedIds.includes(ticket.ticket_id))}
                  disabled={processing}
                  onChange={(event) => {
                    const visiblePending = visibleTickets.filter((ticket) => !ticket.result).map((ticket) => ticket.ticket_id);
                    setSelectedIds((current) => event.target.checked ? [...new Set([...current, ...visiblePending])] : current.filter((id) => !visiblePending.includes(id)));
                  }}
                  data-testid="checkbox-select-visible"
                />
                Select pending
              </label>
              <button type="button" className="th-button th-button-primary th-process" disabled={processing || selectedPending.length === 0} onClick={processSelected} data-testid="button-process-selected">
                <Glyph name="spark" size={13} /> {processing ? "Processing…" : `Process selected (${selectedPending.length})`}
              </button>
            </div>

            <div className="th-ticket-list">
              {visibleTickets.length === 0 ? <div className="th-queue-empty">{tickets.length === 0 ? "No tickets yet. Submit an educational sample to begin." : "No tickets match this view. Try another filter or search."}</div> : visibleTickets.map((ticket) => (
                <div key={ticket.ticket_id} className={`th-ticket-row${ticket.ticket_id === activeId ? " is-current" : ""}`} data-testid={`ticket-row-${ticket.ticket_id}`}>
                  <input
                    className="th-ticket-check"
                    type="checkbox"
                    aria-label={`Select ${ticket.ticket_id}`}
                    checked={selectedIds.includes(ticket.ticket_id) && !ticket.result}
                    disabled={!!ticket.result || processing}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleSelected(ticket, event.target.checked)}
                    data-testid={`checkbox-ticket-${ticket.ticket_id}`}
                  />
                  <button type="button" className="th-ticket-select" aria-current={ticket.ticket_id === activeId ? "true" : undefined} onClick={() => setActiveId(ticket.ticket_id)} data-testid={`button-open-${ticket.ticket_id}`}>
                    <div className="th-ticket-topline"><span className="th-ticket-id">{ticket.ticket_id}</span>{statusFor(ticket)}</div>
                    <div className="th-ticket-name">{ticket.customer_name}</div>
                    <div className="th-ticket-preview">{ticket.ticket}</div>
                    {ticket.result && <div className="th-ticket-tags"><span className="th-tag">{ticket.result.category.replaceAll("_", " ")}</span><span className="th-tag-priority">{ticket.result.priority}</span>{ticket.result.requires_human && <span className="th-tag">Human review</span>}</div>}
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <main className="th-main">
            <div className="th-main-top">
              <span className="th-main-kicker">CASE WORKSPACE</span>
              <span className="th-work-status">{activeTicket?.result ? "Draft ready for human review" : activeTicket ? "Awaiting triage" : "Select a ticket to begin"}</span>
            </div>
            {progress && (
              <section className="th-progress" role="status" aria-live="polite" data-testid="status-processing-progress">
                <Glyph name="spark" size={17} />
                <div className="th-progress-copy">
                  <div className="th-progress-label">{processing ? "Processing selected tickets" : "Processing complete"}</div>
                  <div className="th-progress-detail">{progress.current} · {progress.completed} of {progress.total} completed</div>
                  <div className="th-progress-track"><div className="th-progress-fill" style={{ width: `${(progress.completed / progress.total) * 100}%` }} /></div>
                </div>
              </section>
            )}
            {tickets.some((ticket) => ticket.error && !ticket.result) && (
              <section className="th-errors" aria-live="polite" data-testid="section-processing-errors">
                <div className="th-errors-title">Some tickets need another pass</div>
                {tickets.filter((ticket) => ticket.error && !ticket.result).map((ticket) => (
                  <div className="th-error-line" key={ticket.ticket_id}>
                    <span><strong>{ticket.ticket_id}:</strong> {ticket.error}</span>
                    <button type="button" className="th-button th-retry" disabled={processing} onClick={() => { setSelectedIds((current) => [...new Set([...current, ticket.ticket_id])]); setActiveId(ticket.ticket_id); }} data-testid={`button-retry-${ticket.ticket_id}`}>Select to retry</button>
                  </div>
                ))}
              </section>
            )}

            {activeTicket ? (
              <article className="th-panel th-review-card">
                <div className="th-review-head">
                  <div>
                    <h2 className="th-review-title">{activeTicket.result ? "Review suggested response" : "Customer request"}</h2>
                    <p className="th-review-sub">{activeTicket.customer_name} · {activeTicket.result ? "AI-assisted output — edit before use" : "Pending classification"}</p>
                  </div>
                  <span className="th-ticket-ref">{activeTicket.ticket_id}</span>
                </div>
                <div className="th-stage-rail" aria-label="Workflow stages">
                  <div className={`th-stage${activeTicket.result ? "" : " is-dim"}`}><span className="th-stage-dot">{activeTicket.result ? <Glyph name="check" size={11} /> : "1"}</span>Triage</div>
                  <span className="th-stage-line" />
                  <div className={`th-stage${activeTicket.result ? "" : " is-dim"}`}><span className="th-stage-dot">{activeTicket.result ? <Glyph name="check" size={11} /> : "2"}</span>Case analysis</div>
                  <span className="th-stage-line" />
                  <div className={`th-stage${activeTicket.result ? "" : " is-dim"}`}><span className="th-stage-dot">{activeTicket.result ? <Glyph name="check" size={11} /> : "3"}</span>Decision</div>
                  <span className="th-stage-line" />
                  <div className={`th-stage${activeTicket.result ? "" : " is-dim"}`}><span className="th-stage-dot">{activeTicket.result ? <Glyph name="check" size={11} /> : "4"}</span>Draft</div>
                </div>

                <div className="th-review-body">
                  <section className="th-case-column">
                    <div className="th-block-label"><Glyph name="layers" size={14} /> Customer message</div>
                    <div className="th-customer-quote">{activeTicket.ticket}</div>
                    <div className="th-quote-by">Submitted by {activeTicket.customer_name}</div>

                    {activeTicket.result ? (
                      <>
                        <div className="th-triage">
                          <div className="th-block-label"><Glyph name="spark" size={14} /> Classification</div>
                          <div className="th-triage-grid">
                            <div className="th-triage-chip"><div className="th-chip-label">Category</div><div className="th-chip-value">{activeTicket.result.category.replaceAll("_", " ")}</div></div>
                            <div className="th-triage-chip"><div className="th-chip-label">Priority</div><div className="th-chip-value">{activeTicket.result.priority}</div></div>
                            <div className="th-triage-chip"><div className="th-chip-label">Language</div><div className="th-chip-value">{activeTicket.result.language}</div></div>
                          </div>
                          <div className="th-summary-row" style={{ marginTop: 7, border: "1px solid #e6eeeb", borderRadius: 8 }}>
                            <span className="th-summary-key">Resolution type</span><span className="th-summary-value">{activeTicket.result.resolution_type.replaceAll("_", " ")}</span>
                          </div>
                        </div>
                        <div className="th-case-summary">
                          <div className="th-block-label">Case summary</div>
                          <div className="th-summary-list">
                            {activeTicket.result.case_summary.map((field, index) => <div className="th-summary-row" key={`${field.label}-${index}`}><span className="th-summary-key">{field.label}</span><span className="th-summary-value">{field.value}</span></div>)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="th-case-summary">
                        <div className="th-block-label"><Glyph name="clock" size={14} /> Awaiting processing</div>
                        <p className="th-guidance-copy">Select this request and choose <strong>Process selected</strong> to run triage, case analysis, resolution guidance, and draft generation.</p>
                      </div>
                    )}
                  </section>

                  <section className="th-response-column">
                    {activeTicket.result ? (
                      <>
                        <div className="th-block-label"><Glyph name="spark" size={14} /> Suggested next steps</div>
                        <div className="th-guidance-stack">
                          <div className="th-guidance is-action">
                            <div className="th-guidance-title"><Glyph name="arrow" size={12} /> Recommended action</div>
                            <p className="th-guidance-copy">{activeTicket.result.recommended_action}</p>
                          </div>
                          <div className="th-guidance">
                            <div className="th-guidance-title"><Glyph name="layers" size={12} /> Resolution rationale</div>
                            <p className="th-guidance-copy">{activeTicket.result.resolution_reason}</p>
                          </div>
                        </div>
                        {activeTicket.result.requires_human && <div className="th-human-review"><Glyph name="alert" size={14} /><span><strong>Human review required.</strong> Verify the case context before using this recommendation.</span></div>}
                        <div className="th-draft-area">
                          <div className="th-draft-toolbar">
                            <label className="th-draft-label" htmlFor={`draft-${activeTicket.ticket_id}`}>Response draft</label>
                            <button type="button" className="th-button th-button-quiet th-copy-button" onClick={() => copyDraft(activeTicket.ticket_id, drafts[activeTicket.ticket_id] ?? activeTicket.result?.response ?? "")} data-testid={`button-copy-draft-${activeTicket.ticket_id}`}><Glyph name="copy" size={12} /> {copiedId === activeTicket.ticket_id ? "Copied" : "Copy draft"}</button>
                          </div>
                          <textarea id={`draft-${activeTicket.ticket_id}`} className="th-draft" value={drafts[activeTicket.ticket_id] ?? activeTicket.result.response} onChange={(event) => setDrafts((current) => ({ ...current, [activeTicket.ticket_id]: event.target.value }))} aria-label="Editable customer response draft" data-testid={`textarea-draft-${activeTicket.ticket_id}`} />
                          {copyError && <p className="th-form-error" role="alert">{copyError}</p>}
                          <p className="th-draft-hint">Editable draft · copy places this text on your clipboard only. No message is sent.</p>
                        </div>
                      </>
                    ) : (
                      <div className="th-no-selection" style={{ minHeight: 310 }}>
                        <div className="th-empty-mark"><Glyph name="spark" size={21} /></div>
                        <h3 className="th-empty-title">Decision trace appears here</h3>
                        <p className="th-empty-copy">The workflow returns classification, contextual summary, rationale, and a draft. Nothing is sent or changed on a customer account.</p>
                        <div style={{ marginTop: 15, color: "#7c9091", fontSize: 10 }}>Four stages · human stays in control</div>
                      </div>
                    )}
                  </section>
                </div>
              </article>
            ) : (
              <div className="th-panel th-no-selection">
                <div className="th-empty-mark"><Glyph name="layers" size={22} /></div>
                <h2 className="th-empty-title">Choose a ticket to review</h2>
                <p className="th-empty-copy">Select any request in the queue to see its message and the status of its review.</p>
              </div>
            )}
          </main>
        </div>

        <footer className="th-footer">
          <span><strong>Educational prototype</strong> · Tickets and drafts are saved only in this browser. Do not use sensitive customer details. Processing sends ticket text to the configured AI model. No real business actions run here.</span>
          <span className="th-live-message">{processing ? "WORKFLOW RUNNING" : "HUMAN REVIEW REQUIRED"}</span>
        </footer>
      </div>
    </div>
  );
}
