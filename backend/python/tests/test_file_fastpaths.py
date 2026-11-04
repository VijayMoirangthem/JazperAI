"""The file-open experience must not depend on an LLM choosing a tool."""
import pytest

from agents import fastpaths


@pytest.mark.parametrize("phrase", [
    "open the Sir Jazper AI doc", "open Sir Jazper AI document", "show the Q3 budget sheet",
    "show me the Q3 budget spreadsheet", "play my song Chill", "play the Chill audio",
    "view the launch PDF", "let me see the launch pdf", "display the roadmap slides",
    "pull up the roadmap presentation", "open the photo file", "show the image file",
    "open the video file", "play the demo video", "open the report document",
    "show the notes doc", "view the python file", "open the config file",
    "open the invoice pdf", "show yesterday's PDF file", "open that doc",
    "show it", "play it", "view this file", "open this sheet",
    "could you open the Sir Jazper AI doc again", "now can you try opening the Sir Jazper AI doc again",
    "I want to see the Sir Jazper AI document", "bring up the budget sheet",
    "can I look at the proposal PDF", "please show the design doc", "open my song Chill",
    "show my presentation slides", "view the meeting document", "open the exported file",
    "display that spreadsheet", "pull up the latest report file", "open the attached PDF file",
    "let me see the project markdown file", "show the archive file",
])
def test_file_open_phrasings_are_deterministic(phrase):
    history = [type("Message", (), {"role": "user", "content": "open the Sir Jazper AI doc"})()]
    assert fastpaths.match("jasper", phrase, history) is not None


@pytest.mark.parametrize("phrase", [
    "what is the capital of France", "write a poem about a file", "delete the file",
    "share the document with Ada", "create a new spreadsheet", "why is my computer slow",
])
def test_non_open_phrasings_do_not_take_file_fastpath(phrase):
    assert fastpaths.match("jasper", phrase) is None

