const core = require("@actions/core");
const github = require("@actions/github");
const fetch = require("node-fetch");
const parseDiff = require("parse-diff");

const OPENAI_API_URL = "https://api.openai.com/v1";

async function run() {
  try {
    const token = core.getInput("github-token");
    const openaiApiKey = core.getInput("openai-api-key");
    const assistantId = core.getInput("assistant-id");

    const octokit = github.getOctokit(token);
    const context = github.context;
    const pull_number = context.payload.pull_request.number;

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number,
    });

    for (const file of files) {
      if (!file.patch || !file.filename.endsWith(".js")) continue;

      const diff = file.patch;

      // 1. Create a new thread
      const threadRes = await fetch(`${OPENAI_API_URL}/threads`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
      });

      const thread = await threadRes.json();
      const threadId = thread.id;

      // 2. Add message to thread
      await fetch(`${OPENAI_API_URL}/threads/${threadId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "user",
          content: `Here is the diff for ${file.filename}:\n\n${diff}`,
        }),
      });

      // 3. Run the assistant
      const runRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assistant_id: assistantId,
        }),
      });

      const run = await runRes.json();

      // 4. Poll until run completes
      let status = "queued";
      while (status === "queued" || status === "in_progress") {
        await new Promise((r) => setTimeout(r, 1000));
        const runStatusRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/runs/${run.id}`, {
          headers: { Authorization: `Bearer ${openaiApiKey}` },
        });
        const runStatus = await runStatusRes.json();
        status = runStatus.status;
      }

      // 5. Get messages from thread
      const messagesRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/messages`, {
        headers: { Authorization: `Bearer ${openaiApiKey}` },
      });

      if (!messagesRes.ok) {
        const errorText = await messagesRes.text();
        throw new Error(`Failed to fetch messages: ${messagesRes.status} ${messagesRes.statusText}\n${errorText}`);
      }

      const messages = await messagesRes.json();
      console.log("Messages from thread:", messages);

      const assistantMessage = messages.data?.find(msg => msg.role === "assistant");

      if (!assistantMessage) {
        throw new Error("No assistant message found in thread.");
      }

      let suggestions;
      try {
        suggestions = JSON.parse(assistantMessage.content[0].text.value);
      } catch (err) {
        console.error("Failed to parse AI response", assistantMessage.content[0].text.value);
        continue;
      }

      // 6. Add inline comments to GitHub PR
      for (const suggestion of suggestions) {
        if (!suggestion.comment || !suggestion.line) continue;

        await octokit.rest.pulls.createReviewComment({
          owner: context.repo.owner,
          repo: context.repo.repo,
          pull_number,
          commit_id: context.payload.pull_request.head.sha,
          path: file.filename,
          side: "RIGHT",
          line: suggestion.line,
          body: suggestion.comment,
        });
      }
    }
  } catch (error) {
    core.setFailed(error.stack);
  }
}

run();
