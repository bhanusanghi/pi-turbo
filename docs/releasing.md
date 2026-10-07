# Publishing and maintenance

This guide is for a separately authorized publication of the local implementation. These commands have not
been executed against GitHub or npm by this implementation task.

## Prepare a release

Choose an available npm name, optionally scoped, and your GitHub repository identity.
Update the package name in examples before declaring them runnable.

Keep Pi-supplied packages in `peerDependencies` with `"*"` as required by Pi's
package guide; install concrete versions as development dependencies for verification.
Avoid bundling physical host-package copies. [Dependency guidance](https://pi.dev/docs/latest/packages).

Complete configured live model and delivery evaluation before removing `private: true`. Review the tarball,
fill out release notes, and record the Pi versions actually tested.

```sh
npm run check
npm pack --dry-run
npm pack
```

Inspect the archive: include the declared extension, compiled exports/declarations,
license, documentation, and intended examples. Exclude credentials, session data,
development dependencies, and unrelated repository files.

## Create the public source repository

If this folder already has a local Git repository, use it. Rename its initial
scaffold branch to your intended default branch when ready; otherwise initialize Git.

```sh
# For an existing scaffold repository:
git branch -m main

# For a folder without a Git repository, use instead:
# git init -b main

git add .
git commit -m "Create pi-turbo"
gh repo create pi_turbo --public --source . --remote origin
git push -u origin main
```

Replace the repository name if needed. Add its actual identity to package metadata:

```sh
npm pkg set repository.type=git
npm pkg set repository.url=git+https://github.com/YOUR_OWNER/pi_turbo.git
npm pkg set homepage=https://github.com/YOUR_OWNER/pi_turbo#readme
npm pkg set bugs.url=https://github.com/YOUR_OWNER/pi_turbo/issues
```

Publishing the source and publishing an npm package are separate steps.

## Publish npm and a release tag

After verification and publication approval, remove the publishing guard:

```sh
npm pkg delete private
```

Commit the completed runtime and metadata first. Then create a versioned release:

```sh
npm version 0.1.0
npm pack --dry-run
npm publish --access public
git push --follow-tags
gh release create v0.1.0 --generate-notes
```

Use a prerelease tag for experimental builds. Review registry access and package-name
availability for the chosen identity. No publishing credentials belong in this repository.

## Install and manage

Once published, users can select an npm version or a Git tag:

```sh
pi install npm:pi-turbo@0.1.0
pi install git:github.com/YOUR_OWNER/pi_turbo@v0.1.0
pi list
pi update --extensions
```

Pinned versions/tags remain pinned. To remove a package, pass the configured source
to `pi remove`. Local development can use `pi -e ./src/extension.ts`.

Update the development Pi pin and lockfile together when reviewing an upstream release.
Recheck controller/helper transport, tool exposure/hooks, lifecycle, history/branch
reconstruction, compaction, and package loading against the new version. Describe support
based on verification rather than the broad host peer range.
