# CAD builders and coverage

PICOCEO Builder turns a `RobotSpec` into printable parts with one of 11 parametric builders in `src/cad/`. This page maps the
things people build with a CyberBrick-class kit (1 ESP32-C3, 4 servo headers, 2 motor outputs, up to 6 LEDs) onto
those builders, says what each builder makes, and lists what is still missing.

## How a builder is chosen

If the spec carries `composition.use = true`, the **free-form composer** builds it (see below); the AI sets this for any
idea the dedicated builders do not capture. Otherwise `buildAssembly` (`src/cad/build.ts`) runs
`mechanismFamily(archetype)` (`src/design/spec.ts`) first. That function
matches whole words in the archetype, so `pet_feeder`, `Camera-Slider` and `ferris wheel` all work, but `catapult` does not
match `cat` and `crane` does not match `ran`. If no mechanism family matches, the older robot rules run (snake,
quadruped, arm, rover, turntable, companion, humanoid). The same classifier picks the default parameters
(`familyDefaults`) and the behaviours, so geometry, simulation and firmware always agree.

## Coverage map

Rows are object categories, roughly in order of how often people ask for them. Hobby and desk scale only.

| Category | Typical objects | Builder | Actuation | Status |
|---|---|---|---|---|
| Wheeled vehicles | rovers, cars, trucks, tanks, buggies, phone-stand rovers | `rover` | 2 × B-PG002 or 2 × B-GM001, differential drive | existing |
| Serial arms | 4-DOF desk arms, cranes, excavators, grippers, pick-and-place | `arm` | 4 × B-PG001 | existing |
| Planar arms | SCARA, drawing robots, pen plotters, laser-pointer toys, sorters | **`scara`** | 2 × B-PG001, vertical axes | **new** |
| Pan-tilt heads | companions, desk AI agents, CCTV, turrets, radar, face trackers | `companion` | 2 × B-PG001 | existing |
| Swing levers | boom gates, catapults, trebuchets, flag wavers, flippers, hammers, wipers, drawbridges, railway crossings, metronomes | **`lever`** | 1 × B-PG001, horizontal axis | **new** |
| Continuous rotors | fans, windmills, wind turbines, ferris/display wheels, water/paddle wheels, propeller displays | **`rotor`** | 1 × B-PG002, horizontal axis | **new** |
| Indexing carousels | pet feeders, candy/pill dispensers, sorting trays, rotating displays | **`rotor`** (`carousel`) | 1 × B-PG002, vertical axis | **new** |
| Turntables | product turntables, 3D-scanner stands | `turntable` | 1 × B-PG002 | existing |
| Linear axes (horizontal) | camera sliders and dollies, linear actuators, shuttle conveyors, drawer, sliding-door and curtain openers, syringe pumps | **`linear`** | 1 × B-PG001, rack and pinion | **new** |
| Linear axes (vertical) | lifts, elevators, forklift masts, platform hoists | **`linear`** (`vertical`) | 1 × B-PG001, rack and pinion | **new** |
| Bipeds | humanoids, ducks, chickens, penguins, birds, T-rex | `humanoid` | 4-6 × B-PG001 | existing |
| Quadrupeds | dogs, cats, horses, turtles, lizards | `quadruped` | 4-8 × B-PG001 | existing |
| Serpentine | snakes, worms, caterpillars, dragons, segmented trains | `snake` | 4 × B-PG001 | existing |
| **Anything else** | fish, clocks, plant waterers, waving hands, flowers, animatronic faces, mascots, kinetic sculptures, toys | **`composer`** | up to 4 × B-PG001 / B-PG002, any face, chains allowed | **new** |
| **Driving characters** | ladybug bots, shark / animal cars, ducks on wheels, character vehicles | **`composer`** + `mobility: "wheels"` | rover drive + 2 (servo drive) or 4 (motor drive) joints | **new** |

### Not covered yet (candidates for the next builders)

| Gap | Why it is not covered | Closest builder today |
|---|---|---|
| Steered (Ackermann) cars | needs passive, unactuated wheel joints in the simulator | `rover` (skid steer) |
| Tracked vehicles with real treads | needs a TPU track loop and idler wheels | `rover` |
| Hexapods and 6-leg walkers | 12 servos is 3 kits, and the torque-check grid grows 6^N | `quadruped` |
| XY gantries and claw machines | needs two stacked `linear` axes plus a Z or gripper (3 servos) | `linear` + `arm` |
| Parallel mechanisms (delta, Stewart) | closed kinematic loops; the simulator only does trees | none |
| Balancing robots | needs an IMU control loop in the simulator and the firmware | `rover` |
| Boats, drones | no water or thrust model; kit motors cannot lift a drone | out of scope |

