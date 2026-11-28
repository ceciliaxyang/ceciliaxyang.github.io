(() => {
  "use strict";
  const DATA = JSON.parse(document.getElementById("cc-data").textContent);
  const SAVED = JSON.parse(document.getElementById("cc-state").textContent);
  const PATTERNS = DATA.patterns;
  const TOTAL = PATTERNS.reduce((n, p) => n + p.count, 0);
  const GROUPS = [
    ["turn", "Your turn", "You tap the coach before throwing a tile."],
    ["claim", "Someone discarded", "You tap the coach while deciding whether to take a thrown tile."],
    ["review", "After your move", "The coach speaks up on its own after a move it would have made differently."],
    ["summary", "End of the hand", "The recap card when a hand finishes."],
  ];
  const groupOf = (key) => key.split("-")[0];

  // ---------- state ----------
  // edits[key] = { html: string|null (null = same as current), notes: string }
  const edits = JSON.parse(JSON.stringify(SAVED.edits || {}));
  let selected = (() => { try { return localStorage.getItem("cc-selected") || PATTERNS[0].key; } catch { return PATTERNS[0].key; } })();
  if (!PATTERNS.some((p) => p.key === selected)) selected = PATTERNS[0].key;
  let dirty = false;
  const DRAFT_KEY = "cc-draft-" + (SAVED.savedAt || "first");
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (d && d.edits) { Object.assign(edits, d.edits); dirty = true; }
  } catch { /* no storage */ }
  const saveDraft = () => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ edits })); } catch { /* no storage */ } };
  const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* no storage */ } };

  // ---------- the product card, in a shadow root with the site's own stylesheet ----------
  const siteSheet = new CSSStyleSheet();
  siteSheet.replaceSync(DATA.css);
  const editSheet = new CSSStyleSheet();
  editSheet.replaceSync(`
    .frame { font-family: "SF Pro Display", -apple-system, BlinkMacSystemFont, Inter, system-ui, sans-serif; letter-spacing: -.2px;
      color: #000; line-height: normal; font-size: 16px; -webkit-font-smoothing: antialiased; }
    .frame { position: static !important; transform: none !important; opacity: 1 !important; visibility: visible !important;
      max-height: none !important; width: 400px; max-width: 100%; border-radius: 28px; }
    .frame .pane-body { overflow: visible; }
    .frame .pane-actions { position: static; margin: 24px 0 0; padding: 0; pointer-events: auto; }
    .editing [contenteditable="true"] { outline: none; }
    .editing [contenteditable="true"]:not(.btn) { border-radius: 4px; transition: background .15s ease, box-shadow .15s ease; cursor: text; }
    .editing [contenteditable="true"]:not(.btn):hover { background: rgba(14, 106, 78, .06); box-shadow: 0 0 0 3px rgba(14, 106, 78, .06); }
    .editing [contenteditable="true"]:not(.btn):focus { background: rgba(14, 106, 78, .08); box-shadow: 0 0 0 3px rgba(14, 106, 78, .18); }
    .editing .pane-body > * { position: relative; inset: auto; }
    .editing .btn[contenteditable="true"]:focus { box-shadow: 0 0 0 3px rgba(14, 106, 78, .35); }
    .frame.editing { overflow: visible !important; }
    /* the block tools sit in the margin to the left of the card, only for the block you're editing */
    .frame.editing { position: relative !important; inset: auto !important; }
    .blk-tools { position: absolute; top: 0; right: calc(100% + 10px); z-index: 5; display: none; flex-direction: column; gap: 2px;
      padding: 3px; border-radius: 10px; background: #1d2b25; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
    .blk-tools.show { display: flex; }
    .editing .pane-body > .on-edit { box-shadow: -14px 0 0 -12px rgba(14, 106, 78, .5); }
    .editing span.btn { cursor: text; }
    .blk-tools button { all: unset; display: grid; place-items: center; min-width: 24px; height: 24px; padding: 0 6px; border-radius: 7px;
      font: 500 12px/1 Inter, system-ui, sans-serif; letter-spacing: 0; color: #fff; cursor: pointer; white-space: nowrap; }
    .blk-tools button:hover, .blk-tools button:focus-visible { background: rgba(255,255,255,.16); }
  `);

  const hydrate = (html) => html.replace(/<svg data-face="(\d+)"><\/svg>/g, (_, i) => DATA.faces[+i]);
  const dehydrate = (root) => {
    const c = root.cloneNode(true);
    c.querySelectorAll(".blk-tools").forEach((n) => n.remove());
    c.querySelectorAll("[contenteditable]").forEach((n) => n.removeAttribute("contenteditable"));
    c.querySelectorAll("[tabindex]").forEach((n) => n.removeAttribute("tabindex"));
    c.querySelectorAll(".on-edit").forEach((n) => { n.classList.remove("on-edit"); if (!n.className) n.removeAttribute("class"); });
    c.querySelectorAll("span[data-was-button]").forEach((n) => { const btn = document.createElement("button"); btn.type = "button"; btn.className = n.className; btn.innerHTML = n.innerHTML; n.replaceWith(btn); });
    // tile faces go back to their short placeholders
    return c.innerHTML.replace(/<svg data-face="(\d+)"[\s\S]*?<\/svg>/g, '<svg data-face="$1"></svg>');
  };

  function mountCard(host, html, editable, onChange) {
    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.adoptedStyleSheets = [siteSheet, editSheet];
    root.innerHTML = `<div class="pane open frame ${editable ? "editing" : ""}"><div class="pane-body">${hydrate(html)}</div></div>`;
    const body = root.querySelector(".pane-body");
    body.querySelectorAll("button").forEach((b) => b.setAttribute("tabindex", editable ? "0" : "-1"));
    if (!editable) return body;
    const TEXT = "h3, p, li, .lbl, .sub, small, .pane-actions .btn";
    // buttons can't hold editable text in every browser, so while editing they're plain spans
    body.querySelectorAll("button.btn").forEach((b) => {
      const sp = document.createElement("span");
      sp.className = b.className; sp.dataset.wasButton = "1"; sp.innerHTML = b.innerHTML;
      b.replaceWith(sp);
    });
    const arm = () => {
      body.querySelectorAll(TEXT).forEach((n) => n.setAttribute("contenteditable", "true"));
      body.querySelectorAll(".tile").forEach((n) => n.setAttribute("contenteditable", "false"));
    };
    arm();
    // one toolbar for the whole card, kept outside the text, beside the block you're editing
    const frame = root.querySelector(".frame");
    const tools = document.createElement("div");
    tools.className = "blk-tools";
    tools.innerHTML = `<button type="button" data-a="up" title="Move up" aria-label="Move up">↑</button><button type="button" data-a="down" title="Move down" aria-label="Move down">↓</button><button type="button" data-a="text" title="Add a paragraph below" aria-label="Add a paragraph below">+¶</button><button type="button" data-a="tip" title="Add a tip below" aria-label="Add a tip below">+Tip</button><button type="button" data-a="del" title="Remove" aria-label="Remove">✕</button>`;
    frame.appendChild(tools);
    let current = null;
    const place = (blk) => {
      current = blk;
      body.querySelectorAll(":scope > .on-edit").forEach((n) => n.classList.remove("on-edit"));
      if (!blk) { tools.classList.remove("show"); return; }
      blk.classList.add("on-edit");
      tools.style.top = `${blk.getBoundingClientRect().top - frame.getBoundingClientRect().top}px`;
      tools.classList.add("show");
    };
    body.addEventListener("focusin", (e) => place(e.target.closest(".pane-body > *")));
    body.addEventListener("focusout", () => setTimeout(() => { if (!body.contains(root.activeElement)) place(null); }, 150));
    tools.addEventListener("mousedown", (e) => e.preventDefault());  // keep the text focused
    tools.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || !current) return;
      const blk = current;
      const a = b.dataset.a;
      if (a === "up" && blk.previousElementSibling) blk.parentNode.insertBefore(blk, blk.previousElementSibling);
      if (a === "down" && blk.nextElementSibling) blk.parentNode.insertBefore(blk.nextElementSibling, blk);
      if (a === "del") { blk.remove(); place(null); }
      if (a === "text" || a === "tip") {
        const p = document.createElement("p");
        if (a === "tip") p.className = "tip";
        p.textContent = a === "tip" ? "Tip: " : "New paragraph";
        blk.after(p);
        arm();
        p.focus();
        const r = document.createRange(); r.selectNodeContents(p); const sel = root.getSelection ? root.getSelection() : getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
      if (current && current.isConnected) place(current);
      onChange(dehydrate(body));
    });
    body.addEventListener("click", (e) => { if (e.target.closest(".btn")) e.preventDefault(); });
    body.addEventListener("input", () => onChange(dehydrate(body)));
    // pasted text arrives as plain text, so the card keeps the product's styles
    body.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches?.("h3, .lbl, .sub, .btn, small")) e.preventDefault();
    });
    return body;
  }

  // ---------- page ----------
  const $ = (s) => document.querySelector(s);
  const app = $("#app");
  app.innerHTML = `
    <header class="top">
      <div class="brand">
        <h1>Coach copy</h1>
        <p class="lede">The coach's most common advice cards, as they read today, beside your version. Click any words on the right to rewrite them. The tools beside the card move, add or remove the block you are editing.</p>
      </div>
      <div class="save">
        <span class="save-status" id="saveStatus" role="status"></span>
        <button type="button" class="btn-primary" id="saveBtn">Save version</button>
      </div>
    </header>
    <div class="layout">
      <nav class="patterns" aria-label="Advice patterns" id="nav"></nav>
      <main class="work" id="work"></main>
    </div>`;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pct = (n) => { const v = (n / TOTAL) * 100; return v >= 1 ? `${Math.round(v)}%` : v >= 0.1 ? `${v.toFixed(1)}%` : "<0.1%"; };
  const isEdited = (key) => !!(edits[key] && edits[key].html !== null && edits[key].html !== undefined);
  const hasNotes = (key) => !!(edits[key] && edits[key].notes && edits[key].notes.trim());
  const maxCount = Math.max(...PATTERNS.map((p) => p.count));

  function renderNav() {
    const nav = $("#nav");
    nav.innerHTML = GROUPS.map(([g, label]) => {
      const items = PATTERNS.filter((p) => groupOf(p.key) === g);
      if (!items.length) return "";
      return `<section class="nav-group"><h2>${esc(label)}</h2><ul>${items.map((p) => `
        <li><button type="button" class="nav-item${p.key === selected ? " on" : ""}" data-key="${esc(p.key)}" aria-current="${p.key === selected}">
          <span class="nav-name">${esc(p.name)}</span>
          <span class="nav-meta"><span class="freq"><span style="width:${Math.max(3, (p.count / maxCount) * 100)}%"></span></span><span class="share">${pct(p.count)}</span>${isEdited(p.key) ? `<span class="chip">Edited</span>` : hasNotes(p.key) ? `<span class="chip note">Note</span>` : ""}</span>
        </button></li>`).join("")}</ul></section>`;
    }).join("");
  }

  function renderWork() {
    const p = PATTERNS.find((x) => x.key === selected);
    const e = edits[p.key] || {};
    const [, gLabel, gWhen] = GROUPS.find(([g]) => g === groupOf(p.key));
    $("#work").innerHTML = `
      <div class="work-head">
        <p class="eyebrow">${esc(gLabel)}</p>
        <h2>${esc(p.name)}</h2>
        <p class="when">${esc(gWhen)} ${esc(p.about)} Shows up in <b>${pct(p.count)}</b> of coach cards (${p.count.toLocaleString()} of ${TOTAL.toLocaleString()} across ${DATA.hands.toLocaleString()} simulated hands).</p>
      </div>
      <div class="pair">
        <figure class="col">
          <figcaption><span>Current</span><span class="cap-note">Live on the site</span></figcaption>
          <div class="stage"><div class="card-host" id="curHost"></div></div>
        </figure>
        <figure class="col">
          <figcaption><span>Your version</span><span class="cap-actions"><button type="button" class="link" id="resetBtn"${isEdited(p.key) ? "" : " disabled"}>Reset to current</button></span></figcaption>
          <div class="stage edit"><div class="card-host" id="edHost"></div></div>
        </figure>
      </div>
      <label class="notes" for="notes"><span>Notes for this pattern</span>
        <textarea id="notes" rows="3" placeholder="Rules that should apply to every card like this one, e.g. &quot;never say 'run', say 'sequence'&quot;">${esc(e.notes || "")}</textarea>
      </label>
      <p class="fine">This example comes from one real hand, so the tiles and numbers change from card to card. Write the wording you want here; I'll turn it into the rule for every hand.</p>`;
    mountCard($("#curHost"), p.card, false);
    mountCard($("#edHost"), isEdited(p.key) ? e.html : p.card, true, (html) => {
      edits[p.key] = { ...(edits[p.key] || {}), html: html === normalized(p.card) ? null : html };
      touch();
      $("#resetBtn").disabled = !isEdited(p.key);
    });
    $("#resetBtn").addEventListener("click", () => {
      edits[p.key] = { ...(edits[p.key] || {}), html: null };
      touch();
      renderWork();
    });
    $("#notes").addEventListener("input", (ev) => {
      edits[p.key] = { ...(edits[p.key] || { html: null }), notes: ev.target.value };
      touch();
    });
  }
  // the current card as the editor would serialise it, so "unchanged" compares like with like
  const normCache = new Map();
  function normalized(card) {
    if (normCache.has(card)) return normCache.get(card);
    const tmp = document.createElement("div");
    tmp.style.display = "none";
    document.body.appendChild(tmp);
    const body = mountCard(tmp, card, true, () => {});
    const out = dehydrate(body);
    tmp.remove();
    normCache.set(card, out);
    return out;
  }

  let navTimer = 0;
  function touch() {
    dirty = true;
    saveDraft();
    updateSave();
    clearTimeout(navTimer);
    navTimer = setTimeout(renderNav, 250);
  }

  // ---------- saving: the page republishes itself with the edits inside ----------
  let artifactApi = null;
  let saving = false;
  function updateSave() {
    const btn = $("#saveBtn"), st = $("#saveStatus");
    const edited = PATTERNS.filter((p) => isEdited(p.key)).length;
    btn.disabled = saving || !dirty || !artifactApi;
    if (saving) { st.textContent = "Saving…"; return; }
    const when = SAVED.savedAt ? new Date(SAVED.savedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
    if (dirty) st.textContent = `Unsaved changes · ${edited} card${edited === 1 ? "" : "s"} edited`;
    else st.textContent = SAVED.version ? `Version ${SAVED.version}${when ? ` · saved ${when}` : ""}` : "No edits saved yet";
    if (!artifactApi && dirty) st.textContent += " · saving isn't available in this view";
  }

  const jsonForScript = (o) => JSON.stringify(o).replace(/</g, "\\u003c");
  const RESET = document.getElementById("cc-reset").textContent;
  function buildDocument(state) {
    const parts = [
      document.querySelector("title").outerHTML,
      `<meta name="claude:viewport-fit-sides" content="cover">`,
      document.getElementById("cc-fonts").outerHTML,
      document.getElementById("cc-style").outerHTML,
      `<div id="app"></div>`,
      `<script type="application/json" id="cc-data">${jsonForScript(DATA)}<\/script>`,
      `<script type="application/json" id="cc-state">${jsonForScript(state)}<\/script>`,
      `<script type="text/plain" id="cc-reset">${RESET}<\/script>`,
      `<script id="cc-app">${document.getElementById("cc-app").textContent}<\/script>`,
    ];
    return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${RESET}</style></head><body>${parts.join("\n")}</body></html>`;
  }

  $("#saveBtn").addEventListener("click", async () => {
    if (!artifactApi || saving) return;
    saving = true; updateSave();
    const clean = {};
    for (const [k, v] of Object.entries(edits)) {
      if ((v.html !== null && v.html !== undefined) || (v.notes && v.notes.trim())) clean[k] = { html: v.html ?? null, notes: v.notes || "" };
    }
    const state = { version: (SAVED.version || 0) + 1, savedAt: new Date().toISOString(), edits: clean };
    try {
      await artifactApi.publish(buildDocument(state));
      clearDraft();
    } catch (err) {
      saving = false;
      const code = err && err.code;
      $("#saveStatus").textContent = code === "conflict" ? "Someone saved first. The page will reload with their version; your edits are kept as a draft."
        : code === "not_granted" || code === "not_writer" ? "You can view this page but not save it."
        : "Couldn't save. Your edits are kept here as a draft; try again.";
      $("#saveBtn").disabled = false;
    }
  });

  $("#nav").addEventListener("click", (e) => {
    const b = e.target.closest(".nav-item");
    if (!b) return;
    selected = b.dataset.key;
    try { localStorage.setItem("cc-selected", selected); } catch { /* no storage */ }
    renderNav(); renderWork();
    if (matchMedia("(max-width: 900px)").matches) $("#work").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  renderNav();
  renderWork();
  updateSave();
  if (window.claude && typeof window.claude.use === "function") {
    window.claude.use("artifact").then((a) => { artifactApi = a; updateSave(); }).catch(() => {});
  }
})();
