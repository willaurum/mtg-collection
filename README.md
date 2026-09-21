# MTG Card Viewer

python desktop_app.py --server http://100.116.99.123:8000

A desktop app that looks up any Magic: The Gathering card on
[Scryfall](https://scryfall.com/docs/api) and displays it — art, rules text,
printings, prices, and format legality.

Scryfall is free, needs no API key or account, and covers every card ever
printed in every set and language.

A Flask app served on a local port and shown in a native window by
[pywebview](https://pywebview.flowrl.com/), so the interface is plain
HTML/CSS/JS.

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
| Save a card | **Add to collection** under the details — saves the printing you are looking at |
| Import a list | **Import** in the rail — paste a decklist or CSV, or pick a file; preview before it writes |
| See what you own | **Collection** in the rail; search rules text, sort by name/newest/copies/value/set, toggle unused cards, or switch between card grid and compact list |
| Preview a collection card | Hover it, or focus it with the keyboard; click or press **Enter** to open it |
| Back up or move your library | **Export profile** writes your cards and decks to a JSON file; **Import profile** can merge one in or replace your current library with it |
| Remove a copy | **Remove one** on the card, or the **−** badge on a collection tile |
| Build a deck | **+** beside *Decks* in the rail — cards land in columns by type |
| Track cards to acquire | **Wishlist** in the rail — manual wishes and main-deck proxies are merged without double-counting |
| Revisit a card | Click it under **Recent** in the rail — the list survives restarts |
| Open the card page | **Scryfall** button — opens your real browser, not the app window |
| Focus the search box | **Ctrl+L** |
| Open commands | **Ctrl+K** — jump to views, imports, random, new decks, or any deck |

Misspell a card badly and the toast suggests real names instead of just
failing.

## Selecting multiple cards

In Collection or an open deck, choose **Select cards**, click the selection
button on a card, or **Ctrl/⌘-click** a card. **Shift-click** selects a range in
the displayed order. **Space** toggles a focused card; **Select all shown**
selects the visible cards. **Clear** empties the selection, and **Done selecting**
or **Escape** leaves selection mode. Ordinary clicks still open card details
outside selection mode.

- In Collection, choose a destination deck and main deck or maybeboard, then
  **Add one each** to add one copy of every selected printing. Existing copy
  limits still apply. **Copy selected list** exports full collection quantities.
- In a deck, move selected rows to the main deck or maybeboard, copy their
  quantities as a list, or remove them. Removal asks for an inline confirmation,
  removes every copy in those deck rows, and keeps the copies in your collection.
- Selection survives sorting and switching between grid and list. Filtering
  deselects cards that are no longer shown; navigation clears the selection.
- Bulk writes run one card at a time. If a write fails, the batch stops and
  reports how many completed; failed and unattempted cards remain selected while
  you stay in that view. If the connection was lost, refresh before retrying to
  check whether the server saved the last request.

## Settings

Open **Settings** in the rail to choose light/dark theme, text size, compact
spacing, startup screen, collection layout/sort, and remembered filters.
These preferences are saved on the current browser or desktop device.

The Prices section shows collection value and can force a refresh of all
collection, deck, and cheapest-printing prices. Data & backups provides profile
import/export, optional weekly/monthly in-app backup reminders, and image-cache
clearing. Cache clearing affects the server's shared downloaded images only.
Browser caches may retain their own copies.

Account password changes require the current password. Automatic local sign-in
mode does not offer password changes or sign-out. About & help lists shortcuts
and the app version; set `MTG_APP_VERSION` for a release label (otherwise it shows
“Development build”).

## Where the data lives

Everything is in one SQLite database — `library.db` — inside the data
directory, alongside the cached card art and the session signing key:

```
<data dir>/
├── library.db      collection, decks and accounts
├── secret.key      session signing key, mode 600, generated once
└── images/         cached card art, shared by everyone on the server
```

The data directory is `$MTG_DATA_DIR` when set (the server sets it), and
otherwise `Documents\MTG Card Viewer` — the same folder the desktop app has
always used, so an existing install keeps its cached art.

Every table that holds a person's cards carries a `user_id`, and every query
filters on it, so the schema was multi-user from the first migration even when
only one account existed. `cards` is the exception: it is a shared cache of
Scryfall payloads keyed by Scryfall id, so the second person to add Lightning
Bolt costs no API call at all.

**Export profile** contains only a user's collection and decks — never their
password, login session, or another person's data. When importing, choose
**Add to current collection** to merge in card copies and recreate decks, or
**Replace current collection** to delete only your current cards and decks and
restore exactly the backup. The replace choice asks for a second confirmation;
it never affects another user's library or the shared Scryfall cache.

SQLite runs in WAL mode, so a reader never blocks the writer — which matters on
a Pi that might lose power mid-write. Each rule (one printing per row, decks
never holding more copies than you own) is enforced inside a transaction rather
than by the page asking nicely. The page loads one complete library snapshot at
startup; routine edits then return only the card or deck that changed, plus the
updated totals, keeping normal use light over Wi-Fi.

## Running it on a Raspberry Pi

```bash
git clone <this repo> ~/mtg && cd ~/mtg
bash deploy/setup-pi.sh
```

That installs a virtualenv with Flask and gunicorn, creates
`~/mtg-data`, and initialises the database. Then make yourself an account and
start the service:

```bash
MTG_DATA_DIR=~/mtg-data .venv/bin/python manage.py adduser will
```

```bash
sudo cp deploy/mtgviewer.service /etc/systemd/system/ && sudo systemctl enable --now mtgviewer
```

Open `http://raspberrypi.local:8000` from any machine on the network, or point
the desktop app at it:

```bash
python desktop_app.py --server http://raspberrypi.local:8000
```

The URL is remembered, so that flag is only needed once; `--local` forgets it.
If the Pi cannot be reached the window falls back to a **local** library and
says so in the title bar. That local library is a separate database, not an
offline cache — edits made while the Pi is down do not sync up later.

### Admin commands

All of these run on the server, with `MTG_DATA_DIR` set:

| | |
| --- | --- |
| `manage.py initdb` | create or upgrade the database |
| `manage.py adduser <name>` | create an account (prompts for the password) |
| `manage.py passwd <name>` | change a password |
| `manage.py users` | list accounts with their card and deck counts |
| `manage.py deluser <name>` | delete an account and everything it owns |
| `manage.py import-json <name> [folder]` | load a desktop app's old JSON folder into an account |
| `manage.py export-json <name> <folder>` | write an account back out as JSON files |
| `manage.py stats` | database size, accounts, card-cache size |

Moving an existing desktop library onto the Pi is the import command: copy
`Documents\MTG Card Viewer` across and run
`manage.py import-json will /path/to/folder`. It reads the same `cards/` and
`decks/` files, skips anything corrupt rather than failing, and re-applies the
ownership rules as it goes — so a deck that asked for more copies than the
collection holds reports the clash instead of importing a lie.

### Security

Built LAN-first, but nothing here would need rewriting to face the internet:

- Passwords are hashed with scrypt (Werkzeug's default — no compiled extension
  to fight with on ARM). A login for a username that does not exist still costs
  a hash comparison, so missing accounts cannot be spotted by timing.
- Sessions are signed cookies, `HttpOnly` and `SameSite=Lax`, keyed by a secret
  generated once into `secret.key` at mode 600. Rotating that file signs
  everyone out.
- Repeated failures lock a username-and-address pair out for five minutes, and
  the correct password is refused while the lockout stands.
- The login form carries a CSRF token; the JSON API is same-origin and
  `SameSite=Lax` keeps the cookie off cross-site posts.
- Every API route, the image proxy included, requires a session. A dead session
  answers `401` and the page returns to the login screen rather than silently
  failing.

Before exposing it beyond the LAN: put it behind HTTPS (Caddy or a Cloudflare
Tunnel both terminate TLS for you) and set `MTG_HTTPS=1` so the session cookie
is marked `Secure`. The systemd unit has that line ready and commented out.

## Importing

**Import** in the rail takes a pasted list or a file (**Choose file…** reads
`.txt` and `.csv`). Two shapes are understood, detected automatically:

A decklist, one card per line, in any of the usual dialects:

```
Commander
1 Atraxa, Praetors' Voice

Deck
4 Lightning Bolt
2x Birds of Paradise
1 Sol Ring (LTC) 284 *F*
3 Forest [M10]
// comments, blank lines and section headers are skipped
```

Or a CSV export from Archidekt, Moxfield and friends. Columns are matched by
**name, not position**, so `Quantity`/`Count`/`Qty`, `Edition Code`/`Set`, and
`Collector Number` all land correctly whatever order they come in. A
`Scryfall ID` column, if present, is used and trusted outright.

Where a set and collector number are given they pin the exact printing;
otherwise the name alone picks Scryfall's default. Repeats of the same card
are folded together, so a list with a deck and a sideboard counts as what you
own in total.

**Nothing is written until you confirm.** Preview resolves the whole list and
shows what it found and what it could not, and only then does *Add to
collection* write anything. A preview is single-use, so a double-click cannot
import twice. Importing a card you already own adds to that count rather than
replacing it.

Two things the report tells you that are easy to get wrong elsewhere:

- A name the batch could not match exactly gets one fuzzy look-up, and the row
  says so — `matched from "1 Lighming Bolt"`.
- If a set and collector number point at a *different card* than the name on
  the same line — a stale export, or a typo — the name wins and the row
  explains why: `CMR 1 is The Prismatic Piper, not Atraxa, Praetors' Voice`.

Resolution goes through Scryfall's batch endpoint, seventy-five cards a
request, so a 100-card list costs two round trips rather than a hundred.

## Decks

Wishlist card popups offer **Add one to collection** for the displayed printing.
This leaves wish quantities and deck proxies unchanged. In a proxy's deck popup,
**Add to collection & use** adds the missing copies of that exact printing and
converts the whole row to owned cards in one save. Free copies already owned
count toward the main-deck row; copies reserved by other decks do not. The card's
zone and commander, partner, or companion role stay the same.

A deck file stores card **ids and counts only** — the collection stays the one
record of what you actually own. That makes the central rule easy to state and
impossible to cheat:

> The copies of a card spread across every deck can never exceed the number you
> own.

Own three Lightning Bolts and you can put two in one deck and one in another,
but never a fourth anywhere. What's left over is *free*, and free copies are
the only ones the deck builder offers you. The server recomputes availability
from the deck files on every change, so it cannot drift out of step with them.

The same rule runs in reverse: you can't remove a copy from the collection
while a deck is holding it. The app says which deck has it instead of silently
gutting your list. Deleting a deck hands its copies straight back.

| | |
| --- | --- |
| Make a deck | **+** beside *Decks* in the rail — the heading doubles as its name field |
| Add cards | Click any card under **Free to add**, or use **Add to deck** on a card |
| Change counts | Hover a card for its **− N +** stepper; **+** greys out at your last free copy |
| Set deck roles | Use **★** for the primary commander, or open a card for partner and companion controls |
| See where a card is | Chips under each collection tile: *2 free*, *Mono Red Burn ×2* — click a deck chip to jump there |
| Delete a deck | **Delete deck**, then click again to confirm |

### The deck view

**Manual goldfishing (desktop).** **Goldfish / Practice** opens a full tabletop in
the app's current theme. Main-deck quantities and proxies are included, the
commander starts in the command zone, and maybeboard cards stay out. Start with
seven cards (or all available cards in smaller decks).

Drag cards from your hand or any open zone onto the battlefield. Cards stay at
their exact dropped positions, can overlap, and can be moved freely. Ctrl-click
adds cards to a selection; dragging empty battlefield selects an area. Drag a
selected group to move it together. Right-click a card for its actions (or actions
for the selected group). Double-click a battlefield card to tap it;
double-click a card elsewhere to put it on the battlefield. Hover for a readable
preview. Click zone headings to browse cards; the library has a name filter.
Drop on zone panels or the hand to move cards; library drops go on top. Use the
selected-card Move control to put cards on the library bottom.

The side controls support tapping, flipping double-faced cards, turning cards
face down, generic or named counters, token copies, and named custom tokens.
Moving between zones clears tapping, counters, and face state; rearranging the
battlefield preserves them. Tokens disappear automatically when they leave the
battlefield; Undo restores them. Right-click empty battlefield for token
creation, draw, untap, next turn, and
shuffle. **Find token art** searches Scryfall tokens; select the artwork to place
it on the field (at the right-click location when opened there). Search by name
or filters such as `Soldier pow:1 tou:1`; Previous/Next browse artwork pages.
**Create custom token** still makes a named placeholder without a network request.
There is no mana or rules enforcement.

**Next turn** untaps the battlefield and draws one card. Draw, shuffle, untap,
life adjustment, and mulligans are also available separately. Mulligans shuffle
the hand back and draw seven; bottom cards manually for your chosen rules.
Shortcuts outside text inputs: **D** draw, **N** next turn, **T** tap selection,
**F** flip selection, **G** move to graveyard, **H** move to hand, **Ctrl+Z** undo.
**Undo** restores up to 50 actions, with a group drag counting as one action.
Every opening starts fresh; closing or reloading discards the session. **Reset**
starts again with the saved deck. Practice never changes your saved collection
or deck lists.

Laid out like Archidekt: one column per card type, cards stacked so only each
title bar shows, and hovering lifts a card clear of the ones below it. Columns
flow into as many screen columns as the window fits and the page scrolls down —
never sideways — so every category stays reachable.

Types are read from the front face, so a transforming card files under what it
starts as. Two orderings matter and they differ:

- **Land beats creature**, so Dryad Arbor and Darksteel Citadel sit with the
  lands — but an *artifact creature* is a creature first.
- Within a column, cards sort by mana value then name.

Commander decks get a **Commander** column pinned first. Any legendary creature
in the deck (or anything whose text says it *can be your commander*) shows a
star on hover for the primary commander. Open a card to assign it as the
primary commander or partner commander. The two command-zone cards share a
combined colour identity and count toward the 100-card deck. Partner pairing
rules are intentionally not validated.

A card with the Companion keyword can be assigned from the maybeboard. It gets
its own **Companion** column and stays outside the 100-card count. Companion
deck-building conditions are intentionally left to the player.

### Rule checking

The deck header says either **No rule breaks** or how many cards are wrong, and
names the offences underneath. Every offending card is outlined in red with a
red **!**, and its tooltip says why.

Above the deck columns, a compact stats panel shows land count, average mana
value, commander colour identity, a nonland mana curve, cards by colour
identity, and type counts. It recalculates immediately whenever the deck
changes.

Three rules are enforced:

**Format legality.** Scryfall reports Commander legality per card, so the
ban list never needs to live in this repo and never goes stale — *banned in
Commander* covers the 83-card ban list, and *not legal in Commander* covers
everything outside the format altogether: Un-set cards, Alchemy rebalances,
Mystery Booster playtest cards. This holds with or without a commander.

**Singleton.** One copy of a card, counted **by name** — so two different
printings of Sol Ring are still two Sol Rings, which is the mistake a
printing-aware collection makes easy to miss. Two exemptions are honoured, and
both are read from the card itself rather than a list kept here:

- basic lands (including snow basics and Wastes), unlimited;
- cards that grant themselves an exemption in their rules text — *"A deck can
  have any number of cards named Relentless Rats"*, or a stated cap like
  *"A deck can have up to nine cards named Nazgûl"*.

  Those two sentences are the whole mechanism: thirteen cards in Magic say
  something of the sort, and the parser was checked against every one. It also
  has to *not* be fooled by Once More with Feeling, whose text reads "A deck
  can have **only one** card named…" — near-identical wording, opposite
  meaning.

**Colour identity.** Every card must sit inside the commander's identity;
anything outside is flagged with the offending colours named. Identity comes
from Scryfall's `color_identity`, so it accounts for mana symbols in rules text,
not just the casting cost, and reads both halves of a two-faced card. The
commander itself is never flagged — it *is* the identity. With **no commander
set the colour rule does not apply** and any card is fine; the other two rules
still hold.

A card can break more than one rule, and the tooltip lists each.

Cards in **Free to add** that would land outside the identity are marked before
you add them. Nothing is blocked — the deck is yours, the app just tells you
what a judge would say.

Nothing in this view touches the network — card data and art both come from
your own folder and the image cache — so a deck opens instantly and works
offline.

## The look

A topbar (brand, search, Random), a navigation rail, and one content surface
that swaps between Card, Collection, Import and whichever deck is open. The
rail is the only navigation, so no view carries a *Back* button, and the active
row always says where you are. Below 820px the rail collapses to icons.

Flat dark-forest surfaces, one gold accent, hairline borders instead of stacked
panels and shadows. Fraunces for card and view titles over Inter for interface
text.

Two things stay out of the way: messages appear as a toast in the corner and
fade, rather than as a strip that truncates; and loading shows as a hairline
under the topbar rather than words that shift the layout.

Mana costs render as real coloured pips — including diagonally split discs for
hybrid, twobrid, and Phyrexian symbols — both in the cost line and inline in
the rules text, so `{T}: Add one mana of any color.` reads the way it does on
the card.

## Files

| File | Purpose |
| --- | --- |
| `desktop_app.py` | Desktop shell — picks a free port, starts Flask, opens the pywebview window |
| `server.py` | Flask routes: pages, login, the Scryfall proxy, the cached image proxy |
| `db.py` | SQLite schema, connections and migrations |
| `store.py` | Collection and deck operations, every one scoped to a user |
| `auth.py` | Passwords, sessions, login throttling |
| `manage.py` | Server admin CLI: accounts, import/export, stats |
| `deploy/` | systemd unit and first-run setup script for the Pi |
| `scryfall.py` | API client: lookup, random, autocomplete, printings, images |
| `importer.py` | Reading decklists and CSV exports, and resolving them against Scryfall |
| `templates/` | The app shell and the login page |
| `static/style.css` | The whole theme |
| `static/app.js` | Front end — search, autofill, rendering, collection, decks, import |
| `static/multiselect.js` | Collection/deck selection and bulk actions |
| `MTGCardViewer.spec`, `build_exe.ps1` | PyInstaller packaging |
| `legacy_tk/` | The earlier Tkinter version, kept for reference |
| `.cache/images/` | Downloaded card art (gitignored) |

## Multiselect checks

Run `node tests/test_multiselect.js` for selection and batch regression checks.
The browser interaction check is `node tests/test_multiselect_ui.js`; it requires
the `playwright` Node package and its Chromium browser. Set
`PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge instead.

## Notes on the API

The client follows Scryfall's published guidelines:

- Sends a descriptive `User-Agent` and `Accept` header
- Leaves at least 200ms between requests, with one request awaiting response
  headers at a time
- Stops immediately on HTTP 429 without automatic retries; all callers fail
  fast during a minimum 60-second cooldown. Longer `Retry-After` values,
  including HTTP dates, are honored in full and warnings are logged.
- Opening decks and price history uses saved prices without API price scans.
  Card lookups and additions save prices included in their card data. Only
  **Refresh all prices** scans the collection and missing-card estimates.
  Cheapest-printing estimates are saved across restarts and stay unchanged
  until an explicit refresh.
- Stops remaining price scans after a rate-limit warning and preserves daily
  cheapest-printing caches when refreshing prices. Concurrent lookups share
  those cached results instead of repeating the same search.
- Caches images to disk rather than re-downloading them

Throttling and cooldowns are shared by threads within one process, not across
separate app instances or computers. Keep the supplied single-worker server
configuration; instances sharing an outbound IP also share Scryfall's limits.
Restarting the app resets its in-memory cooldown and price caches.

The page never calls Scryfall directly — everything goes through the local
Flask app, so the rate limiting and the image cache apply no matter what the UI
does. Requests that carry a URL (the printings query, the image proxy, the
"open in browser" button) are checked against Scryfall's hosts before being
fetched.

Autofill waits for a 500ms pause in typing before asking. Typing a nine-letter
name is one request rather than nine, which keeps the app far inside Scryfall's
rate limit, and a reply you have already typed past is discarded instead of
flashing stale names.

If you ever need *all* cards at once, don't loop this API — Scryfall publishes
daily bulk JSON dumps at `https://api.scryfall.com/bulk-data`.