The categories that are covered account for most of the requests in the architecture doc's taxonomy (its
families 1-7). The gaps are mostly multi-kit builds or need simulator features (passive joints, closed loops) before a
builder makes sense.

## Free-form composer (`src/cad/composer.ts`)

Dedicated builders produce fixed body plans, so before the composer a new idea was forced into the nearest one (a fish
became a wheeled rover, a clock became a turntable). With the composer, the AI describes the robot directly in
`spec.composition` and the CAD builds those shapes. All coordinates are world axes at rest: x right, y front, z up, mm.

- **Base and body:** the standard desk base (battery bay, shield, switch, rear cover) carries a neck with a 3 × M3 flange.
  The body sits on the neck and is raised automatically to clear the cover and the deck parts.
- **Shapes:** `box`, `rounded_box`, `cylinder`, `sphere`, `egg`, `capsule`, `cone`, `wedge`, `disc`, `fin`, each sized on
  world axes.
- **Joints** (max 4, ports S1-S4 in order):
  - Each joint mounts on a face (`±x/±y/±z`) of its parent's bounding box: the body, or an earlier joint's member, which
    gives chains.
  - The joint rotates about that face's normal. `swing` uses a B-PG001 with a range; `spin` uses a B-PG002.
  - The servo gets a printed housing with 3 mm walls, a push-fit pocket, M2 ear taps, a cleared horn zone and a lead
    channel back down the neck.
- **Members:** each member rides its horn on a Ø38 hub with the Ø6.5 centre-screw tunnel. Its shape sits `reach` mm out
  in the `point` direction, or on the shaft for `axis`. On a vertical shaft, a member that lies wholly beyond its parent is
  lowered to the parent's height on a strut. That is how a fish tail sits behind the body instead of standing above it.
- **Features:**
  - static shapes fused to the body or a member;
  - `accent` features become a separate glue-on part in the accent colour;
  - shape `led` puts a B-KB003 eye in a pocket on the parent front.
- **Checks:** the existing watertight, interference and motion-sweep checks judge every composition. Failures go back to
  the AI audit step (step 5) so it can refine the layout.
- **Behaviours:** `wave` (all swings in a phased sine), `look` (each joint to both limits in turn), `dance`, and `spin`
  (continuous joints on the shared `spin` drive channel).
