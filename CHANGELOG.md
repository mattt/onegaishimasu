# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-25

### Changed

- Update vite-plus to 1.4 and the transitive dependencies with security fixes (#15)
- Update zod to 4.6 (#16)

### Fixed

- Fix release-cycle defects: skip the release PR's own merge, tag the merge commit, handle CRLF bodies, and tolerate provider failures (#11)
- Use structured outputs in the Anthropic provider instead of a forced tool call (#17)
- Tag releases with the version from the merged manifest instead of the release PR title (#19)
