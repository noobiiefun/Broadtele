/**
 * Fisher-Yates shuffle — dipakai untuk mengacak urutan target tiap job dijalankan,
 * supaya pola pengiriman tidak selalu sama (mengurangi risiko kena flood/rate-limit).
 * Tidak memodifikasi array asli.
 */
function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

module.exports = { shuffle };
