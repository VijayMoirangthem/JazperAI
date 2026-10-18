"""
Gmail service — OAuth token management + Gmail API with smart Redis caching.

Cache strategy:
  - Email list (per label/query): Redis, 3 min TTL → instant UI, background refresh
  - Full email body (per msg_id): Redis, 24h TTL → emails never change once received
  - Gmail profile: Redis, 10 min TTL
  - History ID: Redis, permanent → used for incremental sync (only fetch new messages)

Gmail History API:
  After first full load we store the historyId. On every subsequent sync we call
  users.history.list(startHistoryId=...) which returns ONLY new/changed messages
  since that checkpoint — far cheaper than a full list call.
"""
import base64
import email as email_lib
import hashlib
import json
import re
import structlog
from app.services.memory_service import _pg
from app.core.config import settings

log = structlog.get_logger()

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/userinfo.email",
]

# Cache TTLs (seconds)
_TTL_LIST    = 180     # 3 min  — inbox list
_TTL_BODY    = 86400   # 24 h   — full email body (immutable)
_TTL_PROFILE = 600     # 10 min — profile stats
_TTL_SEARCH  = 300     # 5 min  — search results


# ── Redis helper ──────────────────────────────────────────────────────────────

def _redis():
    import redis
    return redis.Redis(
        host=settings.REDIS_HOST,
        port=settings.REDIS_PORT,
        password=settings.REDIS_PASSWORD,
        decode_responses=True,
        socket_connect_timeout=2,
    )


def _cache_get(key: str) -> dict | list | None:
    try:
        r = _redis()
        val = r.get(key)
        r.close()
        if val:
            return json.loads(val)
    except Exception:
        pass
    return None


def _cache_set(key: str, value: dict | list, ttl: int) -> None:
    try:
        r = _redis()
        r.setex(key, ttl, json.dumps(value, default=str))
        r.close()
    except Exception:
        pass


def _cache_del(key: str) -> None:
    try:
        r = _redis()
        r.delete(key)
        r.close()
    except Exception:
        pass


def _cache_ttl(key: str) -> int:
    """Returns remaining TTL in seconds, -1 if not cached."""
    try:
        r = _redis()
        ttl = r.ttl(key)
        r.close()
        return ttl
    except Exception:
        return -1


# ── Token storage ─────────────────────────────────────────────────────────────

def _as_dict(val) -> dict:
    if isinstance(val, dict):
        return val
    return json.loads(val)


