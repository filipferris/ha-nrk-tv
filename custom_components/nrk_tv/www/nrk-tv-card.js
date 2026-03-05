/**
 * NRK TV Custom Lovelace Card
 * Replicates the NRK TV browsing experience from tv.nrk.no
 * Uses HA websocket API to proxy NRK PSAPI calls (geo-blocked).
 */

const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace") ?? customElements.get("hui-view")
);
const html = LitElement?.prototype.html ?? ((s, ...v) => {
  const t = document.createElement("template");
  t.innerHTML = v.reduce((a, val, i) => a + val + s[i + 1], s[0]);
  return t;
});
const css = LitElement?.prototype.css ?? ((s, ...v) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(v.reduce((a, val, i) => a + val + s[i + 1], s[0]));
  return sheet;
});

const LIVE_CHANNELS = [
  { id: "nrk1", name: "NRK1", color: "#2a4fa0" },
  { id: "nrk2", name: "NRK2", color: "#5c2d91" },
  { id: "nrk3", name: "NRK3", color: "#d35400" },
  { id: "nrksuper", name: "NRK Super", color: "#e74c3c" },
];

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='180' fill='%23253550'%3E%3Crect width='320' height='180'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%23556' font-size='14'%3ENRK%3C/text%3E%3C/svg%3E";

class NrkTvCard extends HTMLElement {
  // --- HA card registration ---
  static getConfigElement() {
    return document.createElement("nrk-tv-card-editor");
  }

