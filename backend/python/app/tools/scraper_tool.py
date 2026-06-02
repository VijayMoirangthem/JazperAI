"""
Scraper Tool — generic web scraper (BeautifulSoup + Playwright fallback).

Will:
1. Try fast requests + BS4 first; fall back to Playwright for JS-heavy pages
2. Extract structured data via CSS selectors or LLM-guided extraction
3. Respect robots.txt and add polite delays
"""


class ScraperTool:
    """Placeholder — not yet implemented."""

    def __init__(self):
        raise NotImplementedError("ScraperTool not yet implemented")
