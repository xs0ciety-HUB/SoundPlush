/**
 * SoundPulse API Client v2
 * Supports: tracks, playlists, users, playlist detail
 */

class SoundPulseAPI {
  constructor() {
    this.clientId = null;
    this.cacheExpiry = 5 * 60 * 1000;
    this.requestCache = new Map();
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  /* ================ CREDENTIALS ================ */
  async getCredentials(forceRefresh = false) {
    const cacheKey = "clientId";
    const cached = this.requestCache.get(cacheKey);
    if (!forceRefresh && cached && Date.now() < cached.expiry) return cached.value;

    let lastError = null;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await fetch("/api/get-credentials", { cache: "no-cache" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.client_id) throw new Error("No client_id in response");
        this.clientId = data.client_id;
        this.requestCache.set(cacheKey, {
          value: data.client_id,
          expiry: Date.now() + this.cacheExpiry
        });
        return data.client_id;
      } catch (err) {
        lastError = err.message;
        if (i < this.maxRetries - 1) await this._delay(this.retryDelay * (i + 1));
      }
    }
    throw new Error(`Failed to get credentials: ${lastError}`);
  }

  /* ================ SEARCH TRACKS ================ */
  async search(query) {
    return this._searchTyped(query, "tracks");
  }

  /* ================ SEARCH PLAYLISTS ================ */
  async searchPlaylists(query) {
    return this._searchTyped(query, "playlists");
  }

  /* ================ SEARCH USERS / ARTISTS ================ */
  async searchArtists(query) {
    return this._searchTyped(query, "users");
  }

  /* ================ GET PLAYLIST DETAIL (with tracks) ================ */
  async getPlaylistTracks(playlistId) {
    if (!playlistId) throw new Error("playlistId required");

    if (!this.clientId) this.clientId = await this.getCredentials();

    const cacheKey = `playlist_${playlistId}`;
    const cached = this.requestCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.value;

    const url = `/api/search?playlist_id=${playlistId}&client_id=${this.clientId}`;

    let lastError = null;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await fetch(url, { cache: "no-cache" });

        if (res.status === 401 || res.status === 403) {
          this.clientId = null;
          this.clientId = await this.getCredentials(true);
          lastError = "Refreshed client_id";
          if (i < this.maxRetries - 1) await this._delay(this.retryDelay);
          continue;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Unknown error");

        this.requestCache.set(cacheKey, {
          value: data,
          expiry: Date.now() + this.cacheExpiry
        });

        return data;
      } catch (err) {
        lastError = err.message;
        if (i < this.maxRetries - 1) await this._delay(this.retryDelay * Math.pow(2, i));
      }
    }

    throw new Error(`Playlist fetch failed: ${lastError}`);
  }

  /* ================ INTERNAL: typed search ================ */
  async _searchTyped(query, type) {
    if (!query || !query.trim()) throw new Error("Search query kosong");

    const cacheKey = `search_${type}_${query}`;
    const cached = this.requestCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.value;

    if (!this.clientId) this.clientId = await this.getCredentials();

    let lastError = null;
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const url = `/api/search?q=${encodeURIComponent(query)}&client_id=${this.clientId}&type=${type}`;
        const res = await fetch(url, { cache: "no-cache" });

        if (res.status === 401 || res.status === 403) {
          this.clientId = null;
          this.clientId = await this.getCredentials(true);
          lastError = "Client_id refreshed";
          if (i < this.maxRetries - 1) await this._delay(this.retryDelay);
          continue;
        }

        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after") || "30";
          throw new Error(`Rate limited. Retry after ${retryAfter}s`);
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

        const data = await res.json();
        if (!data.success && data.error) throw new Error(data.error);
        if (!Array.isArray(data.collection)) throw new Error("Invalid response format");

        this.requestCache.set(cacheKey, {
          value: data,
          expiry: Date.now() + this.cacheExpiry
        });

        return data;
      } catch (err) {
        lastError = err.message;
        if (i < this.maxRetries - 1) await this._delay(this.retryDelay * Math.pow(2, i));
      }
    }

    throw new Error(`Search failed: ${lastError}`);
  }

  /* ================ STREAM URL ================ */
  getStreamUrl(track) {
    if (!track) return null;
    return track.stream_url || null;
  }

  isStreamable(track) {
    if (!track) return false;
    if (track?.policy?.policy === "BLOCK") return false;
    return !!this.getStreamUrl(track);
  }

  /* ================ UTILS ================ */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  clearCache() {
    this.requestCache.clear();
  }
}

/* ============================================================
   EXPORT — dukung CommonJS (Node) DAN global (browser classic script)
   ============================================================
   PENTING: Di browser, `class Foo {}` di top-level classic script
   TIDAK otomatis jadi `window.Foo`. Makanya kita harus attach manual
   ke `window` agar `window.SoundPulseAPI` bisa diakses dari index.html.
============================================================ */
if (typeof module !== "undefined" && module.exports) {
  // Node / CommonJS environment
  module.exports = SoundPulseAPI;
} else if (typeof window !== "undefined") {
  // Browser classic script — attach ke window
  window.SoundPulseAPI = SoundPulseAPI;
          }
