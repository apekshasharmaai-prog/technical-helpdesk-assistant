"""Deterministic workflow regression tests; no external AI calls."""

import contextlib
import io
import json
import unittest

from langchain_core.runnables import RunnableLambda

from runner import TicketInput
from src.chains import create_router
from src.schemas import BillingAnalysis, ResolutionDecision, TechnicalAnalysis, TicketTriage
from src.workflow import process_ticket


class WorkflowTests(unittest.TestCase):
    def test_original_workflow_preserves_ticket_and_decision(self):
        ticket = {"ticket_id": "TEST-1", "customer_name": "Test customer", "ticket": "Export stops."}
        workflow = {
            "triage_chain": RunnableLambda(lambda _: TicketTriage(category="technical", priority="medium", language="English")),
            "router": RunnableLambda(lambda _: TechnicalAnalysis(issue="Export fails", affected_feature="export", error_message="none", troubleshooting_required=True)),
            "resolution_chain": RunnableLambda(lambda _: ResolutionDecision(resolution_type="request_information", recommended_action="Ask for export format.", requires_human=True, reason="Insufficient diagnostic details.")),
            "response_chain": RunnableLambda(lambda inputs: f"Please share the export format. {inputs['recommended_action']}"),
        }
        with contextlib.redirect_stdout(io.StringIO()):
            result = process_ticket(ticket, workflow)
        self.assertEqual(result.ticket_id, ticket["ticket_id"])
        self.assertEqual(result.category, "technical")
        self.assertTrue(result.requires_human)
        self.assertEqual(json.loads(result.case_summary)["affected_feature"], "export")
        self.assertIn("Ask for export format.", result.response)

    def test_missing_or_whitespace_message_is_rejected(self):
        for ticket in ["", "   "]:
            with self.assertRaises(ValueError):
                TicketInput(ticket_id="TEST-2", ticket=ticket)

    def test_oversized_message_is_rejected(self):
        with self.assertRaises(ValueError):
            TicketInput(ticket_id="TEST-3", ticket="x" * 6001)

    def test_model_and_all_category_routes_build_without_network(self):
        class StubModel:
            def with_structured_output(self, schema):
                # Schema routing is verified here without paid network calls.
                return RunnableLambda(lambda _: schema)
        router = create_router(StubModel())
        expected = {
            "billing": "BillingAnalysis",
            "technical": "TechnicalAnalysis",
            "account": "AccountAnalysis",
            "cancellation_refund": "CancellationRefundAnalysis",
            "order_delivery": "OrderDeliveryAnalysis",
            "general": "GeneralAnalysis",
        }
        for category, name in expected.items():
            schema = router.invoke({"category": category, "customer_name": "Test", "ticket": "Test"})
            self.assertEqual(schema.__name__, name)


if __name__ == "__main__":
    unittest.main()
