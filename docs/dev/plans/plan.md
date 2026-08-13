The purpose of this project is to provide a set of standardized utilities that can be installable offline as a PWA. 

## Features

There are several categories of tools that should exist:

1. Time
    1. Timers
        1. Be able to set timer(s) with 
            1. labels
            2. markdown longer descriptions (rendered as HTML)
        2. configurable to do one or all of the following (and store a preference to auto-fill from when updating in future)
            1. play a sound on completion
            2. vibrate on completion
            3. Show a notification on completion
    2. Timezone conversions
        1. Be able to take two timezones (default to current user timezone), and set a time, then see what time it is in another timezone
        2. Should be able to look up by location what timezone is active
    3. stopwatch
        1. Be able to set a stopwatch with standard lap time semantics
2. Scheduler
    1. An interface to manage 
        1. Events
            1. Date and time
        2. TODO's
            1. Markdown based descriptions
            2. title
            3. Due date
            4. priority
            5. TODO -> In Progress -> Completed workflow
            6. Comments field to add comments about a TODO
            7. Ability to create a recurring TODO
    2. For each should be visible on a calendar, with a TODO list or kanban style UI (like JIRA)
    3. Interface should be inspired by JIRA/LINEAR and donetick
    4. Show notifications with similar settings to the time section
3. Images
    1. Editors
        1. SVG editor
            1. A layer-based SVG editor with basic tools to create SVG's with
            2. Can also add layers that are copy-pasted SVG's to add
            3. Export to SVG or PNG/JPG
                1. Downloadable
                2. Copyable
                    1. as a file
                    2. as text (for svg only)
            4. Have fill and stroke options for layers (that make sense like shapes)
            5. use the editor in `local-sync-template` to start from, but also add the ability to draw shapes
                1. A line segment (with bezier options)
                2. A free-form shape where you can specify the number of edges, and re-organize (like you would in illustrator)
        2. Basic layer-based image editor
            1. crop
            2. rotate
            3. edit metadata
            4. eraser
            5. paintbrush
            6. draw arrows
            7. add text layers
            8. darken
            9. lighten
            10. blur portions
            11. Export (as .png, .jpg)
                1. Downloadable
                2. Copyable
    2. Converters
        1. SVG, AVIF, webp, or tiff to
            1. PNG
            2. jpg
        2. PNG to
            1. jpg
        3. jPG to
            1. png
    3. Background remover
    4. Resizer
    5. compressor
3. Calculators
    1. Should have some sub-sub-categories
        1. Coding
            1. Number conversion
                1. Allow you to convert between the following formats
                    1. binary representation
                    2. hex
                    3. octal
                2. Apply operations like two's compliment
                3. explain how to do each conversion (in a clickable drop-down)
        2. Photography
            1. Equivalent settings calculator
                1. Set the sensor type (micro 4/3, apsc, full-frame)
                2. Set focal length
                3. set shutter speed
                4. set iso
                5. Be able to see the "conversions" across the other formats (e.g. 20mm focal length on micro 4/3 is 40mm equivalent on full-frame)
            2. Light stop calculator
                1. Dial in same settings as equivalent settings calculator, but add a second set of settings and be able to tell difference (e.g. with same everything, micro 4/3 is ~-1/3 stop compared to apsc, etc.)
        3. Networks
            1. File transfer calculator
                1. put in size of file
                2. put in approximate network speed
                3. get time estimate for transfer
4. Generators
    1. CSS
        1. Color Conversion
            1. Be able to convert between any css standard colors, and have a color picker UI
                1. e.g. take a HEX or RGBA and convert to oklch, or RGB, etc.
        1. Gradient Generator
            1. CSS generator for gradients
        2. glassmorphism generator
    2. Regex
        1. Be able to take a regex and generate
            1. golang snippet
            2. rust snippet
            3. JS snippet
            4. python snippet
    3. QR code
        1. Creator
            1. URL's
            2. See https://kieranwood.ca/components/stacks/astro-svelte/editors/qr-code-generator/ for example
        2. Reader
            1. Upload image
            2. use camera
            3. See data in QR code
            4. if it's a link allow it to be clickable as well (but don't automatically click it)

On top of these tools, there should also be the ability to press `ctrl+k` to bring up a quick-action panel (like spotlight search on macos) to access a tool quickly by name

## Technical details

The project was initially generated with [local-sync-template](https://github.com/Descent098/local-sync-template). It should already have all of the necessary peices to be a fully working installable PWA. As such there's a few key peices of technical guidance:

1. this site MUST be fully statically buildable, and not rely on any server
2. Everything should be componentized into either an astro or svelte component
3. The design should be a collapsible sidebar-based layout to navigate through the features, but each feature should be in it's own page
4. Use view-transitions to make it feel like a more native app when transitioning pages
5. The quick-search should use something like pagefind that can generate the search indexes statically
6. Plain CSS (no tailwind or frameworks)
7. Theme should be orange-yellow accented, but plain colors overall (white background, dark-neutral-background, etc.) similar to what already exists in here, but can be tweaked as necessary
