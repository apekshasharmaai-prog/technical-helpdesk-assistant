
"""AI Helpdesk Workbench — Streamlit entry point."""

import json
import uuid
from pathlib import Path

import streamlit as st

from src.llm import create_llm
from src.workflow import build_workflow, process_ticket

PROJECT_ROOT = Path(__file__).resolve().parent
INPUT_FILE = PROJECT_ROOT / "data" / "support_tickets.json"
OUTPUT_FILE = (
    PROJECT_ROOT / "data" / "output" / "support_ticket_results.json"
)

st.set_page_config(
    page_title="AI Helpdesk Workbench",
    page_icon="🎫",
    layout="wide",
)

# ---------- Initialization ----------

def load_tickets():
    if not INPUT_FILE.exists():
        return []

    with INPUT_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, list):
        raise ValueError("The input JSON must contain a list of tickets.")

    return data


@st.cache_resource
def get_workflow():
    """Initialize the LLM and workflow once per application process."""
    llm = create_llm()
    return build_workflow(llm)


def to_dict(result):
    """Convert a Pydantic result or dictionary into a plain dictionary."""
    if hasattr(result, "model_dump"):
        return result.model_dump()
    if isinstance(result, dict):
        return result
    raise TypeError("The workflow returned an unsupported result type.")


def get_text(record, key, default=""):
    value = record.get(key, default)
    return str(value) if value is not None else default


def persist_results(results):
    """Save results from this application's current session."""
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", encoding="utf-8") as file:
        json.dump(
            list(results.values()),
            file,
            indent=2,
            ensure_ascii=False,
        )


if "tickets" not in st.session_state:
    try:
        st.session_state.tickets = load_tickets()
    except (OSError, json.JSONDecodeError, ValueError) as error:
        st.error(f"Could not load the ticket input file: {error}")
        st.stop()

if "results" not in st.session_state:
    # Deliberately do not load old output here.
    # Every new browser session starts with tickets awaiting processing.
    st.session_state.results = {}

if "processing_errors" not in st.session_state:
    st.session_state.processing_errors = {}


# ---------- Header ----------

st.title("🎫 AI Helpdesk Workbench")
st.write(
    "Select submitted tickets or add a new customer request. "
    "The AI analyzes tickets only when you click Process."
)

tickets = st.session_state.tickets
results = st.session_state.results

processed_count = len(results)
pending_count = sum(
    ticket["ticket_id"] not in results for ticket in tickets
)
human_review_count = sum(
    result.get("requires_human") is True
    for result in results.values()
)

m1, m2, m3 = st.columns(3)
m1.metric("Submitted tickets", len(tickets))
m2.metric("Processed this session", processed_count)
m3.metric("AI flags for human review", human_review_count)

st.caption(f"{pending_count} ticket(s) awaiting processing.")

# ---------- Add a new ticket ----------

st.header("1. Submit a new ticket")

with st.form("new_ticket_form", clear_on_submit=True):
    customer_name = st.text_input(
        "Customer name (optional)",
        placeholder="Enter customer name",
    )

    ticket_message = st.text_area(
        "Ticket message",
        placeholder=(
            "Example: I was charged twice for my subscription. "
            "Please investigate."
        ),
        height=130,
    )

    submitted = st.form_submit_button(
        "Submit ticket",
        type="primary",
    )

    if submitted:
        message = ticket_message.strip()

        if not message:
            st.error("Please enter a ticket message.")
        else:
            ticket_id = f"TKT-CUSTOM-{uuid.uuid4().hex[:8].upper()}"

            new_ticket = {
                "ticket_id": ticket_id,
                "customer_name": customer_name.strip() or "Not provided",
                "ticket": message,
            }

            st.session_state.tickets.append(new_ticket)
            st.session_state.processing_errors.pop(ticket_id, None)

            st.success(
                f"Ticket {ticket_id} submitted. "
                "Select it below when you are ready to process it."
            )
            st.rerun()

# ---------- Submitted ticket list ----------

st.divider()
st.header("2. Select tickets to process")

ticket_by_id = {
    ticket["ticket_id"]: ticket
    for ticket in st.session_state.tickets
}

pending_ids = [
    ticket_id
    for ticket_id in ticket_by_id
    if ticket_id not in st.session_state.results
]

