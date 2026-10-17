# Tile downloader (Spain)

`spain_tiles.py` downloads the map tiles for the SD card from the Spanish National Geographic Institute (IGN, CC BY 4.0). It needs only Python 3 and its standard library.

## What it downloads

The plan is in `plan_spain.json`, and the areas it names are in `areas/areas.json`:

- the whole peninsula to zoom 14, in all four layers (MTN topographic, PNOA aerial, IGN Base, vector);
- the mountain ranges (Pyrenees, Cantabrian/Picos, Sistema Central, Ibérico north and south, Sierra Nevada, Cazorla-Segura) and the Community of Madrid to zoom 16, in the three raster layers.

That's about 3.66 million tiles and 54 GB on a card with 4 KB blocks. At 24 tiles/s it takes about 42 hours.

## Commands

Run these from this folder:

```
python3 spain_tiles.py estimate                                   # size and time of the plan, downloads nothing
python3 spain_tiles.py download --out ../sdCard/tiles --adaptive  # resumable: run it again to continue
python3 spain_tiles.py retry --out ../sdCard/tiles                # only the tiles listed in failed.txt
python3 spain_tiles.py vector --out ../sdCard/vector              # offline vector style, icons and fonts
```

- `--rate` sets the speed in tiles per second (default 5).
- With `--adaptive`, the downloader finds IGN's limit by itself and settles below it (`--max-rate`, default 30).
- `plan_madrid_test.json` is a small test plan (central Madrid): `--plan plan_madrid_test.json`.

## Good to know

- Tiles are saved as `/tiles/<layer>/<z>/<x>/<y>.<ext>`, the paths the dongle serves.
- A tile that fails 4 times is written to `<out>/failed.txt`; `retry` downloads those again later.
- Vector tiles that don't exist (sea) answer 403 and count as missing, not as failed.
- A laptop that goes to sleep stops the download. Run it under `systemd-inhibit --what=sleep:idle:handle-lid-switch python3 spain_tiles.py download ...` and keep the laptop plugged in.
- Tests: `python3 -m unittest discover -s ../tests/downloader`
