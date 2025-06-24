const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function run() {
  try {
    const token = core.getInput('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');
    const openaiApiKey = core.getInput('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');

    const octokit = github.getOctokit(token);
    const context = github.context;

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
    });

    for (const file of files) {
      if (!file.patch || !file.filename.endsWith('.js')) continue;

      const diff = file.patch;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a senior software engineer reviewing pull requests.' },
            { role: 'user', content: `Review this code diff:\n\n${diff}` }
          ],
          temperature: 0.2
        })
      });

      const result = await response.json();
      const reviewSuggestions = result.choices[0].message.content;

      await octokit.rest.issues.createComment({
        issue_number: context.payload.pull_request.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `**ReviewBot 🤖 AI Suggestions for ${file.filename}**:\n\n${reviewSuggestions}`
      });
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