  static getStubConfig() {
    return {
      media_player: "media_player.living_room_tv",
      profiles: [
        { name: "Parent", content_group: "adults", color: "#4a90d9" },
        { name: "Child 1", content_group: "children", avatar: "🐕", color: "#ff69b4" },
        { name: "Child 2", content_group: "children", avatar: "🦌", color: "#44cc88" },
      ],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass = null;
    this._config = {};
    this._activeProfile = 0;
    this._sections = [];
    this._loading = false;
    this._cache = {};
    this._overlay = null; // { series, seasons, episodes, selectedSeason }
    this._error = null;
  }

  set hass(hass) {
    this._hass = hass;
    // Initial load on first hass assignment
    if (!this._initialLoaded) {
      this._initialLoaded = true;
      this._loadContent();
    }
  }

  setConfig(config) {
    if (!config.media_player) {
      throw new Error("Please define a media_player entity");
    }
    this._config = {
      profiles: [
        { name: "Parent", content_group: "adults", color: "#4a90d9" },
        { name: "Child 1", content_group: "children", avatar: "🐕", color: "#ff69b4" },
        { name: "Child 2", content_group: "children", avatar: "🦌", color: "#44cc88" },
      ],
      ...config,
    };
    this._activeProfile = 0;
    this._render();
  }

  getCardSize() {
    return 8;
  }

  // --- Data Fetching ---

  _currentContentGroup() {
    const profile = this._config.profiles[this._activeProfile];
    return profile?.content_group ?? "adults";
  }

  _cacheKey() {
    return this._currentContentGroup();
  }

  async _loadContent() {
    const key = this._cacheKey();
    if (this._cache[key]) {
      this._sections = this._cache[key];
      this._error = null;
      this._render();
      return;
    }

    this._loading = true;
    this._error = null;
    this._render();

    try {
      const group = this._currentContentGroup();
      const page = group === "children" ? "barn" : "frontpage";
      const result = await this._hass.callWS({
        type: "nrk_tv/browse",
        content_group: group,
        page,
      });

      // PSAPI returns { sections: [ { title, included: { plugs: [...] } } ] }
      const sections = this._parseSections(result);
      this._cache[key] = sections;
      this._sections = sections;
    } catch (err) {
      console.warn("NRK TV Card: WS browse failed, using fallback sections", err);
      this._sections = this._fallbackSections();
      this._error = "Kunne ikke laste innhold fra NRK";
    }

    this._loading = false;
    this._render();
  }

  _parseSections(result) {
    if (!result) return this._fallbackSections();

    // Handle pre-parsed response from WS handler: { sections: [{ title, shows: [...] }] }
    const raw = result.sections ?? result.data?.sections ?? [];
    if (!raw.length) return this._fallbackSections();

    return raw
      .filter((s) => (s.shows?.length || s.included?.plugs?.length || s.plugs?.length))
      .slice(0, 8)
      .map((s) => ({
        title: s.title ?? s.displayContractContent?.title ?? "Innhold",
        items: (s.shows ?? s.included?.plugs ?? s.plugs ?? []).map((p) => this._parseShowItem(p)),
      }));
  }

  _parseShowItem(item) {
    // Handle pre-parsed items from WS handler: { title, series_id, image, prf_id }
    if (item.series_id !== undefined) {
      return {
        id: item.series_id || item.prf_id || "",
        title: item.title || "",
        subtitle: "",
        image: item.image || PLACEHOLDER_IMAGE,
        type: item.series_id ? "series" : "episode",
        seriesId: item.series_id || "",
        episodeId: item.prf_id || "",
      };
    }
    return this._parsePlug(item);
  }

  _parsePlug(plug) {
    const target = plug.targetSeries ?? plug.series ?? plug.target ?? plug;
    const images = plug.displayContractContent?.contentImage ?? plug.image ?? [];
    const imageUrl = this._pickImage(images) ?? plug.imageUrl ?? PLACEHOLDER_IMAGE;
    return {
      id: target.id ?? plug.id ?? "",
      title:
        plug.displayContractContent?.contentTitle ??
        plug.title ??
        target.title ??
        "",
      subtitle:
        plug.displayContractContent?.description ??
        plug.subtitle ??
        "",
      image: imageUrl,
      type: plug.targetType ?? plug.type ?? "series",
      seriesId: target.id ?? plug.seriesId ?? "",
      episodeId: plug.episodeId ?? plug.targetEpisode?.id ?? "",
    };
  }

  _pickImage(images) {
    if (typeof images === "string") return images;
    if (!Array.isArray(images) || images.length === 0) return null;
    const wide = images.find((i) => i.width >= 640) ?? images[0];
    return wide?.url ?? wide?.uri ?? null;
  }

  _fallbackSections() {
    const group = this._currentContentGroup();
    if (group === "children") {
      return [
        {
          title: "Populært for barn",
          items: [
            { id: "laeransen", title: "Lansen Lansen", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "laeransen" },
            { id: "fantorangen", title: "Fantorangen", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "fantorangen" },
            { id: "jul-i-blaafjell", title: "Jul i Blåfjell", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "jul-i-blaafjell" },
            { id: "barnas-supershow", title: "Barnas supershow", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "barnas-supershow" },
          ],
        },
        {
          title: "For de minste",
          items: [
            { id: "bolansen", title: "Bolla ogansen", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "bolansen" },
            { id: "dansen", title: "Dansen", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "dansen" },
          ],
        },
      ];
    }
    return [
      {
        title: "Populært akkurat nå",
        items: [
          { id: "exit", title: "Exit", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "exit" },
          { id: "lykkeland", title: "Lykkeland", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "lykkeland" },
          { id: "side-om-side", title: "Side om side", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "side-om-side" },
          { id: "nytt-paa-nytt", title: "Nytt på nytt", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "nytt-paa-nytt" },
        ],
      },
      {
        title: "Dokumentar",
        items: [
          { id: "brennpunkt", title: "Brennpunkt", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "brennpunkt" },
          { id: "folkeopplysningen", title: "Folkeopplysningen", image: PLACEHOLDER_IMAGE, type: "series", seriesId: "folkeopplysningen" },
        ],
      },
    ];
  }

  // --- Series / Episode Browsing ---

  async _openSeries(item) {
    this._overlay = {
      title: item.title,
      seriesId: item.seriesId || item.id,
      seasons: null,
      episodes: null,
      selectedSeason: null,
      loading: true,
    };
    this._render();

    try {
      const result = await this._hass.callWS({
        type: "nrk_tv/series",
        series_id: item.seriesId || item.id,
      });

      const seasons =
        result?.seasons ??
        result?.data?._embedded?.seasons ??
        result?._embedded?.seasons ??
        [];
      this._overlay.seasons = seasons.map((s, i) => ({
        number: s.sequenceNumber ?? s.number ?? i + 1,
        title: s.title ?? `Sesong ${i + 1}`,
        id: s.id ?? `${i + 1}`,
        episodeCount: s.episodeCount ?? s.episodes?.length ?? 0,
      }));
      this._overlay.loading = false;

      if (this._overlay.seasons.length > 0) {
        this._selectSeason(this._overlay.seasons[0]);
      } else {
        this._render();
      }
    } catch (err) {
      console.warn("NRK TV Card: Failed to load series", err);
      this._overlay.loading = false;
      this._overlay.error = "Kunne ikke laste serie";
      this._render();
    }
  }

  async _selectSeason(season) {
    if (!this._overlay) return;
    this._overlay.selectedSeason = season.number;
    this._overlay.episodes = null;
    this._overlay.loading = true;
    this._render();

    try {
      const result = await this._hass.callWS({
        type: "nrk_tv/episodes",
        series_id: this._overlay.seriesId,
        season: season.number,
      });

      const episodes =
        result?.episodes ??
        result?.data?._embedded?.episodes ??
        result?._embedded?.episodes ??
        [];
      this._overlay.episodes = episodes.map((ep) => ({
        id: ep.prfId ?? ep.id ?? "",
        title: ep.title ?? ep.titles?.title ?? "",
        subtitle: ep.titles?.subtitle ?? ep.subtitle ?? "",
        image: this._pickImage(ep.image) ?? ep.imageUrl ?? PLACEHOLDER_IMAGE,
        duration: ep.duration ?? "",
      }));
    } catch (err) {
      console.warn("NRK TV Card: Failed to load episodes", err);
      this._overlay.episodes = [];
      this._overlay.error = "Kunne ikke laste episoder";
    }

    this._overlay.loading = false;
    this._render();
  }

  _closeOverlay() {
    this._overlay = null;
    this._render();
  }

  // --- Playback ---

  _playChannel(channelId) {
    if (!this._hass || !this._config.media_player) return;
    this._hass.callService("media_player", "play_media", {
      entity_id: this._config.media_player,
      media_content_id: `media-source://nrk_tv/channel/${channelId}`,
      media_content_type: "video",
    });
  }

  _playEpisode(episodeId) {
    if (!this._hass || !this._config.media_player || !episodeId) return;
    this._hass.callService("media_player", "play_media", {
      entity_id: this._config.media_player,
      media_content_id: `media-source://nrk_tv/episode/${episodeId}`,
      media_content_type: "video",
    });
  }

  _handleItemClick(item) {
    if (item.type === "episode" && item.episodeId) {
      this._playEpisode(item.episodeId);
    } else {
      this._openSeries(item);
    }
  }

  // --- Profile Switching ---

  _selectProfile(index) {
    if (this._activeProfile === index) return;
    this._activeProfile = index;
    this._overlay = null;
    this._loadContent();
  }

  // --- Rendering ---

  _render() {
    const profiles = this._config.profiles ?? [];
    const isChildren = this._currentContentGroup() === "children";

    this.shadowRoot.innerHTML = `
      <style>${this._styles(isChildren)}</style>
      <ha-card>
        <div class="nrk-card">
          ${this._renderHeader(profiles)}
          ${this._renderChannels()}
          <div class="content-area">
            ${this._error ? `<div class="error-banner">${this._error}</div>` : ""}
            ${this._loading ? this._renderSkeleton() : this._renderSections()}
          </div>
          ${this._overlay ? this._renderOverlay() : ""}
        </div>
      </ha-card>
    `;
    this._attachEvents();
  }

  _renderHeader(profiles) {
    return `
      <div class="header">
        <div class="logo">
          <svg viewBox="0 0 100 30" width="64" height="20">
            <text x="0" y="22" font-family="Arial,sans-serif" font-weight="bold"
                  font-size="22" fill="white">NRK</text>
            <text x="58" y="22" font-family="Arial,sans-serif" font-weight="400"
                  font-size="16" fill="#aaa">TV</text>
          </svg>
        </div>
        <div class="profiles">
          ${profiles.map((p, i) => `
            <button class="profile-btn ${i === this._activeProfile ? "active" : ""}"
                    data-profile="${i}"
                    style="--profile-color: ${p.color ?? "#4a90d9"}">
              <span class="avatar">${p.avatar ?? p.name.charAt(0)}</span>
              <span class="profile-name">${p.name}</span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  _renderChannels() {
    return `
      <div class="channels-row">
        ${LIVE_CHANNELS.map((ch) => `
          <button class="channel-btn" data-channel="${ch.id}"
                  style="background: ${ch.color}">
            <span class="play-icon">▶</span>
            <span>${ch.name}</span>
          </button>
        `).join("")}
      </div>
    `;
  }

  _renderSkeleton() {
    const row = `
      <div class="section">
        <div class="section-title skeleton-text" style="width:140px">&nbsp;</div>
        <div class="scroll-row">
          ${Array(4).fill('<div class="show-card skeleton"><div class="thumb skeleton-thumb"></div><div class="card-title skeleton-text">&nbsp;</div></div>').join("")}
        </div>
      </div>
    `;
    return row + row;
  }

  _renderSections() {
    if (!this._sections.length) {
      return '<div class="empty-state">Ingen innhold tilgjengelig</div>';
    }
    return this._sections
      .map(
        (section) => `
      <div class="section">
        <div class="section-title">${this._esc(section.title)}</div>
        <div class="scroll-row">
          ${section.items
            .map(
              (item) => `
            <button class="show-card" data-item-id="${this._esc(item.id)}"
                    data-series-id="${this._esc(item.seriesId ?? "")}"
                    data-episode-id="${this._esc(item.episodeId ?? "")}"
                    data-type="${this._esc(item.type ?? "series")}">
              <div class="thumb">
                <img src="${this._esc(item.image)}" alt="${this._esc(item.title)}"
                     loading="lazy" onerror="this.src='${PLACEHOLDER_IMAGE}'">
              </div>
              <div class="card-title">${this._esc(item.title)}</div>
              ${item.subtitle ? `<div class="card-subtitle">${this._esc(item.subtitle)}</div>` : ""}
            </button>
          `
            )
            .join("")}
        </div>
      </div>
    `
      )
      .join("");
  }

  _renderOverlay() {
    const o = this._overlay;
    return `
      <div class="overlay" data-overlay-backdrop>
        <div class="overlay-panel">
          <div class="overlay-header">
            <h2>${this._esc(o.title)}</h2>
            <button class="close-btn" data-close-overlay>✕</button>
          </div>
          ${o.loading ? '<div class="overlay-loading"><div class="spinner"></div></div>' : ""}
          ${o.error ? `<div class="error-banner">${o.error}</div>` : ""}
          ${o.seasons && o.seasons.length > 0 ? this._renderSeasonTabs(o) : ""}
          ${o.episodes ? this._renderEpisodeList(o) : ""}
        </div>
      </div>
    `;
  }

  _renderSeasonTabs(o) {
    return `
      <div class="season-tabs">
        ${o.seasons
          .map(
            (s) => `
          <button class="season-tab ${s.number === o.selectedSeason ? "active" : ""}"
                  data-season="${s.number}">
            ${this._esc(s.title)}
          </button>
        `
          )
          .join("")}
      </div>
    `;
  }

  _renderEpisodeList(o) {
    if (!o.episodes || o.episodes.length === 0) {
      return '<div class="empty-state">Ingen episoder funnet</div>';
    }
    return `
      <div class="episode-list">
        ${o.episodes
          .map(
            (ep) => `
          <button class="episode-row" data-play-episode="${this._esc(ep.id)}">
            <div class="ep-thumb">
              <img src="${this._esc(ep.image)}" alt="${this._esc(ep.title)}"
                   loading="lazy" onerror="this.src='${PLACEHOLDER_IMAGE}'">
              <div class="ep-play-icon">▶</div>
            </div>
            <div class="ep-info">
              <div class="ep-title">${this._esc(ep.title)}</div>
              ${ep.subtitle ? `<div class="ep-subtitle">${this._esc(ep.subtitle)}</div>` : ""}
              ${ep.duration ? `<div class="ep-duration">${this._esc(ep.duration)}</div>` : ""}
            </div>
          </button>
        `
          )
          .join("")}
      </div>
    `;
  }

  _esc(str) {
    if (!str) return "";
    const d = document.createElement("div");
    d.textContent = String(str);
    return d.innerHTML;
  }

  // --- Event Binding ---

  _attachEvents() {
    const root = this.shadowRoot;

    // Profile buttons
    root.querySelectorAll(".profile-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._selectProfile(parseInt(btn.dataset.profile, 10));
      });
    });

