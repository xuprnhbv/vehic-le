// Tiny, safe markdown renderer for announcement popups. Shared by the popup
// (announce.js) and the admin live-preview so what an admin types is exactly what
// visitors see. Supports a deliberately small set:
//   **bold**            → <strong>
//   *italic*            → <em>
//   {accent|text}       → colored span (accent/green/blue/red/muted)
//   blank line          → new paragraph,   single newline → <br>
// Everything is HTML-escaped first, so the body can never inject markup — only the
// whitelisted color names produce a class, anything else stays literal text.
(function () {
  const COLORS = new Set(["accent", "green", "blue", "red", "muted"]);

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderInline(text) {
    let html = esc(text);
    // Color spans first, so bold/italic inside them still get processed below.
    html = html.replace(/\{([a-z]+)\|([\s\S]*?)\}/g, (m, name, inner) =>
      COLORS.has(name) ? `<span class="md-${name}">${inner}</span>` : m
    );
    html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  function render(src) {
    return String(src)
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((block) => `<p>${renderInline(block)}</p>`)
      .join("");
  }

  window.AnnounceMD = { render };
})();
