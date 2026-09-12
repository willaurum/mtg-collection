# MTG Card Viewer

A desktop app that looks up any Magic: The Gathering card on
[Scryfall](https://scryfall.com/docs/api) and displays it — art, rules text,
printings, prices, and format legality.

Scryfall is free, needs no API key or account, and covers every card ever
printed in every set and language.

Built the same way as [CheckMate](https://github.com/willaurum/CheckMate): a
Flask app served on a local port and shown in a native window by
[pywebview](https://pywebview.flowrl.com/), so the interface is plain
HTML/CSS/JS. Same frame — radial-lit ground, 22px rounded panels, a fixed
sidebar beside a flexible content column, Fraunces over Space Grotesk — in a
dark forest-and-leather palette.

## Running it

```bash
pip install -r requirements.txt
```

```bash
python desktop_app.py
```

On Windows you can double-click `run.bat` instead, which launches without a
console window.

To work on the styling in an ordinary browser, run the Flask app on its own and
open <http://127.0.0.1:5000>:

```bash
python server.py
```

## Building an .exe

```bash
powershell -ExecutionPolicy Bypass -File build_exe.ps1
```

That produces `dist\MTGCardViewer.exe`. The spec bundles `templates/` and
`static/`; when frozen, the image cache moves to
`%LOCALAPPDATA%\MTGCardViewer\images` since the bundle itself is read-only.

## Using it

| Action | How |
| --- | --- |
| Autofill | Start typing — real card names appear under the box after a short pause |
| Pick a suggestion | **↑ / ↓** to highlight, **Enter** to accept, or click it; **Esc** dismisses |
| Search a card | **Enter** — matching is fuzzy, so `lightning blot` finds Lightning Bolt |
| Random card | **Random** button |
| Flip a double-faced card | **Flip card** under the art (appears only for two-faced cards) |
| View another printing | The **Printing** dropdown lists every printing, oldest first |
| Revisit a card | Click it in **Recently viewed** — the list survives restarts |
| Open the card page | **Scryfall** button — opens your real browser, not the app window |
| Focus the search box | **Ctrl+L** |

Misspell a card badly and the status line suggests real names instead of just
failing.

## The look

Deep forest greens, worn-leather browns, and an aged gold accent. Mana costs
render as real coloured pips — including diagonally split discs for hybrid,
twobrid, and Phyrexian symbols — both in the cost line and inline in the rules
text, so `{T}: Add one mana of any color.` reads the way it does on the card.
Legality and prices are outlined chips; the art sits in a bronze frame that
stays put while the details scroll.

## Files

| File | Purpose |
| --- | --- |
| `desktop_app.py` | Desktop shell — picks a free port, starts Flask, opens the pywebview window |
| `server.py` | Flask routes: the page, the Scryfall JSON proxy, the cached image proxy |
| `scryfall.py` | API client: lookup, random, autocomplete, printings, images |
| `templates/index.html` | Page skeleton |
| `static/style.css` | The whole theme |
| `static/app.js` | Front end — search, autofill, rendering, printings, recents |
| `MTGCardViewer.spec`, `build_exe.ps1` | PyInstaller packaging |
| `legacy_tk/` | The earlier Tkinter version, kept for reference |
| `.cache/images/` | Downloaded card art (gitignored) |

## Notes on the API

The client follows Scryfall's published guidelines:

- Sends a descriptive `User-Agent` and `Accept` header
- Leaves at least 100ms between requests (they ask for 50–100ms)
- Caches images to disk rather than re-downloading them

The page never calls Scryfall directly — everything goes through the local
Flask app, so the rate limiting and the image cache apply no matter what the UI
does. Requests that carry a URL (the printings query, the image proxy, the
"open in browser" button) are checked against Scryfall's hosts before being
fetched.

Autofill waits for a ~220ms pause in typing before asking, so a fast typist
triggers one request rather than ten, and a reply you have already typed past is
discarded instead of flashing stale names.

If you ever need *all* cards at once, don't loop this API — Scryfall publishes
daily bulk JSON dumps at `https://api.scryfall.com/bulk-data`.
