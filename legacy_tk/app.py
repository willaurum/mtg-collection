"""MTG Card Viewer - a desktop app that looks up Magic cards on Scryfall.

Run with:  python app.py
"""

from __future__ import annotations

import io
import queue
import threading
import tkinter as tk
import webbrowser
from tkinter import ttk

import scryfall
import theme

try:
    from PIL import Image, ImageTk

    HAS_PIL = True
except ImportError:  # falls back to Tk's own PNG decoder
    HAS_PIL = False

CARD_ASPECT = 488 / 680
FORMATS = [
    "standard", "pioneer", "modern", "legacy",
    "vintage", "commander", "pauper", "brawl",
]
SUGGEST_LIMIT = 9
SUGGEST_DELAY = 220  # ms of quiet typing before we ask Scryfall
NAV_KEYS = {"Up", "Down", "Return", "Escape", "Tab", "Left", "Right", "Home", "End",
            "Shift_L", "Shift_R", "Control_L", "Control_R", "Alt_L", "Alt_R"}


def is_double_faced(card):
    """True when the card has two faces with separate artwork (a flip is useful)."""
    faces = card.get("card_faces") or []
    return len(faces) > 1 and all(face.get("image_uris") for face in faces)


def face_of(card, index):
    faces = card.get("card_faces") or []
    return faces[index] if faces else card


def image_url(card, index):
    """Best image URL for the given face, in the format our decoder can read."""
    source = face_of(card, index) if is_double_faced(card) else card
    uris = source.get("image_uris") or card.get("image_uris") or {}
    if HAS_PIL:
        return uris.get("normal") or uris.get("large") or uris.get("png")
    return uris.get("png") or uris.get("large") or uris.get("normal")


