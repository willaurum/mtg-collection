# Collection loading failure after the wishlist update

## Incident — September 17, 2026

After deploying the wishlist feature to the Raspberry Pi, the collection appeared
empty and the app displayed:

```text
Unexpected token '<', "<!doctype "... is not valid JSON
```

The service log confirmed that `GET /api/library` returned HTTP 500 when
`store.library()` called `wishlist()`:

```text
sqlite3.OperationalError: no such table: wishlist
```

Flask returned an HTML error page. The frontend tried to parse it as JSON and
showed the parsing error. Because the library request failed, the UI retained
its initial empty collection state. This error does not establish that any
collection records were deleted. The Pi's collection contents were not directly
verified during this investigation.

## Diagnosis and limits of the evidence

The new library response queries the `wishlist` table, which was introduced in
schema version 6. The Pi was confirmed to have `db.py` containing the version 6
migration, so the earlier suggestion that it simply had an outdated `db.py` was
not supported by the subsequent evidence.

The migration function returns immediately when the stored schema version is
already at least `SCHEMA_VERSION`. A database recorded as version 6 but missing
the wishlist table therefore remains broken after both a restart and
`manage.py initdb`. This migration gap was reproduced in regression tests.
The Pi's stored schema version was not captured, so this exact database state
remains a possible explanation rather than a confirmed fact about that server.

Another possibility is that a manual migration targeted a different database
from the service. The earlier commands assumed `/home/willaurum/mtg-data`
without capturing the service's configured path. A local Windows database was
also inspected, but it is separate from the Pi database and cannot establish
the state of the Pi's collection.

The Gunicorn warning about a read-only `/home/willaurum/.gunicorn` directory was
separate from the missing-table exception: the worker was running and serving
requests, and the library traceback explicitly identified `wishlist` as missing.

## Implemented fix

- **`db.py`:** increase `SCHEMA_VERSION` to 7. For databases below version 7,
  run `CREATE TABLE IF NOT EXISTS wishlist` before recording version 7. This
  repairs version 6 databases with a missing table and preserves existing
  wishlist rows. It also tolerates an already-created table when the stored
  version is still 5. Collection and deck records are not deleted or replaced.
- **`server.py`:** log the database path and schema version after startup
  migration. Return a JSON error for API HTTP 500 responses, while the server
  log retains the underlying exception.
- **`static/app.js`:** report unexpected non-JSON responses with the HTTP status
  instead of exposing a JSON parsing exception. A failed initial library load
  explicitly says the collection could not be loaded.

Startup migration uses the service's own `MTG_DATA_DIR`, avoiding a separately
guessed database path. This repair is for installations below schema version 7;
it is not a general repair for damaged tables or databases.

## Deploy to the Raspberry Pi

These commands use the host and paths from this incident. Substitute the actual
host or checkout path for other installations. The original wishlist feature
must already be deployed; these files contain the follow-up repair.

From **Windows PowerShell**, copy the updated application files:

```powershell
cd C:\Users\golde\Documents\GitHub\mtg-collection
scp db.py server.py willaurum@100.116.99.123:/home/willaurum/mtg/
scp static/app.js willaurum@100.116.99.123:/home/willaurum/mtg/static/
```

Then, **on the Pi**, restart the service and inspect startup output:

```bash
sudo systemctl restart mtgviewer
sudo journalctl -u mtgviewer --since "2 minutes ago" --no-pager
```

Expect a line like:

```text
Database ready: /actual/data/directory/library.db (schema 7)
```

Refresh the app. Success means `/api/library` returns HTTP 200 and the expected
collection and decks are visible. A successful service restart alone does not
confirm that the library request succeeds.

## If the collection still fails to load

Immediately after reproducing the failure, collect:

```bash
sudo systemctl show mtgviewer -p Environment -p EnvironmentFiles -p WorkingDirectory -p ExecStart
sudo journalctl -u mtgviewer --since "5 minutes ago" --no-pager
```

Compare the startup database path with the intended data directory, confirm
schema 7 was reported, and inspect the newest `/api/library` traceback. Do not
assume that logs from an older worker describe the current request.

Avoid deleting or replacing the database, resetting its schema-version marker,
or using profile import's replace option to address a loading error. If a
database backup is needed, use SQLite's backup API or a proper SQLite backup
tool: the application uses WAL mode, so copying only a live `library.db` file
can omit committed data still present in its WAL file.

## Validation and deployment status

The local fix passed 25 relevant Python tests across
`tests/test_migrations.py` and `tests/test_mutation_patches.py`, plus JavaScript
syntax validation and `git diff --check`.

Regression coverage includes:

- Missing wishlist tables repaired from schema versions 5 and 6.
- Existing collection quantities and deck allocations preserved by migration.
- Existing manual wishes preserved across upgrades and repeated migrations.
- SQLite integrity checks after migration.
- Library exceptions returning JSON HTTP 500 responses without changing saved
  collection quantities.

Run the Python checks from the repository root:

```bash
python -m unittest tests.test_migrations tests.test_mutation_patches -v
```

At the time this document was written, the repair was implemented and tested
locally. Successful deployment and collection recovery on the Pi had not yet
been confirmed.
