# Chiwire Maps — working rules

Always apply these project skills (in `firmware/.claude/skills/`), every task, every session:

- `test-driven-development` and `tdd`: red → green → refactor. No production code without a failing test watched first, failing for the right reason. Test only at seams agreed with the user.
- `ponytail`: smallest complete change. Reuse what exists (codebase, stdlib, platform) before adding code or dependencies.
- `caveman`: terse replies, every technical fact kept.

## How the skills fit together

- User instructions win over any skill. Then: test first (TDD), smallest code (ponytail), short report (caveman).
- The user is new to embedded work: step-by-step instructions stay complete, in full sentences, with exact commands and the expected output (caveman allows this for step sequences).
- Docs, code comments, commit messages and memory files: normal prose (caveman rule 5).
- Refactor runs after green, tests kept green (obra loop). Larger refactors are proposed to the user, not done silently.
- Ponytail's "one small test" floor is replaced by full TDD here.

## Agreed test seams

| Seam | Checks |
|---|---|
| `tests/web/` | Phone-side maths and logic in `sdCard/*.js`: UTM, sun, north, marks, search ranking |
| `tests/e2e/` | The real page in headless Chrome against `tests/e2e/fake_dongle.py`, which mirrors `firmware/include/routes.h` |
| `tests/downloader/` | `tileDownloader/spain_tiles.py`: rate control, retries, failed tiles |
| `tests/search/` | `tools/build_search.py` on a tiny hand-made map file |
| `firmware/test/` | Pure helpers in `firmware/include/pathutil.h`, compiled and run on the PC |
| Build check | The firmware still compiles for the dongle |

## Quality habits

- Reference data: check maths against official published values (NOAA/USNO sun times, GeographicLib for grid convergence, the WMM test values for magnetic declination). Never against numbers worked out by hand.
- Mutation check after green: break the new logic on purpose and confirm a test fails. If none fails, strengthen the test.
  - Web tests: mutate a copy of `sdCard/` and run with `SDCARD_DIR=<copy>`.
  - The e2e fake dongle ignores `SDCARD_DIR`: back the file up, mutate it in place, run, restore it, and confirm with `cmp`.
- Honest reporting: report failing or flaky tests with their output. Correct earlier wrong conclusions openly. Call nothing done until it is verified.
- Device-only behaviour (display colours, SD timing, Wi-Fi range, real GPS output) cannot be tested on the PC. Give the user a manual checklist and ask for the results.
- Look before deleting, and ask before irreversible steps. There is no git history, so deleted files cannot be recovered.

## Safety

- Flash firmware only after the user says the dongle is in flash mode.
- Publish to GitHub only after the user confirms.
- No proxies or other tricks to get around IGN rate limits.
- Never commit tiles or search data. Keep all licenses and the credit to the original project (github.com/diyaquanauts/BackcountryBeacon).

## Test commands (from the repository root)

- Web app on the SD card: `node --test "tests/web/*.test.js"`
- Browser e2e (headless Chrome + fake dongle): `cd tests && node --test "e2e/*.test.js"`
- Tile downloader: `python3 -m unittest discover -s tests/downloader`
- Search data builder: `tools/.venv/bin/python -m unittest discover -s tests/search`
- Firmware helpers on the PC (needs g++): `cd firmware && ~/.platformio/penv/bin/pio test -e native`
- Firmware build check: `cd firmware && ~/.platformio/penv/bin/pio run` (`pio` is not on PATH)
