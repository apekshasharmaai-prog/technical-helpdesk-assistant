"""AI Helpdesk Workbench — Streamlit entry point."""

import json
import uuid
from pathlib import Path

import streamlit as st

from src.llm import create_llm
from src.workflow import build_workflow, process_ticket

PROJECT_ROOT = Path(__file__).resolve().parent
INPUT_FILE = PROJECT_ROOT / "data" / "support_tickets.json"
OUTPUT_FILE = PROJECT_ROOT / "data" / "output" / "support_ticket_results.json"

st.set_page_config(page_title="AI Helpdesk Workbench", page_icon="🎫", layout="wide")


def load_tickets():
    if not INPUT_FILE.exists():
        return []
    with INPUT_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if not isinstance(data, list):
        raise ValueError("Input JSON must contain a list of tickets.")
    return data


@st.cache_resource
def get_workflow():
    return build_workflow(create_llm())


def to_dict(result):
    if hasattr(result, "model_dump"):
        return result.model_dump()
    if isinstance(result, dict):
        return result
    raise TypeError("Unsupported workflow result type.")


def get_text(record, key, default=""):
    value = record.get(key, default)
    return str(value) if value is not None else default


def persist_results(results):
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8") as file:
        json.dump(list(results.values()), file, indent=2, ensure_ascii=False)


def selection_key(ticket_id):
    return f"select_{ticket_id}"


# ---------- Session initialization ----------
if "tickets" not in st.session_state:
    try:
        st.session_state.tickets = load_tickets()
    except (OSError, json.JSONDecodeError, ValueError) as error:
        st.error(f"Could not load tickets: {error}")
        st.stop()

if "results" not in st.session_state:
    st.session_state.results = {}

if "processing_errors" not in st.session_state:
    st.session_state.processing_errors = {}


# ---------- Header and metrics ----------
st.title("🎫 AI Helpdesk Workbench")
st.write(
    "Submit a customer support ticket or select existing requests. "
    "The LangChain workflow analyzes tickets when you click Process."
)

tickets = st.session_state.tickets
results = st.session_state.results

pending_count = sum(ticket["ticket_id"] not in results for ticket in tickets)
human_review_count = sum(
    result.get("requires_human") is True for result in results.values()
)

m1, m2, m3 = st.columns(3)
m1.metric("Submitted tickets", len(tickets))
m2.metric("Processed this session", len(results))
m3.metric("AI flags for human review", human_review_count)
st.caption(f"{pending_count} ticket(s) awaiting processing.")


# ---------- Submit a new ticket ----------
st.divider()
st.header("1. Submit a new ticket")

with st.form("new_ticket_form", clear_on_submit=True):
    customer_name = st.text_input(
        "Customer name (optional)", placeholder="Enter customer name"
    )
    ticket_message = st.text_area(
        "Ticket message",
        placeholder=(
            "Example: I was charged twice for my subscription. "
            "Please investigate."
        ),
        height=130,
    )
    submitted = st.form_submit_button("Submit ticket", type="primary")

if submitted:
    message = ticket_message.strip()
    if not message:
        st.error("Please enter a ticket message.")
    else:
        ticket_id = f"TKT-CUSTOM-{uuid.uuid4().hex[:8].upper()}"
        st.session_state.tickets.append(
            {
                "ticket_id": ticket_id,
                "customer_name": customer_name.strip() or "Not provided",
                "ticket": message,
            }
        )
        st.session_state.processing_errors.pop(ticket_id, None)
        st.success(f"Ticket {ticket_id} submitted successfully.")
        st.rerun()


# ---------- Submitted ticket list ----------
st.divider()
st.header("2. Select tickets to process")
st.caption(
    "Select one or more pending tickets using the checkboxes. "
    "The processing controls are above the ticket list."
)

ticket_by_id = {
    ticket["ticket_id"]: ticket for ticket in st.session_state.tickets
}
pending_ids = [
    ticket_id for ticket_id in ticket_by_id if ticket_id not in results
]

# Initialize checkbox state before widgets are created.
for ticket_id in ticket_by_id:
    key = selection_key(ticket_id)
    if key not in st.session_state:
        st.session_state[key] = False
    if ticket_id in results:
        st.session_state[key] = False

