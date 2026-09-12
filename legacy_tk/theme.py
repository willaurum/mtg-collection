"""Dark forest-and-leather theme: palette, fonts, ttk styling, small widgets.

The look is built from deep forest greens with worn-leather browns and an aged
gold accent - roughly the colour of an old Magic binder left in a cabin.
"""

from __future__ import annotations

import re
import tkinter as tk
from tkinter import font as tkfont
from tkinter import ttk

# --------------------------------------------------------------- palette

BG_DEEP = "#0c1310"      # window base, deepest green-black
BG_HEADER = "#101a14"    # header + status bars
BG_PANEL = "#15201a"     # main panels
BG_RAISED = "#1e2c23"    # inputs, dropdowns
BG_WELL = "#070b08"      # the well the card art sits in
BG_PILL = "#1a2820"      # chip interiors

BORDER = "#2c4034"       # green hairline
BORDER_FOCUS = "#4c7355"
BORDER_WARM = "#5a422c"  # bronze frame around the art
BROWN = "#42301f"        # button leather
BROWN_HI = "#5a4029"
BROWN_DOWN = "#33241715"

GOLD = "#d4b06a"         # aged gold accent
LEAF = "#8fbf72"
TEXT = "#e9e5d7"         # parchment
TEXT_DIM = "#8b9c86"
TEXT_WARM = "#c3a982"

RARITY = {
    "common": "#cfd6cb",
    "uncommon": "#a9bcc6",
    "rare": "#d4b06a",
    "mythic": "#e08849",
    "special": "#c08fd0",
    "bonus": "#c08fd0",
}

LEGALITY = {
    "legal": "#7cc47f",
    "restricted": "#e0b169",
    "banned": "#e0736a",
    "not_legal": "#5d6c5c",
}

# mana pip -> (disc colour, glyph colour)
MANA = {
    "W": ("#f3ead0", "#2b2a22"),
    "U": ("#9dcbe8", "#11232d"),
    "B": ("#6b6575", "#efebee"),
    "R": ("#e8907c", "#321511"),
    "G": ("#86c087", "#112713"),
    "C": ("#bcb5a7", "#25221c"),
    "S": ("#ced7dd", "#21272b"),
    "P": ("#a79fae", "#1d1a21"),
}
GENERIC = ("#b6afa1", "#222018")


class Fonts:
    """Serif for card text (it is a Magic card), sans for the chrome."""

    def __init__(self):
        available = set(tkfont.families())

        def pick(*names):
            for name in names:
                if name in available:
                    return name
            return "TkDefaultFont"

        serif = pick("Georgia", "Palatino Linotype", "Book Antiqua", "Times New Roman")
        sans = pick("Segoe UI", "Helvetica Neue", "Helvetica", "Arial")
        mono = pick("Consolas", "Courier New")

        self.wordmark = tkfont.Font(family=serif, size=12, weight="bold")
        self.title = tkfont.Font(family=serif, size=17, weight="bold")
        self.typeline = tkfont.Font(family=serif, size=10, slant="italic")
        self.body = tkfont.Font(family=serif, size=10)
        self.flavor = tkfont.Font(family=serif, size=10, slant="italic")
        self.ui = tkfont.Font(family=sans, size=9)
        self.ui_bold = tkfont.Font(family=sans, size=9, weight="bold")
        self.small = tkfont.Font(family=sans, size=8)
        self.pip = tkfont.Font(family=sans, size=9, weight="bold")
        self.pip_small = tkfont.Font(family=sans, size=6, weight="bold")
        self.stat = tkfont.Font(family=mono, size=12, weight="bold")


def apply(root, fonts):
    """Point every ttk widget we use at the palette above."""
    root.configure(bg=BG_DEEP)
    style = ttk.Style(root)
    style.theme_use("clam")  # the only bundled theme that honours these colours

    style.configure(
        "Search.TEntry",
        fieldbackground=BG_RAISED, foreground=TEXT, insertcolor=GOLD,
        bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER,
        selectbackground="#33513c", selectforeground=TEXT,
        padding=(10, 8), relief="flat",
    )
    style.map(
        "Search.TEntry",
        bordercolor=[("focus", BORDER_FOCUS)],
        lightcolor=[("focus", BORDER_FOCUS)],
        darkcolor=[("focus", BORDER_FOCUS)],
    )

    for name, base, hover in (("Leather.TButton", BROWN, BROWN_HI),
                              ("Ghost.TButton", BG_RAISED, "#2a3d30")):
        style.configure(
            name,
            background=base, foreground=TEXT_WARM if base == BROWN else TEXT_DIM,
            bordercolor=BORDER_WARM if base == BROWN else BORDER,
            lightcolor=base, darkcolor=base, focuscolor=GOLD,
            relief="flat", padding=(14, 8), font=fonts.ui_bold, anchor="center",
        )
        style.map(
            name,
            background=[("pressed", "#2d2015"), ("active", hover), ("disabled", "#1a2219")],
            foreground=[("disabled", "#4f5d4e"), ("active", TEXT)],
            lightcolor=[("active", hover)], darkcolor=[("active", hover)],
            bordercolor=[("disabled", "#243024")],
        )

    style.configure(
        "Dark.TCombobox",
        fieldbackground=BG_RAISED, background=BROWN, foreground=TEXT,
        arrowcolor=GOLD, bordercolor=BORDER, lightcolor=BORDER, darkcolor=BORDER,
        padding=(8, 6), relief="flat", selectbackground=BG_RAISED, selectforeground=TEXT,
    )
    style.map(
        "Dark.TCombobox",
        fieldbackground=[("readonly", BG_RAISED), ("disabled", BG_PANEL)],
        foreground=[("readonly", TEXT), ("disabled", "#55634f")],
        bordercolor=[("focus", BORDER_FOCUS)],
        arrowcolor=[("disabled", "#55634f")],
    )
    # the combobox popdown is a plain Tk listbox, styled via the option database
    root.option_add("*TCombobox*Listbox.background", BG_RAISED)
    root.option_add("*TCombobox*Listbox.foreground", TEXT)
    root.option_add("*TCombobox*Listbox.selectBackground", "#33513c")
    root.option_add("*TCombobox*Listbox.selectForeground", GOLD)
    root.option_add("*TCombobox*Listbox.font", fonts.ui)

    style.configure(
        "Dark.Vertical.TScrollbar",
        background=BG_RAISED, troughcolor=BG_PANEL, bordercolor=BG_PANEL,
        arrowcolor=TEXT_DIM, lightcolor=BG_RAISED, darkcolor=BG_RAISED,
        relief="flat", width=11,
    )
    style.map("Dark.Vertical.TScrollbar", background=[("active", "#33513c")])
    return style


