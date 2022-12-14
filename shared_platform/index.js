class Version {
  constructor(major, minor, build = 0) {
    this.major = major;
    this.minor = minor;
    this.build = build;
  }

  asFullTag() {
    return `${this.major}.${this.minor}.${this.build}`;
  }

  asMinorTag() {
    return `${this.major}.${this.minor}`;
  }
}

class Image {
  constructor(name, registry = null) {
    this.registry = registry || getInput("docker-repository");
    this.name = name;
  }

  asTags(version) {
    let tags = [`${this.registry}/${this.name}:${version.asMinorTag()}`];
    if (version.build > 0) {
      tags.push(`${this.registry}/${this.name}:${version.asFullTag()}`);
    }
    return tags;
  }
}

async function run_shell(command) {
  /* eslint-disable no-undef */
  const util = require("node:util");
  const _exec = util.promisify(require("node:child_process").exec);
  console.log(`Executing command: ${command}`);
  return await _exec(command);
}

function getInput(name, required=true) {
  const val = process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] || '';
  if (required && !val) {
      throw new Error(`Input required and not supplied: ${name}`);
  }
  return val.trim();
}

async function getGitVersion() {
  try {
    const { stdout } = await run_shell(
      "git describe --match='[0-9]*.[0-9]*' --exclude='[0-9]*.[0-9]*[0-9]' --exclude='*[^0-9.]*' --tags"
    );

    const version = stdout.trim().replaceAll("-", ".").split(".");
    return new Version(version[0], version[1], version[2]);
  } catch (error) {
    console.error(`${error}`);
    return new Version(0, 0, 1);
  }
}

async function _getToml(){
  try {
    return require("toml");
  } catch (error) {
    console.log("Toml was not installed, installing it now");
  }
  let stdout, stderr
  try {
    [stdout, stderr] = await run_shell("npm install toml");
    console.log("Toml installed", stdout, stderr);
    return require("toml");
  } catch (error) {
    console.error("Toml installation failed", error, stderr);
    throw error;
  }
}

async function _getNodePackageVersion() {
  console.log("_getNodePackageVersion");
  try {
    // eslint-disable-next-line no-undef
    const packageConfig = require("./package.json");
    const versionParts = packageConfig.version.split(".");
    // we don't care about the patch version, it is used as build number and increased by the CI
    return new Version(versionParts[0], versionParts[1], 0);
  } catch (error) {
    return null;
  }
}

async function _getPythonPoetryPackageVersion() {
  console.log("_getPythonPoetryPackageVersion");
  try {
    // eslint-disable-next-line no-undef
    console.log("getting toml");
    const toml = await _getToml();
    console.log("getting fs");
    const fs = require("fs");

    console.log("loading file pyproject.toml");
    const projectConfig = toml.parse(fs.readFileSync("pyproject.toml", "utf8"));
    console.log("projectConfig: ", projectConfig);
    const versionParts = projectConfig.tool.poetry.version.split(".");
    // we don't care about the patch version, it is used as build number and increased by the CI
    return new Version(versionParts[0], versionParts[1], 0);
  } catch (error) {
    return null;
  }
}

async function getPackageVersion() {
  // TODO move this outside of the action
  // this cant be done right now as  global scope is not automatically passed
  // to the final script
  const _getPackageVersionStrategies = [
    _getNodePackageVersion,
    _getPythonPoetryPackageVersion,
  ];

  for (const strategy of _getPackageVersionStrategies) {
    try{
      const version = await strategy();
      console.log("trying strategy", strategy, "got", version);
      if (version) {
        return version;
      }
    } catch (error) {
      console.log("trying strategy", strategy, " FAILED");
    }
  }

  throw new Error("Could not determine package version");
}

async function createGithubTag(version, full = false) {
  try {
    const tag = full ? version.asFullTag() : version.asMinorTag();
    console.log(`Creating git tag ${tag}`);
    await github.rest.git.createRef({
      owner: context.repo.owner,
      repo: context.repo.repo,
      ref: `refs/tags/${tag}`,
      sha: context.sha,
    });
  } catch (error) {
    console.error(`${error}`);
  }
}

async function createGithubRelease(version) {
  const releaseTag = version.asFullTag();
  console.log(`Creating release ${releaseTag}`);
  await createGithubTag(version, true);
  try {
    await github.rest.repos.createRelease({
      name: `Automatic release ${releaseTag}`,
      tag_name: releaseTag,

      owner: context.repo.owner,
      repo: context.repo.repo,

      draft: false,
      generate_release_notes: true,
      prerelease: false,
    });
  } catch (error) {
    console.error(`${error}`);
  }
}

async function buildDockerImage(tags) {
  console.log(`Building docker image with tags: ${tags}`);

  tagParams = tags.map((tag) => `-t "${tag}"`).join(" ");
  try {
    const { stdout } = await run_shell(`docker build . ${tagParams}`);
    console.log(stdout);
  } catch (error) {
    console.error("Docker build failed", error);
  }
}

async function pushDockerImage(tags) {
  console.log(`Publishing docker image with tags: ${tags}`);

  for (const tag of tags) {
    try {
      const { stdout } = await run_shell(`docker push ${tag}`);
      console.log(stdout);
    } catch (error) {
      console.error("Docker push failed", error);
    }
  }
}

async function releaseDocker(image, version) {
  const tags = image.asTags(version);
  await buildDockerImage(tags);
  await pushDockerImage(tags);
}

async function dispatchDeploymentWorkflow(version) {
  console.log(
    "Triggering deployment workflow",
    context.repo.repo,
    "version",
    version.asFullTag()
  );
  try {
    const repo = getInput("deployment-repo");
    const workflow = getInput("deployment-workflow");
    const ref = getInput("deployment-repo-reference");
    await github.rest.actions.createWorkflowDispatch({
      owner: context.repo.owner,
      repo: repo,
      workflow_id: workflow,
      ref: ref,
      inputs: {
        updated_service: context.repo.repo,
        version: version.asFullTag(),
      },
    });
  } catch (error) {
    console.error("Failed to dispatch deployment", error);
  }
}

exports.Version = Version;
exports.Image = Image;

exports.buildDockerImage = buildDockerImage;
exports.createGithubRelease = createGithubRelease;
exports.createGithubTag = createGithubTag;
exports.dispatchDeploymentWorkflow = dispatchDeploymentWorkflow;
exports.getGitVersion = getGitVersion;
exports.getPackageVersion = getPackageVersion;
exports.pushDockerImage = pushDockerImage;
exports.releaseDocker = releaseDocker;

exports.getInput = getInput;
exports.run_shell = run_shell;

exports._getToml = _getToml;
exports._getNodePackageVersion = _getNodePackageVersion;
exports._getPythonPoetryPackageVersion = _getPythonPoetryPackageVersion;
