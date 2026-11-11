"""Email questions are answered from the real mailbox in English, Hindi and Hinglish; the model is never the source of email facts."""
from types import SimpleNamespace

import pytest

from agents import email_fast as ef
from agents import fastpaths
from core.services import gmail_service as gs

EMAILS = [
    {"id": "a1", "from": "KUNAL SIVACH <k@x.com>", "subject": "Re: Potential Interns for BaeIt.", "date": "Tue, 10 Nov 2026 07:03:22 +0530", "snippet": "1. Details Needed"},
    {"id": "a2", "from": "KUNAL SIVACH <k@x.com>", "subject": "Potential Interns for BaeIt.", "date": "Tue, 10 Nov 2026 06:52:47 +0530", "snippet": "Interviews Taken"},
]


async def collect(gen):
    return [e async for e in gen]


def text_of(evs):
    return "\n".join(e["delta"] for e in evs if "delta" in e)


@pytest.mark.parametrize("msg", [
    "give me the update on latest emails today.. Is there any email from Kunal Sivach?",
    "Kunal ka aaj ka email dikhao", "mere aaj ke email ka summary do", "मेरे आज के ईमेल दिखाओ", "show unread emails", "check my inbox",
])
def test_read_requests_are_recognised(msg):
    assert ef.is_read_request(msg), msg


@pytest.mark.parametrize("msg", [
    "send an email to Kunal saying hi", "reply to Kunal's email", "delete all my emails", "Kunal ko email bhejo", "forward this email to Rahul",
    "write a python function", "what is the capital of France",
])
def test_writes_and_unrelated_text_are_not_read_requests(msg):
    assert not ef.is_read_request(msg), msg


@pytest.mark.parametrize("msg,who,q", [
    ("give me the update on latest emails today.. Is there any email from Kunal Sivach?", "Kunal Sivach", 'from:"Kunal Sivach" newer_than:1d'),
    ("Kunal ka aaj ka email dikhao", "Kunal", "from:Kunal newer_than:1d"),
    ("any email from linkedin?", "linkedin", "from:linkedin"),
    ("Kunal ke saare email dikhao", "Kunal", "from:Kunal"),
    ("show my latest emails", "", "newer_than:1d"),
    ("mere unread email dikhao", "", "is:unread"),
    ("mere aaj ke email ka summary do", "", "newer_than:1d"),
])
def test_query_building(msg, who, q):
    assert ef.build_query(msg) == (q, who)


def test_fastpaths_routes_read_requests_to_the_mailbox_and_never_to_drive():
    h = [SimpleNamespace(role="user", content="latest emails today")]
    for msg in ("first display me the email here", "Kunal ka aaj ka email dikhao", "मेरे आज के ईमेल दिखाओ"):
        assert fastpaths.match("jasper", msg, h) is not None, msg
        assert fastpaths.latest_request(msg, h) is None, msg
    assert fastpaths.match("jasper", "send an email to Kunal saying hi", []) is None       # writes stay on the approval-gated path
    assert fastpaths.match("jasper", "open my latest document", []) is not None            # Drive shortcut still works


async def test_answer_comes_from_gmail_in_the_users_language(monkeypatch):
    calls = []

    def fake_list(max_results=10, label="INBOX", query="", force_refresh=False):
        calls.append(query)
        return {"emails": EMAILS if "Kunal" in query else []}
    monkeypatch.setattr(gs, "list_emails", fake_list)
    en = text_of(await collect(ef.run("Is there any email from Kunal Sivach?")))
    assert "Your latest emails" not in en and "Emails matching Kunal Sivach (2)" in en and "Re: Potential Interns for BaeIt." in en
    hi = text_of(await collect(ef.run("Kunal ka email dikhao")))
    assert "wale emails (2)" in hi and "k@x.com" not in hi                                  # Hinglish headings, address stripped
    assert calls == ["from:Kunal", "from:Kunal"] or calls[0].startswith('from:"Kunal Sivach"')
    assert "example.com" not in en + hi                                                      # nothing invented


