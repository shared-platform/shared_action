function wrap_github_script() {
    // we are modifying the script to include our own code
    // therefore detection inside of github-script would be incorrect and always passing

    const script = process.env["INPUT_SCRIPT"] || '';
    if (!script) {
        throw new Error("Input required and not supplied: script");
    }

    const separator = "-".repeat(80);
    const debug = process.env['INPUT_DEBUG'] === 'true';

    if (debug) {
        console.log("SHARED_PLATFORM: extending script with share_platform build functions");
    }

    const shared_platform = Object.values(require('../shared_platform')).map(a=> a.toString()).join('\n\n')

    const extended_script = `
      ${shared_platform}

      ${script}
    `
    process.env["INPUT_SCRIPT"] = extended_script;

    if (debug) {
        console.log(`SHARED_PLATFORM: new script: \n${separator}\n${extended_script}\n${separator}\n`);
        console.log("SHARED_PLATFORM: running original github-scripts");
    }

    // run original github-script with patched source
    require('../github-script/dist')
}

wrap_github_script()