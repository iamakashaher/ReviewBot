const core = require('@actions/core');
const github = require('@actions/github');
const fetch = require('node-fetch');

async function callOpenAI(openaiApiKey, diff) {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',  // fallback-safe model
          messages: [
            { role: 'system', content: 'You are a senior software engineer reviewing pull requests.' },
            { role: 'user', content: `Review this code diff:\n\n${diff.slice(0, 3000)}` } // limit size
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
        console.warn("Invalid OpenAI response:", JSON.stringify(result));
        throw new Error("Invalid OpenAI response structure.");
      }

      return result.choices[0].message.content;
    } catch (err) {
      console.warn(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt === maxRetries) throw err;
      await new Promise(res => setTimeout(res, 1000 * attempt)); // exponential backoff
    }
  }
}

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const openaiApiKey = core.getInput('openai-api-key', { required: true });

    if (!token || !openaiApiKey) {
      throw new Error('Missing GitHub or OpenAI API key.');
    }

    const octokit = github.getOctokit(token);
    const context = github.context;

    if (!context.payload.pull_request) {
      throw new Error('This action must be run on pull_request events only.');
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

      console.log(`Reviewing file: ${file.filename}`);

      const reviewSuggestions = await callOpenAI(openaiApiKey, diff);

      await octokit.rest.issues.createComment({
        issue_number: pullNumber,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `**ReviewBot 🤖 Suggestions for \`${file.filename}\`**:\n\n${reviewSuggestions}`
      });
    }
  } catch (error) {
    console.error('Error stack:', error.stack);
    core.setFailed(error.message);
  }
}

run();
