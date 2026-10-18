"""
Workflow service tests — detection, structure, and step-tracking contracts.

These tests run entirely offline: no LLM calls, no DB connections.
DB-touching functions (create_plan_for_workflow, update_plan_step_sync,
complete_plan_sync) are tested for importability and interface only; their
integration behaviour is covered by a live DB in the integration test suite.
"""
import pytest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# ── Workflow detection ────────────────────────────────────────────────────────

class TestWorkflowDetection:

    def test_job_apply_trigger_explicit(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("can you apply to software engineer jobs for me?")
        assert wf is not None
        assert wf["id"] == "job_apply"

    def test_job_apply_trigger_hunt(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("start a job hunt and apply for me")
        assert wf is not None
        assert wf["id"] == "job_apply"

    def test_check_email_trigger_inbox(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("check my inbox please")
        assert wf is not None
        assert wf["id"] == "check_email"

    def test_check_email_trigger_any_new(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("any new emails?")
        assert wf is not None
        assert wf["id"] == "check_email"

    def test_web_research_trigger_research(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("research about the latest AI developments")
        assert wf is not None
        assert wf["id"] == "web_research"

    def test_web_research_trigger_latest_news(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("what's the latest news on Python 4?")
        assert wf is not None
        assert wf["id"] == "web_research"

    def test_send_email_trigger_send_to(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("send an email to the recruiter at Acme")
        assert wf is not None
        assert wf["id"] == "send_email"

    def test_send_email_trigger_reply(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("reply to the email from Google")
        assert wf is not None
        assert wf["id"] == "send_email"

    def test_no_match_returns_none_greeting(self):
        from core.services.workflow_service import detect_workflow
        assert detect_workflow("hello, how are you?") is None

    def test_no_match_returns_none_time(self):
        from core.services.workflow_service import detect_workflow
        assert detect_workflow("what time is it in Tokyo?") is None

    def test_no_match_returns_none_explain(self):
        from core.services.workflow_service import detect_workflow
        assert detect_workflow("explain how transformers work") is None

    def test_detection_is_case_insensitive(self):
        from core.services.workflow_service import detect_workflow
        wf = detect_workflow("APPLY TO JOBS TODAY")
        assert wf is not None
        assert wf["id"] == "job_apply"


# ── Workflow structure ────────────────────────────────────────────────────────

class TestWorkflowStructure:

    def test_all_workflows_have_required_fields(self):
        from core.services.workflow_service import WORKFLOWS
        required = {"id", "name", "agent", "triggers", "steps", "approval"}
        for wf in WORKFLOWS:
            missing = required - set(wf.keys())
            assert not missing, f"Workflow '{wf.get('id')}' missing: {missing}"

    def test_all_workflows_have_steps(self):
        from core.services.workflow_service import WORKFLOWS
        for wf in WORKFLOWS:
            assert isinstance(wf["steps"], list), f"'{wf['id']}' steps must be a list"
            assert len(wf["steps"]) >= 1, f"'{wf['id']}' must have at least 1 step"

    def test_all_steps_have_title_and_description(self):
        from core.services.workflow_service import WORKFLOWS
        for wf in WORKFLOWS:
            for i, step in enumerate(wf["steps"]):
                assert "title" in step, f"'{wf['id']}' step {i} missing 'title'"
                assert "description" in step, f"'{wf['id']}' step {i} missing 'description'"

    def test_all_workflows_have_at_least_one_trigger(self):
        from core.services.workflow_service import WORKFLOWS
        for wf in WORKFLOWS:
            assert isinstance(wf["triggers"], list)
            assert len(wf["triggers"]) >= 1, f"'{wf['id']}' must have triggers"

    def test_exactly_four_workflows_defined(self):
        from core.services.workflow_service import WORKFLOWS
        assert len(WORKFLOWS) == 4, f"Expected 4 workflows, got {len(WORKFLOWS)}"

    def test_workflow_ids_are_unique(self):
        from core.services.workflow_service import WORKFLOWS
        ids = [wf["id"] for wf in WORKFLOWS]
        assert len(ids) == len(set(ids)), "Duplicate workflow IDs found"


# ── list_workflows API ────────────────────────────────────────────────────────

class TestListWorkflows:

    def test_returns_all_four(self):
        from core.services.workflow_service import list_workflows
        assert len(list_workflows()) == 4

    def test_each_entry_has_required_keys(self):
        from core.services.workflow_service import list_workflows
        required = {"id", "name", "agent", "steps", "needs_approval"}
        for w in list_workflows():
            missing = required - set(w.keys())
            assert not missing, f"list_workflows entry missing: {missing}"

    def test_needs_approval_is_bool(self):
        from core.services.workflow_service import list_workflows
        for w in list_workflows():
            assert isinstance(w["needs_approval"], bool)

    def test_steps_count_matches_definition(self):
        from core.services.workflow_service import list_workflows, WORKFLOWS
        listed = {w["id"]: w["steps"] for w in list_workflows()}
        for wf in WORKFLOWS:
            assert listed[wf["id"]] == len(wf["steps"])


# ── update_plan_step_sync — importability + interface ─────────────────────────

class TestUpdatePlanStep:

    def test_function_is_importable(self):
        from core.services.workflow_service import update_plan_step_sync
        assert callable(update_plan_step_sync)

    def test_complete_plan_sync_is_importable(self):
        from core.services.workflow_service import complete_plan_sync
        assert callable(complete_plan_sync)
