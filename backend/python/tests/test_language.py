import pytest

from core import language as L


@pytest.mark.parametrize("msg", [
    "Bhai aaj mera din kaisa rahega? Mujhe 3 important kaam batao jo mujhe karne chahiye, short mein.",
    "kya hai ye",
    "mujhe kal ka schedule dikhao",
    "yaar email check karo na, kuch important aaya kya?",
    "Aaj ka kaam kya hai mera",
])
def test_roman_hindi_is_hinglish(msg):
    assert L.detect(msg) == "hinglish", msg


@pytest.mark.parametrize("msg", [
    "मुझे Python में एक function लिखकर दो जो duplicate हटाए",
    "आज मेरा दिन कैसा रहेगा?",
    "क्या कोई नया ईमेल आया है",
])
def test_devanagari_is_hindi(msg):
    assert L.detect(msg) == "hindi", msg


@pytest.mark.parametrize("msg", [
    "give me the update on latest emails today.. Is there any email from Kunal Sivach?",
    "What is the status of my system?",
    "Write a function to remove duplicates from a list",
    "I want to go to the bank to check my account",       # 'to', 'me', 'go' are not Hindi markers
    "Show me the full email from Kunal about the interns",
    "ok", "", "12345",
])
def test_english_stays_english(msg):
    assert L.detect(msg) == "english", msg


def test_explicit_request_wins_over_detection():
    assert L.detect("What is the status of my system? Reply in Hinglish.") == "hinglish"
    assert L.detect("Bhai ye samjhao in English please") == "english"
    assert L.detect("explain recursion in hindi") == "hindi"
    assert L.detect("batao hindi mein") == "hindi"
    assert L.detect("hinglish mein baat karo") == "hinglish"


def test_directives_force_the_right_script():
    assert L.directive_for("hello there") == ""
    assert "Devanagari" in L.directive_for("आज क्या करना है")
    d = L.directive_for("bhai kya haal hai")
    assert "ONLY Roman letters" in d and "never Devanagari" in d
