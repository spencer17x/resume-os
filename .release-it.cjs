const PATCH_TYPES = new Set(["fix", "perf", "revert"]);
const FEATURE_TYPES = new Set(["feat", "feature"]);

function recommendRelease(commits) {
  let level = null;

  for (const commit of commits) {
    if (commit.notes?.length > 0) {
      level = 0;
    } else if (level !== 0 && FEATURE_TYPES.has(commit.type)) {
      level = 1;
    } else if (level === null && PATCH_TYPES.has(commit.type)) {
      level = 2;
    }
  }

  return {
    level,
    reason:
      level === null
        ? "No releasable Conventional Commits were found."
        : "The next version follows the highest releasable Conventional Commit.",
  };
}

module.exports = {
  git: {
    requireBranch: "main",
    requireCleanWorkingDir: true,
    requireUpstream: true,
    requireCommits: true,
    commit: true,
    commitMessage: "chore(release): v${version} [skip ci]",
    tag: true,
    tagName: "v${version}",
    tagAnnotation: "Release v${version}",
    push: true,
  },
  github: {
    release: true,
    releaseName: "v${version}",
  },
  npm: {
    publish: false,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
      },
      whatBump: recommendRelease,
      infile: "CHANGELOG.md",
    },
  },
};