def save_token(email: str, token_data: dict) -> None:
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO gmail_tokens (email, token_data)
            VALUES (%s, %s)
            ON CONFLICT (email) DO UPDATE
                SET token_data = EXCLUDED.token_data, updated_at = NOW()
            """,
            (email, json.dumps(token_data)),
        )
        conn.commit()
        cur.close()
        log.info("Gmail token saved", email=email)


def load_token(email: str) -> dict | None:
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT token_data FROM gmail_tokens WHERE email = %s", (email,))
        row = cur.fetchone()
        cur.close()
        return _as_dict(row[0]) if row else None


def load_any_token() -> tuple[str, dict] | tuple[None, None]:
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email, token_data FROM gmail_tokens LIMIT 1")
        row = cur.fetchone()
        cur.close()
        if not row:
            return None, None
        return row[0], _as_dict(row[1])


def list_connected_accounts() -> list[dict]:
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT email, updated_at FROM gmail_tokens ORDER BY updated_at DESC")
        rows = cur.fetchall()
        cur.close()
        return [{"email": r[0], "connected_at": r[1].isoformat() if r[1] else None} for r in rows]


def delete_token(email: str) -> bool:
    with _pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM gmail_tokens WHERE email = %s RETURNING email", (email,))
        deleted = cur.fetchone() is not None
        conn.commit()
        cur.close()
    # Clear all cached data for this account
    try:
        r = _redis()
        keys = r.keys(f"gmail:*:{email}:*") + r.keys(f"gmail:profile:{email}")
        if keys:
            r.delete(*keys)
        r.close()
    except Exception:
        pass
    return deleted


# ── Google credentials object ─────────────────────────────────────────────────

def _build_credentials(token_data: dict):
    from google.oauth2.credentials import Credentials
    return Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )


def _get_service(email: str = "default"):
    from googleapiclient.discovery import build
    from google.auth.transport.requests import Request

    email_key, token_data = (
        (email, load_token(email)) if email != "default" else load_any_token()
    )
    if not token_data:
        raise RuntimeError(
            "No Gmail account connected. Please authorise via /api/google/oauth/authorize"
        )

    creds = _build_credentials(token_data)

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_data.update({
            "access_token": creds.token,
            "refresh_token": creds.refresh_token,
            "expiry": creds.expiry.isoformat() if creds.expiry else None,
        })
        save_token(email_key, token_data)

    return build("gmail", "v1", credentials=creds), email_key


# ── Decode helpers ────────────────────────────────────────────────────────────

def _decode_body(payload: dict) -> str:
    mime = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data", "")

    if mime == "text/plain" and body_data:
        return base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")

    if mime == "text/html" and body_data:
        raw = base64.urlsafe_b64decode(body_data + "==").decode("utf-8", errors="replace")
        text = re.sub(r"<style[^>]*>.*?</style>", " ", raw, flags=re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
        text = re.sub(r"\s{2,}", " ", text)
        return text.strip()

    for part in payload.get("parts", []):
        result = _decode_body(part)
        if result:
            return result
    return ""


def _header(headers: list[dict], name: str) -> str:
    name_lower = name.lower()
    for h in headers:
        if h.get("name", "").lower() == name_lower:
            return h.get("value", "")
    return ""


def _msg_to_summary(m: dict) -> dict:
    hdrs = m.get("payload", {}).get("headers", [])
    return {
        "id": m["id"],
        "thread_id": m.get("threadId"),
        "subject": _header(hdrs, "Subject") or "(no subject)",
        "from": _header(hdrs, "From"),
        "to": _header(hdrs, "To"),
        "date": _header(hdrs, "Date"),
        "snippet": m.get("snippet", ""),
        "unread": "UNREAD" in m.get("labelIds", []),
    }


# ── History ID (incremental sync checkpoint) ──────────────────────────────────

def _save_history_id(email: str, history_id: str) -> None:
    try:
        r = _redis()
        r.set(f"gmail:history_id:{email}", history_id)
        r.close()
    except Exception:
        pass


def _load_history_id(email: str) -> str | None:
    try:
        r = _redis()
        val = r.get(f"gmail:history_id:{email}")
        r.close()
        return val
    except Exception:
        return None


# ── Core Gmail operations ─────────────────────────────────────────────────────

def get_profile() -> dict:
    svc, email_key = _get_service()
    cache_key = f"gmail:profile:{email_key}"

    cached = _cache_get(cache_key)
    if cached:
        return cached

    profile = svc.users().getProfile(userId="me").execute()
    result = {
        "email": profile.get("emailAddress"),
        "messages_total": profile.get("messagesTotal"),
        "threads_total": profile.get("threadsTotal"),
        "history_id": profile.get("historyId"),
    }
    _cache_set(cache_key, result, _TTL_PROFILE)

    # Seed history ID if we don't have one yet
    if not _load_history_id(email_key) and result.get("history_id"):
        _save_history_id(email_key, str(result["history_id"]))

    return result


def list_emails(
    max_results: int = 30,
    label: str = "INBOX",
    query: str = "",
    page_token: str = "",
    force_refresh: bool = False,
) -> dict:
    """
    Returns {emails, next_page_token, from_cache, cache_age_seconds}.
    Caches results in Redis. Pass force_refresh=True to bypass cache.
    """
    svc, email_key = _get_service()

    # Build a stable cache key
    q_hash = hashlib.md5(f"{label}:{query}:{page_token}".encode()).hexdigest()[:12]
    cache_key = f"gmail:list:{email_key}:{q_hash}"

    if not force_refresh:
        cached = _cache_get(cache_key)
        if cached:
            remaining_ttl = _cache_ttl(cache_key)
            cached["from_cache"] = True
            cached["cache_age_seconds"] = max(0, _TTL_LIST - remaining_ttl)
            return cached

    # Gmail category labels use `category:x` syntax in search queries,
    # but STARRED/SENT/DRAFTS/SPAM/TRASH use `labelIds` filter instead.
    _CATEGORY_Q = {
        "CATEGORY_PERSONAL":   "category:primary",
        "CATEGORY_SOCIAL":     "category:social",
        "CATEGORY_PROMOTIONS": "category:promotions",
        "CATEGORY_UPDATES":    "category:updates",
        "CATEGORY_FORUMS":     "category:forums",
    }
    _SYSTEM_LABELS = {"STARRED", "SENT", "DRAFTS", "SPAM", "TRASH", "IMPORTANT", "INBOX"}

    q_parts = []
    label_ids = []

    if label and label not in ("", "ALL"):
        if label in _CATEGORY_Q:
            q_parts.append(_CATEGORY_Q[label])
        elif label in _SYSTEM_LABELS:
            label_ids.append(label)
        else:
            q_parts.append(f"label:{label}")

    if query:
        q_parts.append(query)
    q_final = " ".join(q_parts)

    kwargs = {"userId": "me", "maxResults": max_results}
    if q_final:
        kwargs["q"] = q_final
    if label_ids:
        kwargs["labelIds"] = label_ids
    if page_token:
        kwargs["pageToken"] = page_token

    result = svc.users().messages().list(**kwargs).execute()
    messages_meta = result.get("messages", [])
    next_page_token = result.get("nextPageToken", "")

    # Fetch metadata for each message (batch-friendly — metadata format is cheap)
    emails = []
    for msg in messages_meta:
        # Check body cache first — avoid refetching known messages
        body_cache_key = f"gmail:meta:{msg['id']}"
        cached_meta = _cache_get(body_cache_key)
        if cached_meta:
            emails.append(cached_meta)
            continue

        m = svc.users().messages().get(
            userId="me", id=msg["id"], format="metadata",
            metadataHeaders=["Subject", "From", "To", "Date"],
        ).execute()
        summary = _msg_to_summary(m)
        _cache_set(body_cache_key, summary, _TTL_BODY)
        emails.append(summary)

    # Save history ID from latest message for future incremental syncs
    profile = svc.users().getProfile(userId="me").execute()
    if profile.get("historyId"):
        _save_history_id(email_key, str(profile["historyId"]))

    payload = {
        "emails": emails,
        "next_page_token": next_page_token,
        "from_cache": False,
        "cache_age_seconds": 0,
    }
    _cache_set(cache_key, payload, _TTL_LIST)
    return payload


def get_email(msg_id: str, mark_read: bool = False) -> dict:
    """Fetch full email — body cached for 24h since emails are immutable."""
    svc, email_key = _get_service()
    cache_key = f"gmail:body:{msg_id}"

    cached = _cache_get(cache_key)
    if cached and not mark_read:
        return cached

    m = svc.users().messages().get(userId="me", id=msg_id, format="full").execute()
    hdrs = m.get("payload", {}).get("headers", [])
    body = _decode_body(m.get("payload", {}))

    if mark_read and "UNREAD" in m.get("labelIds", []):
        svc.users().messages().modify(
            userId="me", id=msg_id, body={"removeLabelIds": ["UNREAD"]}
        ).execute()
        # Invalidate the summary cache so unread dot disappears
        _cache_del(f"gmail:meta:{msg_id}")

    result = {
        "id": m["id"],
        "thread_id": m.get("threadId"),
        "subject": _header(hdrs, "Subject") or "(no subject)",
        "from": _header(hdrs, "From"),
        "to": _header(hdrs, "To"),
        "date": _header(hdrs, "Date"),
        "body": body,
        "unread": "UNREAD" in m.get("labelIds", []),
        "labels": m.get("labelIds", []),
    }
    _cache_set(cache_key, result, _TTL_BODY)
    return result


def send_email(
    to: str,
    subject: str,
    body: str,
    reply_to_id: str | None = None,
    cc: str | None = None,
    bcc: str | None = None,
) -> dict:
    svc, _ = _get_service()
    msg = email_lib.message.EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    if cc:  msg["Cc"] = cc
    if bcc: msg["Bcc"] = bcc
    msg.set_content(body)

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    payload: dict = {"raw": raw}
    if reply_to_id:
        payload["threadId"] = reply_to_id

    sent = svc.users().messages().send(userId="me", body=payload).execute()
    log.info("Email sent", to=to, subject=subject)
    # Invalidate sent folder cache
    try:
        r = _redis()
        keys = list(r.scan_iter("gmail:list:*"))
        if keys: r.delete(*keys)
        r.close()
    except Exception:
        pass
    return {"ok": True, "id": sent.get("id"), "thread_id": sent.get("threadId")}


def trash_email(msg_id: str) -> dict:
    """Move a single message to Trash."""
    svc, _ = _get_service()
    svc.users().messages().trash(userId="me", id=msg_id).execute()
    _cache_del(f"gmail:meta:{msg_id}")
    _cache_del(f"gmail:body:{msg_id}")
    log.info("Email trashed", msg_id=msg_id)
    return {"ok": True, "msg_id": msg_id, "action": "trashed"}


def delete_email_permanent(msg_id: str) -> dict:
    """Permanently delete — cannot be undone."""
    svc, _ = _get_service()
    svc.users().messages().delete(userId="me", id=msg_id).execute()
    _cache_del(f"gmail:meta:{msg_id}")
    _cache_del(f"gmail:body:{msg_id}")
    log.info("Email permanently deleted", msg_id=msg_id)
    return {"ok": True, "msg_id": msg_id, "action": "deleted"}


def archive_email(msg_id: str) -> dict:
    """Archive — removes INBOX label, keeps email searchable."""
    svc, _ = _get_service()
    svc.users().messages().modify(
        userId="me", id=msg_id, body={"removeLabelIds": ["INBOX"]}
    ).execute()
    _cache_del(f"gmail:meta:{msg_id}")
    log.info("Email archived", msg_id=msg_id)
    return {"ok": True, "msg_id": msg_id, "action": "archived"}


def mark_email(msg_id: str, read: bool | None = None, starred: bool | None = None,
               important: bool | None = None) -> dict:
    """Toggle read/unread, starred, important on a message."""
    svc, _ = _get_service()
    add_labels, remove_labels = [], []

    if read is True:   remove_labels.append("UNREAD")
    if read is False:  add_labels.append("UNREAD")
    if starred is True:   add_labels.append("STARRED")
    if starred is False:  remove_labels.append("STARRED")
    if important is True:   add_labels.append("IMPORTANT")
    if important is False:  remove_labels.append("IMPORTANT")

    if add_labels or remove_labels:
        svc.users().messages().modify(
            userId="me", id=msg_id,
            body={"addLabelIds": add_labels, "removeLabelIds": remove_labels}
        ).execute()
    _cache_del(f"gmail:meta:{msg_id}")
    _cache_del(f"gmail:body:{msg_id}")
    return {"ok": True, "msg_id": msg_id, "read": read, "starred": starred, "important": important}


def create_draft(to: str, subject: str, body: str,
                 reply_to_id: str | None = None) -> dict:
    """Save a draft without sending."""
    svc, _ = _get_service()
    msg = email_lib.message.EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    payload: dict = {"message": {"raw": raw}}
    if reply_to_id:
        payload["message"]["threadId"] = reply_to_id

    draft = svc.users().drafts().create(userId="me", body=payload).execute()
    log.info("Draft saved", to=to, subject=subject)
    return {"ok": True, "draft_id": draft.get("id")}


def forward_email(msg_id: str, to: str, note: str = "") -> dict:
    """Forward an email to another address with an optional note."""
    original = get_email(msg_id)
    fwd_body = (
        f"{note}\n\n---------- Forwarded message ----------\n"
        f"From: {original['from']}\n"
        f"Date: {original['date']}\n"
        f"Subject: {original['subject']}\n\n"
        f"{original['body']}"
    )
    subject = f"Fwd: {original['subject'].replace('Fwd: ', '').replace('fwd: ', '')}"
    return send_email(to=to, subject=subject, body=fwd_body)


def bulk_action(action: str, query: str, max_messages: int = 50) -> dict:
    """
    Apply an action to all messages matching a Gmail search query.
    action: 'trash' | 'archive' | 'mark_read' | 'mark_unread' | 'star'
    """
    svc, email_key = _get_service()
    result = svc.users().messages().list(
        userId="me", q=query, maxResults=min(max_messages, 500)
    ).execute()
    messages = result.get("messages", [])
    if not messages:
        return {"ok": True, "count": 0, "action": action, "query": query}

    ids = [m["id"] for m in messages]
    count = len(ids)

    if action == "trash":
        for mid in ids:
            svc.users().messages().trash(userId="me", id=mid).execute()
    elif action == "archive":
        svc.users().messages().batchModify(
            userId="me", body={"ids": ids, "removeLabelIds": ["INBOX"]}
        ).execute()
    elif action == "mark_read":
        svc.users().messages().batchModify(
            userId="me", body={"ids": ids, "removeLabelIds": ["UNREAD"]}
        ).execute()
    elif action == "mark_unread":
        svc.users().messages().batchModify(
            userId="me", body={"ids": ids, "addLabelIds": ["UNREAD"]}
        ).execute()
    elif action == "star":
        svc.users().messages().batchModify(
            userId="me", body={"ids": ids, "addLabelIds": ["STARRED"]}
        ).execute()

    # Invalidate list caches
    try:
        r = _redis()
        keys = list(r.scan_iter(f"gmail:list:{email_key}:*")) + list(r.scan_iter(f"gmail:counts:{email_key}"))
        if keys: r.delete(*keys)
        r.close()
    except Exception:
        pass

    log.info("Bulk action done", action=action, count=count, query=query)
    return {"ok": True, "count": count, "action": action, "query": query}


def summarize_thread(thread_id: str) -> dict:
    """Fetch all messages in a thread and return them for AI summarisation."""
    svc, _ = _get_service()
    thread = svc.users().threads().get(userId="me", id=thread_id, format="full").execute()
    messages = thread.get("messages", [])
    parts = []
    for m in messages:
        hdrs = m.get("payload", {}).get("headers", [])
        parts.append({
            "from": _header(hdrs, "From"),
            "date": _header(hdrs, "Date"),
            "body": _decode_body(m.get("payload", {}))[:600],
        })
    return {"thread_id": thread_id, "message_count": len(messages), "messages": parts}


def get_attachment_list(msg_id: str) -> list[dict]:
    """List attachments in an email (name, size, mime type)."""
    svc, _ = _get_service()
    m = svc.users().messages().get(userId="me", id=msg_id, format="full").execute()

    attachments = []
    def _walk(parts):
        for p in parts:
            if p.get("filename") and p.get("body", {}).get("attachmentId"):
                attachments.append({
                    "filename": p["filename"],
                    "mime_type": p.get("mimeType", ""),
                    "size": p.get("body", {}).get("size", 0),
                    "attachment_id": p["body"]["attachmentId"],
                })
            _walk(p.get("parts", []))
    _walk(m.get("payload", {}).get("parts", []))
    return attachments


def extract_action_items(email_body: str, subject: str) -> str:
    """
    Return a prompt-ready string describing the email for LLM action-item extraction.
    The actual extraction is done by the LLM in the chat route.
    """
    return f"Subject: {subject}\n\nBody:\n{email_body[:2000]}"


def find_unsubscribe_link(msg_id: str) -> dict:
    """Look for List-Unsubscribe header or unsubscribe links in the email body."""
    svc, _ = _get_service()
    m = svc.users().messages().get(userId="me", id=msg_id, format="full").execute()
    hdrs = m.get("payload", {}).get("headers", [])

    # Check List-Unsubscribe header first
    unsub_header = _header(hdrs, "List-Unsubscribe")
    if unsub_header:
        # Extract URL from <url> format
        url_match = re.search(r"<(https?://[^>]+)>", unsub_header)
        if url_match:
            return {"found": True, "url": url_match.group(1), "method": "header"}
        mailto = re.search(r"<(mailto:[^>]+)>", unsub_header)
        if mailto:
            return {"found": True, "url": mailto.group(1), "method": "mailto"}

    # Fallback: scan body for unsubscribe links
    body = _decode_body(m.get("payload", {}))
    link_match = re.search(
        r"https?://[^\s\"'<>]+unsubscri[^\s\"'<>]*", body, re.IGNORECASE
    )
    if link_match:
        return {"found": True, "url": link_match.group(0), "method": "body_link"}

    return {"found": False, "url": None, "method": None}


def search_emails(query: str, max_results: int = 20) -> dict:
    cache_key = f"gmail:search:{hashlib.md5(query.encode()).hexdigest()[:12]}"
    cached = _cache_get(cache_key)
    if cached:
        cached["from_cache"] = True
        return cached

    result = list_emails(max_results=max_results, label="", query=query)
    _cache_set(cache_key, result, _TTL_SEARCH)
    return result


# ── Category unread counts ────────────────────────────────────────────────────

# Gmail system label IDs for each category tab
CATEGORY_LABELS = {
    "primary":    "CATEGORY_PERSONAL",
    "social":     "CATEGORY_SOCIAL",
    "promotions": "CATEGORY_PROMOTIONS",
    "updates":    "CATEGORY_UPDATES",
    "forums":     "CATEGORY_FORUMS",
    "starred":    "STARRED",
    "important":  "IMPORTANT",
    "sent":       "SENT",
    "drafts":     "DRAFTS",
    "spam":       "SPAM",
    "trash":      "TRASH",
}

_TTL_COUNTS = 120   # 2 min — unread counts


def get_category_counts() -> dict:
    """
    Return unread counts for every category tab in one efficient Labels.list call.
    Gmail's labels endpoint returns messagesUnread for each label — a single call
    beats making 11 separate search queries.
    """
    svc, email_key = _get_service()
    cache_key = f"gmail:counts:{email_key}"

    cached = _cache_get(cache_key)
    if cached:
        return cached

    result = svc.users().labels().list(userId="me").execute()
    label_map: dict[str, dict] = {l["id"]: l for l in result.get("labels", [])}

    counts: dict[str, int] = {}
    for tab_name, label_id in CATEGORY_LABELS.items():
        label_data = label_map.get(label_id, {})
        counts[tab_name] = label_data.get("messagesUnread", 0)

    # Also expose total inbox unread
    inbox = label_map.get("INBOX", {})
    counts["inbox"] = inbox.get("messagesUnread", 0)

    _cache_set(cache_key, counts, _TTL_COUNTS)
    return counts


# ── Smart Jazper summary ──────────────────────────────────────────────────────

def get_jazper_summary(max_emails: int = 5) -> dict:
    """
    Build a natural-language summary of the most important unread emails
    for Jazper to read aloud. Prioritises: Primary > Important > Updates.
    Returns {summary_text, emails, total_unread}.
    """
    svc, email_key = _get_service()
    cache_key = f"gmail:jazper_summary:{email_key}"

    cached = _cache_get(cache_key)
    if cached:
        return cached

    # Fetch important unread emails only
    result = svc.users().messages().list(
        userId="me",
        q="is:unread is:important",
        maxResults=max_emails,
    ).execute()
    messages = result.get("messages", [])

    emails = []
    for msg in messages:
        m = svc.users().messages().get(
            userId="me", id=msg["id"], format="metadata",
            metadataHeaders=["Subject", "From", "Date"],
        ).execute()
        hdrs = m.get("payload", {}).get("headers", [])
        emails.append({
            "id": m["id"],
            "subject": _header(hdrs, "Subject") or "(no subject)",
            "from": _header(hdrs, "From"),
            "date": _header(hdrs, "Date"),
            "snippet": m.get("snippet", ""),
        })

    # Build counts for the summary text
    counts = get_category_counts()
    total_unread = counts.get("inbox", 0)

    # Build a natural-language summary Jazper can read
    lines = []
    if total_unread == 0:
        lines.append("Your inbox is clear. No unread emails.")
    else:
        lines.append(f"You have {total_unread} unread emails.")
        if counts.get("primary", 0):
            lines.append(f"{counts['primary']} in Primary.")
        if counts.get("updates", 0):
            lines.append(f"{counts['updates']} updates.")
        if counts.get("social", 0):
            lines.append(f"{counts['social']} social notifications.")
        if counts.get("promotions", 0):
            lines.append(f"{counts['promotions']} promotions.")

        if emails:
            lines.append("Your most important unread emails are:")
            for i, e in enumerate(emails[:3], 1):
                sender = re.sub(r"<[^>]+>", "", e["from"]).strip() or e["from"]
                lines.append(f"{i}. From {sender}: {e['subject']}. {e['snippet'][:120]}")

    summary_text = " ".join(lines)
    payload = {
        "summary_text": summary_text,
        "emails": emails,
        "counts": counts,
        "total_unread": total_unread,
    }
    _cache_set(cache_key, payload, _TTL_COUNTS)
    return payload


# ── Incremental sync (History API) ────────────────────────────────────────────

def incremental_sync() -> dict:
    """
    Fetch only new/changed messages since last sync using Gmail History API.
    Called by the background sync worker every 5 min.
    Returns {new_count, updated_count}.
    """
    svc, email_key = _get_service()
    history_id = _load_history_id(email_key)

    if not history_id:
        log.info("No history ID yet — skipping incremental sync", email=email_key)
        return {"new_count": 0, "updated_count": 0}

    try:
        result = svc.users().history().list(
            userId="me",
            startHistoryId=history_id,
            historyTypes=["messageAdded", "labelAdded", "labelRemoved"],
        ).execute()
    except Exception as e:
        # History ID expired (>7 days old) — reset it
        if "Invalid startHistoryId" in str(e) or "404" in str(e):
            log.warning("History ID expired, resetting", email=email_key)
            _cache_del(f"gmail:history_id:{email_key}")
        return {"new_count": 0, "updated_count": 0}

    history = result.get("history", [])
    new_count = 0
    updated_count = 0

    for record in history:
        # Invalidate meta cache for any touched message so next list fetch is fresh
        for added in record.get("messagesAdded", []):
            mid = added.get("message", {}).get("id")
            if mid:
                _cache_del(f"gmail:meta:{mid}")
                new_count += 1

        for label_change in record.get("labelsAdded", []) + record.get("labelsRemoved", []):
            mid = label_change.get("message", {}).get("id")
            if mid:
                _cache_del(f"gmail:meta:{mid}")
                updated_count += 1

    # Invalidate inbox list cache so next open shows fresh data
    if history:
        try:
            r = _redis()
            keys = list(r.scan_iter(f"gmail:list:{email_key}:*"))
            if keys:
                r.delete(*keys)
            r.close()
        except Exception:
            pass

    # Update history ID checkpoint
    new_history_id = result.get("historyId") or history_id
    _save_history_id(email_key, str(new_history_id))

    log.info("Gmail incremental sync done",
             email=email_key, new=new_count, updated=updated_count)
    return {"new_count": new_count, "updated_count": updated_count}
