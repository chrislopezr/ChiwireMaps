"""How far is the copy of sdCard/ to the SD card? Run it while rsync is copying:

    python3 tools/card_copy_progress.py

rsync walks the source folder in sorted order (names compared byte by byte, so "10" comes before "9").
This script asks rsync which source file it is reading right now (from /proc/<pid>/fd), lists the
source folder in the same order and reports how many files and bytes come before that file.
"""
import os
import subprocess
import sys

SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdCard")
SKIPPED = (".download.lock", "failed.txt")  # the same files the copy command excludes


def current_file(source):
    """Source file an rsync process has open right now, or None between files."""
    pids = subprocess.run(["pgrep", "-x", "rsync"], capture_output=True, text=True).stdout.split()
    for pid in pids:
        try:
            for fd in os.listdir(f"/proc/{pid}/fd"):
                target = os.readlink(f"/proc/{pid}/fd/{fd}")
                if target.startswith(source + os.sep):
                    return target
        except OSError:
            continue  # the process ended while we looked
    return None


def walk_sorted(folder):
    """(path, size) of every file, in the order rsync copies them."""
    entries = sorted(os.scandir(folder), key=lambda e: e.name.encode())
    for e in entries:
        if e.is_file() and e.name not in SKIPPED and not e.name.startswith("download_metrics"):
            yield e.path, e.stat().st_size
    for e in entries:
        if e.is_dir():
            yield from walk_sorted(e.path)


def main():
    source = os.path.realpath(SOURCE)
    now = None
    for _ in range(50):  # rsync opens a new file several hundred times a second
        now = current_file(source)
        if now:
            break
    if not now:
        print("rsync is not copying anything from", source)
        return 1
    files = done_files = total_bytes = done_bytes = 0
    for path, size in walk_sorted(source):
        files += 1
        total_bytes += size
        if path == now:
            done_files, done_bytes = files - 1, total_bytes - size
    print(f"now copying: {os.path.relpath(now, source)}")
    print(f"files: {done_files:,} of {files:,} done ({100 * done_files / files:.1f}%), {files - done_files:,} left")
    print(f"data:  {done_bytes / 1e9:.1f} of {total_bytes / 1e9:.1f} GB done ({100 * done_bytes / total_bytes:.1f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
