/* === index.js === */

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

      // === Step 1: Create thread ===
      const threadRes = await fetch(`${OPENAI_API_URL}/threads`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const thread = await threadRes.json();
      const threadId = thread.id;

      // === Step 2: Add message (code diff) to thread ===
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

      // === Step 3: Run the assistant ===
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

      // === Step 4: Poll until run is complete ===
      let runStatus = run.status;
      while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled") {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const statusRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/runs/${run.id}`, {
          headers: {
            Authorization: `Bearer ${openaiApiKey}`,
          },
        });
        const statusData = await statusRes.json();
        runStatus = statusData.status;
      }

      if (runStatus !== "completed") {
        console.error(`Run failed or was cancelled for file ${file.filename}`);
        continue;
      }

      // === Step 5: Get assistant's response ===
      const messagesRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/messages`, {
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
        },
      });

      const messagesData = await messagesRes.json();
      const lastMessage = messagesData.data.find((msg) => msg.role === "assistant");

      let suggestions;
      try {
        suggestions = JSON.parse(lastMessage.content[0].text.value);
      } catch (err) {
        console.error("Failed to parse AI response:", lastMessage.content[0].text.value);
        continue;
      }

      // === Step 6: Post review comments back to GitHub PR ===
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
    core.setFailed(error.stack || error.message);
  }
}

run();
