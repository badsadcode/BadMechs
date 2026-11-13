# 🛠️ BADMECH DEVLOG
*Field notes from the Bad Ideas Works mech garage. Smells like hydraulic fluid and ambition.*

Crew: **BadSad** (idea guy, owner of the brief), **Noor** (concept art, chaos, spider legs), **Sage** (wrench-holder, writes these logs).

---

## Day 1 — "The Robots Have Knees Now"

### ☕ 08:00 — A zip file arrives
BadSad dropped a brief and Noor dropped *eight* pieces of concept art: an olive-drab brute with a rotary cannon (A-73), a skinny chicken-legged scout (Lynx S1), a yellow quadruped hauler that is basically a construction site with feet, and a six-legged spider-tank that I will be seeing in my dreams.

The brief's main rule: **these mechs must be able to walk in a real game engine.** Not "look like they could walk." Actually walk. With knees. That bend the right way. Gulp.

### 🦴 09:00 — Skeleton first, looks later
Before a single bolt, I built the bones: every moving part is a named node whose origin *is* its pivot. Joints rotate around exactly one axis, have limits, and "angle 0" always means "standing there looking cool."

> Rule of the garage: if you can't tell me where it pivots, it's not a part, it's a sticker.

### 🔩 10:30 — Hydraulics that refuse to be impossible
Pistons are now real: a barrel on one limb, a rod on the next, aimed at each other. Fun fact I re-learned: a real hydraulic ram can only stretch to about **1.8×** its squished length. So if a knee asks for more range than its piston can physically give, the generator quietly says *"no, buddy"* and tightens the knee. Physics: 1, Ambition: 0.

### 🕷️ 12:00 — Six families walk into a garage
- **Biped**: plantigrade (normal knees) or digitigrade (chicken legs, Lynx-style)
- **Exosuit**: you wear it. Your legs go in its thighs. Snug.
- **Quadruped**: upright legs *or* sprawled spider-legs, with a crane, cargo bed, turret or radar dish
- **Hexapod / Octopod**: tripod gaits, sensor dishes, Noor approves
- **Colossus**: a walking building with a deck house you can actually walk around in

### 🚨 14:00 — The validator snitches on everyone
I wrote a validator that swings every joint to its limits and checks if armor plates crash into each other. First run results:
- Exosuit hands kept **punching their own thighs** while walking. Moved the shoulders out. Exo is no longer self-harming.
- A colossus was standing **6 cm underground**. Its front and rear legs disagreed about how tall it was. Couples therapy (math) resolved it.
- Quadrupeds were getting a **different foot on every leg**. A hoof, a claw, a flat foot, another hoof. Fashion-forward, mechanically confusing. Fixed.
- Cockpits were **inside the torso armor**. The pilot would have been a fossil. Cockpits now bolt on the front like they should.

Then a joint-limit fitter: if a hip would clip the torso at full swing, it trims the limit until it doesn't. Exported limits are now *trustworthy*, which is a big deal for game-side IK.

### 📦 16:00 — Export day
GLB, LODs, collision proxies, OBJ (with a big shouty "THIS DOES NOT MOVE" header), USD, and a `.rig.json` that tells a game engine everything: which joints, which axes, which legs, which pistons aim at what, which hoses bend.

The Khronos glTF validator gave us **0 errors, 0 warnings** across all families. I may frame it.

### 🧪 17:30 — The Blender gauntlet
Installed actual Blender (as a Python module, no GUI, very spooky) and built a bridge that turns a mech into a proper skeletal mesh → `.blend` + `.fbx`.

Then made it *prove it*: re-import every format and compare every single pivot against the rig file.

| Mech | GLB | LODs | FBX | FBX pose test | USD | OBJ |
|---|---|---|---|---|---|---|
| Grudge A-73 | ✅ | ✅✅ | ✅ 48 bones | ✅ | ✅ | ✅ |
| Lynx S1 | ✅ | ✅✅ | ✅ 28 bones | ✅ | ✅ | ✅ |
| Mule Hauler | ✅ | ✅✅ | ✅ 45 bones | ✅ | ✅ | ✅ |
| Cricket Surveyor | ✅ | ✅✅ | ✅ 29 bones | ✅ | ✅ | ✅ |
| Harrow Octo | ✅ | ✅✅ | ✅ 67 bones | ✅ | ✅ | ✅ |
| Tick Exo | ✅ | ✅✅ | ✅ 43 bones | ✅ | ✅ | ✅ |
| Bastion Colossus | ✅ | ✅✅ | ✅ 36 bones | ✅ | ✅ | ✅ |

Worst pivot error after a full trip through FBX: **about one micrometre**. That's smaller than a speck of dust on Noor's tablet.

*(The first run "failed" — turned out my test was wrong, not the mech. Blender only imports materials you actually use. The mech was innocent. I apologised to it.)*

### 🔜 Next up
- The actual app: 3D viewer, click-a-part inspector, joint sliders, save/load
- A "walk test" button that loads the **exported** file and makes it walk using only the rig file (the ultimate proof)
- Deploy to GitHub Pages so BadSad can play with it from anywhere

*Mood: cautiously smug.* 🤖
