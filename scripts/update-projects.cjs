// Called by actions/github-script. No npm dependencies or personal token needed.
const START = '<!-- PROJECTS:START -->';
const END = '<!-- PROJECTS:END -->';
const PROJECT_LIMIT = 6;
const FORK_LIMIT = 3;

// The section lives inside an HTML <td>, so Markdown is never parsed there and
// every repository field has to be escaped as HTML before it is interpolated.
function text(value, limit = 90) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  const cut = clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
  return cut.replace(/[&<>"']/g, ch => `&#${ch.codePointAt(0)};`);
}

function item(repo, owner) {
  const href = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo.name)}`;
  const language = repo.language ? ` <sub>· ${text(repo.language, 24)}</sub>` : '';
  return `  <li><a href="${href}"><b>${text(repo.name, 40)}</b></a>${language}<br>`
    + `<sub>${text(repo.description) || 'No description provided'}</sub></li>`;
}

function render(repos, owner) {
  const eligible = repos.filter(repo => !repo.private && !repo.archived
    && repo.owner.login.toLowerCase() === owner.toLowerCase()
    && repo.name.toLowerCase() !== owner.toLowerCase())
    .sort((a, b) => b.created_at.localeCompare(a.created_at)
      || a.name.localeCompare(b.name, 'en'));
  const list = (items, empty) => items.length
    ? ['<ul>', ...items.map(repo => item(repo, owner)), '</ul>'].join('\n')
    : `<p><sub>${empty}</sub></p>`;
  return [
    '<h3>🚀 Latest Projects</h3>', '',
    '<p><sub>Recently created public repositories, newest first. Updated daily.</sub></p>', '',
    list(eligible.filter(repo => !repo.fork).slice(0, PROJECT_LIMIT),
      'No matching public repositories yet.'), '',
    '<h3>🌱 Latest Forks</h3>', '',
    list(eligible.filter(repo => repo.fork).slice(0, FORK_LIMIT),
      'No public forks yet.'), '',
    `<p><a href="https://github.com/${encodeURIComponent(owner)}?tab=repositories">View all repositories →</a></p>`,
  ].join('\n');
}

function replaceSection(readme, content) {
  if (readme.split(START).length !== 2 || readme.split(END).length !== 2
      || readme.indexOf(START) >= readme.indexOf(END)) {
    throw new Error('README must contain exactly one ordered PROJECTS marker pair.');
  }
  return readme.slice(0, readme.indexOf(START) + START.length)
    + '\n\n' + content + '\n\n' + readme.slice(readme.indexOf(END));
}

async function update({ github, context, core }) {
  const { owner, repo } = context.repo;
  const branch = context.payload.repository.default_branch;
  const path = 'README.md';
  // Paginate all public repositories before making any change.
  const repos = await github.paginate(github.rest.repos.listForUser, {
    username: owner, type: 'owner', sort: 'created', direction: 'desc', per_page: 100,
  });
  const { data: file } = await github.rest.repos.getContent({ owner, repo, path, ref: branch });
  if (file.type !== 'file' || file.encoding !== 'base64') {
    throw new Error(`${path} is not a readable base64 file.`);
  }
  const previous = Buffer.from(file.content, 'base64').toString('utf8');
  const next = replaceSection(previous, render(repos, owner));
  if (next === previous) {
    core.info('Project lists unchanged; no commit needed.');
    return;
  }
  // The file SHA protects the commit against a concurrent edit of the README.
  await github.rest.repos.createOrUpdateFileContents({
    owner, repo, branch, path, sha: file.sha,
    message: `docs: refresh public projects in ${path} [skip ci]`,
    content: Buffer.from(next, 'utf8').toString('base64'),
  });
  core.info(`Updated the project section of ${path}.`);
}

module.exports = update;
module.exports.render = render;
module.exports.replaceSection = replaceSection;
