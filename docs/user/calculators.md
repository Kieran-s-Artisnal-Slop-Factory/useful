# Calculators

Four small calculators under **Calculators** in the sidebar (or search for them with Ctrl/Cmd+K): **Programming** converts numbers between binary, octal, decimal and hex, shows bit operations, and walks two numbers through an operation one bit at a time; **Photography** turns one camera's settings into their equivalents on other sensor sizes and compares two sets of settings in stops; **File transfer** estimates how long a file takes to move at a given network speed; **Daily calories** works out what you burn and what to eat to gain, lose or hold your weight. Each page has "by hand" drop-downs that explain the maths. Nothing you type is saved, with two exceptions: the Photography page remembers which sensor format you picked, and the Daily calories page remembers whether you chose metric or imperial.

_Describes the code as of v0.5.0 (unreleased; schema v16) — verify against source when in doubt._

## Programming (number conversion)

1. Pick a **bit width** — 8, 16, 32 or 64. The range next to it shows the largest unsigned value and the signed range for that width.
2. Type into any of the four boxes — Binary, Octal, Decimal, Hexadecimal. The other three update as you type. Prefixes (`0b`, `0o`, `0x`), spaces and underscores between digits are all accepted, and hex is case-insensitive.
3. If what you typed is not valid for that box (a `2` in binary, a value that does not fit the width) an error appears under it and the other boxes keep the last good value.
4. In Decimal only, you can type a negative number. Under the Decimal box a "signed: …" line appears whenever the current bit pattern has its top bit set — that is what the same bits mean as a signed number.
5. The **Operations** table shows Bitwise NOT, one's complement and two's complement of the current value, each in binary (grouped in fours), hex, decimal and signed.
6. The **Operation visualizer** below it takes a second number and shows the working. Enter operand **b** in any of its four boxes (the value at the top of the page is operand **a**), pick an operation — add, subtract, multiply, divide, modulo, AND, OR, XOR, or one of the three shifts — and step through it with **Back** and **Next**. Each step is a sentence, so you can follow it without reading the colours, and the table shows the bits as they are decided. The answer is echoed in all four bases, and the flags underneath say in words what happened to it.

For the shifts, operand b is the number of places to shift rather than a value. For divide and modulo, the **Read the operands as signed** box changes the answer itself; for everything else it only changes how the answer is read.

The page starts at 5 + 3 in 8-bit and goes back to that on reload.

## Photography

**Your settings** (set A): pick your sensor format (Micro 4/3, APS-C, APS-C Canon, Full frame), then enter focal length, aperture (f-number), shutter and ISO. Shutter accepts `1/250`, `0.5`, `2` or `2s`.

**Equivalent settings** lists all four formats, with your own row highlighted, showing the focal length, f-number and ISO that gather the same total light — and so give the same framing, depth of field and noise — with the shutter unchanged. Numbers are snapped to the standard 1/3-stop marks cameras actually offer.

**Light stops — compare a second set** (set B): pick a format, aperture, shutter and ISO. The table gives, per component, how many stops set A sits above set B and a sentence saying what that means for light. Two totals follow: **Image brightness** (shutter, aperture and ISO — how bright the picture renders) and **Total light** (shutter, aperture and sensor area — what drives noise and depth of field). Positive means A is brighter / gathers more.

The sensor format you pick for set A is remembered and preselected next time. It is listed on the Preferences page under "Remembered values". Everything else on the page resets on reload.

## File transfer

1. Enter the **file size** and pick a unit (KB, MB, GB, TB).
2. Enter the **network speed** and pick a unit. Kbps/Mbps/Gbps are bits per second (what ISPs advertise); KB/s and MB/s are bytes per second (what file managers show).
3. Optionally enter a **protocol overhead %** (0–99) to reserve part of the link for headers, encryption and retries.

The estimate shows the transfer time (for example "1 min 20 s"), the same figure in plain seconds, the link speed spelled both ways ("100 Mbps = 12.5 MB/s") and, if you set an overhead, the effective speed after it. The page starts at 1 GB over 100 Mbps.

## Daily calories

Read these four things before you read a number off this page.

**It is an estimate, not a prescription.** The equations behind it were built by measuring groups of people and fitting a line through the results. You are not the average of a group. Two people the same age, height, weight and sex can genuinely burn a few hundred calories a day apart from each other, and nothing you can type into a form will say which of them you are. Treat the number as a starting point, weigh yourself over two weeks, and move the target based on what actually happened to the scale.

**The activity level is the one most people get wrong, and most people pick one too high.** It is a bigger source of error than which equation you choose — moving one step up the list raises the answer by about 11 %. "Moderately active" means real exercise three to five days a week, not a busy day. If you sit at a desk and go to the gym twice a week, you are "Lightly active". If the numbers stop matching the scale after a fortnight, this is the first setting to move down.

**The warnings are cautions, and you can ignore them.** When a plan takes you below your resting rate, below the usual floor for eating without supervision, or faster than about 1 % of your body weight a week, a sentence appears next to the answer explaining why that matters. The answer is still there. Nothing is greyed out and no button stops working — the page tells you what it thinks and leaves the decision with you.