if not ticket_by_id:
    st.info("No tickets have been submitted yet.")

else:
    # Show all tickets, their status, and their submitted message.
    for ticket_id, ticket in ticket_by_id.items():
        status = (
            "Processed"
            if ticket_id in results
            else "Pending"
        )

        with st.expander(
            f"{ticket_id} · "
            f"{get_text(ticket, 'customer_name', 'Unknown customer')} "
            f"· {status}",
            expanded=False,
        ):
            st.write(get_text(ticket, "ticket"))

            if ticket_id in results:
                st.caption(
                    "AI results are available in the results section below."
                )

    selected_ids = st.multiselect(
        "Choose one or more pending tickets",
        options=pending_ids,
        format_func=lambda ticket_id: (
            f"{ticket_id} — "
            f"{get_text(ticket_by_id[ticket_id], 'customer_name')} — "
            f"{get_text(ticket_by_id[ticket_id], 'ticket')[:65]}"
        ),
        placeholder="Select tickets...",
    )

    if st.button(
        "🚀 Process selected tickets",
        type="primary",
        disabled=not selected_ids,
    ):
        st.session_state.processing_errors = {}

        try:
            workflow = get_workflow()
        except Exception as error:
            st.error(f"Could not initialize the AI workflow: {error}")
            st.stop()

        progress = st.progress(0)
        status_text = st.empty()

        total = len(selected_ids)

        for index, ticket_id in enumerate(selected_ids, start=1):
            status_text.write(
                f"Processing {ticket_id} ({index} of {total})..."
            )

            try:
                result = process_ticket(
                    ticket_by_id[ticket_id],
                    workflow,
                )

                st.session_state.results[ticket_id] = to_dict(result)
                st.session_state.processing_errors.pop(ticket_id, None)

            except Exception as error:
                st.session_state.processing_errors[ticket_id] = str(error)

            progress.progress(index / total)

        try:
            persist_results(st.session_state.results)
        except OSError as error:
            st.warning(f"Could not save results to disk: {error}")

        status_text.empty()
        st.rerun()

# ---------- Processing errors ----------

if st.session_state.processing_errors:
    st.header("Processing errors")

    for ticket_id, error in st.session_state.processing_errors.items():
        st.error(f"{ticket_id}: {error}")

# ---------- AI results ----------

st.divider()
st.header("3. AI processing results")

if not results:
    st.info(
        "No AI results yet. Submit a ticket or select pending tickets "
        "and click Process selected tickets."
    )

else:
    for ticket_id, result in reversed(list(results.items())):
        ticket = ticket_by_id.get(ticket_id, {})

        priority = get_text(result, "priority", "Not assigned")
        category = get_text(result, "category", "Not classified")
        resolution_type = get_text(
            result, "resolution_type", "Not determined"
        )
        requires_human = result.get("requires_human", False)

        with st.expander(
            f"{ticket_id} · {priority.upper()} · {category}",
            expanded=True,
        ):
            left, right = st.columns(2)

            with left:
                st.subheader("Submitted request")
                st.write(get_text(ticket, "ticket", "Ticket unavailable"))

                st.subheader("Classification")
                st.write(f"**Category:** {category}")
                st.write(f"**Priority:** {priority}")
                st.write(f"**Resolution type:** {resolution_type}")
                st.write(
                    "**Human review:** "
                    + ("Required" if requires_human else "Not flagged")
                )

                st.subheader("Case summary")
                summary = result.get("case_summary", {})

                if isinstance(summary, str):
                    try:
                        summary = json.loads(summary)
                    except json.JSONDecodeError:
                        pass

                if isinstance(summary, (dict, list)):
                    st.json(summary)
                else:
                    st.write(summary or "No summary provided.")

            with right:
                st.subheader("Recommended action")
                st.write(
                    get_text(result, "recommended_action", "Not provided")
                )

                st.subheader("Reasoning / resolution rationale")
                st.write(
                    get_text(result, "resolution_reason", "Not provided")
                )

                st.subheader("Draft customer response")
                st.text_area(
                    "Review or copy the AI-generated response",
                    value=get_text(result, "response", ""),
                    height=220,
                    key=f"response_{ticket_id}",
                )

            st.caption(
                "AI-generated recommendation. No refund, cancellation, "
                "shipment, or account deletion is performed by this UI."
            )
