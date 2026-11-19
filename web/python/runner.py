"""Fixed stdin/stdout bridge: one validated ticket in, one real result out.

No ticket text, model responses or credentials are logged. The upstream workflow
is retained; its informational print statements are suppressed for this bridge.
"""

import contextlib
import io
import json
import sys

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.llm import create_llm
from src.workflow import build_workflow, process_ticket


class TicketInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticket_id: str = Field(min_length=1, max_length=80)
    customer_name: str = Field(default="Not provided", max_length=100)
    ticket: str = Field(min_length=1, max_length=6000)

    @field_validator("ticket", "ticket_id")
    @classmethod
    def not_blank(cls, value):
        if not value.strip():
            raise ValueError("A nonblank value is required.")
        return value.strip()


def main():
    try:
        ticket = TicketInput.model_validate_json(sys.stdin.read(30000))
        with contextlib.redirect_stdout(io.StringIO()):
            result = process_ticket(ticket.model_dump(), build_workflow(create_llm()))
        print(result.model_dump_json())
    except Exception:
        # SDK exceptions can include request payloads or credentials.
        print(json.dumps({"error": "AI processing failed. Please retry later."}))
        sys.exit(1)


if __name__ == "__main__":
    main()