class CardViewer(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("MTG Card Viewer")
        self.geometry("1080x780")
        self.minsize(900, 660)

        self.card = None
        self.face_index = 0
        self.printings = []
        self._generation = 0
        self._queue = queue.Queue()
        self._pil_image = None
        self._tk_image = None
        self._resize_job = None
        self._image_box = (0, 0)
        self._suppress_printing_event = False
        self._suggest_job = None
        self._suggest_gen = 0
        self._suggest_names = []
        self._suggest_open = False
        self._suggest_click = False
        self._window_height = 0

        self.fonts = theme.Fonts()
        theme.apply(self, self.fonts)
        self._build_ui()
        self._dark_titlebar()
        self._pump()

        self.after(100, self.load_random)

    # ---------------------------------------------------------------- layout

    def _build_ui(self):
        self._build_header()

        body = tk.Frame(self, bg=theme.BG_DEEP)
        body.pack(side="top", fill="both", expand=True, padx=14, pady=12)
        body.columnconfigure(0, weight=5, minsize=300)
        body.columnconfigure(1, weight=6, minsize=380)
        body.rowconfigure(0, weight=1)

        self._build_art_column(body)
        self._build_detail_panel(body)
        self._build_status_bar()
        self._build_suggestions()

        self.bind("<F5>", lambda _e: self.load_random())
        self.bind("<Control-l>", lambda _e: self.entry.focus_set())
        self.bind("<Configure>", self._on_root_configure)

    def _on_root_configure(self, event):
        # Child widgets share the toplevel's bindtag, so filter to our own event.
        if event.widget is not self:
            return
        self._reposition_suggestions()
        if event.height != self._window_height:
            self._window_height = event.height
            if self.card:
                self._fit_oracle()

    def _dark_titlebar(self):
        """Ask Windows for a dark title bar so the chrome matches the app."""
        try:
            import ctypes

            self.update_idletasks()
            hwnd = ctypes.windll.user32.GetParent(self.winfo_id())
            flag = ctypes.c_int(1)
            for attribute in (20, 19):  # DWMWA_USE_IMMERSIVE_DARK_MODE, pre-20H1 value
                if ctypes.windll.dwmapi.DwmSetWindowAttribute(
                    hwnd, attribute, ctypes.byref(flag), ctypes.sizeof(flag)
                ) == 0:
                    break
        except Exception:  # noqa: BLE001 - cosmetic only, and Windows-only
            pass

    def _build_header(self):
        header = tk.Frame(self, bg=theme.BG_HEADER)
        header.pack(side="top", fill="x")
        inner = tk.Frame(header, bg=theme.BG_HEADER)
        inner.pack(fill="x", padx=14, pady=11)

        mark = tk.Frame(inner, bg=theme.BG_HEADER)
        mark.pack(side="left", padx=(0, 16))
        theme.Diamond(mark, bg=theme.BG_HEADER).pack(side="left", padx=(0, 7))
        tk.Label(
            mark, text="MTG CARD VIEWER", bg=theme.BG_HEADER, fg=theme.GOLD,
            font=self.fonts.wordmark,
        ).pack(side="left")

        self.query = tk.StringVar()
        self.entry = ttk.Entry(
            inner, textvariable=self.query, style="Search.TEntry", font=self.fonts.body
        )
        self.entry.pack(side="left", fill="x", expand=True)
        self.entry.focus_set()
        self.entry.bind("<KeyRelease>", self._on_entry_key)
        self.entry.bind("<Down>", lambda _e: self._move_suggestion(1) or "break")
        self.entry.bind("<Up>", lambda _e: self._move_suggestion(-1) or "break")
        self.entry.bind("<Return>", self._on_entry_return)
        self.entry.bind("<Escape>", lambda _e: self._hide_suggestions())
        self.entry.bind("<FocusOut>", lambda _e: self.after(150, self._maybe_hide))

        ttk.Button(inner, text="Search", style="Leather.TButton", command=self.do_search).pack(
            side="left", padx=(10, 0)
        )
        ttk.Button(inner, text="Random", style="Ghost.TButton", command=self.load_random).pack(
            side="left", padx=(6, 0)
        )
        self.browser_btn = ttk.Button(
            inner, text="Scryfall", style="Ghost.TButton",
            command=self.open_in_browser, state="disabled",
        )
        self.browser_btn.pack(side="left", padx=(6, 0))

        tk.Frame(self, bg=theme.BORDER, height=1).pack(side="top", fill="x")

    def _build_art_column(self, parent):
        column = tk.Frame(parent, bg=theme.BG_DEEP)
        column.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        column.rowconfigure(0, weight=1)
        column.columnconfigure(0, weight=1)

        self.image_holder = tk.Frame(
            column, bg=theme.BG_WELL, highlightthickness=1,
            highlightbackground=theme.BORDER, bd=0,
        )
        self.image_holder.grid(row=0, column=0, sticky="nsew")
        self.image_holder.bind("<Configure>", self._on_image_resize)

        # a two-pixel bronze frame hugging the art, centred in the well
        self.image_frame = tk.Frame(self.image_holder, bg=theme.BORDER_WARM)
        self.image_frame.place(relx=0.5, rely=0.5, anchor="center")
        self.image_label = tk.Label(
            self.image_frame, bg=theme.BG_WELL, fg=theme.TEXT_DIM,
            text="", font=self.fonts.ui, padx=20, pady=20,
        )
        self.image_label.pack(padx=2, pady=2)

        self.flip_btn = ttk.Button(
            column, text="Flip card", style="Leather.TButton",
            command=self.flip, state="disabled",
        )
        self.flip_btn.grid(row=1, column=0, pady=(10, 0))

    def _build_detail_panel(self, parent):
        panel = tk.Frame(
            parent, bg=theme.BG_PANEL, highlightthickness=1,
            highlightbackground=theme.BORDER, bd=0,
        )
        panel.grid(row=0, column=1, sticky="nsew")
        inner = tk.Frame(panel, bg=theme.BG_PANEL)
        inner.pack(fill="both", expand=True, padx=18, pady=16)
        inner.columnconfigure(0, weight=1)
        inner.rowconfigure(9, weight=1)  # slack lands at the foot of the panel

        head = tk.Frame(inner, bg=theme.BG_PANEL)
        head.grid(row=0, column=0, sticky="ew")
        head.columnconfigure(0, weight=1)
        self.name_label = tk.Label(
            head, text="", bg=theme.BG_PANEL, fg=theme.TEXT,
            font=self.fonts.title, anchor="w", justify="left",
        )
        self.name_label.grid(row=0, column=0, sticky="w")
        self.mana = theme.ManaCost(head, self.fonts)
        self.mana.grid(row=0, column=1, sticky="e", padx=(12, 0))

        typeline = tk.Frame(inner, bg=theme.BG_PANEL)
        typeline.grid(row=1, column=0, sticky="ew", pady=(3, 0))
        typeline.columnconfigure(0, weight=1)
        self.type_label = tk.Label(
            typeline, text="", bg=theme.BG_PANEL, fg=theme.TEXT_WARM,
            font=self.fonts.typeline, anchor="w",
        )
        self.type_label.grid(row=0, column=0, sticky="w")
        self.pt_label = tk.Label(
            typeline, text="", bg=theme.BG_PANEL, fg=theme.GOLD,
            font=self.fonts.stat, anchor="e",
        )
        self.pt_label.grid(row=0, column=1, sticky="e", padx=(12, 0))

        self._divider(inner, row=2)

        text_wrap = tk.Frame(inner, bg=theme.BG_PANEL)
        text_wrap.grid(row=3, column=0, sticky="nsew")
        text_wrap.rowconfigure(0, weight=1)
        text_wrap.columnconfigure(0, weight=1)
        self.oracle = tk.Text(
            # width is deliberately small: the Text's default 80 characters would
            # claim the whole panel and starve the art column of space.
            text_wrap, wrap="word", height=8, width=24, font=self.fonts.body, relief="flat",
            background=theme.BG_PANEL, foreground=theme.TEXT, padx=0, pady=0,
            cursor="arrow", highlightthickness=0, spacing1=2, spacing3=4,
            selectbackground="#33513c", selectforeground=theme.TEXT,
            inactiveselectbackground="#33513c",
        )
        self.oracle.grid(row=0, column=0, sticky="nsew")
        self.oracle_scroll = ttk.Scrollbar(
            text_wrap, orient="vertical", style="Dark.Vertical.TScrollbar",
            command=self.oracle.yview,
        )
        self.oracle_scroll.grid(row=0, column=1, sticky="ns", padx=(6, 0))
        self.oracle.configure(yscrollcommand=self.oracle_scroll.set, state="disabled")
        self.oracle.tag_configure("flavor", font=self.fonts.flavor, foreground=theme.TEXT_DIM)
        self.oracle.tag_configure(
            "facename", font=self.fonts.ui_bold, foreground=theme.GOLD, spacing1=8
        )
        self.oracle.tag_configure("rule", foreground=theme.BORDER)

        self._divider(inner, row=4)

        meta = tk.Frame(inner, bg=theme.BG_PANEL)
        meta.grid(row=5, column=0, sticky="ew")
        meta.columnconfigure(1, weight=1)
        self.rarity_dot = tk.Canvas(
            meta, width=9, height=9, bg=theme.BG_PANEL, highlightthickness=0, bd=0
        )
        self.rarity_dot.grid(row=0, column=0, padx=(0, 8))
        self.set_label = tk.Label(
            meta, text="", bg=theme.BG_PANEL, fg=theme.TEXT, font=self.fonts.ui, anchor="w"
        )
        self.set_label.grid(row=0, column=1, sticky="w")
        self.artist_label = tk.Label(
            meta, text="", bg=theme.BG_PANEL, fg=theme.TEXT_DIM, font=self.fonts.small, anchor="w"
        )
        self.artist_label.grid(row=1, column=1, sticky="w", pady=(3, 0))

        self.price_pills = theme.PillRow(inner, self.fonts.small, height=22)
        self.price_pills.grid(row=6, column=0, sticky="ew", pady=(12, 0))

        self.legal_pills = theme.PillRow(inner, self.fonts.small, height=22)
        self.legal_pills.grid(row=7, column=0, sticky="ew", pady=(6, 0))

        picker = tk.Frame(inner, bg=theme.BG_PANEL)
        picker.grid(row=8, column=0, sticky="ew", pady=(14, 0))
        picker.columnconfigure(1, weight=1)
        tk.Label(
            picker, text="PRINTING", bg=theme.BG_PANEL, fg=theme.TEXT_DIM, font=self.fonts.small
        ).grid(row=0, column=0, padx=(0, 10))
        self.printing_box = ttk.Combobox(
            picker, state="disabled", style="Dark.TCombobox", font=self.fonts.ui
        )
        self.printing_box.grid(row=0, column=1, sticky="ew")
        self.printing_box.bind("<<ComboboxSelected>>", self._on_printing_selected)

        tk.Frame(inner, bg=theme.BG_PANEL, height=1).grid(row=9, column=0, sticky="ew")

    def _divider(self, parent, row):
        tk.Frame(parent, bg=theme.BORDER, height=1).grid(
            row=row, column=0, sticky="ew", pady=11
        )

    def _build_status_bar(self):
        tk.Frame(self, bg=theme.BORDER, height=1).pack(side="bottom", fill="x")
        self.status = tk.StringVar(value="Ready.")
        self.status_label = tk.Label(
            self, textvariable=self.status, anchor="w", bg=theme.BG_HEADER,
            fg=theme.TEXT_DIM, font=self.fonts.small, padx=14, pady=6,
        )
        self.status_label.pack(side="bottom", fill="x")

    def _build_suggestions(self):
        """Autocomplete list, floated over the body directly under the entry."""
        self.suggest = tk.Listbox(
            self, bg=theme.BG_RAISED, fg=theme.TEXT, font=self.fonts.ui,
            selectbackground="#33513c", selectforeground=theme.GOLD,
            highlightthickness=1, highlightbackground=theme.BORDER_FOCUS,
            relief="flat", bd=0, activestyle="none", exportselection=False,
            takefocus=False,
        )
        self.suggest.bind("<Button-1>", lambda _e: setattr(self, "_suggest_click", True))
        self.suggest.bind("<ButtonRelease-1>", self._on_suggest_click)
        self.suggest.bind("<Motion>", self._on_suggest_motion)

    # ------------------------------------------------------------- autofill

    def _on_entry_key(self, event):
        if event.keysym in NAV_KEYS:
            return
        if self._suggest_job:
            self.after_cancel(self._suggest_job)
        text = self.query.get().strip()
        if len(text) < 2:
            self._hide_suggestions()
            return
        self._suggest_job = self.after(SUGGEST_DELAY, lambda: self._fetch_suggestions(text))

    def _fetch_suggestions(self, text):
        self._suggest_gen += 1
        generation = self._suggest_gen

        def worker():
            names = scryfall.autocomplete(text)
            self._queue.put(lambda n=names: self._show_suggestions(generation, n, text))

        threading.Thread(target=worker, daemon=True).start()

    def _show_suggestions(self, generation, names, text):
        # Ignore a reply the user has already typed past.
        if generation != self._suggest_gen or text != self.query.get().strip():
            return
        if not names:
            self._hide_suggestions()
            return
        self._suggest_names = names[:SUGGEST_LIMIT]
        self.suggest.delete(0, "end")
        for name in self._suggest_names:
            self.suggest.insert("end", "  " + name)
        self.suggest.configure(height=len(self._suggest_names))
        self._suggest_open = True
        self._reposition_suggestions()
        self.suggest.lift()

    def _reposition_suggestions(self, _event=None):
        if not self._suggest_open:
            return
        x = self.entry.winfo_rootx() - self.winfo_rootx()
        y = self.entry.winfo_rooty() - self.winfo_rooty() + self.entry.winfo_height() + 2
        self.suggest.place(x=x, y=y, width=self.entry.winfo_width())

    def _hide_suggestions(self):
        self._suggest_open = False
        self._suggest_names = []
        self.suggest.place_forget()

    def _maybe_hide(self):
        """FocusOut also fires when the list is clicked; let the click win."""
        if self._suggest_click:
            self._suggest_click = False
            return
        self._hide_suggestions()

    def _move_suggestion(self, step):
        if not self._suggest_open:
            return None
        current = self.suggest.curselection()
        index = (current[0] + step) if current else (0 if step > 0 else len(self._suggest_names) - 1)
        index = max(0, min(index, len(self._suggest_names) - 1))
        self.suggest.selection_clear(0, "end")
        self.suggest.selection_set(index)
        self.suggest.see(index)
        return None

    def _on_suggest_motion(self, event):
        index = self.suggest.nearest(event.y)
        self.suggest.selection_clear(0, "end")
        self.suggest.selection_set(index)

    def _on_suggest_click(self, _event=None):
        self._suggest_click = False
        selection = self.suggest.curselection()
        if selection:
            self._accept_suggestion(selection[0])

    def _accept_suggestion(self, index):
        name = self._suggest_names[index]
        self.query.set(name)
        self.entry.icursor("end")
        self._hide_suggestions()
        self.entry.focus_set()
        self.do_search()

    def _on_entry_return(self, _event=None):
        selection = self.suggest.curselection() if self._suggest_open else ()
        if selection:
            self._accept_suggestion(selection[0])
        else:
            self._hide_suggestions()
            self.do_search()
        return "break"

    # ------------------------------------------------------------ threading

    def _pump(self):
        """Drain callbacks posted by worker threads on the Tk main thread."""
        try:
            while True:
                self._queue.get_nowait()()
        except queue.Empty:
            pass
        self.after(40, self._pump)

    def _run(self, work, on_success, busy):
        """Run `work()` off the UI thread; stale results are discarded."""
        self._generation += 1
        generation = self._generation
        self.set_status(busy)

        def worker():
            try:
                result = work()
            except Exception as exc:  # noqa: BLE001 - surfaced in the status bar
                self._queue.put(lambda e=exc: self._finish(generation, self._show_error, e))
                return
            self._queue.put(lambda r=result: self._finish(generation, on_success, r))

        threading.Thread(target=worker, daemon=True).start()

    def _finish(self, generation, callback, payload):
        if generation == self._generation:
            callback(payload)

    def _show_error(self, exc):
        message = str(exc)
        suggestions = getattr(exc, "suggestions", None)
        if suggestions:
            message += "   Did you mean: " + ", ".join(suggestions[:5]) + "?"
        self.set_status(message, error=True)

    def set_status(self, message, error=False):
        self.status.set(message)
        self.status_label.configure(fg=theme.LEGALITY["banned"] if error else theme.TEXT_DIM)

    # --------------------------------------------------------------- actions

    def do_search(self):
        name = self.query.get().strip()
        if not name:
            self.set_status("Type a card name first.", error=True)
            return
        self._run(
            lambda: scryfall.card_by_name(name),
            self.show_card,
            'Searching for "%s"...' % name,
        )

    def load_random(self):
        self._hide_suggestions()
        self._run(scryfall.random_card, self.show_card, "Drawing a random card...")

    def open_in_browser(self):
        if self.card and self.card.get("scryfall_uri"):
            webbrowser.open(self.card["scryfall_uri"])

    def flip(self):
        if self.card and is_double_faced(self.card):
            self.face_index = 1 - self.face_index
            self.render_details()
            self.load_image()

    def _on_printing_selected(self, _event=None):
        if self._suppress_printing_event:
            return
        index = self.printing_box.current()
        if 0 <= index < len(self.printings):
            self.show_card(self.printings[index], refresh_printings=False)

    # -------------------------------------------------------------- painting

    def show_card(self, card, refresh_printings=True):
        self.card = card
        self.face_index = 0
        self.browser_btn.configure(state="normal")
        self.flip_btn.configure(state="normal" if is_double_faced(card) else "disabled")
        self.render_details()
        self.load_image()
        self.set_status("%s  -  %s" % (card.get("name", "?"), card.get("set_name", "")))
        if refresh_printings:
            self._load_printings(card)
        else:
            self._select_current_printing()

    def _load_printings(self, card):
        self.printings = []
        self.printing_box.configure(values=[], state="disabled")
        self.printing_box.set("")
        generation = self._generation

        def worker():
            data = scryfall.printings(card)
            self._queue.put(lambda d=data: self._finish(generation, self._fill_printings, d))

        threading.Thread(target=worker, daemon=True).start()

    def _fill_printings(self, data):
        self.printings = data
        labels = [
            "%s   %s #%s   %s"
            % (
                (item.get("released_at") or "")[:4],
                (item.get("set") or "").upper(),
                item.get("collector_number", "?"),
                (item.get("rarity") or "").title(),
            )
            for item in data
        ]
        state = "readonly" if len(data) > 1 else "disabled"
        self.printing_box.configure(values=labels, state=state)
        self._select_current_printing()

    def _select_current_printing(self):
        if not (self.card and self.printings):
            return
        self._suppress_printing_event = True
        try:
            ids = [item.get("id") for item in self.printings]
            if self.card.get("id") in ids:
                self.printing_box.current(ids.index(self.card["id"]))
        finally:
            self._suppress_printing_event = False

    def render_details(self):
        card = self.card
        face = face_of(card, self.face_index)
        display = face if is_double_faced(card) else card

        self.name_label.configure(text=display.get("name", ""))
        self.mana.set_cost(display.get("mana_cost"))
        self.type_label.configure(text=display.get("type_line", ""))

        if display.get("power") is not None:
            self.pt_label.configure(
                text="%s / %s" % (display["power"], display.get("toughness", ""))
            )
        elif display.get("loyalty"):
            self.pt_label.configure(text="[%s]" % display["loyalty"])
        else:
            self.pt_label.configure(text="")

        self._render_oracle(card)

        rarity = (card.get("rarity") or "common").lower()
        self.rarity_dot.delete("all")
        self.rarity_dot.create_oval(
            0, 0, 8, 8, fill=theme.RARITY.get(rarity, theme.TEXT_DIM), outline=""
        )
        self.set_label.configure(
            text="%s  (%s)  #%s  -  %s"
            % (
                card.get("set_name", "?"),
                (card.get("set") or "").upper(),
                card.get("collector_number", "?"),
                rarity.title(),
            )
        )
        artist = face.get("artist") or card.get("artist") or "Unknown"
        self.artist_label.configure(
            text="Illustrated by %s   -   released %s" % (artist, card.get("released_at", "?"))
        )
        self._render_prices(card)
        self._render_legality(card)

    def _render_oracle(self, card):
        faces = card.get("card_faces") or []
        if faces and is_double_faced(card):
            blocks = [face_of(card, self.face_index)]
        elif faces:
            blocks = faces  # split / adventure / flip: both halves share one image
        else:
            blocks = [card]

        self.oracle.configure(state="normal")
        self.oracle.delete("1.0", "end")
        for index, block in enumerate(blocks):
            if index:
                self.oracle.insert("end", "\n" + "─" * 34 + "\n", "rule")
            if len(blocks) > 1:
                self.oracle.insert("end", "%s\n" % block.get("name", ""), "facename")
                self.oracle.insert("end", "%s\n\n" % block.get("type_line", ""), "flavor")
            self.oracle.insert("end", (block.get("oracle_text") or "").strip() + "\n")
            if block.get("flavor_text"):
                self.oracle.insert("end", "\n" + block["flavor_text"].strip() + "\n", "flavor")
        self.oracle.configure(state="disabled")
        self._fit_oracle()

    def _fit_oracle(self):
        """Grow the rules box to fit its text, within what the window can spare.

        Keeping it content-sized puts the card's details right under the text
        instead of stranding them below a half-empty box.
        """
        self.oracle.update_idletasks()
        try:
            wanted = int(self.oracle.count("1.0", "end-1c", "displaylines")[0])
        except (tk.TclError, TypeError):
            return
        line_px = max(self.fonts.body.metrics("linespace") + 2, 1)
        ceiling = max(4, (self.winfo_height() - 470) // line_px)
        height = max(3, min(wanted, ceiling))
        self.oracle.configure(height=height)
        if wanted > height:
            self.oracle_scroll.grid()
        else:
            self.oracle_scroll.grid_remove()

    def _render_prices(self, card):
        prices = card.get("prices") or {}
        pills = []
        for key, label, symbol, color in (
            ("usd", "USD", "$", theme.LEAF),
            ("usd_foil", "FOIL", "$", theme.GOLD),
            ("eur", "EUR", "€", theme.TEXT_WARM),
            ("tix", "MTGO", "", theme.TEXT_DIM),
        ):
            if prices.get(key):
                pills.append(("%s  %s%s" % (label, symbol, prices[key]), color))
        self.price_pills.set_items(pills or [("No price data", theme.TEXT_DIM)])

    def _render_legality(self, card):
        legalities = card.get("legalities") or {}
        self.legal_pills.set_items(
            [
                (fmt.title(), theme.LEGALITY.get(legalities.get(fmt, "not_legal"), theme.TEXT_DIM))
                for fmt in FORMATS
            ]
        )

    # ----------------------------------------------------------------- image

    def load_image(self):
        url = image_url(self.card, self.face_index)
        if not url:
            self._pil_image = None
            self.image_label.configure(image="", text="No image available")
            return
        self.image_label.configure(image="", text="Loading art...")
        self._tk_image = None
        generation = self._generation
        face = self.face_index

        def worker():
            try:
                data = scryfall.image_bytes(url)
            except Exception as exc:  # noqa: BLE001
                self._queue.put(lambda e=exc: self._finish(generation, self._show_error, e))
                return
            self._queue.put(lambda d=data: self._apply_image(generation, face, d))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_image(self, generation, face, data):
        if generation != self._generation or face != self.face_index:
            return
        if HAS_PIL:
            self._pil_image = Image.open(io.BytesIO(data))
            self._pil_image.load()
        else:
            self._pil_image = tk.PhotoImage(data=data)
        self.render_image()

    def render_image(self):
        if self._pil_image is None:
            return
        width = max(self.image_holder.winfo_width() - 28, 60)
        height = max(self.image_holder.winfo_height() - 28, 80)
        box_w = min(width, int(height * CARD_ASPECT))
        box_h = int(box_w / CARD_ASPECT)

        if HAS_PIL:
            resized = self._pil_image.resize((box_w, box_h), Image.LANCZOS)
            self._tk_image = ImageTk.PhotoImage(resized)
        else:
            factor = max(1, round(self._pil_image.width() / box_w))
            self._tk_image = self._pil_image.subsample(factor, factor)
        self.image_label.configure(image=self._tk_image, text="", padx=0, pady=0)

    def _on_image_resize(self, event):
        if (
            abs(event.width - self._image_box[0]) < 8
            and abs(event.height - self._image_box[1]) < 8
        ):
            return
        self._image_box = (event.width, event.height)
        if self._resize_job:
            self.after_cancel(self._resize_job)
        self._resize_job = self.after(120, self.render_image)


if __name__ == "__main__":
    CardViewer().mainloop()
