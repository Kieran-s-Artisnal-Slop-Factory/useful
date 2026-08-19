# Calculators

Three small calculators under **Calculators** in the sidebar (or search for them with Ctrl/Cmd+K): **Programming** converts numbers between binary, octal, decimal and hex and shows bit operations; **Photography** turns one camera's settings into their equivalents on other sensor sizes and compares two sets of settings in stops; **File transfer** estimates how long a file takes to move at a given network speed. Each page has "by hand" drop-downs that explain the maths. Nothing you type is saved, with one exception: the Photography page remembers which sensor format you picked.

_Describes the code as of v0.2.0 (unreleased; schema v7) — verify against source when in doubt._

## Programming (number conversion)

1. Pick a **bit width** — 8, 16, 32 or 64. The range next to it shows the largest unsigned value and the signed range for that width.
2. Type into any of the four boxes — Binary, Octal, Decimal, Hexadecimal. The other three update as you type. Prefixes (`0b`, `0o`, `0x`), spaces and underscores between digits are all accepted, and hex is case-insensitive.
3. If what you typed is not valid for that box (a `2` in binary, a value that does not fit the width) an error appears under it and the other boxes keep the last good value.
4. In Decimal only, you can type a negative number. Under the Decimal box a "signed: …" line appears whenever the current bit pattern has its top bit set — that is what the same bits mean as a signed number.
5. The **Operations** table shows Bitwise NOT, one's complement and two's complement of the current value, each in binary (grouped in fours), hex, decimal and signed.

The page starts at 5 in 8-bit and goes back to that on reload.

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

## Gotchas

### Programming

- **Negative numbers are shown as two's complement.** Typing −5 in Decimal at 8 bits puts `11111011`, `373` and `fb` in the other boxes; those are the same bits. Decimal is the only box that accepts a minus sign — in binary, octal and hex a negative number is just its bit pattern.
- **Both readings are accepted in Decimal.** At 8 bits, `255` and `−1` are the same value; the box shows whichever you typed and the "signed:" line shows the other reading.
- **Changing the width changes the number.** Going narrower drops the high bits (like moving a value into a smaller register). Going wider keeps the bits but not the sign: 8-bit −5 becomes 16-bit 251, because nothing is sign-extended.
- The box you are typing in keeps your text; only the other three are rewritten. So `0xFF` stays as typed until you edit another box.
- Bitwise NOT and one's complement are the same operation — the table shows both because they are taught as separate ideas.
- Two's complement of 0 is 0, and two's complement of the most negative value (for example −128 in 8 bits) is itself — that is how CPUs behave, not a bug.
- Hex is shown in lowercase; binary, octal and hex are zero-padded to the width; decimal is not.
- Nothing here is saved. Reloading returns to 5 in 8-bit.

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
