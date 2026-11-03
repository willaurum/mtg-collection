# MTG Card Viewer

My app for keeping track of my Magic cards and decks. It looks up cards through
[Scryfall](https://scryfall.com/), and I can use it in a Windows app window or a
browser.

## Run it on Windows

Install the Python packages once:

```powershell
pip install -r requirements.txt
```

Run the app with my Pi collection:

```powershell
python desktop_app.py --server http://100.116.99.123:8000
```

I can also double-click `run.bat`. The app remembers the server address, so I
don't have to type it every time. `python desktop_app.py --local` switches to a
separate collection on this computer. That local collection does not sync back
to the Pi.

## Update the Pi

From Windows:

```powershell
ssh willaurum@100.116.99.123
```

Then on the Pi:

```bash
git -C /srv/homelab/apps/mtg/app pull --ff-only origin main
sudo systemctl restart mtgviewer
```

That `/srv/homelab/apps/mtg/app` folder is the one the running service uses.
Updating `~/mtg` won't update the app I see.

## What I can do in the app

- Search any card, switch printings, and see art, rules, legality, and prices.
- Track my collection with search, filters, sorting, grid/list views, and an
  unused cards toggle.
- Use **Collection manager** to see where a new card belongs alphabetically.
  Cards with a copy outside my decks count as nearby cards.
- Build decks, see the stats below their cards, check Commander rules, and
  practice hands with **Goldfish**.
- Keep a wishlist of cards I still need.
- Import decklists or CSV files. I get a preview before anything is added.
- Export my profile as JSON, then import it by adding to or replacing my
  collection and decks.
- Pick a theme in Settings: Dark, Light, Katrine, Ty, Ethan, or Eli.

**Ctrl+K** opens the command menu. **Ctrl+L** jumps to card search.

## Where images and cards go

When I use the Windows app, downloaded card images go in one folder:

```text
%LOCALAPPDATA%\MTGCardViewer\images
```

All app accounts under the same Windows sign-in use that folder. Settings has
an **Open image folder** button. People using the browser still get images from
the Pi's cache.

The Pi keeps the accounts, collections, and decks in its SQLite database. If
the Pi is unavailable, the desktop app opens its separate local collection.

## Build an exe

```powershell
powershell -ExecutionPolicy Bypass -File build_exe.ps1
```

The result is `dist\MTGCardViewer.exe`.
