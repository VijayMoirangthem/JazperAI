"""
Email Tool — send/read Gmail via OAuth.

Will:
1. OAuth2 flow with Google (gmail.send + gmail.readonly scopes)
2. Send job application confirmation emails
3. Read inbox for interview invitations and responses
"""
from app.workers.base_worker import BaseWorker


class EmailTool:
    """Placeholder — not yet implemented."""

    def __init__(self, credentials: dict):
        raise NotImplementedError("EmailTool not yet implemented")
