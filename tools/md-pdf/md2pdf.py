#!/usr/bin/env python3
"""Convert Markdown files to McKinsey-style PDFs."""

import argparse
import json
import re
import sys
import warnings
from datetime import date
from pathlib import Path

import markdown
from markdown.extensions.codehilite import CodeHiliteExtension
from markdown.extensions.tables import TableExtension
from markdown.extensions.toc import TocExtension
from markdown.extensions.footnotes import FootnoteExtension
from markdown.extensions.meta import MetaExtension
from weasyprint import HTML

# kaleido 0.2.1 is the last version that ships its own renderer (no Chrome needed).
# Plotly emits a deprecation warning each call; suppress it.
warnings.filterwarnings("ignore", message=r"(?s).*Kaleido.*", category=DeprecationWarning)

TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_CSS = TOOL_DIR / "style.css"

PLOTLY_BLOCK_RE = re.compile(r"^```plotly\s*\n(.*?)\n```\s*$", re.MULTILINE | re.DOTALL)
PLOTLY_DEFAULTS = {
    "template": "simple_white",
    "font": {"family": "Inter, Helvetica Neue, Arial, sans-serif", "size": 12, "color": "#1a1a1a"},
    "colorway": ["#2251FF", "#051C2C", "#9FA8B8", "#00A9E0", "#E5B400"],
    "margin": {"l": 60, "r": 30, "t": 50, "b": 50},
    "paper_bgcolor": "white",
    "plot_bgcolor": "white",
    "waterfall": {
        "increasing": {"marker": {"color": "#2251FF"}},
        "decreasing": {"marker": {"color": "#C8102E"}},
        "totals": {"marker": {"color": "#051C2C"}},
        "connector": {"line": {"color": "#9FA8B8", "width": 1}},
    },
}


def render_plotly_blocks(md_text: str) -> str:
    """Replace ```plotly fenced blocks with rendered inline SVG."""
    import plotly.graph_objects as go

    def render(match: re.Match) -> str:
        spec_text = match.group(1)
        try:
            spec = json.loads(spec_text)
        except json.JSONDecodeError as exc:
            return f'<pre class="chart-error">Invalid plotly JSON: {exc}</pre>'

        width = spec.pop("_width", 900)
        height = spec.pop("_height", 480)

        fig = go.Figure(spec)

        layout_updates = {k: v for k, v in PLOTLY_DEFAULTS.items() if k != "waterfall"}
        # Only set fields the user didn't explicitly override
        user_layout = spec.get("layout") or {}
        for key, value in list(layout_updates.items()):
            if key in user_layout:
                layout_updates.pop(key)
        fig.update_layout(**layout_updates)

        # Apply waterfall trace defaults if user didn't set them
        wf = PLOTLY_DEFAULTS["waterfall"]
        for trace in fig.data:
            if trace.type != "waterfall":
                continue
            if trace.increasing.marker.color is None:
                trace.increasing = wf["increasing"]
            if trace.decreasing.marker.color is None:
                trace.decreasing = wf["decreasing"]
            if trace.totals.marker.color is None:
                trace.totals = wf["totals"]
            if trace.connector.line.color is None:
                trace.connector = wf["connector"]

        svg = fig.to_image(format="svg", width=width, height=height).decode("utf-8")
        svg = re.sub(r"<\?xml[^>]*\?>\s*", "", svg)
        return f'\n\n<div class="chart">{svg}</div>\n\n'

    return PLOTLY_BLOCK_RE.sub(render, md_text)


def md_to_html(md_text: str) -> str:
    """Convert markdown text to styled HTML document."""
    md_text = render_plotly_blocks(md_text)
    extensions = [
        "tables",
        "fenced_code",
        "footnotes",
        "smarty",
        "toc",
        "meta",
        "attr_list",
        "def_list",
        CodeHiliteExtension(
            linenums=False,
            css_class="highlight",
            noclasses=True,
            pygments_style="monokai",
        ),
    ]
    html_body = markdown.markdown(md_text, extensions=extensions)
    return html_body


def build_document(html_body: str, css_path: Path) -> str:
    """Wrap HTML body in a full document with stylesheet."""
    css_text = css_path.read_text(encoding="utf-8")
    created = date.today().strftime("%Y-%m-%d")
    # Inject created date into @bottom-right alongside page number
    date_css = f"""
@page {{
  @bottom-right {{
    content: "Created {created}  ·  " counter(page);
  }}
}}
@page :first {{
  @bottom-right {{ content: none; }}
}}"""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>{css_text}
{date_css}</style>
</head>
<body>
{html_body}
</body>
</html>"""


def convert(src: Path, dst: Path, css: Path) -> None:
    """Read markdown, render PDF."""
    md_text = src.read_text(encoding="utf-8")
    html_body = md_to_html(md_text)
    document = build_document(html_body, css)
    HTML(string=document, base_url=str(src.parent)).write_pdf(str(dst))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert Markdown to McKinsey-style PDF"
    )
    parser.add_argument("input", help="Markdown file (or - for stdin)")
    parser.add_argument(
        "-o", "--output",
        help="Output PDF path (default: same name as input with .pdf)",
    )
    parser.add_argument(
        "--css",
        default=str(DEFAULT_CSS),
        help="Custom CSS stylesheet (default: built-in McKinsey style)",
    )
    args = parser.parse_args()

    # Handle stdin
    if args.input == "-":
        md_text = sys.stdin.read()
        dst = Path(args.output) if args.output else Path("output.pdf")
        html_body = md_to_html(md_text)
        document = build_document(html_body, Path(args.css))
        HTML(string=document).write_pdf(str(dst))
    else:
        src = Path(args.input)
        if not src.exists():
            sys.exit(f"Error: {src} not found")
        dst = Path(args.output) if args.output else src.with_suffix(".pdf")
        convert(src, dst, Path(args.css))

    print(f"✓ {dst}")


if __name__ == "__main__":
    main()
