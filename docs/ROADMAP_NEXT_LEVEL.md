# Jazper: next-level plan (written 2026-11-11)

## Where Jazper really stands (tested today, not assumed)

| Area | Result |
|---|---|
| English chat, coding (Python function, explanation) | Works; replies in about 4-5 s once models are warm |
| Hindi (Devanagari) coding question | Worked |
| Hinglish (Roman letters) | **Was broken** (answered in Devanagari). Fixed: `core/language.py` mirrors your script; 18 tests; verified live |
| Hindi/Hinglish email requests ("mere email dikhao") | **Broken**: email detection is English-keyword only (see P1) |
| "Status of my system" in the main chat | **Broken**: went to a web search and quoted Apple's status. The chat stream has no system tool; only the older Jasper tool path does (P1) |
| Gmail read / full email / Drive | Works after Google reconnect; verified against the real mailbox |
| Speed | First replies took 60-110 s: the PC had 0.3 GB of 15.7 GB RAM free (VS Code 2.7 GB, Chrome 2.1 GB, Jazper 1.6-2.1 GB once the memory models load, Docker VM). Not a model problem |
| Telegram | Was outbound-only. Now two-way (below) |
| WhatsApp | Not built (below) |

Not yet tested: voice, vision/images (Lens has no working model), calendar writes, the LinkedIn/job automation, the dev-loop (autonomous
coding with approval), MCP connectors (16 new ones are untested), memory recall quality, sending a real email or Telegram reply.

## Built in this round

1. **Language mirroring** (`core/language.py`, hooked into the chat): English, Hindi in Devanagari, Hinglish in Roman letters; an explicit
   "reply in X" wins. Deterministic, no extra model call.
2. **Telegram, two-way** (`core/services/telegram_bot.py`): long-polls Telegram from this PC, so no public URL, webhook or tunnel. Messages
   go through the same chat pipeline as the app (email, Drive, search, agents, memory, Hinglish). Only ONE approved chat is answered;
   strangers get a one-line "private bot" reply and appear as a pending request you approve with one click in Settings -> Telegram.
   Updates are acknowledged on receipt (at-most-once), so a restart cannot replay a message that sent an email. Commands: /help /new
   /status /whoami. Tested with a fake Telegram server (9 tests). **Not tested against real Telegram: it needs your bot token.**
3. **Memory relief**: the AI memory models are freed after an idle period (per preset) or on demand (Performance -> "Free memory now").
   Measured: 1,332 MB released and the PC's free RAM rose from 2% to 6.8%; the next message after a release takes about 11 s once.
   (Deleting the models alone freed only 19 MB, because Python keeps freed memory; the Windows working-set trim is what returns it.)
4. **Operations**: watchdog restarts now cooperate with the supervised backend (they used to start a second hanging `uvicorn --reload`
   and aim at the removed Next.js port); `start.bat` also stops stale supervisors.

## Connect Telegram (2 minutes, needs you)

1. In Telegram message **@BotFather** -> `/newbot` -> copy the token.
2. Jazper -> Settings -> Telegram -> paste the token -> Connect. 3. Open your bot, send `/start`. 4. Click **Approve** in Settings.
Then try: "latest emails today", "Kunal ka email dikhao", "write a python function to ...".

## WhatsApp: recommendation

Telegram first: free, official, works on this PC with no public address, and is the most future-proof for a personal assistant.
WhatsApp is possible but heavier: the official **WhatsApp Cloud API** (Meta) needs a Meta Business account, a verified business phone
number, message templates for anything outside a 24-hour window, and a **public HTTPS webhook** (the repo already ships `cloudflared`,
so a Cloudflare tunnel is the way). Unofficial libraries that drive a personal WhatsApp Web session break often and risk the number
being banned, so I do not recommend them. The bot core (`_handle`/`_ask`) is channel-independent, so a WhatsApp adapter is about a day
of work once you have the Meta account. Decision needed from you: do you want the business-account route?

## Prioritised next steps

| # | Task | Why |
|---|---|---|
| P1 | One shared "Jazper brain" entry point for chat, Telegram and voice; route system/status/email/Drive/calendar intents there; extend email and file intent detection to Hindi/Hinglish | today two chat paths behave differently; Hindi email and system-status questions fail |
| P2 | Real quality evaluation set for Jazper (50-100 checkable tasks: email, files, code, memory, Hinglish) run nightly, shown in the chat strip | "better than Grok" cannot be steered without a measurement |
| P3 | Voice notes on Telegram (transcribe with the existing Whisper stack, reply in text or voice) and photos | most convenient on a phone; needs the Whisper model (RAM) |
| P4 | Coding assistant hardening: run the dev-loop end to end on a real task with tests and approval; show diffs in chat/Telegram | "it can code" is only partly verified |
| P5 | Live web search keys (Tavily/Brave) and test the 16 new connectors one by one | current answers about the outside world are weak |
| P6 | WhatsApp adapter (if you choose the Cloud API route) | see above |
| P7 | Lower RAM floor: smaller/optional embedding model, trim Docker Desktop memory (`.wslconfig`), close heavy apps | the biggest latency factor on this PC |
