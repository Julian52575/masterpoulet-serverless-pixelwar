const { log } = require("./logger");

function createReplier({ discord }) {
  return async function reply(event, content, files = []) {
    try {
      await discord.editOriginal(event, { content }, files);
    } catch (error) {
      if (error.retryable) throw error;
      log.warn("could not reply to the user", {
        correlation_id: event.correlation_id,
        command: event.type,
        error: error.message,
        status: error.status
      });
    }
  };
}

module.exports = { createReplier };
