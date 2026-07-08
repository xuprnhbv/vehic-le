// Shared emoji-reaction bar, shown under a roll on the leaderboard (expanded detail +
// featured #1) and on public profile cards. Displays every reaction's count and lets a
// logged-in user toggle their own by tapping. The server is authoritative: each tap POSTs
// to /api/rolls/:id/reactions and the bar redraws from the returned { counts, mine }.

window.Reactions = (function () {
  // Curated set — MUST stay in sync with REACTION_EMOJIS in server/reactions.js.
  const REACTION_EMOJIS = ["🔥", "❤️", "😂", "😮", "👏", "💀", "😭", "🤡"];

  // Draw the chip buttons for one reactions state into `bar`.
  function draw(bar, rollId, reactions) {
    const counts = reactions?.counts || {};
    const mine = new Set(reactions?.mine || []);
    bar.textContent = "";
    for (const emoji of REACTION_EMOJIS) {
      const count = counts[emoji] || 0;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className =
        "reaction-chip" + (count ? "" : " is-empty") + (mine.has(emoji) ? " is-mine" : "");
      chip.dataset.emoji = emoji;
      const face = document.createElement("span");
      face.className = "reaction-emoji";
      face.textContent = emoji;
      const num = document.createElement("span");
      num.className = "reaction-count";
      num.textContent = count || "";
      chip.append(face, num);
      chip.addEventListener("click", (e) => {
        e.stopPropagation(); // don't collapse the leaderboard detail row
        react(bar, rollId, emoji);
      });
      bar.appendChild(chip);
    }
  }

  // Toggle one emoji and redraw from the server's authoritative response.
  async function react(bar, rollId, emoji) {
    try {
      const res = await fetch(`/api/rolls/${rollId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (res.status === 401) {
        showHint(bar, "התחבר כדי להגיב");
        return;
      }
      if (!res.ok) return;
      const { reactions } = await res.json();
      draw(bar, rollId, reactions);
    } catch {
      /* network hiccup — leave the bar as-is */
    }
  }

  // Brief inline nudge for logged-out users. Replaces any previous one.
  function showHint(bar, text) {
    bar.querySelector(".reaction-hint")?.remove();
    const hint = document.createElement("span");
    hint.className = "reaction-hint";
    hint.textContent = text;
    bar.appendChild(hint);
    setTimeout(() => hint.remove(), 3000);
  }

  // Build a reaction bar for a roll. `reactions` is { counts, mine } from the API.
  function renderBar(rollId, reactions) {
    const bar = document.createElement("div");
    bar.className = "reaction-bar";
    draw(bar, rollId, reactions);
    return bar;
  }

  return { renderBar, REACTION_EMOJIS };
})();
