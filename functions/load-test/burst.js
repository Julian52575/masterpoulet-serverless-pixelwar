#!/usr/bin/env node
const { parseOptions, planDraw, sendDraw, runLoad, summarize, report, newRunId, correlationIdOf, UsageError, USAGE } = require("./load");

const PROGRESS_EVERY = 50;

async function main() {
  let options;
  try {
    options = parseOptions(process.argv.slice(2), process.env);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const runId = newRunId();
  console.log(
    `run ${runId}: ${options.requests} ${options.route} draws to ${options.url}, ${options.concurrency} at a time` +
      `${options.rate ? `, at most ${options.rate} per second` : ""}, ${options.tokens.length} user(s)`
  );

  let done = 0;
  const { results, elapsedMs } = await runLoad({
    requests: options.requests,
    concurrency: options.concurrency,
    rate: options.rate,
    send: (index) => sendDraw(planDraw(index, options), correlationIdOf(runId, index), { timeoutSeconds: options.timeout }),
    onResult: () => {
      done += 1;
      if (done % PROGRESS_EVERY === 0 || done === options.requests) console.log(`  ${done}/${options.requests}`);
    }
  });

  const summary = summarize(results, elapsedMs);
  console.log(`\n${report(summary, runId)}`);
  if (summary.queued === 0) process.exitCode = 1;
}

main();
