/**
 * Delay acak (jitter) antara minSec dan maxSec, dalam detik.
 * Dipakai antar pengiriman supaya interval tidak selalu sama persis (fixed interval
 * lebih gampang dikenali sebagai pola otomatis).
 */
function randomDelayMs(minSec, maxSec) {
  const min = Math.max(0, minSec) * 1000;
  const max = Math.max(min, maxSec * 1000);
  return min + Math.random() * (max - min);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { randomDelayMs, sleep };
