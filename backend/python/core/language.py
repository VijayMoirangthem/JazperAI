"""Reply in the language AND script the founder used: English, Hindi (Devanagari) or Hinglish (Hindi written in Roman letters).

Deterministic (no model call): Devanagari characters mean Hindi; Roman text containing enough common Hindi words means Hinglish;
otherwise English. An explicit request ("reply in Hinglish", "hindi mein batao", "in english please") always wins. The result is a
one-line directive appended to the prompt, so every model follows it the same way.
"""
from __future__ import annotations

import re

_DEVANAGARI = re.compile(r"[ऀ-ॿ]")
# Common Hindi words as typed in Roman letters. Words that are also normal English (is, me, to, main, the, a, in) are left out so
# English sentences are not mistaken for Hinglish.
_HINGLISH = frozenset("""
hai hain hoon ho tha thi the kya kyun kyu kaise kaisa kaisi kahan kab kaun kitna kitni kitne mujhe mujhko mera meri mere tum tumhe
tumhara aap aapka aapko hum humein humara yeh ye woh wo isko usko isme usme isse usse nahi nahin naa na haan han ji bhai yaar dost
karo kar karna karke kare karein karta karti kiya kiye kijiye batao bata bataiye bolo bol dikha dikhao dekho dekh suno chalo chal
jao ja aao aa raha rahi rahe rahega rahegi hoga hogi honge hua hui hue sakta sakti sakte chahiye chahie chahta chahti lagta lagti
aaj kal abhi pehle phir fir bahut bohot thoda zyada jyada kam sab sabhi kuch koi kabhi toh bhi se ko ka ki ke par pe mein
andar bahar saath liye lekin magar aur ya agar kyunki isliye matlab samajh samjhao samjha accha achha theek thik sahi galat
kaam din raat subah shaam paisa paise ghar log kaisa kuchh mil milega milegi diya diye dena lena
""".split())
_STOP_EN = frozenset("the and is are was were this that with for from have has you your what when where how why can will would please".split())

_ASK = {
    "hinglish": re.compile(r"\b(in|reply in|answer in|speak|talk|baat|bolo|batao)\s+(in\s+)?hinglish\b|\bhinglish\s+(mein|me|main|ma)\b", re.I),
    "hindi": re.compile(r"\b(in|reply in|answer in)\s+hindi\b|\bhindi\s+(mein|me|main|ma)\b|(हिंदी|हिन्दी)\s*(में|मे)", re.I),
    "english": re.compile(r"\b(in|reply in|answer in)\s+english\b|\benglish\s+(mein|me|main|ma)\b|\bspeak english\b", re.I),
}

DIRECTIVES = {
    "english": "",  # the default: nothing to add
    "hindi": ("LANGUAGE: The user writes Hindi. Reply in natural Hindi using Devanagari script. Keep code, commands, file names, "
              "numbers and proper nouns exactly as they are."),
    "hinglish": ("LANGUAGE: The user writes Hinglish (Hindi in Roman letters). Reply in friendly, natural Hinglish using ONLY Roman letters "
                 "- never Devanagari - the way a Hindi speaker types to a friend: simple Hindi words mixed with common English words. "
                 "Keep code, commands, file names, numbers and proper nouns exactly as they are."),
}


def detect(text: str) -> str:
    """'english' | 'hindi' | 'hinglish' for one user message. An explicit request in the message overrides the detection."""
    t = text or ""
    for lang in ("hinglish", "hindi", "english"):  # most specific first: "in hinglish" also contains "in english"-like words
        if _ASK[lang].search(t):
            return lang
    letters = [c for c in t if c.isalpha()]
    if not letters:
        return "english"
    if len(_DEVANAGARI.findall(t)) / len(letters) > 0.25:
        return "hindi"
    words = re.findall(r"[a-zA-Z']+", t.lower())
    if not words:
        return "english"
    hits = sum(1 for w in words if w in _HINGLISH)
    english = sum(1 for w in words if w in _STOP_EN)
    # two distinct Hindi markers and a clear share of the sentence (short messages like "kya hai" count; one stray "to"/"ho" does not)
    if hits >= 2 and hits / len(words) >= 0.2 and hits > english:
        return "hinglish"
    return "english"


def directive_for(text: str) -> str:
    """The instruction line to add to the prompt for this message ('' for plain English)."""
    return DIRECTIVES[detect(text)]
