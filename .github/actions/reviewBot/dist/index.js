/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 442:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 822:
/***/ ((module) => {

module.exports = eval("require")("@actions/github");


/***/ }),

/***/ 994:
/***/ ((module) => {

module.exports = eval("require")("node-fetch");


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
const core = __nccwpck_require__(442);
const github = __nccwpck_require__(822);
const fetch = __nccwpck_require__(994);

async function run() {
  try {
    const token = core.getInput("git-token");
    const openaiApiKey = core.getInput("openai-api-key");

    const octokit = github.getOctokit(token);
    const context = github.context;

    const { data: files } = await octokit.rest.pulls.listFiles({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: context.payload.pull_request.number,
    });

    for (const file of files) {
      if (!file.patch || !file.filename.endsWith(".js")) continue;

      const diff = file.patch;
      
      console.log("🚀 ~ run ~ diff:", diff)

      const response = await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
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
                content:
                  "You are a senior software engineer reviewing pull requests.",
              },
              { role: "user", content: `Review this code diff:\n\n${diff}` },
            ],
            temperature: 0.2,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `OpenAI API request failed: ${response.status} ${response.statusText}\n${errorText}`
        );
      }

      const result = await response.json();

      if (!result.choices || result.choices.length === 0) {
        throw new Error(`OpenAI API error: ${JSON.stringify(result, null, 2)}`);
      }

      const reviewSuggestions = result.choices[0].message.content;

      await octokit.rest.issues.createComment({
        issue_number: context.payload.pull_request.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: `**ReviewBot 🤖 AI Suggestions for ${file.filename}**:\n\n${reviewSuggestions}`,
      });
    }
  } catch (error) {
    core.setFailed(error.stack);
  }
}

run();

module.exports = __webpack_exports__;
/******/ })()
;