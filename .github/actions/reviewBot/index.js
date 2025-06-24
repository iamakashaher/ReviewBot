const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const openaiApiKey = core.getInput('openai-api-key', { required: true });

    const octokit = github.getOctokit(token);
    const context = github.context;

    if (!context.payload.pull_request) {
      throw new Error("This action must be triggered by a pull_request event.");
    }

    const pullNumber = context.payload.pull_request.number;
    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: pullNumber,
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

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error (${response.status}): ${errorText}`);
      }

      const result = await response.json();

      if (
        !result.choices ||
        !Array.isArray(result.choices) ||
        result.choices.length === 0 ||
        !result.choices[0].message
      ) {
        console.error('Unexpected OpenAI response:', JSON.stringify(result, null, 2));
        throw new Error('Invalid response structure from OpenAI API.');
      }

      const reviewSuggestions = result.choices[0].message.content;

      await octokit.rest.issues.createComment({
        issue_number: pullNumber,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `**ReviewBot 🤖 AI Suggestions for ${file.filename}**:\n\n${reviewSuggestions}`
      });
    }
  } catch (error) {
    console.error(error);
    console.error('Error stack:', error.stack);
    core.setFailed(error.message);
  }
}

run();
