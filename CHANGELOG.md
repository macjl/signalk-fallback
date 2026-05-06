# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-05-06

### Added
- Initial release: monitor any SignalK path and publish a fallback value when no update is received within a configurable timeout
- Three fallback modes: fixed value, last known value, other path value
- Optional source filter (`watchedSource`) to restrict monitoring to a specific `$source`
- Multiple independent rules can run simultaneously
- Automatic deactivation when the source resumes
- Subscribe with `sourcePolicy: 'all'` to receive deltas from all sources regardless of configured priorities
