import logging
import logging.handlers

from core import logfile


def _tee(tmp_path, console=None):
    h = logfile.handler(tmp_path / "t.log")
    return logfile.Tee(console=console if console is not None else _Sink(), file_handler=h), tmp_path / "t.log", h


class _Sink:
    def __init__(self):
        self.buf = ""

    def write(self, s):
        self.buf += s

    def flush(self):
        pass


def test_tee_writes_console_and_file_with_a_timestamp_and_no_colour_codes(tmp_path):
    sink = _Sink()
    tee, path, h = _tee(tmp_path, sink)
    tee.write("\x1b[31m[error    ]\x1b[0m something broke code=7")
    tee.write("\n")                      # print() sends the newline separately: must not create an empty line
    h.flush()
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1 and "[error    ] something broke code=7" in lines[0] and "\x1b" not in lines[0]
    assert lines[0][:4].isdigit() and "something broke" in sink.buf                      # timestamp added; console untouched


def test_secrets_never_reach_the_file(tmp_path):
    tee, path, h = _tee(tmp_path)
    tee.write("[warning  ] provider failed key=gsk_abcdefghijklmnopqrstuvwx and sk-abcdefghijklmnop")
    h.flush()
    text = path.read_text(encoding="utf-8")
    assert "gsk_abc" not in text and "sk-abcdef" not in text and "<redacted>" in text


def test_a_dead_console_does_not_break_logging(tmp_path):
    class Broken:
        def write(self, s):
            raise OSError("no console")

        def flush(self):
            raise OSError("no console")

    h = logfile.handler(tmp_path / "t.log")
    tee = logfile.Tee(console=Broken(), file_handler=h)
    assert tee.write("[info     ] still logged") > 0
    tee.flush()
    h.flush()
    assert "still logged" in (tmp_path / "t.log").read_text(encoding="utf-8")


def test_rotation_keeps_the_newest_data(tmp_path, monkeypatch):
    monkeypatch.setattr(logfile, "MAX_BYTES", 400)
    p = tmp_path / "r.log"
    h = logging.handlers.RotatingFileHandler(p, maxBytes=400, backupCount=2, encoding="utf-8")
    tee = logfile.Tee(console=_Sink(), file_handler=h)
    for i in range(60):
        tee.write(f"[info     ] line number {i:03d}")
    h.flush()
    assert (tmp_path / "r.log.1").exists() and not (tmp_path / "r.log.3").exists()
    assert "line number 059" in p.read_text(encoding="utf-8")


def _write(path, lines):
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def test_recent_problems_merges_repeats_and_orders_newest_first(tmp_path):
    p = tmp_path / "j.log"
    _write(p, [
        "2026-11-15 10:00:00 [info     ] started",
        "2026-11-15 10:00:05 [warning  ] presidio unavailable, regex-only sanitizer",
        "2026-11-15 10:01:00 [error    ] Gmail failed status=401 attempt=1",
        "2026-11-15 10:02:00 [error    ] Gmail failed status=401 attempt=2",
        "2026-11-15 10:03:00 [warning  ] presidio unavailable, regex-only sanitizer",
        "garbage line without a level",
    ])
    out = logfile.recent_problems(log_file=p)
    assert [(o["level"], o["count"]) for o in out] == [("warning", 2), ("error", 2)]      # newest group first, repeats merged
    assert out[0]["time"] == "2026-11-15 10:03:00" and "presidio" in out[0]["message"]


def test_recent_problems_can_show_errors_only_and_redacts(tmp_path):
    p = tmp_path / "j.log"
    _write(p, ["2026-11-15 10:00:00 [warning  ] minor thing",
               "2026-11-15 10:01:00 [error    ] auth failed token=eyJabcdefghijklmnopqrstuvwxyz.abcdefghijkl"])
    out = logfile.recent_problems(min_level="error", log_file=p)
    assert len(out) == 1 and out[0]["level"] == "error" and "eyJabc" not in out[0]["message"]


def test_recent_problems_reads_the_previous_file_too_and_survives_a_missing_log(tmp_path):
    p = tmp_path / "j.log"
    _write(Path := tmp_path / "j.log.1", ["2026-11-14 09:00:00 [error    ] old failure"])
    _write(p, ["2026-11-15 09:00:00 [info     ] fresh start"])
    assert [o["message"] for o in logfile.recent_problems(log_file=p)] == ["old failure"]
    assert logfile.recent_problems(log_file=tmp_path / "nope.log") == []


def test_stdlib_warnings_use_the_same_format_and_are_found_as_problems(tmp_path, monkeypatch):
    h = logfile.handler(tmp_path / "s.log")
    monkeypatch.setattr(logfile, "handler", lambda path=None: h)
    lg = logging.getLogger("jasper.test.bridge")
    bridge = logfile._StdlibBridge(logging.WARNING)
    lg.addHandler(bridge)
    lg.propagate = False
    try:
        lg.warning("slow response from provider took %s s", 12)
        lg.info("not written: below the bridge level")
        try:
            raise ValueError("boom")
        except ValueError:
            lg.error("handler failed", exc_info=True)
    finally:
        lg.removeHandler(bridge)
    h.flush()
    out = logfile.recent_problems(log_file=tmp_path / "s.log")
    assert [(o["level"], "boom" in o["message"]) for o in out] == [("error", True), ("warning", False)]
    assert "not written" not in (tmp_path / "s.log").read_text(encoding="utf-8")


def test_problems_endpoint_returns_merged_recent_problems(tmp_path, monkeypatch):
    from api.routes import logs as logs_route
    p = tmp_path / "jasper.log"
    _write(p, ["2026-11-15 10:00:00 [warning  ] disk almost full free=900",
               "2026-11-15 10:01:00 [error    ] Gmail failed status=401",
               "2026-11-15 10:02:00 [warning  ] disk almost full free=800"])
    monkeypatch.setattr(logfile, "LOG_FILE", p)
    out = logs_route.problems(limit=10, level="warning")["problems"]
    assert [(o["level"], o["count"]) for o in out] == [("warning", 2), ("error", 1)]
    assert [o["level"] for o in logs_route.problems(level="error")["problems"]] == ["error"]
    assert logs_route.problems(level="nonsense")["problems"]          # an unknown level falls back to warning
