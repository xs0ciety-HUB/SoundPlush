/**
 * SoundPulse API Client
 * Enhanced with retry logic, better error handling, and caching
 */

class SoundPulseAPI {
  constructor() {
    this.clientId = null;
    this.cacheExpiry = 5 * 60 * 1000; // 5 menit cache
    this.requestCache = new Map();
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 detik
  }

  /**
   * Get valid client ID dengan retry
   */
  async getCredentials(forceRefresh = false) {
    const cacheKey = 'clientId';
    const cached = this.requestCache.get(cacheKey);
    
    if (!forceRefresh && cached && Date.now() < cached.expiry) {
      return cached.value;
    }

    let lastError = null;

    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const res = await fetch('/api/get-credentials', {
          method: 'GET',
          cache: 'no-cache'
        });

        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          console.warn(`[API] get-credentials attempt ${i + 1} failed:`, lastError);
          if (i < this.maxRetries - 1) {
            await this._delay(this.retryDelay * (i + 1));
          }
          continue;
        }

        const data = await res.json();
        
        if (!data.client_id) {
          throw new Error('No client_id in response');
        }

        // Cache hasilnya
        this.clientId = data.client_id;
        this.requestCache.set(cacheKey, {
          value: data.client_id,
          expiry: Date.now() + this.cacheExpiry
        });

        console.log('[API] Got valid client_id');
        return data.client_id;
      } catch (err) {
        lastError = err.message;
        console.error(`[API] get-credentials attempt ${i + 1} error:`, err.message);
        
        if (i < this.maxRetries - 1) {
          await this._delay(this.retryDelay * (i + 1));
        }
      }
    }

    throw new Error(`Failed to get credentials after ${this.maxRetries} attempts: ${lastError}`);
  }

  /**
   * Search tracks dengan retry dan error handling
   */
  async search(query) {
    if (!query || query.trim().length === 0) {
      throw new Error('Search query kosong');
    }

    const cacheKey = `search_${query}`;
    const cached = this.requestCache.get(cacheKey);
    
    if (cached && Date.now() < cached.expiry) {
      return cached.value;
    }

    // Pastikan punya client_id
    if (!this.clientId) {
      this.clientId = await this.getCredentials();
    }

    let lastError = null;

    for (let i = 0; i < this.maxRetries; i++) {
      try {
        const url = `/api/search?q=${encodeURIComponent(query)}&client_id=${this.clientId}`;
        
        console.log(`[API] Search attempt ${i + 1} for "${query}"`);

        const res = await fetch(url, {
          method: 'GET',
          cache: 'no-cache'
        });

        if (!res.ok) {
          // Jika 401/403, client_id mungkin expired
          if (res.status === 401 || res.status === 403) {
            console.warn('[API] Client ID invalid, refreshing...');
            this.clientId = null;
            this.clientId = await this.getCredentials(true); // Force refresh
            lastError = 'Client ID refreshed, retrying...';
            if (i < this.maxRetries - 1) {
              await this._delay(this.retryDelay);
            }
            continue;
          }

          // 429 = rate limit
          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after') || '30';
            throw new Error(`Rate limited. Retry after ${retryAfter}s`);
          }

          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        if (!data.success && data.error) {
          throw new Error(data.error);
        }

        if (!data.collection || !Array.isArray(data.collection)) {
          throw new Error('Invalid response format');
        }

        if (data.collection.length === 0) {
          console.warn(`[API] No tracks found for "${query}"`);
        }

        // Cache hasilnya
        this.requestCache.set(cacheKey, {
          value: data,
          expiry: Date.now() + this.cacheExpiry
        });

        console.log(`[API] Found ${data.collection.length} tracks`);
        return data;
      } catch (err) {
        lastError = err.message;
        console.error(`[API] Search attempt ${i + 1} error:`, err.message);
        
        if (i < this.maxRetries - 1) {
          // Exponential backoff
          await this._delay(this.retryDelay * Math.pow(2, i));
        }
      }
    }

    throw new Error(`Search failed after ${this.maxRetries} attempts: ${lastError}`);
  }

  /**
   * Get stream URL untuk track
   */
  getStreamUrl(track) {
    if (!track) return null;
    
    // Priority order
    if (track.stream_url) return track.stream_url;
    
    if (track.media?.transcodings && Array.isArray(track.media.transcodings)) {
      // Progressive (MP3)
      const progressive = track.media.transcodings.find(t => 
        t?.format?.protocol === 'progressive'
      );
      if (progressive?.url) return progressive.url;

      // HLS
      const hls = track.media.transcodings.find(t => 
        t?.format?.protocol === 'hls'
      );
      if (hls?.url) return hls.url;

      // Any
      if (track.media.transcodings[0]?.url) {
        return track.media.transcodings[0].url;
      }
    }

    return null;
  }

  /**
   * Check if track is streamable
   */
  isStreamable(track) {
    if (!track) return false;
    if (track?.policy?.policy === 'BLOCK') return false;
    return !!this.getStreamUrl(track);
  }

  /**
   * Helper: delay
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.requestCache.clear();
    console.log('[API] Cache cleared');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SoundPulseAPI;
}
