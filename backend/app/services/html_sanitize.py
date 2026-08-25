"""Making stored email HTML safe to render.

Email HTML is attacker-controlled in the most literal sense: anyone who knows
the address can send whatever markup they like. Rendering it raw is a stored
XSS hole where the attacker is the entire internet, so this strips anything
that can execute, navigate, or phone home.

Allowlist, not blocklist. A blocklist of "dangerous tags" fails to whatever
was invented after it was written; an allowlist fails closed.

Written against stdlib HTMLParser rather than bleach to avoid adding a
dependency for one function, and because the rules here are narrower than a
general-purpose sanitiser: this only ever renders email.
"""

import re
from html import escape
from html.parser import HTMLParser

# Structure and formatting only. No <form>, no <iframe>, no <object>, no
# <style> -- a stylesheet can exfiltrate via url() and can cover the page.
ALLOWED_TAGS = {
    "p", "br", "div", "span", "a", "b", "strong", "i", "em", "u", "s",
    "ul", "ol", "li", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "hr", "sub", "sup", "small",
}

# Everything inside these is dropped wholesale, not just unwrapped: the text
# content of a <script> is code, and of <style> is a stylesheet.
DROP_CONTENT_TAGS = {"script", "style", "title", "head", "iframe", "object", "embed"}

ALLOWED_ATTRS = {
    "a": {"href", "title"},
    "img": {"src", "alt", "title", "width", "height"},
    "td": {"colspan", "rowspan"},
    "th": {"colspan", "rowspan"},
}

VOID_TAGS = {"br", "hr", "img"}

# javascript:, data:, vbscript: all execute or smuggle. Anything not http(s)
# or mailto is refused rather than guessed at.
SAFE_URL = re.compile(r"^(https?:|mailto:|#|/)", re.IGNORECASE)


class _Sanitizer(HTMLParser):
    def __init__(self, allow_images: bool) -> None:
        super().__init__(convert_charrefs=True)
        self.allow_images = allow_images
        self.out: list[str] = []
        self._suppress_depth = 0
        self._open: list[str] = []
        self.blocked_images = 0

    # ---- helpers ----

    def _allowed(self, tag: str) -> bool:
        if tag == "img":
            return self.allow_images
        return tag in ALLOWED_TAGS

    def _clean_attrs(self, tag: str, attrs: list[tuple[str, str | None]]) -> str:
        permitted = ALLOWED_ATTRS.get(tag, set())
        parts = []
        for name, value in attrs:
            if name not in permitted or value is None:
                continue
            if name in ("href", "src") and not SAFE_URL.match(value.strip()):
                continue
            parts.append(f'{name}="{escape(value, quote=True)}"')
        if tag == "a":
            # Opening mail links in the app's own tab would let a link
            # navigate the CRM away; noopener stops the target reaching back
            # through window.opener.
            parts.append('target="_blank"')
            parts.append('rel="noopener noreferrer nofollow"')
        return (" " + " ".join(parts)) if parts else ""

    # ---- parser callbacks ----

    def handle_starttag(self, tag: str, attrs) -> None:
        if self._suppress_depth:
            if tag in DROP_CONTENT_TAGS:
                self._suppress_depth += 1
            return
        if tag in DROP_CONTENT_TAGS:
            self._suppress_depth = 1
            return
        if tag == "img" and not self.allow_images:
            # Remote images in email are overwhelmingly tracking pixels: they
            # tell the sender the mail was opened, and when.
            self.blocked_images += 1
            return
        if not self._allowed(tag):
            return  # unwrap: drop the tag, keep its children
        self.out.append(f"<{tag}{self._clean_attrs(tag, attrs)}>")
        if tag not in VOID_TAGS:
            self._open.append(tag)

    def handle_startendtag(self, tag: str, attrs) -> None:
        if self._suppress_depth:
            return
        if tag == "img" and not self.allow_images:
            self.blocked_images += 1
            return
        if not self._allowed(tag):
            return
        self.out.append(f"<{tag}{self._clean_attrs(tag, attrs)}>")

    def handle_endtag(self, tag: str) -> None:
        if self._suppress_depth:
            if tag in DROP_CONTENT_TAGS:
                self._suppress_depth -= 1
            return
        if tag in VOID_TAGS or not self._allowed(tag):
            return
        if tag in self._open:
            # Close everything opened inside it too -- malformed email is the
            # norm, and unbalanced tags would otherwise leak into the page.
            while self._open:
                open_tag = self._open.pop()
                self.out.append(f"</{open_tag}>")
                if open_tag == tag:
                    break

    def handle_data(self, data: str) -> None:
        if self._suppress_depth:
            return
        self.out.append(escape(data, quote=False))

    def result(self) -> str:
        while self._open:
            self.out.append(f"</{self._open.pop()}>")
        return "".join(self.out)


def sanitize_email_html(html: str | None, allow_images: bool = False) -> tuple[str, int]:
    """Return (safe_html, blocked_image_count).

    Sanitising at render time rather than on the way in is deliberate: a fix
    to these rules then applies to mail already stored, which it could not do
    if the stripped version were what got saved.
    """
    if not html:
        return "", 0
    parser = _Sanitizer(allow_images=allow_images)
    try:
        parser.feed(html)
        parser.close()
    except Exception:  # noqa: BLE001 - malformed markup must not 500 the inbox
        return escape(html[:5000], quote=False), 0
    return parser.result(), parser.blocked_images
