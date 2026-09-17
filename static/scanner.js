/* Webcam scanning. Camera frames stay in this browser; only names reach Scryfall. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(`scanner${id}`);
  const dialog = $("Dialog"), video = $("Video");
  const sample = document.createElement("canvas");
  sample.width = 48; sample.height = 64;
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  const crop = document.createElement("canvas");
  const cropCtx = crop.getContext("2d");
  let session = 0, request = 0, stream = null, worker = null, libraryPromise = null;
  let timer = null, baseline = null, previous = null, stable = 0, empty = 0;
  let mode = "closed", busy = false, saving = false, lastRead = 0;
  let selected = null, printings = [], face = 0, opener = null;
  const alive = (token) => token === session && dialog.open;
  const say = (message) => { $("Status").textContent = message; };

  // The guide occupies 80% of the video height and has a real card's aspect ratio.
  function bounds() {
    const height = video.videoHeight * 0.8;
    const width = height * 63 / 88;
    return { x: (video.videoWidth - width) / 2, y: video.videoHeight * 0.1, width, height };
  }

  function pixels() {
    const b = bounds();
    sampleCtx.drawImage(video, b.x, b.y, b.width, b.height, 0, 0, sample.width, sample.height);
    const rgba = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
    return Array.from({ length: rgba.length / 4 }, (_, i) =>
      rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114);
  }

  function difference(a, b) {
    if (!a || !b) return Infinity;
    // Remove uniform brightness shifts from webcam auto-exposure.
    const offset = a.reduce((sum, value, i) => sum + value - b[i], 0) / a.length;
    return a.reduce((sum, value, i) => sum + Math.abs(value - b[i] - offset), 0) / a.length;
  }

  function nameFromText(text) {
    return String(text || "").split(/\r?\n/).map((line) => line
      .replace(/[^a-zA-ZÀ-ž'’ ,\-]/g, " ").replace(/\s+/g, " ").trim())
      .find((line) => line.length >= 3) || "";
  }

  function loadOcrLibrary() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
      const timeout = setTimeout(() => fail(), 30000);
      const fail = () => {
        clearTimeout(timeout); script.remove(); libraryPromise = null;
        reject(new Error("Text recognition could not load. Check your internet connection and reopen the scanner."));
      };
      script.onload = () => { clearTimeout(timeout); resolve(window.Tesseract); };
      script.onerror = fail;
      document.head.appendChild(script);
    });
    return libraryPromise;
  }

  function stop() {
    session++; request++;
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null; video.srcObject = null;
    if (worker) worker.terminate().catch(() => {});
    worker = null; mode = "closed";
  }

  function close() {
    // A submitted add must settle before closing so the user sees its outcome.
    if (saving) return;
    stop(); dialog.close();
    opener?.focus();
  }

  async function open() {
    if (dialog.open) return;
    opener = document.activeElement;
    stop(); const token = session;
    baseline = previous = null; stable = empty = 0; lastRead = 0;
    busy = saving = false; selected = null; mode = "setup";
    $("Review").hidden = true; $("Capture").hidden = false;
    $("Search").value = ""; $("Calibrate").disabled = true; $("Rescan").disabled = true;
    $("Add").disabled = false; $("Close").disabled = false;
    $("Find").disabled = true; $("Search").disabled = true;
    $("Calibrate").textContent = "Frame is empty — start scanning";
    dialog.showModal();
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      say("Camera access needs HTTPS or localhost in a supported browser. Open the app there to scan cards.");
      return;
    }
    say("Allow webcam access, then leave the outline empty while the scanner loads.");
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (!alive(token)) { camera.getTracks().forEach((track) => track.stop()); return; }
      stream = camera; video.srcObject = camera;
      camera.getVideoTracks()[0].addEventListener("ended", () => {
        if (alive(token)) { stop(); say("The webcam disconnected. Close and reopen the scanner to reconnect."); }
      });
      await video.play();
      if (!alive(token)) return;
      say("Loading text recognition… Keep the outline empty.");
      const engine = await loadOcrLibrary();
      if (!alive(token)) return;
      const created = await engine.createWorker("eng", 1, {
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0",
      });
      if (!alive(token)) { await created.terminate(); return; }
      worker = created;
      await worker.setParameters({ tessedit_pageseg_mode: "7" });
      if (!alive(token)) return;
      $("Calibrate").disabled = false;
      say("Leave the card outline empty, then click “Frame is empty” to start.");
      timer = setInterval(tick, 250);
    } catch (error) {
      if (!alive(token)) return;
      stop();
      say(error.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser and reopen the scanner."
        : error.name === "NotFoundError" ? "No webcam found. Connect a webcam and reopen the scanner."
        : `Could not start scanner: ${error.message}`);
    }
  }

  function calibrate() {
    if (!worker || !video.videoWidth || saving || busy) return;
    baseline = pixels(); previous = baseline; stable = empty = 0;
    mode = "scanning"; lastRead = 0;
    $("Rescan").disabled = false;
    $("Find").disabled = false; $("Search").disabled = false;
    $("Calibrate").textContent = "Reset empty frame";
    say("Ready. Hold a card steady inside the outline.");
  }

  function tick() {
    if (!dialog.open || !baseline || !video.videoWidth || video.readyState < 2) return;
    const current = pixels();
    const absent = difference(current, baseline) < 10;
    stable = difference(current, previous) < 5 ? stable + 1 : 0;
    previous = current;
    if (mode === "waiting") {
      empty = absent ? empty + 1 : 0;
      if (empty >= 3) {
        mode = "scanning"; stable = 0; empty = 0; lastRead = 0;
        say("Ready for the next card. Another copy of the same card is welcome.");
      }
    } else if (mode === "scanning" && !busy && !absent && stable >= 3 && Date.now() - lastRead > 2500) {
      recognize();
    }
  }

  async function recognize() {
    if (!worker || busy || saving || !video.videoWidth) return;
    const token = session, attempt = ++request;
    busy = true; lastRead = Date.now();
    say("Reading card name…");
    const b = bounds();
    crop.width = 1000; crop.height = 140;
    // Crop the title strip, excluding the mana symbols at its right edge.
    cropCtx.drawImage(video, b.x + b.width * 0.06, b.y + b.height * 0.035,
      b.width * 0.73, b.height * 0.10, 0, 0, crop.width, crop.height);
    try {
      const { data } = await worker.recognize(crop);
      if (!alive(token) || attempt !== request) return;
      const name = nameFromText(data.text);
      if (!name || data.confidence < 35) {
        say("Could not read the name. Hold steady, improve the lighting, or press R to rescan.");
        return;
      }
      $("Search").value = name;
      await lookup(name, token, attempt);
    } catch (error) {
      if (alive(token) && attempt === request) say(`Recognition failed: ${error.message}. Press R to retry or enter the name.`);
    } finally {
      if (alive(token) && attempt === request) busy = false;
    }
  }

  async function lookup(name, token, attempt) {
    const card = await getJson(`/api/card?name=${encodeURIComponent(name)}`);
    if (!alive(token) || attempt !== request) return;
    mode = "review"; selected = card; face = 0; printings = [card];
    $("Capture").hidden = true; $("Review").hidden = false;
    $("Search").value = card.name;
    renderPrintings(); renderCard();
    say("Check the match and printing. Press Enter to add one copy, or R to rescan.");
    $("Add").focus();
    $("PrintingStatus").textContent = "Loading other printings…";
    try {
      const items = card.prints_search_uri
        ? await getJson(`/api/printings?uri=${encodeURIComponent(card.prints_search_uri)}`) : [];
      if (!alive(token) || attempt !== request || mode !== "review") return;
      printings = [card, ...items.filter((item) => item.id !== card.id)];
      renderPrintings();
      $("PrintingStatus").textContent = printings.length > 1 ? "Choose the printing that matches your card." : "No other printings available.";
    } catch {
      if (alive(token) && attempt === request) $("PrintingStatus").textContent = "Other printings could not load. Rescan or find the card again to retry.";
    }
  }

  function renderPrintings() {
    $("Printings").replaceChildren(...printings.map((card) => new Option(
      `${card.set_name || card.set} #${card.collector_number || "?"} · ${card.released_at || ""}`, card.id)));
    $("Printings").value = selected.id;
    $("Printings").disabled = saving || printings.length < 2;
  }

  function renderCard() {
    const shown = faceOf(selected, face);
    const art = imageUrl(selected, face);
    $("Art").src = art ? `/img?u=${encodeURIComponent(art)}` : "";
    $("Art").alt = shown.name || selected.name;
    $("Name").textContent = shown.name || selected.name;
    $("Mana").innerHTML = manaHtml(shown.mana_cost || "", true);
    $("Type").textContent = shown.type_line || selected.type_line || "";
    $("Rules").innerHTML = (shown.oracle_text || selected.oracle_text || "No rules text.")
      .split("\n").map((line) => `<p>${withInlinePips(line)}</p>`).join("");
    $("Prices").innerHTML = priceChipsHtml(selected);
    $("Owned").textContent = `${state.entryById.get(selected.id)?.quantity || 0} copies of this printing owned`;
    $("Flip").hidden = !isDoubleFaced(selected);
  }

  async function add() {
    if (mode !== "review" || !selected || saving) return;
    saving = true;
    const card = selected;
    ["Add", "Close", "Find", "Rescan", "Printings", "Search"].forEach((id) => { $(id).disabled = true; });
    say(`Adding ${card.name}…`);
    try {
      const data = await getJson("/api/collection/add", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card, quantity: 1 }) });
      applyPatch(data);
      request++; busy = false; mode = "waiting"; empty = 0; selected = null;
      $("Review").hidden = true; $("Capture").hidden = false;
      say(`Added ${card.name}. Remove the card completely from the outline before scanning the next copy.`);
    } catch (error) {
      say(`Could not confirm the add: ${error.message}. Check your collection before retrying if the connection was lost.`);
    } finally {
      saving = false;
      ["Add", "Close", "Find", "Rescan", "Search"].forEach((id) => { $(id).disabled = false; });
      $("Printings").disabled = printings.length < 2;
      if (mode === "waiting") $("Close").focus();
    }
  }

  function rescan() {
    if (saving || !worker || !baseline) return;
    // Rescan deliberately bypasses the removal gate to recover a missed scan.
    if (busy) { say("Finishing the current read. Press R again in a moment."); return; }
    request++; selected = null; mode = "scanning";
    $("Review").hidden = true; $("Capture").hidden = false;
    recognize();
  }

  $("Btn").addEventListener("click", open);
  $("Close").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { if (mode !== "closed") stop(); });
  $("Calibrate").addEventListener("click", calibrate);
  $("Rescan").addEventListener("click", rescan);
  $("Add").addEventListener("click", add);
  $("Flip").addEventListener("click", () => { face = 1 - face; renderCard(); });
  $("Printings").addEventListener("change", () => {
    selected = printings.find((card) => card.id === $("Printings").value); face = 0; renderCard();
  });
  $("SearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("Search").value.trim();
    if (!name || saving || busy) return;
    const token = session, attempt = ++request;
    busy = true; mode = "lookup"; selected = null;
    $("Review").hidden = true; $("Capture").hidden = false;
    say("Finding card…");
    try { await lookup(name, token, attempt); }
    catch (error) {
      if (alive(token) && attempt === request) say(`Could not find that card: ${error.message}. Correct the name or press R to rescan.`);
    } finally { if (alive(token) && attempt === request) busy = false; }
  });
  document.addEventListener("keydown", (event) => {
    if (!dialog.open) return;
    event.stopImmediatePropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    const editing = event.target instanceof Element && event.target.matches("input, textarea, select");
    if (event.repeat) { if (event.key === "Enter") event.preventDefault(); return; }
    if (event.key === "Enter" && mode === "review" && event.target === $("Printings")) {
      event.preventDefault(); add(); return;
    }
    if (!editing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      if (event.key.toLowerCase() === "r") { event.preventDefault(); rescan(); }
      if (event.key === "Enter" && mode === "review") { event.preventDefault(); add(); }
    }
  }, true);
  window.addEventListener("pagehide", stop);
})();
