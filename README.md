# Teleprompter

A teleprompter for reading Hindi and English scripts through a beam-splitter glass, built for an Android tablet's Chrome. Open it at https://akashdeepo.github.io/teleprompter/ and add it to the home screen. After the first open it works without internet. Scripts and settings stay on the device.

- Paste a whole email: it finds the part to be read (short phrase lines) and leaves out the notes around it. Tap a line to move the start or end.
- Speed is in words a minute. Turning the tablet or changing the text size keeps both the pace and your place.
- `**key lines**` are drawn bold in gold, `[directions]` and `(directions)` are small and grey, `### headings` start a new section, and `...`, sentence ends, blank lines and directions leave space, so a steady scroll gives natural pauses.
- The text is mirrored for the glass. The controls are not, and they fade while reading. Lines already read are dimmed.
- Tap the text to pause or play, and drag it to move. Keyboards, page turners and foot pedals work too: Space or Page Down plays and pauses, Page Up goes back three lines, and the arrow keys change the speed.

Tests: `node --test test/` (the script reader) and `node test/ui.mjs [script.txt]` (the whole app in headless Chrome).

Credits: [Mukta](https://github.com/EkType/Mukta) by Ek Type, SIL Open Font License (`fonts/OFL.txt`). Icons from [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons), MIT License.