    // Channel buttons
    root.querySelectorAll(".channel-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._playChannel(btn.dataset.channel);
      });
    });

    // Show cards
    root.querySelectorAll(".show-card[data-item-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._handleItemClick({
          id: btn.dataset.itemId,
          seriesId: btn.dataset.seriesId,
          episodeId: btn.dataset.episodeId,
          type: btn.dataset.type,
          title: btn.querySelector(".card-title")?.textContent ?? "",
        });
      });
    });

    // Overlay close
    root.querySelector("[data-close-overlay]")?.addEventListener("click", () => this._closeOverlay());
    root.querySelector("[data-overlay-backdrop]")?.addEventListener("click", (e) => {
      if (e.target.hasAttribute("data-overlay-backdrop")) this._closeOverlay();
    });

    // Season tabs
    root.querySelectorAll(".season-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const num = parseInt(btn.dataset.season, 10);
        const season = this._overlay?.seasons?.find((s) => s.number === num);
        if (season) this._selectSeason(season);
      });
    });

    // Episode play
    root.querySelectorAll("[data-play-episode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        this._playEpisode(btn.dataset.playEpisode);
      });
    });
  }

  // --- Styles ---

  _styles(isChildren) {
    const bg = isChildren ? "#1a2540" : "#1b2838";
    return `
      :host {
        display: block;
      }
      ha-card {
        overflow: hidden;
        background: transparent !important;
        border: none !important;
        box-shadow: none !important;
      }
      .nrk-card {
        background: ${bg};
        border-radius: 16px;
        overflow: hidden;
        position: relative;
        font-family: "Segoe UI", Roboto, Arial, sans-serif;
        color: #e0e6ed;
        transition: background 0.4s ease;
      }

      /* --- Header --- */
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px 8px;
      }
      .logo svg { display: block; }
      .profiles {
        display: flex;
        gap: 8px;
      }
      .profile-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        background: none;
        border: 2px solid transparent;
        border-radius: 12px;
        padding: 6px 10px;
        cursor: pointer;
        transition: all 0.25s ease;
        color: #a0aec0;
      }
      .profile-btn:hover {
        background: rgba(255,255,255,0.06);
      }
      .profile-btn.active {
        border-color: var(--profile-color);
        color: #fff;
        background: rgba(255,255,255,0.08);
      }
      .avatar {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: var(--profile-color);
        font-size: 18px;
        color: #fff;
        font-weight: 700;
      }
      .profile-name {
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
      }

      /* --- Channels --- */
      .channels-row {
        display: flex;
        gap: 8px;
        padding: 8px 20px 12px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .channels-row::-webkit-scrollbar { display: none; }
      .channel-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border: none;
        border-radius: 10px;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: transform 0.15s ease, filter 0.15s ease;
        flex-shrink: 0;
      }
      .channel-btn:hover {
        filter: brightness(1.15);
        transform: scale(1.04);
      }
      .channel-btn:active { transform: scale(0.97); }
      .play-icon {
        font-size: 10px;
        opacity: 0.85;
      }

      /* --- Content Area --- */
      .content-area {
        padding: 4px 0 16px;
      }

      /* --- Sections --- */
      .section {
        margin-bottom: 16px;
      }
      .section-title {
        font-size: 16px;
        font-weight: 700;
        padding: 4px 20px 8px;
        color: #fff;
      }
      .scroll-row {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding: 0 20px;
        scroll-snap-type: x mandatory;
        scrollbar-width: none;
        -webkit-overflow-scrolling: touch;
      }
      .scroll-row::-webkit-scrollbar { display: none; }

      /* --- Show Cards --- */
      .show-card {
        flex: 0 0 auto;
        width: 155px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        color: inherit;
        padding: 0;
        scroll-snap-align: start;
        transition: transform 0.2s ease;
      }
      .show-card:hover { transform: scale(1.04); }
      .show-card:active { transform: scale(0.97); }
      .thumb {
        width: 155px;
        height: 87px;
        border-radius: 10px;
        overflow: hidden;
        background: #253550;
      }
      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        transition: opacity 0.3s;
      }
      .card-title {
        font-size: 13px;
        font-weight: 600;
        margin-top: 6px;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .card-subtitle {
        font-size: 11px;
        color: #8899aa;
        margin-top: 2px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* --- Skeleton --- */
      .skeleton-thumb {
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, #253550 25%, #2f4060 50%, #253550 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }
      .skeleton-text {
        height: 14px;
        border-radius: 4px;
        background: linear-gradient(90deg, #253550 25%, #2f4060 50%, #253550 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
      }
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      /* --- Error / Empty --- */
      .error-banner {
        background: rgba(231,76,60,0.15);
        color: #e74c3c;
        padding: 8px 20px;
        font-size: 13px;
        border-radius: 8px;
        margin: 4px 20px 8px;
      }
      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: #667;
        font-size: 14px;
      }

      /* --- Overlay --- */
      .overlay {
        position: absolute;
        inset: 0;
        background: rgba(10,18,30,0.92);
        z-index: 10;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 24px 12px;
        overflow-y: auto;
        animation: fadeIn 0.25s ease;
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      .overlay-panel {
        background: #1e2d44;
        border-radius: 16px;
        width: 100%;
        max-width: 480px;
        overflow: hidden;
      }
      .overlay-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
      }
      .overlay-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: #fff;
      }
      .close-btn {
        background: rgba(255,255,255,0.1);
        border: none;
        color: #fff;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .close-btn:hover { background: rgba(255,255,255,0.2); }

      /* --- Season Tabs --- */
      .season-tabs {
        display: flex;
        gap: 4px;
        padding: 0 20px 12px;
        overflow-x: auto;
        scrollbar-width: none;
      }
      .season-tabs::-webkit-scrollbar { display: none; }
      .season-tab {
        padding: 6px 14px;
        border-radius: 8px;
        border: none;
        background: rgba(255,255,255,0.06);
        color: #a0aec0;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        flex-shrink: 0;
        transition: all 0.15s;
      }
      .season-tab:hover { background: rgba(255,255,255,0.1); }
      .season-tab.active {
        background: #4a90d9;
        color: #fff;
      }

      /* --- Episode List --- */
      .episode-list {
        padding: 0 12px 16px;
        max-height: 360px;
        overflow-y: auto;
      }
      .episode-row {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 8px;
        border: none;
        background: none;
        color: inherit;
        width: 100%;
        text-align: left;
        cursor: pointer;
        border-radius: 10px;
        transition: background 0.15s;
      }
      .episode-row:hover { background: rgba(255,255,255,0.06); }
      .ep-thumb {
        flex: 0 0 120px;
        height: 68px;
        border-radius: 8px;
        overflow: hidden;
        position: relative;
        background: #253550;
      }
      .ep-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .ep-play-icon {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.35);
        color: #fff;
        font-size: 20px;
        opacity: 0;
        transition: opacity 0.2s;
      }
      .episode-row:hover .ep-play-icon { opacity: 1; }
      .ep-info { flex: 1; min-width: 0; }
      .ep-title {
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 2px;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .ep-subtitle {
        font-size: 11px;
        color: #8899aa;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ep-duration {
        font-size: 11px;
        color: #667;
        margin-top: 2px;
      }

      /* --- Overlay Loading --- */
      .overlay-loading {
        display: flex;
        justify-content: center;
        padding: 32px;
      }
      .spinner {
        width: 28px;
        height: 28px;
        border: 3px solid rgba(255,255,255,0.1);
        border-top-color: #4a90d9;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      /* --- Responsive --- */
      @media (max-width: 420px) {
        .header { padding: 12px 14px 6px; }
        .channels-row { padding: 6px 14px 10px; }
        .scroll-row { padding: 0 14px; gap: 10px; }
        .section-title { padding: 4px 14px 6px; font-size: 15px; }
        .show-card { width: 130px; }
        .thumb { width: 130px; height: 73px; }
        .profile-btn { padding: 4px 6px; }
        .avatar { width: 32px; height: 32px; font-size: 15px; }
        .profile-name { font-size: 10px; }
        .channel-btn { padding: 6px 12px; font-size: 12px; }
      }
    `;
  }
}

