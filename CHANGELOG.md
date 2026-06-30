# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.1] - 2026-06-30

### Added
- Add `sourceSelection` to choose between Signal K priority-based source selection and a specific `$source`.

### Changed
- Subscribe without `watchedSource` using `sourcePolicy: 'preferred'` and `excludeSelf: true` so unfiltered rules follow Signal K source priorities while excluding the plugin's own output.
- Keep `sourcePolicy: 'all'` for rules with `watchedSource`, preserving access to explicitly configured non-preferred sources.

## [0.1.0] - 2026-05-06

### Added
- Initial release: monitor any SignalK path and publish a fallback value when no update is received within a configurable timeout
- Three fallback modes: fixed value, last known value, other path value
- Optional source filter (`watchedSource`) to restrict monitoring to a specific `$source`
- Multiple independent rules can run simultaneously
- Automatic deactivation when the source resumes
- Subscribe with `sourcePolicy: 'all'` to receive deltas from all sources regardless of configured priorities
