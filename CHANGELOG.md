# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-27

### Added

- Start a publish workflow automatically at each new release's tag (#35)
- Add an init command that sets up a repository for release automation in one step (#37)

## [0.1.0] - 2026-10-26

### Added

- Initial release.
- Rebuild the release PR on demand by running the workflow manually (#20)
- Write shorter, user-focused release notes and clearer release PR details (#21)
- Drop an unreleased change and its revert from the release notes and version bump (#24)
- Keep a handwritten introduction in the release notes when the release PR regenerates (#25)
- Mark the first release after 0.0.0 with an "Initial release" changelog entry (#26)
- Optionally move a floating major version tag, such as v1, to each new release (#27)
- Change the default release branch name to onegai/release (#28)
- Present breaking changes in an initial release as features, without migration notes (#30)

### Changed

- Update vite-plus to 1.4 and the transitive dependencies with security fixes (#15)
- Update zod to 4.6 (#16)

### Fixed

- Fix release tagging, release PR self-inclusion, CRLF bodies, and Copilot CLI invocation (#11)
- Fix Anthropic provider requests being rejected by current Claude models (#17)
- Tag releases with the version in the merged manifest, not the PR title (#19)
- Keep existing release entries when rebuilding in a repository without tags (#23)
- Fix several release bugs, such as wrong tags picked and release PRs opened with nothing to release (#31)
- Respect breaking labels, `!` prefixes, and Release-As footers on dependency-bot PRs (#32)
- Accept correction commands on merged PRs even when no release PR is open (#34)
