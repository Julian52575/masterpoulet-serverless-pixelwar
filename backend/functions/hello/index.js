const functions = require("@google-cloud/functions-framework");

// Same payload as GET /hello in src/app.js.
functions.http("hello", (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method not allowed" });
  res.json({ message: "Hello, world!" });
});
