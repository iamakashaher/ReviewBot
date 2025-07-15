/* === index.js === */

const core = require("@actions/core");
const github = require("@actions/github");
const fetch = require("node-fetch");
const parseDiff = require("parse-diff");

async function run() {
  try {
    const token = core.getInput("git-token");
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

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a senior software engineer reviewing a GitHub pull request.
You will receive a code diff. If there are any suggestions for improvements (e.g., code readability, performance, style, security), return them in this JSON format:

[
  {
    "line": <lineNumberInNewFile>,
    "comment": "Suggestion comment here."
  }
]
If no suggestions, return [].`,
            },
            {
              role: "user",
              content: `Here is the diff for ${file.filename}:\n\n${diff}`,
            },
          ],
          temperature: 0.2,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText}\n${errorText}`);
      }

      const result = await response.json();
      let suggestions;
      try {
        suggestions = JSON.parse(result.choices[0].message.content);
      } catch (err) {
        console.error("Failed to parse AI response", result.choices[0].message.content);
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