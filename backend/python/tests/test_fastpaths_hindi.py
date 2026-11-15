"""Hindi / Hinglish phrasings of the deterministic intents take the fast path; ordinary conversation never does."""
import json

import pytest

from agents import fastpaths


def fast(text):
    return fastpaths.match("jasper", text, [], [])


@pytest.mark.parametrize("text", [
    "Mera system ka status batao", "system theek chal raha hai kya", "system ki halat kaisi hai", "सिस्टम का स्टेटस बताओ",           # health
    "kitne tokens bache hain", "aaj ka kharcha kitna hua", "kaun sa model use ho raha hai", "कितने टोकन बचे हैं",                    # usage
    "chat saaf karo", "poori chat delete kar do", "history mita do", "चैट साफ करो",                                                 # clear chat
    "tum aur kaise smart ban sakte ho", "kya connect karun",                                                                       # smarter
    "drive ki latest files dikhao", "drive mein sabse naya file batao",                                                            # drive
])
def test_hindi_and_hinglish_intents_take_the_fast_path(text):
    assert fast(text) is not None, text


@pytest.mark.parametrize("text", [
    "kya haal hai bhai", "aaj ka din kaisa hai", "tum kaun ho", "mujhe ek joke sunao", "कैसे हो", "meri chat acchi lagi",
    "kal ki meeting mein kya hua tha", "mera naya project kaisa chal raha hai", "thoda sa system design samjhao",
])
def test_ordinary_conversation_is_not_hijacked(text):
    assert fast(text) is None, text


def test_the_english_patterns_still_work():
    for text in ("system health", "how many tokens are left", "clear this chat", "latest files in drive", "what should i connect"):
        assert fast(text) is not None, text


async def _clear(text):
    out = []
    async for ev in fastpaths._clear(text):
        out.append(ev)
    return out


async def test_clear_chat_asks_for_confirmation_in_the_users_language():
    en = await _clear("clear this chat")
    hi = await _clear("chat saaf karo")
    dv = await _clear("चैट साफ करो")
    assert en[0]["ui"]["action"] == "clear_chat" and en[1]["delta"].startswith("Tap delete")
    assert hi[0]["ui"]["label"].endswith("delete kar du?") and "dabao" in hi[1]["delta"]
    assert "हटा दूँ" in dv[0]["ui"]["label"] and "डिलीट" in dv[1]["delta"]
    older = await _clear("30 din purani chat saaf karo")
    assert older[0]["ui"]["scope"] in ("before_now", "all") or older[0]["ui"]["scope"].startswith("older_than_days")
    assert json.dumps(hi, ensure_ascii=False)                          # serialisable for the stream
