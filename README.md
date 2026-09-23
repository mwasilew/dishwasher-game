# Dishwasher Packing

A 3D puzzle game about the small daily geometry problem of getting every dish into a
two-drawer dishwasher. Runs in any WebGL browser. No build step, no dependencies to
install, works offline.

Everything you load is a real rigid body: you drag it in, wedge it against its
neighbours, and let go. When you think you are done you close the door and run the
machine — and the machine is the judge. If the racks will not roll home, if a mug is
sitting the right way up, if a baking tray is leaning over the glasses and shading them
from the spray arm, you find out the way you find out in real life.

## Playing it

```
python3 -m http.server 8000        # or any static file server
```

then open <http://localhost:8000>. It must be served over HTTP — ES modules do not load
from `file://`. Desktop-first: it wants a mouse and a keyboard.

| | |
|---|---|
| Click a dish in the tray | pick it up |
| Move the mouse | carry it |
| Wheel | push it further in / pull it back |
| `Q` / `E` | turn (hold `Shift` for 90°) |
| `R` | tip on its side · `F` flip over · `G` face straight down |
| Click | let go |
| Drag a dish already in the rack | pick it up again |
| `Backspace` | put the carried dish back in the tray |
| `Tab` | swap which rack is pulled out |
| Right-drag / middle-drag | orbit / pan the camera |
| `Enter` | run the wash cycle |
| `A` | auto-load the whole level (or the ✨ button) |
| `Esc` | menu · `H` help · `Shift`+`R` restart the level |

## The rules the machine applies

1. **Everything has to be in a rack.** Balanced on the door does not count.
2. **It has to fit under the rack above** and inside the door seal, once the racks roll
   back in.
3. **Open things face down.** A mug, pot or bowl left facing up comes out full.
4. **Nothing below the deck.** A pan handle poking down through the wires jams the
   spray arm.
5. **Nothing shades anything else.** The arms spray *upwards*, and water travels in
   straight lines: the game traces rays from each dish back to the arm below it, and
   an item in shadow comes out streaky. A roasting tin lying flat shields everything
   above it. This is what stops you simply cramming.
6. **Load it where it belongs.** Plates, pots and trays go in the lower rack where the
   spray is strongest; cups, glasses and light plastic go up top. The tray marks each
   item ▼ or ▲.

Three stars means everything fitted, drained, and got clean.

A load the machine refuses — or one that runs badly — costs you nothing. The racks come
back out exactly as you packed them and the dishes at fault glow red until you pick
them up. **Let me fix it** returns you to the load and swings the camera onto the first
offender; **Start over** empties the machine, and is only there if you want it.

## Auto-load

`A`, or the ✨ button, packs the level for you. It is a packer rather than a search,
and it works the way someone who is good at this works: cutlery into the basket, pots
and pans face down on the floor at the back, then plates and trays on edge into the
tine rows in front of them, filling from the back so the floor stays in one piece.

It obeys the machine's rules by construction — right rack, opening down, nothing
overlapping, headroom checked before anything is committed — and it clears the racks
first, because a plan only holds together if it owns the whole machine. It aims for a
load that *passes*, not for three stars, and where it has to put something in the wrong
rack or cannot fit an item at all, it says so.

`node test/solve.mjs` runs it against all twelve levels and puts each result through
the real wash cycle (`FULL=1` runs the cycle at the speed you actually see, spray and
all). All twelve pass. Most come out at two stars, and a given level can vary by a star
between runs — the spray is genuinely stochastic, so a marginal load is a coin toss.

`media/level-1-autoload.mp4` is a capture of level 1 loading itself and running.

## How it is built

| | |
|---|---|
| `index.html` | markup, HUD, importmap |
| `src/world.js` | renderer, camera, lights, the kitchen. The environment map for the steel is generated at runtime from a gradient — there are no image assets in this project |
| `src/physics.js` | cannon-es setup and the shape builders, including the ring-of-boxes trick that gives hollow vessels you can drop a teaspoon into |
| `src/dishwasher.js` | the machine: tub, door, racks, tines, cutlery basket, spray arms, rack rails |
| `src/dishes.js` | the crockery catalogue — lathed profiles for the visuals, cheap approximations for collision |
| `src/grab.js` | carrying a dish on a point-to-point constraint, so it stays a rigid body while you aim it |
| `src/validate.js` | the wash cycle and every rule above, and which dish to blame for each |
| `src/levels.js` | twelve loads |
| `src/solver.js` | the auto-loader: zones the lower deck, then packs it |
| `src/ui.js` | tray, level select, results. Tray icons are drawn from the same lathe profiles as the meshes |
| `src/audio.js` | procedural clinks — ceramic, glass and steel are three filter recipes over one noise burst |
| `vendor/` | three.js r160 and cannon-es 0.20, vendored so the game runs offline |
| `node_modules/` | three-line re-export shims so the Node test resolves the same bare specifiers the browser resolves through the importmap. Not a dependency tree |

### About the dishwasher model

The reference was the [Bosch Series 2 Silence Plus on
Sketchfab](https://sketchfab.com/3d-models/dishwasher-bosch-series-2-silence-plus-bc3f604f44b74fc786dcef7b96d17b71).
That file cannot be fetched programmatically — it needs an account and a licence
acceptance — so the machine here is modelled in code in its style. That turned out to
be the right call anyway: the game needs the tines as collision geometry and the racks
on rails, and a scanned art model carries neither.

If you own the model, drop it in as `assets/dishwasher.glb` and it will be loaded and
scaled to replace the outer shell on the next reload. The racks, door and all collision
geometry stay procedural, because they have to.

## Tests

```
node test/smoke.mjs                       # geometry + physics, headless, no GPU
```

Builds the machine and every item in the catalogue, checks each has sane dimensions
and a sane number of collision shapes, drops all thirty-nine into a rack looking for
NaNs, escapees and tunnelling, then checks the two things the game actually rests on:
that plates stand on edge in the tine rows for six seconds without rolling over, that
cutlery stays in its basket, and that a mug settled in the upper rack rides that rack
in when it slides. It finishes by timing a full load and reporting each
level's item count against rack capacity. Takes about fifteen seconds.

Physics cost is dominated by narrowphase, not the solver, which is why a tine row
collides as one thin wall rather than nine separate prongs and why a mug's inside is a
hexagon. A deliberately over-packed level 12 steps in 8-10 ms and a mid-sized load in 7 ms —
that is the worst case, a jumbled pile where almost nothing settles enough to sleep.
A load you placed by hand is far lighter, because cannon skips narrowphase entirely
for pairs where both bodies are asleep.

```
node test/solve.mjs                       # auto-load every level and judge the result
```

Loads each level with the packer, settles the physics, and runs the real wash cycle
over it. This is the only honest way to know a level is winnable at all — several were
not, and the numbers it produced are what the level list was rebuilt around. A rack
50 cm wide holds one big pan or a row of standing plates, not both.

`test/browser.html` is the integration test: open it in a browser and it drives a real
game in an iframe through the wash cycle, checking that a correctly loaded plate
passes, that a mug the right way up is rejected, that a dish hanging over the front
stops the cycle, and that spray shadowing is detected.

### Development shortcuts

- `?level=7` — jump straight to a level
- `?level=7&fill=1` — tip the whole queue into the racks. Not a solver; it exists to
  exercise the physics under a full load
- `?level=7&auto=1` — auto-load the level on startup

## License

BSD 3-Clause — see [LICENSE](LICENSE). The libraries in `vendor/`
([three.js](https://github.com/mrdoob/three.js) and
[cannon-es](https://github.com/pmndrs/cannon-es)) are MIT-licensed by their own authors.