**It remembers your units and deliberately not your measurements.** Metric or imperial is saved and comes back next time. Your age, height, weight, body fat, goal and rate are not saved anywhere, on purpose: settings get copied into backup files, and a body weight is not something that should quietly ride along in one. Refilling the form takes about ten seconds.

### Which equation to pick

- **Mifflin–St Jeor** is the default and the right answer for almost everyone. It is the one dietitians have preferred since a 2005 comparison found it the closest for people of ordinary body composition.
- **Harris–Benedict (revised)** reads a bit higher for the same body. It is here because so many other calculators online use it, so if a website gave you a different number, this is probably why.
- **Katch–McArdle** works from lean mass rather than total weight, so it needs a body-fat percentage and refuses to answer without one. Pick it only if you have a real measurement — a DEXA scan, calipers from someone who knows how to use them. It is the best of the three if you are notably lean or notably heavy and you actually know your body fat, and the worst of the three if you are guessing, because a guessed percentage feeds straight into the answer.

If you enter a body-fat percentage while one of the other two equations is selected, the page says the number is not being used rather than quietly dropping it.

### Using it

1. Choose **Metric** or **Imperial** at the top of the first card. Everything already on the page is restated in the new units — the same body, different words.
2. Fill in sex, age, height and weight. Body fat is optional and only Katch–McArdle reads it.
3. Pick an **activity level** and an **equation**. The sentence under the equation says what it assumes.
4. Pick a **goal** — maintain, lose or gain. For lose and gain, set a rate per week and, if you want, a target weight.

You get three figures: **Resting (BMR)**, what you would burn lying still all day; **Maintenance (TDEE)**, resting multiplied by your activity level; and the big **Daily target**, maintenance adjusted for your goal. Below them, a table shows every step with your own numbers written into the formula, so you can check the arithmetic by hand. With a target weight, a line estimates how many weeks the plan takes.

## Gotchas

### Programming

- **Carry and overflow are different things, and the visualizer shows both.** Carry asks whether the answer fit when the bits are read as an ordinary counting number; overflow asks whether it fit when they are read as a signed one. They come apart constantly. At 8 bits, `0xFF + 1` **carries** but does not overflow — 255 + 1 does not fit, but −1 + 1 = 0 is perfectly fine. `0x7F + 1` **overflows** but does not carry — 127 + 1 = 128 fits as a counting number, but a signed byte cannot hold +128 and the answer comes out as −128. A CPU works both out on every add and lets the program pick which one to care about, which is why C's signed overflow is a bug you can have without anything looking wrong.
- **Dividing by zero is refused, not answered.** There is no integer infinity: a CPU raises a fault and the program stops. The page says so instead of inventing a number.
- **Signed division rounds toward zero, but an arithmetic shift rounds down.** −7 / 2 is −3, and the remainder takes the sign of the number being divided, so −7 % 2 is −1. But −1 >> 1 is −1, not 0 — shifting right always rounds toward minus infinity. They are not interchangeable, however much a compiler would like them to be.
- **The two right shifts are different operations.** Logical (`>>>`) feeds in zeros, so a negative number becomes a large positive one. Arithmetic (`>>`) copies the sign bit in, so a negative number stays negative. Picking the wrong one is a classic bug, so the page keeps them apart rather than hiding the choice.
- **Shifting by the width or more is undefined in C.** The page still gives you an answer — the mathematical one — and says that real processors disagree about it, so you do not write code that depends on what your machine happened to do.
- **Negative numbers are shown as two's complement.** Typing −5 in Decimal at 8 bits puts `11111011`, `373` and `fb` in the other boxes; those are the same bits. Decimal is the only box that accepts a minus sign — in binary, octal and hex a negative number is just its bit pattern.
- **Both readings are accepted in Decimal.** At 8 bits, `255` and `−1` are the same value; the box shows whichever you typed and the "signed:" line shows the other reading.
- **Changing the width changes the number.** Going narrower drops the high bits (like moving a value into a smaller register). Going wider keeps the bits but not the sign: 8-bit −5 becomes 16-bit 251, because nothing is sign-extended.
- The box you are typing in keeps your text; only the other three are rewritten. So `0xFF` stays as typed until you edit another box.
- Bitwise NOT and one's complement are the same operation — the table shows both because they are taught as separate ideas.
- Two's complement of 0 is 0, and two's complement of the most negative value (for example −128 in 8 bits) is itself — that is how CPUs behave, not a bug.
- Hex is shown in lowercase; binary, octal and hex are zero-padded to the width; decimal is not.
- Nothing here is saved. Reloading returns to 5 + 3 in 8-bit.

### Photography

