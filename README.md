# InternetBrowser

**Planned.** A good-looking web browser on Electron without ads and tracking, made as a showcase for Alexey's projects.
Not a daily replacement for Chrome, but ordinary sites (YouTube, GitHub, search) should open and work normally.

[Русская версия](README.ru.md)

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Status](https://img.shields.io/badge/status-planned-lightgrey)](#) [![Built with Claude Code](https://img.shields.io/badge/Built_with-Claude_Code-D97757?logo=claude&logoColor=white)](https://claude.com/claude-code)

Code, tests and docs are written by Claude (Anthropic) in Claude Code. Ideas, testing and decisions - Alexey.

## Status

There is no code yet. The repository holds the design note
([docs/superpowers/specs/2026-10-17-browser-design.md](docs/superpowers/specs/2026-10-17-browser-design.md), in Russian),
which waits for Alexey's go-ahead. This README describes the plan, not a working program.

## What it will do

- **Design:** the Liquid Glass style of the Hub and the calculators, the Paint themes (light, dark and colored).
- **No ads, no tracking:** built-in blocking by open filter lists, with a counter of what was blocked on the current site
  and a switch to turn blocking off for one site.
- Tabs, an address bar with search, **bookmarks and history** (with search), **downloads** (its own list; files go to
  Downloads, where the Download Sorter picks them up), **import of bookmarks and history from Chrome** with one button.
- Nothing about the user leaves the computer: history and bookmarks stay local.

Not planned: sync between devices, Chrome Web Store extensions, an own rendering engine, being the default browser
(maybe later).

## How it will be built

- Electron (Chromium inside), its own interface like the Hub, tabs as WebContentsView.
- Blocking with EasyList and EasyPrivacy through a proven library for Electron, lists updated once a week.
- A start page with quick links (the Hub and other projects), a clock and a Liquid Glass background.
- Russian and English, installation through InstallAll, releases on GitHub, tests without visible windows.
- Laws (automatic checks): blocking on a test page, Chrome import on a sample profile, tabs.

## License

MIT
