"""user-agent parsing for device names."""

import re

_OS_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"iPhone", re.IGNORECASE), "iPhone"),
    (re.compile(r"iPad", re.IGNORECASE), "iPad"),
    (re.compile(r"Android", re.IGNORECASE), "Android"),
    (re.compile(r"Mac OS X|Macintosh", re.IGNORECASE), "macOS"),
    (re.compile(r"Windows", re.IGNORECASE), "Windows"),
    (re.compile(r"Linux", re.IGNORECASE), "Linux"),
    (re.compile(r"CrOS", re.IGNORECASE), "ChromeOS"),
]

_BROWSER_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # order matters — check specific before generic
    (re.compile(r"Edg/", re.IGNORECASE), "Edge"),
    (re.compile(r"OPR/|Opera", re.IGNORECASE), "Opera"),
    (re.compile(r"Brave", re.IGNORECASE), "Brave"),
    (re.compile(r"Chrome/", re.IGNORECASE), "Chrome"),
    (re.compile(r"Safari/", re.IGNORECASE), "Safari"),
    (re.compile(r"Firefox/", re.IGNORECASE), "Firefox"),
]


def parse_device_name(ua: str | None) -> str:
    """derive a human-readable device name from a user-agent string.

    returns e.g. "Chrome on macOS", "Safari on iPhone".
    """
    if not ua:
        return "unknown device"

    os_name = "unknown OS"
    for pattern, name in _OS_PATTERNS:
        if pattern.search(ua):
            os_name = name
            break

    browser_name = "browser"
    for pattern, name in _BROWSER_PATTERNS:
        if pattern.search(ua):
            browser_name = name
            break

    return f"{browser_name} on {os_name}"