- **"Equivalent" means equal total light, not equal exposure.** At the same f-number, shutter and ISO every format meters the same; a bigger sensor just gathers more of it. The table multiplies focal length and f-number by the crop ratio and ISO by its square, so the picture brightness stays the same while depth of field and noise match. It assumes an ideal lens and sensor: no lens transmission losses, no differences between sensor generations, no diffraction. Treat it as geometry, not a promise about a specific camera.
- Only four fixed formats are offered: Micro 4/3 (2.0×), APS-C (1.5×), Canon APS-C (1.6×) and full frame (1.0×). No 1-inch, medium format or custom crop.
- **Your own row is snapped too.** Enter f/3.0 and your row shows f/3.2, because every displayed value is rounded to the nearest 1/3-stop mark. Focal lengths round to whole millimetres (one decimal below 10 mm). Very small or very large values beyond the usual f/1.0–f/32 and ISO 25–102400 ranges show a computed number instead of a camera-style one.
- **Stops are exact, not snapped.** f/2.8 against f/4 reads −1.03 stops, not −1, because a nominal "f/2.8" is really 2.83.
- Sign convention: each row is "A minus B on that dial". A positive **shutter** or **ISO** row means A is brighter; a positive **aperture** or **sensor** row means A passes or gathers *less* light (higher f-number, higher crop). The totals already account for this — read the sentence next to each number.
- Set B has no focal length on purpose: focal length does not change how much light reaches the sensor.
- Sub-second shutter speeds are always displayed as a fraction, so a typed 0.7 s shows up as "1/1" in the equivalents table. What you typed is still what is calculated.
- Only set A's sensor format is remembered (shown on the Preferences page as `photo_last_format`). Set B's format and all the numbers reset on reload. Picking a format is the only thing on this page that writes anything.

### File transfer

- **Bits are not bytes.** Internet plans are sold in megabits per second; files are measured in megabytes. One byte is 8 bits, so 100 Mbps moves at most 12.5 MB per second. Picking the wrong unit makes the estimate 8× off; the "Link speed" line always shows both spellings so you can check.
- **Decimal units, not binary.** Here 1 KB = 1 000 bytes and 1 GB = 1 000 000 000 bytes, matching how drives and ISPs label things. Windows Explorer's "GB" is a binary unit (1 073 741 824 bytes), so a file it calls 1 GB is about 1.07 GB in this calculator.
- The estimate is a theoretical best case for a steady link: no latency, connection ramp-up, contention or retransmissions beyond the flat overhead percentage you enter. Real transfers take longer.
- Overhead must be below 100 %; at 100 % or above, or with a zero/negative size or speed, the estimate disappears and a message asks for valid inputs rather than showing a stale number.
- The time is rounded to its two biggest units ("2 d 8 h", "1 h 4 min", "1 min 20 s") — under a minute it is just seconds ("10 s") — and it rounds up cleanly: 1 h 59.5 min shows as "2 h", never "1 h 60 min". The seconds line underneath is exact to three significant digits under 100 s and whole seconds above.
- Nothing is saved; the page returns to 1 GB over 100 Mbps on reload.

### Daily calories

- **The longer the plan, the more optimistic it is.** Goal pacing treats a kilogram of body weight as a fixed 7,700 calories, which is the standard rule of thumb. It ignores the fact that a body running a deficit for months quietly burns less than it did in week one, so the same eating buys a smaller loss over time. The "weeks to your target weight" line is worse again: it assumes today's rate holds all the way there and never recalculates as you get lighter. Read it as a direction, not a date.
- **The two floors are different for men and women.** The warning about eating too little appears below 1,500 calories a day for a man and below 1,200 for a woman. Those are the commonly quoted lower bounds for dieting without medical supervision — rules of thumb, not physics, which is why they produce a sentence rather than a locked page.
- **The "too fast" caution scales with your weight.** Losing more than about 1 % of your body weight a week is where more of what you lose starts being muscle. On a 70 kg body that is 0.7 kg a week; on a 100 kg body it is 1 kg. Gaining has a flat caution instead: faster than half a kilogram (about 1.1 lb) a week tends to add fat whatever your training looks like.
- **Those thresholds are metric underneath.** In imperial the caution about gaining appears a shade past 1.1 lb a week rather than at a round 1 lb, because the rule is half a kilogram converted.
- **Katch–McArdle will not answer without a body-fat percentage.** It refuses rather than falling back to another equation, because a number from a formula you did not choose, sitting under a label saying you did, is worse than no number at all. Enter a percentage or pick a different equation.
- **Clearing a field can make the estimate vanish without a message.** Empty the age or weight box and the whole result disappears rather than showing an error. Height is the odd one out: in metric an empty height does the same, but in imperial the feet and inches boxes count as zero, so you get a message asking for a height above zero. Either way nothing stale is left on screen.
- **Switching units rounds your height.** Imperial height is whole feet and inches, so 175 cm becomes 5 ft 9 in, and switching back gives you 175.26 cm rather than 175. Weight comes back clean. If you care about the exact centimetre, set your units before you type.
- If you enter an age over 120, a height over 260 cm or a weight over 400 kg, a caution says the answer is extrapolation — those are outside the range the equations were built from.
- Everything except your choice of metric or imperial resets when you reload. The page starts at a 30-year-old male, 175 cm, 70 kg, moderately active, Mifflin–St Jeor, maintaining — restated in pounds and feet if imperial is what you chose last time.
- None of this is medical advice, and the page is not trying to be. If you are planning a large or fast change, or you have a condition that food intake affects, talk to someone qualified.
