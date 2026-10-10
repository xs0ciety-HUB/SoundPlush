/**
 * AUDIO HELPERS v4 (ringan)
 * Dibuang dari versi lama karena bikin musik "ga bisa mulai":
 *  - wrapper audio.play() dengan batas 3x percobaan yang ga pernah reset kalau stream gagal
 *    -> setelah 3x gagal, SEMUA lagu ditolak "Max playback attempts" sampai reload
 *  - handler stalled/suspend yang pause + seek + play sendiri (ganggu buffering & hls.js)
 *  - stub global handleAudioError/handleTrackEnded/... yang numpuk namespace
 * Recovery error ada di index.html. File ini cuma: log, Media Session, watchdog buffering.
 */
(function () {
  const audio = document.getElementById("audioEngine");
  if (!audio) return;

  /* ---------- Watchdog: buffering kelamaan -> minta index.html recover ---------- */
  let waitTimer = null;
  const clearWait = () => { clearTimeout(waitTimer); waitTimer = null; };

  audio.addEventListener("waiting", () => {
    clearWait();
    waitTimer = setTimeout(() => {
      if (!audio.paused && audio.readyState < 3 && typeof window.spRecoverStream === "function") {
        console.warn("[Audio] Buffering > 15s, recover");
        window.spRecoverStream();
      }
    }, 15000);
  });
  ["playing", "canplay", "pause", "emptied", "ended"].forEach(ev => audio.addEventListener(ev, clearWait));

  /* ---------- Media Session (kontrol lockscreen / notifikasi) ---------- */
  if ("mediaSession" in navigator) {
    const call = (fn) => () => { if (typeof window[fn] === "function") window[fn](); };
    try {
      navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {}));
      navigator.mediaSession.setActionHandler("pause", () => audio.pause());
      navigator.mediaSession.setActionHandler("nexttrack", call("playNext"));
      navigator.mediaSession.setActionHandler("previoustrack", call("playPrev"));
    } catch {}
  }

  window.spUpdateMediaSession = function (track) {
    if (!("mediaSession" in navigator) || !track || typeof MediaMetadata === "undefined") return;
    const art = track.artwork_url || (track.user && track.user.avatar_url);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || "Unknown",
        artist: (track.user && track.user.username) || "Unknown",
        artwork: art ? [{ src: art.replace("-large", "-t500x500"), sizes: "500x500" }] : [],
      });
    } catch {}
  };

  /* ---------- Debug helper ---------- */
  window.AudioPlaybackEnhanced = {
    getPlaybackStats: () => ({
      currentTime: audio.currentTime,
      duration: audio.duration,
      paused: audio.paused,
      ended: audio.ended,
      error: audio.error ? { code: audio.error.code, message: audio.error.message } : null,
      networkState: audio.networkState, // 0 empty, 1 idle, 2 loading, 3 no source
      readyState: audio.readyState,     // 0..4
      src: audio.currentSrc,
    }),
  };
})();
