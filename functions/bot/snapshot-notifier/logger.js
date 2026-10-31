const SERVICE = process.env.K_SERVICE || "snapshot-notifier";

function write(severity, message, fields = {}) {
  const entry = {
    ...fields,
    severity,
    message,
    function: SERVICE,
    timestamp: new Date().toISOString()
  };
  const line = JSON.stringify(entry);
  if (severity === "ERROR") console.error(line);
  else console.log(line);
}

const log = {
  info: (message, fields) => write("INFO", message, fields),
  warn: (message, fields) => write("WARNING", message, fields),
  error: (message, fields) => write("ERROR", message, fields)
};

module.exports = { log };