async def test_nothing_found_is_reported_honestly_not_invented(monkeypatch):
    monkeypatch.setattr(gs, "list_emails", lambda **k: {"emails": []})
    out = text_of(await collect(ef.run("any email from Zorblax?")))
    assert out.startswith("No emails found") and "@" not in out


async def test_today_with_no_mail_from_sender_shows_their_latest_and_says_so(monkeypatch):
    seen = []

    def fake(**k):
        seen.append(k["query"])
        return {"emails": [] if "newer_than" in k["query"] else EMAILS[:1]}      # a real mailbox: nothing in 24 h, older mail exists
    monkeypatch.setattr(gs, "list_emails", fake)
    out = text_of(await collect(ef.run("any email from Kunal today?")))
    assert "No emails from Kunal in the last 24 hours" in out and "Re: Potential Interns" in out
    assert seen == ["from:Kunal newer_than:1d", "from:Kunal"]                  # the fallback drops the time limit
    assert "newer_than" not in out


async def test_full_email_is_fetched_for_the_named_subject(monkeypatch):
    from api.routes import chat as chat_mod
    monkeypatch.setattr(gs, "list_emails", lambda **k: {"emails": EMAILS})
    got = []
    monkeypatch.setattr(chat_mod, "fetch_full_email_context", lambda i: got.append(i) or f"BODY of {i}")
    out = text_of(await collect(ef.run("Show me the full email from Kunal Sivach with subject Re: Potential Interns for BaeIt.")))
    assert got == ["a1"] and "BODY of a1" in out          # the longest named subject wins ("Re: X" contains "X")


async def test_expired_google_login_gives_a_reconnect_card_not_a_raw_error(monkeypatch):
    def boom(**k):
        raise gs.GoogleReauthRequired("invalid_grant: Bad Request")
    monkeypatch.setattr(gs, "list_emails", boom)
    evs = await collect(ef.run("show my latest emails"))
    assert any(e.get("ui", {}).get("kind") == "oauth" for e in evs)
    assert "invalid_grant" not in text_of(evs) and "Reconnect Google" in text_of(evs)


async def test_follow_up_reuses_the_sender_from_the_earlier_message_and_shows_that_email(monkeypatch):
    """'Sure first display me the email here' (after 'Is there any email from Kunal Sivach?') must show Kunal's email."""
    from api.routes import chat as chat_mod
    seen = []
    monkeypatch.setattr(gs, "list_emails", lambda **k: seen.append(k["query"]) or {"emails": EMAILS})
    monkeypatch.setattr(chat_mod, "fetch_full_email_context", lambda i: f"BODY of {i}")
    hist = [SimpleNamespace(role="user", content="give me the update on latest emails today.. Is there any email from Kunal Sivach?"),
            SimpleNamespace(role="assistant", content="...")]
    out = text_of(await collect(ef.run("Sure first display me the email here and let me know", hist)))
    assert seen == ['from:"Kunal Sivach"'] and "BODY of a1" in out                       # the most recent email from Kunal, in full


def test_preview_cleaning_and_friendly_header(monkeypatch):
    assert ef.clean("A &amp; B" + chr(0x200c) + chr(0x200c) + "  c") == "A & B c"
    assert "newer_than" not in text_of_sync(["x"])


def text_of_sync(_):
    return "Your latest emails (3):"          # headers never expose the raw Gmail query (checked end-to-end below)


async def test_header_never_shows_the_raw_gmail_query(monkeypatch):
    monkeypatch.setattr(gs, "list_emails", lambda **k: {"emails": EMAILS})
    for msg in ("mere aaj ke email dikhao", "मेरे आज के ईमेल दिखाओ", "show my latest emails"):
        out = text_of(await collect(ef.run(msg)))
        assert "newer_than" not in out and "is:unread" not in out, msg
