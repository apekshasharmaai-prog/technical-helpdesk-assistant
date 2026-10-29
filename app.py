
"""Streamlit UI for the AI Support Ticket Assistant."""

import json
import subprocess
import sys
from pathlib import Path

import streamlit as st

PROJECT_ROOT = Path(__file__).resolve().parent
INPUT_FILE = PROJECT_ROOT / "data" / "support_tickets.json"
OUTPUT_FILE = (
    PROJECT_ROOT / "data" / "output" / "support_ticket_results.json"
)
CLI_FILE = PROJECT_ROOT / "cli.py"

st.set_page_config(
    page_title="AI Helpdesk Assistant",
    page_icon="🎫",
    layout="wide",
)

st.title("🎫 AI Helpdesk Assistant")
st.caption(
    "AI-powered ticket classification, recommendations, "
    "and customer response drafting."
)


def load_json(path: Path) -> list:
    if not path.exists():
        return []

    try:
        with path.open("r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def get_value(record: dict, key: str, default: str = "") -> str:
    value = record.get(key, default)
    return str(value) if value is not None else default


tickets = load_json(INPUT_FILE)
results = load_json(OUTPUT_FILE)

# Sidebar controls
st.sidebar.header("Controls")

if st.sidebar.button("🔄 Process tickets", type="primary"):
    if not CLI_FILE.exists():
        st.sidebar.error("cli.py was not found.")
    elif not INPUT_FILE.exists():
        st.sidebar.error("Input ticket file was not found.")
    else:
        with st.spinner("Processing tickets with LangChain..."):
            try:
                completed = subprocess.run(
                    [sys.executable, str(CLI_FILE)],
                    cwd=PROJECT_ROOT,
                    capture_output=True,
                    text=True,
                    timeout=300,
                    check=False,
                )

                if completed.returncode == 0:
                    st.sidebar.success("Processing completed.")
                    st.rerun()
                else:
                    st.sidebar.error("Ticket processing failed.")
                    st.sidebar.code(completed.stderr[-3000:])

            except subprocess.TimeoutExpired:
                st.sidebar.error(
                    "Processing timed out. Check the CLI logs."
                )

if not tickets:
    st.warning(
        "No input tickets found. Add data/support_tickets.json."
    )
    st.stop()

if not results:
    st.info(
        "No output results found yet. Click 'Process tickets' "
        "to run the existing LangChain workflow."
    )

# Dashboard metrics
result_by_id = {
    get_value(item, "ticket_id"): item
    for item in results
    if get_value(item, "ticket_id")
}

priorities = [
    get_value(result_by_id.get(get_value(ticket, "ticket_id"), {}),
              "priority").lower()
    for ticket in tickets
]

human_review_count = sum(
    result_by_id.get(get_value(ticket, "ticket_id"), {}).get(
        "requires_human", False
    ) is True
    for ticket in tickets
)

col1, col2, col3, col4 = st.columns(4)
col1.metric("Input tickets", len(tickets))
col2.metric("Processed", len(result_by_id))
col3.metric("Critical", priorities.count("critical"))
col4.metric("Human review", human_review_count)

st.divider()

# Search and filtering
st.subheader("Ticket Explorer")

search = st.text_input(
    "Search tickets",
    placeholder="Search ticket ID, customer, or ticket message...",
)

available_priorities = sorted({
    get_value(result_by_id.get(get_value(ticket, "ticket_id"), {}),
              "priority").lower()
    for ticket in tickets
    if get_value(result_by_id.get(get_value(ticket, "ticket_id"), {}),
                  "priority")
})

selected_priorities = st.multiselect(
    "Filter by priority",
    options=available_priorities,
    default=available_priorities,
)

filtered_tickets = []

for ticket in tickets:
    ticket_id = get_value(ticket, "ticket_id")
    customer = get_value(ticket, "customer_name")
    message = get_value(ticket, "ticket")
    result = result_by_id.get(ticket_id, {})

    query_text = f"{ticket_id} {customer} {message}".lower()
    priority = get_value(result, "priority").lower()

    if search.lower() not in query_text:
        continue

    if selected_priorities and priority not in selected_priorities:
        continue

    if not selected_priorities and available_priorities:
        continue

    filtered_tickets.append((ticket, result))

if not filtered_tickets:
    st.info("No tickets match the selected filters.")

for ticket, result in filtered_tickets:
    ticket_id = get_value(ticket, "ticket_id", "Unknown ticket")
    customer = get_value(ticket, "customer_name", "Unknown customer")
    priority = get_value(result, "priority", "Not processed").upper()
    category = get_value(result, "category", "Not classified")
    resolution = get_value(result, "resolution_type", "Pending")
    requires_human = result.get("requires_human", False)

    label = f"{ticket_id} · {customer} · {priority}"

    with st.expander(label):
        left, right = st.columns(2)

        with left:
            st.markdown("**Original ticket**")
            st.write(get_value(ticket, "ticket", "No ticket text"))

            st.markdown("**AI case summary**")
            summary = result.get("case_summary", {})
            if isinstance(summary, str):
                try:
                    summary = json.loads(summary)
                except json.JSONDecodeError:
                    pass
            st.json(summary if isinstance(summary, (dict, list))
                    else {"summary": summary or "Not available"})

        with right:
            st.markdown("**Classification**")
            st.write(f"Category: {category}")
            st.write(f"Priority: {priority}")
            st.write(f"Resolution type: {resolution}")
            st.write(
                "Human review: "
                + ("Required" if requires_human else "Not flagged")
            )

            st.markdown("**Recommended action**")
            st.write(
                get_value(result, "recommended_action", "Not available")
            )

            st.markdown("**Decision rationale**")
            st.write(
                get_value(result, "resolution_reason", "Not available")
            )

        st.markdown("**Draft customer response**")
        st.text_area(
            "Response",
            value=get_value(result, "response", "Not available"),
            height=200,
            key=f"response_{ticket_id}",
        )

st.divider()
st.caption(
    "Demo mode: AI recommendations are not proof of completed "
    "refunds, cancellations, shipments, or account deletions."
)
