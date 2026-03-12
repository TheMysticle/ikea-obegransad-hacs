/**
 * IKEA OBEGRÄNSAD Custom Lovelace Card
 * Mushroom-style compact card with hold-to-open detail sheet
 * Drop in: config/www/ikea-obegransad-card.js
 */

// ── Editor ─────────────────────────────────────────────────────────────────────

class IkeaObegransadCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (Object.keys(this._config).length) this._render();
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  _render() {
    const v = (k) => this._config[k] || "";
    this.shadowRoot.innerHTML = `
      <style>
        .editor { display:flex; flex-direction:column; gap:14px; padding:4px 0; }
        .row { display:flex; flex-direction:column; gap:4px; }
        label { font-size:.85rem; color:var(--secondary-text-color); }
        input[type=text] {
          padding:8px 10px; border-radius:8px;
          border:1px solid var(--divider-color,#e0e0e0);
          background:var(--card-background-color,#fff);
          color:var(--primary-text-color);
          font-size:.9rem; font-family:inherit; outline:none; width:100%;
        }
        input[type=text]:focus { border-color:var(--primary-color); }
        .hint { font-size:.72rem; color:var(--secondary-text-color); }
        h4 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em;
             color:var(--secondary-text-color); margin-top:4px; }
      </style>
      <div class="editor">
        <h4>Connection</h4>
        <div class="row">
          <label>Lamp IP Address</label>
          <input id="host" type="text" placeholder="192.168.1.200" value="${v("host")}">
          <span class="hint">Direct IP of your lamp</span>
        </div>
        <h4>Entities</h4>
        <div class="row">
          <label>Light entity</label>
          <ha-entity-picker id="entity_light" .hass=${this._hass}
            .value="${v("entity_light")}" .includeDomains=${["light"]} allow-custom-entity>
          </ha-entity-picker>
        </div>
        <div class="row">
          <label>Plugin select entity</label>
          <ha-entity-picker id="entity_select" .hass=${this._hass}
            .value="${v("entity_select")}" .includeDomains=${["select"]} allow-custom-entity>
          </ha-entity-picker>
        </div>
        <div class="row">
          <label>Scroll text entity</label>
          <ha-entity-picker id="entity_text" .hass=${this._hass}
            .value="${v("entity_text")}" .includeDomains=${["text"]} allow-custom-entity>
          </ha-entity-picker>
        </div>
        <div class="row">
          <label>Clear button entity</label>
          <ha-entity-picker id="entity_button" .hass=${this._hass}
            .value="${v("entity_button")}" .includeDomains=${["button"]} allow-custom-entity>
          </ha-entity-picker>
        </div>
        <h4>Appearance</h4>
        <div class="row">
          <label>Card name (optional)</label>
          <input id="name" type="text" placeholder="IKEA OBEGRÄNSAD" value="${v("name")}">
        </div>
      </div>`;

    this.shadowRoot.querySelector("#host")
      ?.addEventListener("change", () => this._fire());
    this.shadowRoot.querySelector("#name")
      ?.addEventListener("change", () => this._fire());
    ["entity_light","entity_select","entity_text","entity_button"].forEach(id =>
      this.shadowRoot.querySelector("#" + id)
        ?.addEventListener("value-changed", () => this._fire())
    );
  }

  _fire() {
    const g = id => (this.shadowRoot.querySelector("#" + id)?.value ?? "").trim();
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: { ...this._config,
        host: g("host"), name: g("name"),
        entity_light: g("entity_light"),
        entity_select: g("entity_select"),
        entity_text: g("entity_text"),
        entity_button: g("entity_button"),
      }},
      bubbles: true, composed: true,
    }));
  }
}

if (!customElements.get("ikea-obegransad-card-editor"))
  customElements.define("ikea-obegransad-card-editor", IkeaObegransadCardEditor);

// ── Main Card ──────────────────────────────────────────────────────────────────

class IkeaObegransadCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};
    this._ws = null;
    this._wsReconnectTimer = null;
    this._brightnessTimer = null;
    this._rendered = false;
    this._pixels = new Uint8Array(256).fill(0);
    this._indexMatrix = new Uint8Array([...Array(256)].map((_, i) => i));
    this._isDrawing = false;
    this._drawMode = null;
    this._lastDrawMode = false;
    // Hold detection
    this._holdTimer = null;
    this._holdTriggered = false;
  }

  static getConfigElement() { return document.createElement("ikea-obegransad-card-editor"); }
  static getStubConfig() {
    return { host:"192.168.1.200", name:"", entity_light:"", entity_select:"", entity_text:"", entity_button:"" };
  }
  getCardSize() { return 1; }

  setConfig(config) { this._config = config; this._rendered = false; }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._rendered = true;
      this._render();
      this._connectWs();
    } else {
      this._syncState();
    }
  }

  get _L() { return this._hass?.states[this._config.entity_light]; }
  get _S() { return this._hass?.states[this._config.entity_select]; }
  get _T() { return this._hass?.states[this._config.entity_text]; }
  get _B() { return this._hass?.states[this._config.entity_button]; }
  get _host() { return this._config.host || "192.168.1.200"; }
  get _isDrawMode() { return this._S?.state?.toLowerCase().includes("draw"); }

  connectedCallback()    { if (this._hass) this._connectWs(); }
  disconnectedCallback() { this._disconnectWs(); }

  // ── WebSocket ────────────────────────────────────────────────────────────────

  _connectWs() {
    this._disconnectWs();
    try {
      const ws = new WebSocket(`ws://${this._host}/ws`);
      this._ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ event: "info" }));
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.event === "info" && Array.isArray(msg.data) && msg.data.length === 256) {
            this._indexMatrix = new Uint8Array(msg.data);
          }
        } catch (_) {}
      };
      ws.onclose = () => {
        this._wsReconnectTimer = setTimeout(() => this._connectWs(), 3000);
      };
      ws.onerror = () => ws.close();
    } catch (_) {}
  }

  _disconnectWs() {
    if (this._wsReconnectTimer) { clearTimeout(this._wsReconnectTimer); this._wsReconnectTimer = null; }
    if (this._ws) { this._ws.onclose = null; this._ws.close(); this._ws = null; }
  }

  // ── Draw ─────────────────────────────────────────────────────────────────────

  _sendPixel(index, value) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ event: "led", index, status: value }));
    }
  }

  _drawCanvas() {
    const canvas = this.shadowRoot?.querySelector("#draw-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const S = canvas.width, cell = S / 16, r = cell * 0.34;
    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 256; i++) {
      const cx = (i % 16) * cell + cell / 2;
      const cy = Math.floor(i / 16) * cell + cell / 2;
      const on = this._pixels[i] > 0;
      if (on) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.9);
        g.addColorStop(0, "rgba(255,200,60,0.35)");
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(cx, cy, cell * 0.9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = on ? "hsl(42,100%,65%)" : "#1a1a1a";
      ctx.fill();
    }
  }

  _pixelFromEvent(e) {
    const canvas = this.shadowRoot.querySelector("#draw-canvas");
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const col = Math.floor((clientX - rect.left) / rect.width  * 16);
    const row = Math.floor((clientY - rect.top)  / rect.height * 16);
    if (col < 0 || col > 15 || row < 0 || row > 15) return -1;
    return row * 16 + col;
  }

  _handleDrawStart(e) {
    e.preventDefault();
    this._isDrawing = true;
    const idx = this._pixelFromEvent(e);
    if (idx < 0) return;
    this._drawMode = this._pixels[idx] > 0 ? "off" : "on";
    this._pixels[idx] = this._drawMode === "on" ? 255 : 0;
    this._drawCanvas();
    this._sendPixel(idx, this._pixels[idx]);
  }

  _handleDrawMove(e) {
    e.preventDefault();
    if (!this._isDrawing) return;
    const idx = this._pixelFromEvent(e);
    if (idx < 0) return;
    const newVal = this._drawMode === "on" ? 255 : 0;
    if (this._pixels[idx] === newVal) return;
    this._pixels[idx] = newVal;
    this._drawCanvas();
    this._sendPixel(idx, this._pixels[idx]);
  }

  _handleDrawEnd(e) {
    e.preventDefault();
    this._isDrawing = false;
    this._drawMode = null;
  }

  _clearCanvas() {
    this._pixels.fill(0);
    this._drawCanvas();
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ event: "clear" }));
    }
  }

  // ── Popup ─────────────────────────────────────────────────────────────────────

  _openPopup() {
    const popup = this.shadowRoot.querySelector("#popup-overlay");
    if (!popup) return;
    popup.classList.add("open");
    // Redraw canvas after it becomes visible
    requestAnimationFrame(() => {
      if (this._isDrawMode) this._drawCanvas();
    });
  }

  _closePopup() {
    const popup = this.shadowRoot.querySelector("#popup-overlay");
    popup?.classList.remove("open");
  }

  // ── Hold detection ────────────────────────────────────────────────────────────

  _onPointerDown(e) {
    const t = e.touches?.[0] ?? e;
    this._startX = t.clientX;
    this._startY = t.clientY;
    this._scrollCancelled = false;
    this._holdTriggered = false;
    this._holdTimer = setTimeout(() => {
      if (this._scrollCancelled) return;
      this._holdTriggered = true;
      this._openPopup();
    }, 500);
  }

  _onPointerMove(e) {
    if (this._scrollCancelled || (!this._holdTimer && !this._holdTriggered)) return;
    const t = e.touches?.[0] ?? e;
    const dx = t.clientX - this._startX;
    const dy = t.clientY - this._startY;
    if (Math.sqrt(dx * dx + dy * dy) > 10) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
      this._scrollCancelled = true;
    }
  }

  _onPointerUp(e) {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    if (!this._holdTriggered && !this._scrollCancelled) {
      const L = this._L;
      if (L) this._svc("light", "toggle", { entity_id: L.entity_id });
    }
    this._holdTriggered = false;
    this._scrollCancelled = false;
  }

  _onPointerCancel() {
    if (this._holdTimer) { clearTimeout(this._holdTimer); this._holdTimer = null; }
    this._holdTriggered = false;
    this._scrollCancelled = false;
  }

  // ── State sync ────────────────────────────────────────────────────────────────

  _syncState() {
    const L = this._L, S = this._S;
    const isOn = L?.state === "on";
    const brightness = L?.attributes?.brightness ?? 0;
    const pct = Math.round((brightness / 255) * 100);

    // ── Mushroom chip sync ────────────────────────────────────────────────────
    const icon     = this.shadowRoot.querySelector(".mush-icon");
    const iconEl   = this.shadowRoot.querySelector(".mush-icon ha-icon");
    const nameBadge = this.shadowRoot.querySelector(".mush-name");
    const badge    = this.shadowRoot.querySelector(".mush-badge");

    if (icon) {
      icon.classList.toggle("on", isOn);
      icon.classList.toggle("off", !isOn);
    }
    if (badge) badge.textContent = isOn ? `${pct}%` : "Off";

    // ── Popup brightness slider ───────────────────────────────────────────────
    const sl = this.shadowRoot.querySelector("#bs");
    const bl = this.shadowRoot.querySelector("#bl");
    if (sl && L && !sl.matches(":active")) {
      sl.value = brightness;
      if (bl) bl.textContent = pct + "%";
    }

    // ── Plugin select ─────────────────────────────────────────────────────────
    const ps = this.shadowRoot.querySelector("#ps");
    if (ps && S) {
      const opts = S.attributes?.options ?? [];
      if (ps.dataset.c !== String(opts.length)) {
        ps.innerHTML = opts.map(o => `<option value="${o}">${o}</option>`).join("");
        ps.dataset.c = opts.length;
      }
      if (!ps.matches(":focus")) ps.value = S.state;
    }

    // ── Draw / scroll sections ────────────────────────────────────────────────
    const inDraw = this._isDrawMode;
    const wasInDraw = this._lastDrawMode;
    this._lastDrawMode = inDraw;

    const drawSection   = this.shadowRoot.querySelector("#draw-section");
    const scrollSection = this.shadowRoot.querySelector("#scroll-section");
    if (drawSection && scrollSection) {
      drawSection.style.display   = inDraw ? "block" : "none";
      scrollSection.style.display = inDraw ? "none"  : "block";
      if (inDraw) this._drawCanvas();
    }

    // Boost brightness on draw entry
    if (inDraw && !wasInDraw && L) {
      if ((L.attributes?.brightness ?? 0) < 50) {
        this._svc("light", "turn_on", { entity_id: L.entity_id, brightness: 255 });
      }
    }

    // ── Warning chip ──────────────────────────────────────────────────────────
    const chip = this.shadowRoot.querySelector("#chip");
    if (chip) {
      const miss = [!L && "light", !S && "select"].filter(Boolean);
      if (miss.length) {
        chip.textContent = "⚠ Missing: " + miss.join(", ") + " — open card editor";
        chip.style.display = "block";
      } else if (L?.state === "unavailable") {
        chip.textContent = "⚠ Lamp unavailable";
        chip.style.display = "block";
      } else {
        chip.style.display = "none";
      }
    }
  }

  // ── Service calls ─────────────────────────────────────────────────────────────

  _svc(d, s, data) { this._hass?.callService(d, s, data); }

  // ── Render ────────────────────────────────────────────────────────────────────

  _render() {
    const L = this._L, S = this._S;
    const isOn = L?.state === "on";
    const brightness = L?.attributes?.brightness ?? 0;
    const pct = Math.round((brightness / 255) * 100);
    const plugins = S?.attributes?.options ?? [];
    const current = S?.state ?? "";
    const inDraw = this._isDrawMode;
    const cardName = this._config.name || "OBEGRÄNSAD";

    this.shadowRoot.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        :host { display:block; font-family:var(--primary-font-family,Roboto,sans-serif); }

        /* ── Mushroom-style compact card ── */
        ha-card {
          padding:10px;
          display:flex;
          align-items:center;
          gap:10px;
          cursor:pointer;
          user-select:none;
          -webkit-user-select:none;
          height:56px;
          overflow:hidden;
          transition:box-shadow .15s;
        }
        ha-card:active { box-shadow:0 0 0 2px var(--primary-color,#03a9f4) inset; }

        .mush-icon {
          width:36px; height:36px; min-width:36px; min-height:36px; border-radius:50%;
          display:flex; align-items:center; justify-content:center;
          flex-shrink:0;
          transition:background .25s, color .25s;
        }
        .mush-icon.on  { background:rgba(var(--rgb-state-light-active,255,193,7),.2); color:var(--state-light-active-color,#ffc107); }
        .mush-icon.off { background:var(--secondary-background-color,rgba(0,0,0,.06)); color:var(--secondary-text-color); }
        .mush-icon ha-icon { --mdc-icon-size:24px; display:flex; line-height:0; }

        .mush-info { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
        .mush-name { font-size:.92rem; font-weight:500; color:var(--primary-text-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .mush-badge { font-size:.78rem; color:var(--secondary-text-color); }

        .mush-hold-hint { font-size:.68rem; color:var(--disabled-text-color,#bbb); flex-shrink:0; padding:3px 7px; border:1px solid var(--divider-color,#e0e0e0); border-radius:20px; }

        #chip { display:none; font-size:.72rem; padding:3px 8px; background:var(--warning-color,#ff9800); color:white; border-radius:8px; }

        /* ── Popup overlay ── */
        #popup-overlay {
          position:fixed; inset:0; z-index:9999;
          background:rgba(0,0,0,0);
          pointer-events:none;
          transition:background .25s;
          display:flex; align-items:flex-end; justify-content:center;
        }
        #popup-overlay.open {
          background:rgba(0,0,0,.45);
          pointer-events:auto;
        }

        .popup-sheet {
          width:100%; max-width:480px;
          background:var(--card-background-color,#fff);
          border-radius:28px 28px 0 0;
          padding:0 0 env(safe-area-inset-bottom,0);
          transform:translateY(100%);
          transition:transform .3s cubic-bezier(.32,1,.6,1);
          max-height:92vh;
          overflow-y:auto;
          overscroll-behavior:contain;
        }
        #popup-overlay.open .popup-sheet { transform:translateY(0); }

        .sheet-handle {
          display:flex; justify-content:center; padding:12px 0 6px;
        }
        .sheet-handle::before {
          content:''; display:block; width:40px; height:4px;
          background:var(--divider-color,rgba(0,0,0,.12)); border-radius:2px;
        }

        .sheet-header {
          display:flex; align-items:center; justify-content:space-between;
          padding:4px 20px 14px;
          height:52px; box-sizing:border-box;
        }
        .sheet-title {
          display:flex; align-items:center; gap:10px;
          font-size:1rem; font-weight:600; color:var(--primary-text-color);
          flex:1; min-width:0;
        }
        .sheet-title ha-icon { color:var(--state-light-active-color,#ffc107); --mdc-icon-size:20px; display:flex; line-height:0; }

        .close-btn-wrap { width:32px; height:32px; min-width:32px; min-height:32px; flex-shrink:0; display:block; }
        .close-btn {
          display:block; width:32px; height:32px;
          border-radius:50%;
          background:var(--secondary-background-color,rgba(0,0,0,.06));
          border:none; cursor:pointer;
          padding:0; margin:0; line-height:0;
          color:var(--secondary-text-color);
          transition:background .15s;
          text-align:center;
        }
        .close-btn:hover { background:var(--divider-color,rgba(0,0,0,.12)); }
        .close-btn svg { display:inline-block; width:16px; height:16px; vertical-align:middle; pointer-events:none; }

        .sheet-body { padding:0 20px 24px; display:flex; flex-direction:column; gap:0; }

        .row-toggle {
          display:flex; align-items:center; justify-content:space-between;
          padding:10px 0 14px;
          border-bottom:1px solid var(--divider-color,rgba(0,0,0,.08));
          margin-bottom:14px;
        }
        .row-toggle-label { font-size:.9rem; color:var(--primary-text-color); }

        /* Toggle switch */
        .tog { position:relative; width:42px; height:24px; flex-shrink:0; cursor:pointer; }
        .tog input { position:absolute; opacity:0; width:0; height:0; }
        .trk { position:absolute; inset:0; border-radius:12px; background:var(--switch-unchecked-track-color,rgba(0,0,0,.26)); transition:background .2s; }
        .thb { position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:white; box-shadow:0 1px 3px rgba(0,0,0,.4); transition:transform .2s; pointer-events:none; }
        input:checked + .trk { background:var(--state-light-active-color,#ffc107); }
        input:checked ~ .thb { transform:translateX(18px); }

        .lbl { font-size:.72rem; font-weight:500; letter-spacing:.06em; text-transform:uppercase; color:var(--secondary-text-color); margin-bottom:8px; }

        .br { display:flex; align-items:center; gap:8px; margin-bottom:18px; }
        .br ha-icon { color:var(--secondary-text-color); flex-shrink:0; --mdc-icon-size:18px; }
        .bv { font-size:.82rem; color:var(--secondary-text-color); min-width:34px; text-align:right; }
        input[type=range] { flex:1; min-width:0; -webkit-appearance:none; appearance:none; height:4px; border-radius:2px; background:var(--secondary-background-color,#e0e0e0); outline:none; cursor:pointer; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:20px; height:20px; border-radius:50%; background:var(--state-light-active-color,#ffc107); box-shadow:0 1px 3px rgba(0,0,0,.3); cursor:pointer; }

        .section-divider { border:none; border-top:1px solid var(--divider-color,rgba(0,0,0,.08)); margin:4px 0 16px; }

        select { width:100%; padding:10px 32px 10px 12px; border-radius:10px; border:1px solid var(--divider-color,#e0e0e0); background:var(--card-background-color,#fff) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath fill='%23888' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E") no-repeat right 10px center; color:var(--primary-text-color); font-size:.95rem; font-family:inherit; cursor:pointer; outline:none; appearance:none; margin-bottom:18px; }
        select:focus { border-color:var(--primary-color); }

        #draw-section { display:${inDraw ? "block" : "none"}; }
        .canvas-wrap { width:100%; aspect-ratio:1; border-radius:12px; overflow:hidden; background:#0d0d0d; margin-bottom:10px; touch-action:none; cursor:crosshair; }
        #draw-canvas { width:100%; height:100%; display:block; }
        .draw-hint { font-size:.75rem; color:var(--secondary-text-color); margin-bottom:8px; }

        #scroll-section { display:${inDraw ? "none" : "block"}; }
        input[type=text] { width:100%; padding:10px 12px; border-radius:10px; border:1px solid var(--divider-color,#e0e0e0); background:var(--card-background-color,#fff); color:var(--primary-text-color); font-size:.95rem; font-family:inherit; outline:none; margin-bottom:8px; }
        input[type=text]:focus { border-color:var(--primary-color); }
        .prms { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; }
        .plbl { font-size:.72rem; color:var(--secondary-text-color); margin-bottom:3px; }
        input[type=number] { width:100%; padding:9px 10px; border-radius:10px; border:1px solid var(--divider-color,#e0e0e0); background:var(--card-background-color,#fff); color:var(--primary-text-color); font-size:.9rem; font-family:inherit; outline:none; }
        input[type=number]:focus { border-color:var(--primary-color); }

        .btnr { display:flex; gap:8px; }
        button { flex:1; padding:10px 12px; border:none; border-radius:10px; font-size:.9rem; font-family:inherit; font-weight:500; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px; transition:opacity .15s; min-height:44px; }
        button:disabled { opacity:.45; cursor:not-allowed; }
        .btn-primary  { background:var(--primary-color,#03a9f4); color:white; }
        .btn-primary:hover:not(:disabled)  { opacity:.85; }
        .btn-secondary { background:var(--secondary-background-color,#f5f5f5); color:var(--primary-text-color); border:1px solid var(--divider-color,#e0e0e0); }
        .btn-secondary:hover:not(:disabled) { background:var(--divider-color,#e0e0e0); }
      </style>

      <!-- Compact mushroom-style card -->
      <ha-card id="main-card">
        <div class="mush-icon ${isOn ? "on" : "off"}">
          <ha-icon icon="mdi:led-strip-variant"></ha-icon>
        </div>
        <div class="mush-info">
          <div class="mush-name">${cardName}</div>
          <div class="mush-badge">${isOn ? pct + "%" : "Off"}</div>
        </div>
        <div id="chip"></div>
        <div class="mush-hold-hint">Hold</div>
      </ha-card>

      <!-- Popup overlay + bottom sheet -->
      <div id="popup-overlay">
        <div class="popup-sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-header">
            <div class="sheet-title">
              <ha-icon icon="mdi:led-strip-variant"></ha-icon>
              ${cardName}
            </div>
            <div class="close-btn-wrap">
              <button class="close-btn" id="close-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="sheet-body">
            <!-- Power toggle -->
            <div class="row-toggle">
              <span class="row-toggle-label">Power</span>
              <label class="tog">
                <input type="checkbox" id="pt" ${isOn ? "checked" : ""}>
                <span class="trk"></span>
                <span class="thb"></span>
              </label>
            </div>

            <!-- Brightness -->
            <div class="lbl">Brightness</div>
            <div class="br">
              <ha-icon icon="mdi:brightness-4"></ha-icon>
              <input type="range" id="bs" min="0" max="255" value="${brightness}">
              <ha-icon icon="mdi:brightness-7"></ha-icon>
              <span class="bv" id="bl">${pct}%</span>
            </div>

            <hr class="section-divider">

            <!-- Plugin select -->
            <div class="lbl">Active Display</div>
            <select id="ps" data-c="${plugins.length}">
              ${plugins.map(p => `<option value="${p}"${p === current ? " selected" : ""}>${p}</option>`).join("")}
            </select>

            <!-- Draw mode -->
            <div id="draw-section">
              <hr class="section-divider">
              <div class="lbl">Draw</div>
              <div class="draw-hint">Click or drag to toggle pixels</div>
              <div class="canvas-wrap">
                <canvas id="draw-canvas" width="320" height="320"></canvas>
              </div>
              <div class="btnr">
                <button class="btn-secondary" id="clear-draw-btn">
                  <ha-icon icon="mdi:eraser"></ha-icon> Clear
                </button>
              </div>
            </div>

            <!-- Scroll text -->
            <div id="scroll-section">
              <hr class="section-divider">
              <div class="lbl">Scroll Text</div>
              <input type="text" id="si" placeholder="Type a message…" maxlength="255">
              <div class="prms">
                <div><div class="plbl">Speed (ms, lower = faster)</div><input type="number" id="sd" value="50" min="10" max="500" step="5"></div>
                <div><div class="plbl">Repeat (−1 = ∞)</div><input type="number" id="sr" value="-1" min="-1" max="100"></div>
              </div>
              <div class="btnr">
                <button class="btn-primary"   id="sb"><ha-icon icon="mdi:send"></ha-icon>Send</button>
                <button class="btn-secondary" id="cb"><ha-icon icon="mdi:close"></ha-icon>Clear</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;

    this._drawCanvas();
    this._syncState();
    this._attachListeners();
  }

  _attachListeners() {
    const q = id => this.shadowRoot.querySelector(id);

    // ── Mushroom card hold / tap ──────────────────────────────────────────────
    const card = q("#main-card");
    card.addEventListener("mousedown",   e => { if (this._isTouchInteraction) return; this._onPointerDown(e); });
    card.addEventListener("touchstart",  e => { this._isTouchInteraction = true; this._onPointerDown(e); }, { passive: true });
    card.addEventListener("mousemove",   e => this._onPointerMove(e));
    card.addEventListener("touchmove",   e => this._onPointerMove(e), { passive: true });
    card.addEventListener("mouseup",     e => { if (this._isTouchInteraction) { this._isTouchInteraction = false; return; } this._onPointerUp(e); });
    card.addEventListener("touchend",    e => this._onPointerUp(e));
    card.addEventListener("mouseleave",  e => this._onPointerCancel(e));
    card.addEventListener("touchcancel", e => this._onPointerCancel(e));

    // ── Close button / backdrop ───────────────────────────────────────────────
    q("#close-btn").addEventListener("click", () => this._closePopup());
    q("#popup-overlay").addEventListener("click", e => {
      if (e.target === q("#popup-overlay")) this._closePopup();
    });

    // ── Power toggle ──────────────────────────────────────────────────────────
    q("#pt").addEventListener("change", e => {
      const L = this._L; if (!L) return;
      this._svc("light", "toggle", { entity_id: L.entity_id });
    });

    // ── Brightness ────────────────────────────────────────────────────────────
    q("#bs").addEventListener("input", e => {
      const v = e.target.value;
      q("#bl").textContent = Math.round((v / 255) * 100) + "%";
      clearTimeout(this._brightnessTimer);
      this._brightnessTimer = setTimeout(() => {
        const L = this._L; if (!L) return;
        this._svc("light", "turn_on", { entity_id: L.entity_id, brightness: parseInt(v) });
      }, 180);
    });

    // ── Plugin select ─────────────────────────────────────────────────────────
    q("#ps").addEventListener("change", e => {
      const S = this._S; if (!S) return;
      this._svc("select", "select_option", { entity_id: S.entity_id, option: e.target.value });
    });

    // ── Draw canvas ───────────────────────────────────────────────────────────
    const canvas = q("#draw-canvas");
    if (canvas) {
      canvas.addEventListener("mousedown",  e => this._handleDrawStart(e));
      canvas.addEventListener("mousemove",  e => this._handleDrawMove(e));
      canvas.addEventListener("mouseup",    e => this._handleDrawEnd(e));
      canvas.addEventListener("mouseleave", e => this._handleDrawEnd(e));
      canvas.addEventListener("touchstart", e => this._handleDrawStart(e), { passive: false });
      canvas.addEventListener("touchmove",  e => this._handleDrawMove(e),  { passive: false });
      canvas.addEventListener("touchend",   e => this._handleDrawEnd(e),   { passive: false });
    }
    q("#clear-draw-btn")?.addEventListener("click", () => this._clearCanvas());

    // ── Scroll text ───────────────────────────────────────────────────────────
    const send = async () => {
      const value = q("#si")?.value?.trim() ?? "";
      if (!value) {
        try { await fetch(`http://${this._host}/api/removemessage?id=0`, { signal: AbortSignal.timeout(3000), cache: "no-store" }); } catch (_) {}
        q("#si").value = "";
        return;
      }
      const delay  = parseInt(q("#sd")?.value ?? "50");
      const repeat = parseInt(q("#sr")?.value ?? "-1");
      q("#sb").disabled = true;
      try { await fetch(`http://${this._host}/api/message?text=${encodeURIComponent(value)}&repeat=${repeat}&delay=${delay}`, { signal: AbortSignal.timeout(3000), cache: "no-store" }); } catch (_) {}
      setTimeout(() => { q("#sb").disabled = false; }, 600);
    };

    q("#sb")?.addEventListener("click", send);
    q("#si")?.addEventListener("keydown", e => { if (e.key === "Enter") send(); });

    q("#cb")?.addEventListener("click", async () => {
      const T = this._T;
      if (T) this._svc("text", "set_value", { entity_id: T.entity_id, value: "" });
      try { await fetch(`http://${this._host}/api/removemessage?id=0`, { signal: AbortSignal.timeout(3000), cache: "no-store" }); } catch (_) {}
      q("#si").value = "";
    });
  }
}

if (!customElements.get("ikea-obegransad-card"))
  customElements.define("ikea-obegransad-card", IkeaObegransadCard);

window.customCards = window.customCards || [];
if (!window.customCards.find(c => c.type === "ikea-obegransad-card"))
  window.customCards.push({ type:"ikea-obegransad-card", name:"IKEA OBEGRÄNSAD", description:"Mushroom-style card with hold-to-open detail sheet." });