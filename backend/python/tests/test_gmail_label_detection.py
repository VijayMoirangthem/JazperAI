"""Which Gmail folder a chat message refers to. Reported: 'give me the update on latest emails today.. Is there any email from Kunal
Sivach?' searched the Updates TAB, found nothing, and answered 'no emails from Kunal' although two arrived in the main inbox."""
import pytest

from api.routes.chat import _detect_label


@pytest.mark.parametrize("msg", [
    "give me the update on latest emails today.. Is there any email from Kunal Sivach?",
    "any update about my interview emails?",
    "what is the latest update from Kunal",
    "I want to present this email to the team",          # 'present' contains 'sent'
    "combining the emails from last week",                # 'combining' contains 'bin'
    "is there anything important from Kunal today?",
    "social media manager job emails",
    "latest emails",
])
def test_ordinary_sentences_search_the_main_inbox(msg):
    assert _detect_label(msg) == "INBOX", msg


@pytest.mark.parametrize("msg,label", [
    ("show me my spam", "SPAM"),
    ("check the updates tab", "CATEGORY_UPDATES"),
    ("any emails in updates?", "CATEGORY_UPDATES"),
    ("open my promotions", "CATEGORY_PROMOTIONS"),
    ("what's in the social folder", "CATEGORY_SOCIAL"),
    ("show sent emails", "SENT"),
    ("check my sent", "SENT"),
    ("starred emails please", "STARRED"),
    ("look in trash", "TRASH"),
    ("my drafts", "DRAFTS"),
])
def test_explicit_folder_requests_still_work(msg, label):
    assert _detect_label(msg) == label, msg
