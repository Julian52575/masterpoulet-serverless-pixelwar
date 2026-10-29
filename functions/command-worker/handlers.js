const { createReplier } = require("./reply");

const PAUSED = "⏸️ Le dessin est en pause : /draw et le site sont bloqués jusqu'à /admin resume.";
const RESUMED = "▶️ Le dessin a repris.";

function createHandlers({ state, discord }) {
  const reply = createReplier({ discord });

  return {
    "admin.pause": async (event) => {
      await state.setPaused(true, event.user_id);
      await reply(event, PAUSED);
    },
    "admin.resume": async (event) => {
      await state.setPaused(false, event.user_id);
      await reply(event, RESUMED);
    }
  };
}

module.exports = { createHandlers, PAUSED, RESUMED };