- **Driving bodies (`mobility: "wheels"`):** the body rides the rover chassis instead of the desk base.
  - `buildRover(…, mount)` skips the pan-tilt head and phone stand and cuts the neck holes into the deck.
  - The body is centred over the chassis with its centre `standH` above the deck. The chassis keep-out is then carved out
    of it: chassis and deck +2 mm, the electronics canopy, deck parts, wheel arches (+4 mm radial) and 8 mm of ground
    clearance. A large body therefore becomes a shell with wheel arches.
  - The body is raised in 4 mm steps while it would lose more than 65 % of its volume, split into pieces, or put a
    body-mounted servo housing into the keep-out.
  - Ports: with B-PG002 drive the wheels take S1/S2, so joints get S3/S4. With B-GM001 drive (M1/M2), all four headers
    are free. Extra joints are dropped with a warning.
  - Behaviours: the rover's `square`, `patrol` and `spin` (in place), plus the joint behaviours.
  - Firmware drives `wheels[0]`/`[1]` left and right; any further continuous joint follows the left channel.
  - The drive-performance check now runs for any assembly with wheels.
  - Verified: ladybug and shark-car test builds; the simulated ladybug drives 3 s straight and spins in place without
    tipping, with both drive types. Real AI prompts ("ladybug robot that drives around", "shark car that chomps its
    jaw", "duck on wheels that flaps its wings") all chose `mobility: "wheels"` with motor drive and passed every check.
    "Scout rover with a camera" still picked the plain rover.
- **Known limits:**
  - A member always rides its servo hub ~10 mm outside its face, so opening shells (ladybug wing cases, lids) sit above
    the body rather than flush with it.
  - Legged mobility (walking characters with a custom body) is not composable yet; walkers still use the biped and
    quadruped builders.

Verified:
- 4 hand-written compositions in `npm run test:cad`: fish, clock, plant waterer with a chained nozzle, waving hand.
- Simulator: the fish tail tracks 30°, and the clock hand spins.
- Real AI output (Meta Muse): "robotic hand that waves", "plant watering machine", "robot fish", "analog clock" are now
  composed, with every check passing. "Barrier gate" and "walking penguin" still pick their dedicated builders.

## The four mechanism builders

All four sit on the same base (`machineBase`, `src/cad/machine.ts`). That is the desk base tub: an isolated battery bay
(guide s.11), a deck with the shield on the 23 × 24 pitch, the LED hub and the switch cradle, and a screw-on stepped cover
over the controller stack. Each builder adds one actuator on S1 (SCARA also uses S2).

### `lever` (`src/cad/lever.ts`)
- B-PG001 with its shaft along +X. The ears screw onto the outer face of a ribbed deck pillar (guide s.6: open side,
  ears reached from outside). The case hangs through the pillar.
- The lever plate rides the horn (horn recess plus Ø6.5 centre-screw tunnel) and prints on its side (s.7).
- Range -15° to +90°.
- Params:
  - `leverTool`: `boom` (striped boom with tip knob), `cup` (Ø20 catapult bucket), `flag`, or `paddle`.
  - `leverLen`: 50-180 mm.
  - `pivotH`: 44-90 mm. 44 mm is the minimum that lets the hub swing over the switch.
- Behaviours: `raise`, `launch`, `wave`, `tap`.

### `rotor` (`src/cad/rotor.ts`)
- **Horizontal** (`fan`, `windmill`, `wheel`, `paddle`): uses the same pillar mount with a B-PG002 (cservo, no limit). The
  pillar is sized so the swept disc clears the deck parts by ≥ 4 mm and the electronics cover by ≥ 2 mm. The 2 mm is the
  architecture doc's rotating-part gap.
- Rotor styles:
  - fan: 25°-pitched blades, wider at the tip;
  - windmill: lattice sails;
  - wheel: rim, spokes and gondolas;
  - paddle: radial paddles.
- **Vertical** (`carousel`): uses a raised servo tower and an N-cell tray with a Ø6.5 centre tunnel.
- Params: `rotorStyle`, `rotorDia` 60-140 mm (carousel ≤ 120), `bladeCount` 2-8.
- Behaviours:
  - `spin`;
  - `pulse` (speed ramp);
  - `index`: an open-loop burst timed for one cell at 40 % speed.
- The range-of-motion sweep now also turns continuous joints to 5 angles, so rotor clearance is checked, not just assumed.

### `linear` (`src/cad/linear.ts`)
- Rack and pinion. Sizes come from `linearTravel(stroke)`:
  - module-1.5 pinion with ≥ 26 trapezoidal teeth and 0.4 p tooth thickness (≈ 0.5 mm backlash);
  - B-PG001 travel ±90°, so stroke = π × pitch radius, less 1 mm at each end.
- The pinion screws onto the horn and keeps the Ø6.5 tunnel. The servo stands in a generic tower (`towerInFrame`) with its
  case along the rail.
- The carriage wraps a T-rail flange with sliding-fit clearance (+0.20 per wall, guide s.4), so it cannot lift off.
- One end stop is printed in place. The other screws on (2 × M3) after the carriage is slid on.
- `horizontal` lays the rail beside the base. `vertical` stands it as a mast on a foot plate. In both, a tongue overlaps
  the base clamp tab and one M4 screw holds both to the desk.
- Params:
  - `linearOrient`;
  - `linearTool`: `table` (4 × M3 taps), `camera` (1/4"-20 clearance), or `fork` (two 45 mm tines);
  - `stroke`: 60-120 mm.
- Behaviours: `slide`, `lift`, `scan`.

### `scara` (`src/cad/scara.ts`)
- The shoulder B-PG001 sits in a tower raised 4 mm to clear the cover. The elbow B-PG001 drops through the end of link 1,
  ears on top.
- Both axes are vertical, so gravity never loads the servos and the torque check always passes. Tip-over is still checked
  at the zero pose.
- Link 2 carries a Ø10.4 pen holder (Ø10 pen, push fit) with an M3 thumbscrew.
- Ranges: shoulder ±90°, elbow ±120°. At those limits the pen never passes over link 1.
- Params: `upperLen` = link 1, `foreLen` = link 2, both 45-100 mm.
- Behaviours: `draw` (planar IK circle), `sweep`, `wave`.

## Kernel, simulator and firmware support added for these builders

- **Prismatic joints:** `JointDef.type = 'prismatic'` with `pinionR`; limits and commands are in mm.
  - `fk` translates along the axis.
  - `gravityTorque` returns axial force × pinion radius.
  - The range-of-motion sweep translates the moving parts.
  - The simulator uses a Rapier prismatic joint. Its servo state stays in pinion radians, so rated torque, speed and stall
    behave exactly like a revolute servo.
  - The firmware converts mm to servo degrees with `JOINT_SCALE`.
- **Single continuous actuator:** `DRIVE_PINS` can be a 1-tuple, and `drive(left, right)` spins it with `left`. The viewer
  and the simulator also send the left drive channel as `spin`.
- **Intended contacts:** `Build.allowContact(a, b)` exempts a deliberate mesh from the interference and sweep checks
  (pinion ↔ rack, wheel D-bore ↔ motor D-shaft).
- **WASM memory:** the kernel wraps every manifold-3d method up the prototype chain (the instance methods live on the
  embind base classes) and every `new CrossSection`, so `freeAll()` really frees a build. Before this, each voice build
  leaked ~200 MB and long test runs died with `Aborted()` / "memory access out of bounds".

### Movement check (`Build.motionSweep`, check id `sweep`, Step 8 "Movement Test")

Every joint is swept over the whole range it was given, not just its ends. The moving subtree is tested against
everything else every ≤ 6° (or 3 mm), and the first contact is refined to about 1°.

- **Servo travel.** A range beyond the servo's travel (±90° for a 180° servo; ± r·π/2 mm through a pinion) is cut
  to that travel.
- **Narrowing.** A swing that hits something part way is narrowed to the free range, 2° short of the contact. The
  simulator, the behaviours (`behaviorsFor(…, jointLimits(asm))` clamps every keyframe) and the firmware limits then
  never drive the joint into the obstacle.
- **Continuous joints.** Wheels and spin servos must turn all the way round.
- **Status.** The check warns when a joint was narrowed. It fails on free-form layouts when less than 60 % of the
  intended range (or under 20° / 10 mm) is left, or when a continuous joint is blocked.
- **Composer.** A head centred over its parent (a nodding head on a pan member) slides further out until it also
  clears the parent at both swing limits.

### Fit checks: a way in and a cable path (`src/cad/fitcheck.ts`)

Every build gets two assembly checks. They fail free-form (composer) layouts (`Build.strictFit`) and warn on the
archetype builders, whose members carry their servo leads outside (the warning says to clip them along the arm / leg).

- **Electronics can be fitted (`access`).** Each board, module, battery, switch, display and speaker must come out whole,
  as its own shape voxelised at ~1 mm: straight along one axis, or backed out of its pocket as far as it is free and then
  out along another axis (a Claw module out of the back of its frame, then out through the open cover). Parts that come
  off don't block (covers, retainers, sled, straps, decks, members: the `REMOVABLE` names or `removable: true`). Parts on
  other links never block (they come apart at their servo horns). A body on its neck (`liftOff`) blocks only the
  components fitted into it, because it goes on after the base electronics.
- **Wiring routes (`wiring`).** The free space inside the robot is voxelised at ~2.5 mm (a cable bundle) and flooded
  from the controller. Free space is inside a part's convex hull or a declared cable run (`Build.cableway`), and not
  filled by a part or a component. Every display, mic, speaker, battery, servo board, servo and motor must touch the
  flood. Cables cross joints only through cable ports (`Build.cablePort(a, b, label, r?)`).
- **What the composer builds for them:**
  - **Joint cable ports.** For every joint whose member carries something wired, the composer cuts a Ø7 channel. It runs
    from inside the parent out through the wall beside the servo housing, on whichever side lies within the parent.
    Another Ø7 channel runs in through the member's hub to the member's middle, or straight to the leads of the servos
    on it. A port joins the two channels.
  - **Neck cable windows.** Ø7 windows open out of both sides of the neck just above the flange. Leads cross the deck
    instead of dropping onto the battery strap or the PCA9685 under the neck hole. On the Claw base, the deck top
    (5 mm) is a cable run to its two slots.
  - **Claw face leads.** The Claw retainer's cable window sits at the module's bottom edge, with a slot on into the
    head behind it. The key bodies have grooves back to the open end of the pocket, so the module slides in with its
    side keys.
  - **Claw face spot.** The face goes where the module can back out past the neck. If no such spot exists and the
    face stand fits, the face goes on the stand in front of the base.
  - **Slots and magnet bosses.** Where a hollow shell's own wall stands in the way of a board sliding out toward the
    cover, a slot opens in it up to the seam. Magnet bosses stay out of the sled's path (with the boards on it).
  - **Leg leads.** Knee and ankle leads are clipped along the thigh and shin plates, with one cable port per leg joint.
  - **Slim members.** A member that is mostly its next servo (a thin neck carrying the head servo) has no room for an
    inner channel past it. That lead is clipped along the outside: an external port, plus a build step that says so.

## Electronics platforms

`spec.platform` comes from the component directory (`platformOf` in `src/catalog/components.ts`).
- **CyberBrick** is the default.
- **LicheeRV Claw** is used when the directory has a `LICHEERV-NANO-W` and no `B-XA003`.
- **XiaoZhi / Raspberry Pi / Jetson** voice robots are described in the voice-robots section below.

**The Claw module is the head.** Every robot with a head mounts it as the face through `clawFace` (`src/cad/claw.ts`).
The module stands upright in a frame with the LCD forward. The frame has a bezel, an LED/switch window, an open chin
for USB-C, one key plunger out of each side wall (the board has one key on each side edge) and a screw-on retainer at the back. `clawDeck` replaces the CyberBrick
shield stack with a PCA9685 (the module has its own battery and speaker). `bayBattery` puts a 1S2P 14500 servo pack in
the twin-cell bays. A Claw composition with no joints has no base: the body stands on its own flat bottom (round shapes
lose their lowest 12 %), has a solid floor and a USB-C cable slot at the back, and opens at its magnet seam.
- **Pan-tilt head (companion, rover):** the face sits in front of the tilt bracket. Nose-up tilt is limited to 15°.
- **Rover without a head:** the face stands on the deck front, like a dashboard. B-GM001 drive falls back to B-PG002
  with a warning.
- **Humanoid:** the face is the front of the head shell. The deck and head are 8 mm deeper for the PCA9685, and a
  mouth slot takes a right-angle USB-C plug.
- **Quadruped:** the face is on a neck at the front, with the snout below it and the ears on top.
- **Snake:** the face stands in a hood on the head cowl. The snout is 19 mm longer for the PCA9685.
- **Composer:** the face goes on the joint named head/face/neck/eye, or else on the body. It takes the first spot on
  the front that is clear of servos mounted there.

`scripts/facetest.ts` checks that nothing covers the central 24 × 24 mm of the LCD from the front.

**Electronics must be fittable** (kernel `accessCheck`, every build). No electronic part (controller, board, battery,
LED, speaker, sensor and so on) may be walled in on all six sides by a single printed part. Walls from two or more
parts are fine, because one comes off.

In the composer, a body or member that carries electronics (the Claw face, LED eyes) is printed as an open shell:
- **Shell:** a 2.4 mm shell from a scaled-down copy of the shape. Every shape except wedge and fin can be hollowed,
  including the new `prism` A-frame.
- **Seam:** a plane in y, behind the electronics, that stays clear of servo housings and has room for two magnets.
- **Fixed half and cover:** the half on the neck or horn stays. Its neck, flange or hub zone is kept, so the cover gets
  a notch and still lifts straight off. The other half is a cover held by two Ø10 × 2 magnet pairs, buried in bosses on
  the seam.
- **Accents and slivers:** accents split at the same seam, and slivers stay on the fixed half, so the cover prints as one
  piece.

Features placed in mid-air are pulled in toward their parent until they touch it.

Machines without a head use the rear console. On the Claw, `machineBase` returns `clawBase`:
- The base is the same footprint, with a 1S pouch in the tub and an optional PCA9685 under the deck.
- The rear console stands 46 mm tall with the LCD window and the key plungers.
- Builders read `base.coverTop` / `base.ledBudget` instead of the CyberBrick constants (29.5 mm, `leds`):
  - The rotor pillar and the carousel and turntable towers rise until the swept parts clear the console by 2 mm.
  - The composer lifts bodies that reach over it.
  - There are no LED eyes (the screen is the face).

| Builder | Claw layout |
|---|---|
| companion, rover, humanoid, quadruped, snake | yes: the module is the head's face |
| composer | yes: face on the head joint or the body. `mobility: "wheels"` falls back to a desk piece with a warning. 0 joints = no PCA9685 |
| arm, turntable, lever, rotor, linear, SCARA | yes: rear console (no head). Towers rise over the console |

Firmware: `firmwareFiles` dispatches to `clawFirmwareFiles` (`src/design/firmwareClaw.ts`). It writes a python3 app:
- PCA9685 over i2c-dev;
- the keys and LEDs through sysfs GPIO, and the face on `/dev/fb0`;
- a TCP line-command server on port 8765;
- an init script.

The ZIP puts the files in an `app_<name>/` folder.

### Shape library and the cover rule (`src/cad/shapes.ts`)

The composer has 68 shapes (`SHAPES` in `src/design/spec.ts`, mirrored by `SHAPE_ENUM` in `server/design.mjs`). Any shape can be a body, a head or another member, or a feature:

| Group | Shapes |
|---|---|
| Basics | box, rounded_box, cylinder, sphere, egg, capsule, cone, wedge, disc, fin, prism |
| Domes and caps | dome, arch, arch_top, helmet, bowl, saucer |
| Rings | torus, hoop, tube |
| Turned profiles | frustum, bell, vase, gumdrop, barrel, pear, teardrop, hourglass, spinning_top, acorn, mushroom, puck, drum, mug |
| Prisms and polyhedra | pyramid, trapezoid, triangle, pent_prism, hex_prism, oct_prism, gem, crystal, chamfer_box, soft_cube, house, lantern |
| Screens and characters | crt, monitor, cat_head, bear_head, bunny_head, ghost, cloud, blob, bean, beak, horn |
| Flat cut-outs | star, heart, crescent, cross, leaf, shield, wing, stadium, semicircle, petal, bubble |

- **Sizing:** each library shape is built in a unit cube, then stretched to fill exactly the size it is given (within 2 %). Unit shapes are cached per build.
- **Flat cut-outs:** drawn in the plane of the two larger sizes; the smallest size is the thickness.

**Cover rule: any shape can be the shell over the electronics.**

1. **Even shells on any shape.** Shells are hollowed with `erode`: the shape intersected with copies of itself shifted by the wall along the 6 axes and 8 diagonals. This gives an even 2.4 mm wall on convex and concave shapes alike (a cat_head, a cloud, a heart). A shape only fails when its inside is under 12 % of it (thin points). The 0.8 mm core skin uses the 6 axis shifts only.
2. **Core chamber.** If a voice body can't hold the core even grown 1.5×, it is unioned with a core chamber: a rounded box just large enough for the sled and the lowest face block, standing on the floor at the centre. Growth then picks the size where the shape hides the chamber best (≤ 12 % showing ends the search). The "Core chamber" check reports how much shows, and warns above 35 %.
3. **Faces stay clear.** In front of every face (Claw screen, voice display / mic / speaker block) a 120 mm view corridor is cut out of every feature on any part. A visor, hat brim or plate can cover the body, but never the screen, mic or speaker.
4. **Tests.** `scripts/shapetest.ts` checks every shape's size, that it's one solid, and its inset. It then builds every shape three ways: as a Claw body with the face, as a XiaoZhi voice body, and as a Claw head. `facetest` has cover cases: a visor, a shield on a cloud, and a plate rising in front of a head's screen.

### Walking legs on the Claw kit (`src/cad/legs.ts`)

A composition with `mobility: "legs"` turns the Claw base tub into a pelvis on two 4-DOF legs. This is for MicroDuck / Open Duck / BD-X style bipeds and walking pets. The body, neck and head are composed above it as usual, and the Claw screen is the face of the head joint.

- **Joints:** hip, knee and ankle pitch plus an ankle roll: 8 micro servos on PCA9685 S1-S8 (hips 1/2, knees 3/4, ankles 5/6, ankle rolls 7/8, left/right). The composition's joints use S9 and up.
- **Ankle roll:** a servo lies under each ankle block, shaft forward (+y), and the foot rides its horn on a hub plate in front of it. Rolling both ankles the same way leans the whole robot sideways over one flat foot, which unloads the other so it can lift and step. Range ±20°; the roll housing clears the shin over ±25° of ankle pitch and the sole clears the roll housing over ±20° of roll.
- **Narrow legs:** the hip and ankle servos point their shafts outward and the knee servo inward, so each leg zig-zags within ~64 mm of the centre line. The hip housings sit on the tub's side walls; each link is a plate on the horn that carries the next servo's housing.
- **Sizes:** thigh = shin = `legLen / 2`, clamped to 44-60 mm, so the knee clears the tub over the hip's ±35°. Ranges: knee ±60°, ankle ±25°.
- **Feet:** wide soles, 48 mm across and `footLen` long, centred on the roll axis. The composer then grows them forward or back under the robot's centre of mass, by a margin of a quarter of its height (22-55 mm, ≤ 140 mm long). The support polygon is the hull of both feet.
- **Ride height:** the leg links are added after the base link, then the whole robot is lifted onto its feet.
- **Behaviours (`legBehaviors`):** `walk` leans onto one foot (ankle rolls), swings the other leg forward with its knee bent, sets it down, comes back to the middle and steps with the other leg. `dance` sways side to side on the ankles; `bow` and `nod` as before. The foot is kept flat in pitch with ankle = knee − hip. The head is held still while walking.
- **Walking balance (check `walk_balance`):** leaning 15°, each ankle servo holds half the robot's weight times the height of its centre of mass. Above 45 % of the servo's rated torque the check warns. The simulator shows such a robot rocking and tipping: a big screen head high on a long neck is too much for micro servos. `simtest` walks a headless legged pet 10 s: it moves forward with the feet lifting and does not tip.
- **Analysis:** a "Standing load on the legs" check puts half the robot's weight on a thigh / shin lever in a 30° crouch. The torque check only varies the joints in a servo's own chain (ancestors and descendants), so 8+ servos stay fast.
- **Head and neck centring:** a joint named neck / head / face on a side (±x / ±y) face moves its member back onto the parent's centre line on a strut, so a nodding head sits over its neck, not beside it. The strut joins the near end of the member. When the member would touch the parent there, it slides up to 60 mm further out along its pointing direction.
- **Face placement:** the face goes on the head at the end of the chain (`headOf`): "head" on "head_pan" gets it, not the pan block.
- **Other platforms:** CyberBrick (4 servo headers) and the voice platforms fall back to their usual base, with a warning.

### Voice robots: XiaoZhi, Raspberry Pi, Jetson (`src/cad/voicecore.ts`)

`spec.platform` is `xiaozhi`, `rpi` or `jetson` when the directory's main board is an ESP32-S3 (XiaoZhi core, DevKitC,
XIAO S3), a Raspberry Pi (5, 4B, Zero 2 W) or a Jetson (Nano, Orin Nano). The composer then always builds a standalone
body (no CyberBrick base, with or without joints) and puts a **voice core** inside it.

**Parts.** The CAD sees the spec, not the directory. It reads `spec.voice` (a `VoiceParts` object: board, mic, amp,
speaker, display, servoBoard, servo, spinServo, battery, buck; `null` = none, so `display: null` builds a robot with no
face). The app sets it with `voicePartsFor(platform, directory)`; without it the platform's kit preset is used
(`VOICE_DEFAULTS` = the `xiaozhi_voice`, `rpi_voice`, `jetson_voice` kits).

**Layout (`coreLayout`, `buildVoiceCore`).** One printed **core sled** (link `base`), screwed to the 4 mm body floor
from below with 2 × M3×10:
- **Deck (level 0):** the battery in a cradle rim (+1.0 / +1.5 swell margin, hook-and-loop strap), the 5 V buck and the
  servo board on 3 mm bosses at their STANDARD hole patterns, the MAX98357A in a rim. They are shelf-packed in rows
  (rotation allowed); the packer tries widths from the board width up to +45 mm and keeps the smallest width + depth.
- **Shelf:** 2.5 mm on two 5 mm side walls over the deck (the deck height is the tallest level-0 part + 2 mm). A
  16 × 8 cable pass-through at the front.
- **Board:** on Ø5.8 standoffs (≥ 4 mm, STANDARD standoff) at its STANDARD hole pattern, or in a 2.5 mm rim when it has
  no holes (ESP32-S3 DevKitC). Its power / USB edge faces the rear wall.
- **Pi HATs** stack on the 40-pin header from the board's min-x / GPIO corner: servo HAT, UPS HAT, then the ReSpeaker on
  top (its mics face up). Each HAT carries a 51 × 5 mm stacking-header block that bridges down to the part below it, so
  the stack is one connected body.
- **USB mic (Jetson preset):** plugged into a rear USB-A port, poking out of the I/O window.

Typical cores (sled width × depth × height): XiaoZhi DevKitC 59 × 75 × 36 mm (84 wide with a PCA9685), Pi 5 + ReSpeaker
98 × 71 × 51 mm, Jetson Nano 110 × 84 × 61 mm.

**Body cuts:** a rear I/O window over the board's connector edge (≥ 14 × 9 mm, the USB-C plug body), two counterbored
M3 holes in the floor, Ø1.8 sound ports through the top over each ReSpeaker mic, and 3 mm vent slots over the Pi /
Jetson. The top openings skip the servo housings and the face block.

**Face block (`voiceFace`, front cover).** The display, the INMP441 mic and the speaker sit in pockets of one block
(5 mm margins, 4 mm gaps, 1.5 mm bezel). The block layouts are:
- row: mic | display | speaker;
- stack: the display, with the mic over the speaker beside it;
- column: all three stacked.

Each part has an opening in front of it:
- **Display:** a window over the active area (round Ø33 for the GC9A01; 28.5 × 33.2 for the 1.69", 31.1 × 41.3 for the
  2.0"; the SSD1306 glass offset).
- **Mic:** a Ø1.6 sound port.
- **Speaker:** a Ø2 grille on a 3 mm pitch (35 % open).

One screwed retainer plate (2 × M2×6) closes the pockets from behind, with a pad behind each thinner part and a cable
window per part. The block sits 1 mm proud of the front surface. On curved fronts it sinks in (≤ 30 mm) until the
retainer is inside the shape, and the openings cut through the shell in front of it.

**Face on the head.** With a joint named head/face, the block splits. The display (and an I2S mic) goes on the head
member, and the speaker (and the mic, if it didn't fit on the head) goes on the body front. The head grows (never shrinks)
to hold the smallest display block. A round head grows to 1.45× the block, or 1.6× when it carries a servo of its own,
such as an antenna. That servo also makes the head deeper (servo width + 12 mm), so the block clears it. If the head
can't take the block, the whole block goes on the body.

**Placement and growth.** The composer grows the body until everything fits:
1. Each axis grows to the core's bounding need.
2. Then all three axes grow together in 5 % steps, capped at 1.5× and the 250 mm print bed, until three things hold:
   - a face spot exists on the front, clear of the floor and the body servo housings, with a 40 mm view corridor;
   - the core envelope (sled + 1 mm) fits inside the 2.4 mm hollow;
   - the core is clear of the housings and of the block.
3. The core goes as far forward as it fits: just behind the block, or under it when the block is higher than the core.
   So it comes out with the cover.

The body seam is just behind the face retainer, and the front half is the magnet cover. When the side walls are steep
(prisms, wide bodies), a second magnet pass sets the bosses up to 18 mm in from the wall, on a rib out to the wall.

**Driving voice robots (`src/cad/voicedrive.ts`).** With composition `mobility: "wheels"`, the body rides a printed
drive plate instead of standing on the desk:
- **Plate:** 5 mm thick, with a 3 mm tray lip round the body's foot. The core's two floor screws (M3×16) go up through the plate, so one pair holds plate, body and sled together.
- **Drive:** continuous micro servos (FS90R) hang under the plate between pillar pairs, with Ø44-52 wheels on their horns. The wheels sit fully under the plate. They run on the core's servo board, on the channels after the joints.
- **Wheel count (`wheelCount`):**
  - 2: two drive wheels behind the middle, plus a front skid dome (a tripod).
  - 4: a pair at each end, steered like a tank, with Ø44 wheels. A foot shorter than ~95 mm falls back to 2 wheels with a warning.
- **DC gear motors (GA12-N20, catalog `N20-MOTOR`):** used when the directory has them (`voice.driveMotor`). The PCA9685 can't power a motor: its outputs are ~25 mA logic signals. So each motor runs through an H-bridge module whose inputs take servo board channels, like the Adafruit / Waveshare motor HATs:
  - **DRV8833** (default, 2.7-10.8 V): 2 channels per side, PWM on IN1 forward / IN2 reverse.
  - **TB6612FNG** (4.5-13.5 V, not on 1S): 3 channels per side, PWM + 2 direction pins.

  On 4 wheels, each side's pair runs in parallel on one bridge. Each N20 sits in a block under the plate, gearbox against a 2 mm end wall (2 × M1.6), closed by a strap (2 × M2). The wheel hub takes the Ø3 D-shaft. The driver module sits in a rim under the plate. A missing driver gives a warning that asks for one. The robot app caps the PWM so a 6 V motor sees ~6 V from a 2S pack (`MOTOR_MAX_DUTY`).
- **Ride height:** everything is built below the body floor, then the whole build is lifted onto the wheels. The body sits about 50-58 mm above the floor.
- **Robot app:** wheels are links `wheel_L` / `wheel_R` (plus `wheel_LF` / `wheel_RF`). Each wheel has a `DRIVE_SIDE`, and the app offers the AI brain a `drive` tool (forward / backward / left / right, ≤ 3 s, then it stops by itself).

The LicheeRV Claw kit still builds a wheeled composition as a desk piece.

If the body still doesn't fit, the side joints (±x / ±y) move up to the shoulders: above the sled, mid-depth. The fit is
then retried, and a "Joints moved" check reports it. Past the cap, the fit fails with a clear check and never balloons.

A joint housing that would float off a sloped wall (a prism side) moves in along the face normal onto the real surface.
A member that would hit a wall sloping out under it stands off along the normal (≤ 30 mm) on a slanted bar.
Their housings use the directory's micro servo (SG90, SG92R, MG90S; FS90R for spin).
Standard-size or bus servos (MG996R, DS3218, ST3215) get a warning and fall back to the micro housing. The servo leads
run inside the hollow to the servo board. `build.ts` warns when an archetype builder (not the composer) runs on a voice
platform.

## Tests

- `npm run test:cad`: 40 variants (17 robot archetypes, 19 mechanisms, 4 free-form compositions), all must pass the
  watertight, interference and sweep checks.
- `npm run test:sim`: adds checks that the lift tracks +40 mm against gravity, the slider reaches -30 mm, the gate raises
  to 85°, the fan and the feeder spin, and SCARA reaches its target.
- `npm run firmware:dump -- <dir>`: now also writes `lift`, `fan`, `gate` and `scara`, and four LicheeRV Claw app
  packages (`claw_*`).
- LicheeRV Claw: 14 more selftest variants on `platform: 'licheerv_claw'`.
- Voice robots: 20 selftest variants, 6 per platform (xiaozhi, rpi, jetson): rounded_box / egg / prism, with and
  without a display, 0 / 2 / 3 / 4 joints. Two more cover other boards (a XiaoZhi AI core; a Pi 4B with servo HAT + UPS
  HAT + ReSpeaker stack). Voice builds must pass watertight, interference, attachment, access and sweep outright: a warning
  counts as a failure. `scripts/facetest.ts` adds 9 voice display cases: the central 70 % of the glass must be clear from
  the front.
