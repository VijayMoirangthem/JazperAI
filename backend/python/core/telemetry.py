"""OpenTelemetry tracing (spec §17): one trace per directive spanning Jasper -> executive -> crew member -> LLM call / tool call.

Spans export to OTLP/HTTP when OTEL_EXPORTER_OTLP_ENDPOINT is set (local Jaeger/collector, or Langfuse's OTel endpoint);
otherwise they stay in-process (tests attach an in-memory exporter). Span helpers never raise.
"""
import functools
import os
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import Status, StatusCode

provider = TracerProvider(resource=Resource.create({"service.name": "sir-jasper-ai"}))
trace.set_tracer_provider(provider)
tracer = provider.get_tracer("jasper")
_exporting = False


def setup_export() -> bool:
    """Attach the OTLP exporter once, when configured. Returns whether export is active."""
    global _exporting
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if endpoint and not _exporting:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        _exporting = True
    return _exporting


@contextmanager
def span(name: str, **attrs):
    with tracer.start_as_current_span(name) as s:
        for k, v in attrs.items():
            if v is not None:
                s.set_attribute(k, v if isinstance(v, (str, int, float, bool)) else str(v))
        try:
            yield s
        except Exception as e:
            s.set_status(Status(StatusCode.ERROR, str(e)[:200]))
            s.record_exception(e)
            raise


def traced(name: str):
    """Decorator for async node functions."""
    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(*a, **kw):
            with span(name):
                return await fn(*a, **kw)
        return wrapper
    return deco


def trace_id_hex() -> str | None:
    ctx = trace.get_current_span().get_span_context()
    return format(ctx.trace_id, "032x") if ctx.is_valid else None