// --- Card Editor (minimal) ---

class NrkTvCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
  }

  setConfig(config) {
    this._config = config;
    this._render();
  }

  _render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 16px; font-family: var(--paper-font-body1_-_font-family, sans-serif); }
        .field { margin-bottom: 12px; }
        label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 14px; }
        input, textarea {
          width: 100%; box-sizing: border-box; padding: 8px;
          border: 1px solid var(--divider-color, #ccc); border-radius: 6px;
          font-size: 14px; font-family: monospace;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #333);
        }
        textarea { min-height: 120px; resize: vertical; }
        .hint { font-size: 12px; color: var(--secondary-text-color, #888); margin-top: 4px; }
      </style>
      <div class="field">
        <label>Media Player Entity</label>
        <input type="text" id="media_player" value="${this._config.media_player ?? ""}"
               placeholder="media_player.living_room_tv">
      </div>
      <div class="field">
        <label>Profiles (YAML array)</label>
        <textarea id="profiles">${this._profilesToYaml()}</textarea>
        <div class="hint">
          Each profile needs: name, content_group (adults/children), optional avatar emoji and color.
        </div>
      </div>
    `;

    this.shadowRoot.getElementById("media_player").addEventListener("change", (e) => {
      this._config = { ...this._config, media_player: e.target.value };
      this._fireChanged();
    });
    this.shadowRoot.getElementById("profiles").addEventListener("change", (e) => {
      try {
        // Simple YAML-like parsing for the editor
        const text = e.target.value;
        const profiles = this._parseSimpleYaml(text);
        if (profiles.length > 0) {
          this._config = { ...this._config, profiles };
          this._fireChanged();
        }
      } catch { /* ignore parse errors */ }
    });
  }

  _profilesToYaml() {
    const profiles = this._config.profiles ?? [];
    return profiles
      .map(
        (p) =>
          `- name: ${p.name}\n  content_group: ${p.content_group}${p.avatar ? `\n  avatar: "${p.avatar}"` : ""}${p.color ? `\n  color: "${p.color}"` : ""}`
      )
      .join("\n");
  }

  _parseSimpleYaml(text) {
    const profiles = [];
    let current = null;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("- name:")) {
        if (current) profiles.push(current);
        current = { name: trimmed.replace("- name:", "").trim().replace(/"/g, "") };
      } else if (current && trimmed.startsWith("content_group:")) {
        current.content_group = trimmed.replace("content_group:", "").trim().replace(/"/g, "");
      } else if (current && trimmed.startsWith("avatar:")) {
        current.avatar = trimmed.replace("avatar:", "").trim().replace(/"/g, "");
      } else if (current && trimmed.startsWith("color:")) {
        current.color = trimmed.replace("color:", "").trim().replace(/"/g, "");
      }
    }
    if (current) profiles.push(current);
    return profiles;
  }

  _fireChanged() {
    const event = new CustomEvent("config-changed", {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

customElements.define("nrk-tv-card-editor", NrkTvCardEditor);
customElements.define("nrk-tv-card", NrkTvCard);

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "nrk-tv-card",
  name: "NRK TV",
  description: "Browse and play NRK TV content with profile switching",
  preview: true,
});

console.info(
  "%c NRK-TV-CARD %c loaded ",
  "background:#2a4fa0;color:#fff;font-weight:700;padding:2px 6px;border-radius:4px 0 0 4px",
  "background:#1b2838;color:#8899aa;padding:2px 6px;border-radius:0 4px 4px 0"
);
