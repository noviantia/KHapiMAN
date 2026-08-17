# Publishing KHapiMAN

This is a maintainer guide. End users only need the installation and usage instructions in the project README.

The canonical release path publishes from the public [GitHub repository](https://github.com/noviantia/KHapiMAN) to the public [`khapiman` npm package](https://www.npmjs.com/package/khapiman) through npm trusted publishing. The workflow uses an OIDC token minted for a single run; it does not require a long-lived `NPM_TOKEN`. npm automatically creates provenance for eligible public packages, and the workflow also requests provenance explicitly.

## Trusted publisher configuration

The trusted-publisher relationship must match `package.json` repository metadata exactly. Configure npm with:

| Field                | Value                                                 |
| -------------------- | ----------------------------------------------------- |
| Organization or user | `noviantia`                                           |
| Repository           | `KHapiMAN`                                            |
| Workflow filename    | `release.yml`                                         |
| Environment          | Leave empty unless the workflow is updated to use one |
| Allowed action       | `npm publish`                                         |

Use GitHub-hosted runners, protect release tags and restrict who may publish GitHub Releases. npm trusted publishing does not currently support self-hosted GitHub runners.

The trusted-publishing runtime requires npm 11.5.1 or newer and Node.js 22.14.0 or newer. The release workflow uses Node 24 and upgrades within npm 11 before publishing.

References: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [npm provenance](https://docs.npmjs.com/generating-provenance-statements/).

## Prepare a release

1. Ensure CI passes on Windows, macOS and Linux with Node 22 and 24.
2. Move relevant entries from `Unreleased` in `CHANGELOG.md` into a dated version section.
3. Update the version in `package.json`, regenerate `package-lock.json` from `https://registry.npmjs.org`, and run `npm run check:lockfile`. The CLI reads its version from package metadata rather than a second hand-maintained constant.
4. Confirm that the exact new version is not already present on npm. npm versions are immutable and cannot be overwritten.
5. From a clean checkout, inspect the package contents:

```shell
npm ci
npm run check
npm run check:package-brand
npm pack --dry-run
```

6. Commit the version and changelog changes, then push them to the default branch.
7. Create a GitHub Release whose tag is exactly `v` followed by the new `package.json` version. For example, package version `X.Y.Z` requires tag `vX.Y.Z`. Never create a release for a version that is already published on npm.

Publishing a GitHub Release triggers `.github/workflows/release.yml`. The workflow verifies the tag, package version, lockfile artifact hosts, built CLI version, and actual npm package file set; it refuses a package containing prohibited retired branding. It then executes:

```shell
npm publish --access public --provenance
```

No `NODE_AUTH_TOKEN` or `NPM_TOKEN` secret should be configured for the publish step. If npm reports `ENEEDAUTH`, verify the npm trusted-publisher owner, repository and workflow filename character-for-character, and confirm `id-token: write` is present.

## After publishing

Verify the public artifact rather than the working tree:

```shell
npm view khapiman version dist-tags repository
npx --yes khapiman@latest --version
```

On npmjs.com, confirm that the release shows provenance linked to the expected public repository and workflow run.

## Failed or incorrect release

Do not overwrite an existing npm version. Fix the source, increment the version, add a changelog note and publish a new GitHub Release. Prefer `npm deprecate` with a clear replacement version over unpublishing except where npm policy and an active security incident justify removal.