def round_rect(canvas, x1, y1, x2, y2, radius, **kwargs):
    """Rounded rectangle via a smoothed polygon - Tk has no native one."""
    points = [
        x1 + radius, y1, x2 - radius, y1, x2, y1, x2, y1 + radius,
        x2, y2 - radius, x2, y2, x2 - radius, y2, x1 + radius, y2,
        x1, y2, x1, y2 - radius, x1, y1 + radius, x1, y1,
    ]
    return canvas.create_polygon(points, smooth=True, **kwargs)


class ManaCost(tk.Canvas):
    """Draws a mana cost as real coloured pips instead of '{2}{U}{U}'."""

    def __init__(self, master, fonts, bg=BG_PANEL, size=19, gap=3):
        super().__init__(master, bg=bg, highlightthickness=0, bd=0, height=size + 2, width=1)
        self._fonts = fonts
        self._size = size
        self._gap = gap

    def set_cost(self, cost):
        self.delete("all")
        symbols = re.findall(r"\{(.*?)\}", cost or "")
        size, gap = self._size, self._gap
        if not symbols:
            self.configure(width=1)
            return
        self.configure(width=len(symbols) * (size + gap))

        for index, symbol in enumerate(symbols):
            x = index * (size + gap)
            parts = symbol.split("/")
            if len(parts) == 2:
                self._draw_hybrid(x, parts)
            else:
                disc, ink = MANA.get(symbol.upper(), GENERIC)
                self.create_oval(x, 1, x + size, 1 + size, fill=disc, outline="", width=0)
                self.create_text(
                    x + size / 2, 1 + size / 2, text=symbol.upper(),
                    fill=ink, font=self._fonts.pip,
                )

    def _draw_hybrid(self, x, parts):
        size = self._size
        left, right = (MANA.get(p.upper(), GENERIC) for p in parts)
        box = (x, 1, x + size, 1 + size)
        self.create_arc(*box, start=45, extent=180, fill=left[0], outline="", style="pieslice")
        self.create_arc(*box, start=225, extent=180, fill=right[0], outline="", style="pieslice")
        self.create_text(
            x + size * 0.34, 1 + size * 0.34, text=parts[0].upper(),
            fill=left[1], font=self._fonts.pip_small,
        )
        self.create_text(
            x + size * 0.66, 1 + size * 0.68, text=parts[1].upper(),
            fill=right[1], font=self._fonts.pip_small,
        )


class PillRow(tk.Canvas):
    """A wrapping row of outlined chips - used for legality and prices."""

    def __init__(self, master, font, bg=BG_PANEL, height=24, gap=6):
        super().__init__(master, bg=bg, highlightthickness=0, bd=0, height=1)
        self._font = font
        self._items = []
        self._pill_h = height
        self._gap = gap
        self.bind("<Configure>", lambda _e: self._layout())

    def set_items(self, items):
        """items: sequence of (text, colour)."""
        self._items = list(items)
        self._layout()

    def _layout(self):
        self.delete("all")
        if not self._items:
            if int(self["height"]) != 1:
                self.configure(height=1)
            return

        width = self.winfo_width() or 420
        height, gap = self._pill_h, self._gap
        x = y = 0
        for text, color in self._items:
            pill_w = self._font.measure(text) + 20
            if x and x + pill_w > width:
                x, y = 0, y + height + gap
            round_rect(
                self, x, y, x + pill_w, y + height, 9,
                fill=BG_PILL, outline=color, width=1,
            )
            self.create_text(
                x + pill_w / 2, y + height / 2 + 1, text=text, fill=color, font=self._font
            )
            x += pill_w + gap

        wanted = y + height + 2
        if int(self["height"]) != wanted:
            self.configure(height=wanted)


class Diamond(tk.Canvas):
    """Tiny gold rhombus used as the wordmark glyph (no font dependency)."""

    def __init__(self, master, bg=BG_HEADER, size=13, color=GOLD):
        super().__init__(master, bg=bg, highlightthickness=0, bd=0, width=size, height=size)
        mid = size / 2
        self.create_polygon(
            mid, 0, size, mid, mid, size, 0, mid, fill=color, outline=""
        )
        self.create_polygon(
            mid, size * 0.28, size * 0.72, mid, mid, size * 0.72, size * 0.28, mid,
            fill=bg, outline="",
        )
