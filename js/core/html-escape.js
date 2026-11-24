// Escape teks (nama projek/scene/objek/fail, ringkasan action, dll — data drpd
// pengguna atau Supabase) sebelum disisip ke dalam template innerHTML, termasuk
// dalam atribut berpetik (title="..."). Modul daun: tiada import, jadi selamat
// diimport dari mana-mana tanpa risiko circular dependency.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
}
