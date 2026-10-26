# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-26

### Added

- Initial release.
- Add on-demand rebuild of the release PR, reclassifying entries while keeping manual corrections (#20)
- Generate shorter, user-focused release notes and cleaner published release bodies (#21)
- Drop an unreleased change and its revert from the release notes and version bump (#24)
- Keep a hand-written introduction in the release notes when the release PR regenerates (#25)
- Mark the first release after 0.0.0 with an "Initial release" changelog entry (#26)
- Optionally move a floating major version tag, such as v1, to each new release (#27)

### Changed

- Update vite-plus to 1.4 and the transitive dependencies with security fixes (#15)
- Update zod to 4.6 (#16)

### Fixed

- Fix release tagging, release PR self-inclusion, CRLF parsing, and Copilot CLI invocation (#11)
- Fix the Anthropic provider failing with current Claude models (#17)
- Tag releases with the merged manifest's version instead of the release PR title (#19)
- Keep existing release entries when rebuilding in a repository without tags (#23)
