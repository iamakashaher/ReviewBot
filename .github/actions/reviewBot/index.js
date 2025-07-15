/* === index.js === */
const core = require("@actions/core");
const github = require("@actions/github");
const fetch = require("node-fetch");
const parseDiff = require("parse-diff");

const OPENAI_API_URL = "https://api.openai.com/v1";
const ASSISTANT_ID = core.getInput("assistant-id");

async function createThread(openaiApiKey) {
  const res = await fetch(`${OPENAI_API_URL}/threads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  return data.id;
}

async function addMessageToThread(openaiApiKey, threadId, content) {
  await fetch(`${OPENAI_API_URL}/threads/${threadId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "user",
      content,
    }),
  });
}

async function runAssistant(openaiApiKey, threadId) {
  const runRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      assistant_id: ASSISTANT_ID,
    }),
  });

  const run = await runRes.json();

  // Poll for completion
  while (true) {
    const statusRes = await fetch(`${OPENAI_API_URL}/threads/${threadId}/runs/${run.id}`, {
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
      },
    });
    const runStatus = await statusRes.json();
    if (runStatus.status === "completed") break;
    if (runStatus.status === "failed" || runStatus.status === "cancelled") {
      throw new Error(`Assistant run failed with status: ${runStatus.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function getMessages(openaiApiKey, threadId) {
  const res = await fetch(`${OPENAI_API_URL}/threads/${threadId}/messages`, {
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
    },
  });
  const data = await res.json();
  return data.data;
}

async function run() {
  try {
    const token = core.getInput("github-token");
    const openaiApiKey = core.getInput("openai-api-key");

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
      const parsed = parseDiff(`diff --git a/${file.filename} b/${file.filename}\n${diff}`);

      // Prepare thread
      const threadId = await createThread(openaiApiKey);

      await addMessageToThread(
        openaiApiKey,
        threadId,
        `Please review the following JavaScript diff from the file: ${file.filename}\n\n${diff}`
      );

      await runAssistant(openaiApiKey, threadId);
      const messages = await getMessages(openaiApiKey, threadId);

      let suggestions;
      try {
        const lastMessage = messages.find((msg) => msg.role === "assistant");
        suggestions = JSON.parse(lastMessage.content[0].text.value);
      } catch (err) {
        console.error("Failed to parse assistant response.");
        continue;
      }

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
