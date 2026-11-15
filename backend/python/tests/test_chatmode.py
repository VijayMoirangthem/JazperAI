from datetime import datetime, timezone

import pytest

from agents import chatmode


@pytest.mark.parametrize("text", [
    "hi jasper", "how are you", "what is your name", "tell me a joke", "explain recursion in two lines", "thanks!",
    "Aaj ka din kaisa hai", "kya haal hai bhai", "tum kaun ho", "Explain in three sentences what you do for me",
    "good morning", "मेरा नाम क्या है", "what is 15 percent of 240",
])
def test_plain_conversation_skips_tools(text):
    assert chatmode.needs_tools(text) is False, text


@pytest.mark.parametrize("text", [
    "show my latest emails", "Kunal ka email dikhao", "mera system ka status batao", "open the budget sheet on drive",
    "send a mail to Kunal", "remind me tomorrow at 5", "search the web for groq pricing", "write a python script and run it",
    "ask messenger to check gmail", "connect slack", "ईमेल दिखाओ", "मीटिंग कब है", "delete the old files", "check the weather in Imphal",
    "what's the news today",
])
def test_anything_that_could_act_uses_tools(text):
    assert chatmode.needs_tools(text) is True, text


def test_attachments_links_code_and_long_messages_always_use_tools():
    assert chatmode.needs_tools("hi", has_attachments=True)
    assert chatmode.needs_tools("look at https://example.com")
    assert chatmode.needs_tools("mail me@example.com")
    assert chatmode.needs_tools("```print(1)```")
    assert chatmode.needs_tools("word " * 40)
    assert chatmode.needs_tools("")


def test_plain_prompt_has_the_clock_and_no_tool_help():
    now = datetime(2026, 11, 15, 9, 5, tzinfo=timezone.utc)
    p = chatmode.plain_system("You are Jasper.", now)
    assert "Sunday, 15 November 2026, 09:05" in p and p.startswith("You are Jasper.")
    assert "<tool>" not in p and len(p) < 700


@pytest.mark.parametrize("text,esc", [("<tool>{\"name\":\"x\"}</tool>", True), ('{"name":"x"}', True), ("TOOLS", True), ("tools", True),
                                      ("Sure, doing great.", False), ("Toolkit ideas: ...", False), ("", False)])
def test_escalation_detection(text, esc):
    # a wrongly escalated reply only costs speed (it falls back to the full loop); a missed one would be an answer without tools
    assert chatmode.is_escalation(text) is esc


ALLOWED = ["list_org", "find_bot", "remember", "clear_chat", "google", "open_file", "find_file", "capability_plan", "llm_status",
           "system_status", "read_logs", "ask_bot", "alerts", "slo", "diagnose", "gaps", "llm_fix", "list_connections", "suggest_connectors",
           "list_skills", "view_skill", "save_skill", "build_feature", "feature_status", "merge_feature", "fs_roots", "fs_list", "fs_read",
           "fs_search", "fs_write", "hold_meeting", "bot_stats", "create_bot", "edit_bot_prompt", "evaluate_bot", "improve_bot"]


def test_subset_shrinks_the_description_list_for_a_clear_area():
    sub = chatmode.tool_subset("list my drive files", ALLOWED)
    assert sub is not None and len(sub) < len(ALLOWED) // 2
    assert {"google", "open_file", "ask_bot", "capability_plan"} <= set(sub)       # the area + delegation
    assert "build_feature" not in sub


def test_subset_never_hides_everything_or_invents_tools():
    assert chatmode.tool_subset("hello there", ALLOWED) is None                      # no clear area: describe all
    assert chatmode.tool_subset("check status of the team bots and build a feature and drive files", ALLOWED) is None  # many areas: all
    sub = chatmode.tool_subset("system status", ["system_status", "ask_bot"])         # only allowed tools are ever listed
    assert sub is None or set(sub) <= {"system_status", "ask_bot"}
