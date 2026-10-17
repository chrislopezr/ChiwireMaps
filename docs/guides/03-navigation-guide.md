# Chiwire Maps 3: Navigation Guide

Field techniques for mainland Spain, with and without the device. Chiwire Maps supports navigation; it doesn't replace a map, a compass and the skill to use them. Navigation is always your own responsibility.

## Contents

1. [Coordinate systems used in Spain](#coordinate-systems-used-in-spain)
2. [Reaching a coordinate square by square](#reaching-a-coordinate-square-by-square)
3. [True, grid and magnetic north](#true-grid-and-magnetic-north)
4. [Reading contour lines](#reading-contour-lines)
5. [Navigation by terrain type](#navigation-by-terrain-type)
6. [Planning a route](#planning-a-route)
7. [When the GPS or the phone fails](#when-the-gps-or-the-phone-fails)

## Coordinate systems used in Spain

**The datum: ETRS89.** Since Royal Decree 1071/2007, Spain's official geodetic system in the peninsula is ETRS89. For hiking it is the same as WGS84, the GPS datum (they differ by less than a metre). Chiwire Maps, current IGN maps and the GPS all use it.

**Old maps use ED50.** Maps printed before about 2010 often use the older ED50 datum, printed in the map margin. ED50 coordinates for the same point are shifted by a large amount, far bigger than the GPS error. Never mix the two: check the datum printed on any paper map or guidebook before copying coordinates from it.

**UTM.** The peninsula spans three UTM zones, each 6° of longitude wide:

| Zone | Longitudes | Covers, roughly |
|---|---|---|
| 29 | 12°W to 6°W | Galicia, western Asturias, western León and Zamora, western Extremadura, western Andalusia (Huelva) |
| 30 | 6°W to 0° | Most of Spain, including Madrid, Sierra Nevada, Picos de Europa |
| 31 | 0° to 6°E | Catalonia, eastern Aragón, the eastern edge of Valencia |

A UTM position reads `30T 440290 4474257`:

- `30` is the zone, and `T` is the latitude band (S below 40°N, T above it, in the peninsula). The band only says north or south of the equator; the zone is what matters.
- `440290` is the **easting**: metres east, with the zone's central meridian at 500,000.
- `4474257` is the **northing**: metres north of the equator.

The digits are metres, so two positions 1 km apart differ by 1000. The map panel shows the UTM position in large type, so it can be read out loud.

**Latitude and longitude** are shown both as decimal degrees (`40.41680, -3.70380`, west is negative) and as degrees-minutes-seconds (`40°25'00.5"N 3°42'13.7"W`). Spanish maps write west as "O" (oeste); the device accepts both.

**On IGN paper maps (MTN25 and MTN50)** the UTM grid is printed every 1 km with its kilometre numbers in the margin, the same numbers the device's grid labels show.

## Reaching a coordinate square by square

The grid divides the land into squares. Instead of following a line, you move from square to square, checking the terrain at each step.

1. **Set the target.** Type the coordinate in **🎯 Go to** ([guide 2](02-using-the-device.md#go-to-a-coordinate)). The Target row shows the square it is in, for example `square E441 N4475`: the square whose bottom-left corner is at easting 441 km and northing 4475 km.
2. **Find your own square.** Read your UTM position: easting 440290 is in column 440, northing 4474257 is in row 4474.
3. **Count the squares.** The target is 1 column east and 1 row north: about 1 km east and 1 km north.
4. **Choose a route through the squares** that follows the terrain: along a valley floor, a ridge, a path. Note the features you'll cross in each square (a stream, a saddle, a forest edge).
5. **Check at each grid line.** When the easting or northing passes a whole kilometre, you've entered the next square. Compare what you see with the map.
6. **Near the target,** zoom in: the grid switches to 500, 200 or 100 m squares (the Motion row shows the size), and the distance in the Target row counts down.

Keep the same zone as your paper map. Near a zone boundary, lock the zone in the north box so the numbers don't jump.

## True, grid and magnetic north

There are three norths, and in Spain they are all within about 2.5° of each other:

- **True north** points to the geographic North Pole. On the device it is the top of the map.
- **Grid north** is the direction of the UTM grid's vertical lines. It differs from true north by the **grid convergence**: zero on each zone's central meridian (9°W, 3°W, 3°E) and up to about ±2.1° at the zone edges.
- **Magnetic north** is where a compass needle points. It differs from true north by the **declination**, which changes with place and time.

**Values across Spain** (from the World Magnetic Model 2025 for late 2026, and the exact grid convergence; east is positive):

| Place | Declination | Zone | Grid convergence |
|---|---|---|---|
| A Coruña | 0.8° W | 29 | 0.4° E |
| Santiago de Compostela | 0.9° W | 29 | 0.3° E |
| Picos de Europa (Fuente Dé) | 0.3° E | 30 | 1.2° W |
| Bilbao | 0.8° E | 30 | 0.0° |
| Madrid | 0.7° E | 30 | 0.5° W |
| Sevilla | 0.1° E | 30 | 1.8° W |
| Sierra Nevada (Mulhacén) | 0.8° E | 30 | 0.2° W |
| Valencia | 1.5° E | 30 | 1.7° E |
| Pyrenees (Aneto) | 1.8° E | 31 | 1.6° W |
| Barcelona | 2.1° E | 31 | 0.6° W |

The declination grows by about 0.15° a year: by the end of 2029, Barcelona's is about 2.5° E. The device always shows today's value for your position in the north box, so you don't need this table in the field.

**Correcting bearings.** The Target row already gives the bearing in all three forms. To convert by hand (east values positive, west negative):

- true bearing → **compass bearing**: subtract the declination;
- compass bearing → true bearing: add the declination;
- true bearing → **grid bearing** (a protractor on the UTM grid): subtract the grid convergence.

Example in Madrid: true bearing 90°, declination +0.7°: compass bearing 89.3°, so about 89°.

In mainland Spain these corrections are small: at most about 2° for magnetic north. Over 1 km, 2° is about 35 m sideways. They matter for long legs in fog or on featureless ground, less for short legs between visible features. A nearby car, phone, metal pole, iron-rich rock or power line can deflect a compass by more than that.

## Reading contour lines

Contour lines join points of the same height. On the MTN topographic layer they are brown, with thicker **index lines** that carry the height. On the 1:25,000 map (the most detailed level, shown at the deepest zooms) the interval is 10 m, with index lines every 50 m. The vector layer shows contours with height labels at zoom 12–14.

| Shape | What it means |
|---|---|
| Lines close together | Steep slope |
| Lines far apart | Gentle slope, or flat ground |
| Lines touching or merging | A cliff |
| Small closed rings | A summit or a knoll |
| V or U shapes pointing **uphill** | A valley, gully or stream bed |
| V or U shapes pointing **downhill** | A spur or ridge |
| An hourglass shape between two summits | A saddle (col, "collado"), often where paths cross a ridge |

To tell uphill from downhill, read the index line heights, or look for streams: they always run along valley floors, downhill.

## Navigation by terrain type

**High mountains (Pyrenees, Picos de Europa, Sierra Nevada).** Paths are marked, but snow, fog or rockfall can hide them. Use handrails: ridges, streams, and the edges of the zoom-16 MTN map. Know your escape routes down before you go up. Watch the daylight row; mountain days run long.

**Mid-mountain forest (Cantabrian Mountains, Sistema Central, Iberian System).** Forest hides landmarks, and the GPS is less accurate under trees. Use the aerial layer (PNOA) to see forest edges and clearings, and the contour shape to recognise valleys and spurs. Tracks multiply in forests and are not all on the map; check the direction at each junction.

**Open plateau (meseta).** Few landmarks, and long straight legs. Grid bearings and square counting work well. Heat and lack of water are the main risks: mark the water points (💧 in the search and the "Points of interest" layer) before you go.

**Canyons and gorges.** The GPS position can be poor between high walls. Escape points are few; know them before entering. Watch the weather upstream: a storm out of sight can flood a gorge.

**Snow and fog.** Snow covers paths and changes the terrain's look, and fog removes all landmarks. Navigate by bearing and distance (Target row), counting squares. Avalanche terrain needs its own training and the avalanche bulletin ([guide 4](04-safety-and-emergencies.md)).

**At night.** Plan to be off difficult ground before dark. The sun row gives the time left. Carry a headlamp and spare batteries; the phone's screen is not a torch.

## Planning a route

**MIDE.** Spanish route descriptions often use the MIDE method (Método de Información de Excursiones), recommended by the Spanish mountain federation (FEDME). It rates four aspects from 1 to 5: the severity of the environment (medio), the difficulty of finding the way (itinerario), the difficulty of the ground (desplazamiento) and the physical effort (esfuerzo, given as the walking time). It is explained at [montanasegura.com](https://www.montanasegura.com/), which also offers planning advice. The ratings are a guide; your own fitness, the weather and the season change them.

**Before you go:**

1. Plan the route on the map. Mark the start, the key junctions, water, shelters and the escape routes with **🚩 Marks**, and save them as a file.
2. Estimate the time from the MIDE rating, or from the distance and height gain, and add a margin for stops.
3. Set a **turnaround time**: the hour at which you turn back wherever you are. Base it on the daylight row and the weather forecast.
4. Check the weather and, in winter, the avalanche bulletin ([guide 4](04-safety-and-emergencies.md)).
5. Leave your route and your expected return time with someone you trust.

**On the way:** compare the map with the terrain at each junction, not only when you think you are lost. Check the time against your plan. Turn back at the turnaround time.

## When the GPS or the phone fails

The device depends on the GPS, the dongle's battery, and the phone's battery and screen. Plan for losing any of them:

- **Carry a paper map** of the area (IGN MTN25 or MTN50, or a hiking map in ETRS89) and a baseplate compass.
- **Write down key coordinates** (start, refuges, escape points) on paper before you go.
- **Keep track of where you are** on the paper map as you walk, so that you know your position when the device stops.

Without the device:

1. **Stop.** Don't keep walking into the unknown.
2. **Orient the map** with the compass: turn it until the map's north points to magnetic north (in Spain the difference is at most about 2°, small enough to ignore for orienting).
3. **Match the terrain to the map:** the shape of the valleys and ridges, streams, paths, buildings. This is called terrain association.
4. **Take a bearing** to where you want to go, and follow it from landmark to landmark.
5. **If you can't work out where you are,** go back along your route to the last place you were sure of, or follow a safe handrail (a path, a track, a valley downhill, away from cliffs).

If you are lost or hurt and it is getting dark or the weather is turning, call 112 early ([guide 4](04-safety-and-emergencies.md)).