if not ticket_by_id:
    st.info("No tickets have been submitted yet.")
else:
    selected_ids = [
        ticket_id
        for ticket_id in pending_ids
        if st.session_state.get(selection_key(ticket_id), False)
    ]

    toolbar_left, toolbar_right = st.columns(
        [3, 2], vertical_alignment="bottom"
    )
    with toolbar_left:
        st.write("Choose tickets from the list below.")
    with toolbar_right:
        count_col, button_col = st.columns(
            [1, 2], vertical_alignment="center"
        )
        with count_col:
            st.markdown(f"**Selected: {len(selected_ids)}**")
        with button_col:
            process_clicked = st.button(
                "🚀 Process selected tickets",
                type="primary",
                disabled=not selected_ids,
                use_container_width=True,
            )

    st.divider()

    for ticket_id, ticket in ticket_by_id.items():
        is_processed = ticket_id in results
        col_check, col_ticket, col_status = st.columns(
            [0.5, 5, 1.2], vertical_alignment="center"
        )

        with col_check:
            st.checkbox(
                f"Select {ticket_id}",
                key=selection_key(ticket_id),
                label_visibility="collapsed",
                disabled=is_processed,
            )
        with col_ticket:
            st.markdown(
                f"**{ticket_id}** · "
                f"{get_text(ticket, 'customer_name', 'Unknown customer')}"
            )
            st.caption(get_text(ticket, "ticket"))
        with col_status:
            if is_processed:
                st.success("Processed")
            else:
                st.info("Pending")

    # Process selected tickets. No master checkbox state is changed here.
    if process_clicked:
        selected_ids = [
            ticket_id
            for ticket_id in pending_ids
            if st.session_state.get(selection_key(ticket_id), False)
        ]
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
                result = process_ticket(ticket_by_id[ticket_id], workflow)
                st.session_state.results[ticket_id] = to_dict(result)
                st.session_state.processing_errors.pop(ticket_id, None)
            except Exception as error:
                st.session_state.processing_errors[ticket_id] = str(error)
            progress.progress(index / total)

        # Do not mutate checkbox widget keys after rendering them.
        # Processed tickets are excluded from future selections and disabled.
        try:
            persist_results(st.session_state.results)
        except OSError as error:
            st.warning(f"Could not save results to disk: {error}")

        status_text.empty()
        st.rerun()


# ---------- Processing errors ----------
if st.session_state.processing_errors:
    st.divider()
    st.header("Processing errors")
    for ticket_id, error in st.session_state.processing_errors.items():
        st.error(f"{ticket_id}: {error}")


# ---------- AI processing results ----------
st.divider()
st.header("3. AI processing results")

if not st.session_state.results:
    st.info(
        "No AI results yet. Select pending tickets above "
        "and click Process selected tickets."
    )
else:
    ticket_by_id = {
        ticket["ticket_id"]: ticket for ticket in st.session_state.tickets
    }

    for ticket_id, result in reversed(list(st.session_state.results.items())):
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

                st.subheader("AI classification")
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

                if isinstance(summary, dict) and summary:
                    # Render each field as a readable label and value.
                    for key, value in summary.items():
                        label = key.replace("_", " ").strip().title()

                        if isinstance(value, bool):
                            display_value = "Yes" if value else "No"
                        elif isinstance(value, (dict, list)):
                            display_value = json.dumps(
                                value,
                                ensure_ascii=False,
                                indent=2,
                            )
                        else:
                            display_value = str(value)

                        st.markdown(f"**{label}:** {display_value}")

                elif isinstance(summary, list) and summary:
                    for item in summary:
                        st.markdown(f"- {item}")

                elif summary:
                    st.write(summary)

                else:
                    st.info("No case summary available.")


            with right:
                st.subheader("Recommended action")
                st.write(
                    get_text(result, "recommended_action", "Not provided")
                )

                st.subheader("Resolution rationale")
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
                "AI-generated recommendation only. No refund, cancellation, "
                "shipment, or account deletion is executed by this UI."
            )
