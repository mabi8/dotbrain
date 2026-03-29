#!/usr/bin/env python3
"""Convert Markdown files to McKinsey-style PDFs."""

import argparse
import sys
from datetime import date
from pathlib import Path

import markdown
from markdown.extensions.codehilite import CodeHiliteExtension
from markdown.extensions.tables import TableExtension
from markdown.extensions.toc import TocExtension
from markdown.extensions.footnotes import FootnoteExtension
from markdown.extensions.meta import MetaExtension
from weasyprint import HTML

TOOL_DIR = Path(__file__).resolve().parent
DEFAULT_CSS = TOOL_DIR / "style.css"


def md_to_html(md_text: str) -> str:
    """Convert markdown text to styled HTML document."""
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
