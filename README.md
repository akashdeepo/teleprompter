# The RS Teleprompter

The Retired Student channel's teleprompter: a teleprompter for reading Hindi and English scripts through a beam-splitter glass, built for an Android tablet's Chrome. Open it at https://akashdeepo.github.io/teleprompter/ and add it to the home screen. After the first open it works without internet. Scripts and settings stay on the device.

- Paste a whole email: it finds the part to be read (short phrase lines) and leaves out the notes around it. Tap a line to move the start or end.
- Speed is in words a minute. Turning the tablet or changing the text size keeps both the pace and your place.
- `**key lines**` are drawn bold in gold, `[directions]` and `(directions)` are small and grey, `### headings` start a new section, and `...`, sentence ends, blank lines and directions leave space, so a steady scroll gives natural pauses.
- The text is mirrored for the glass. The controls are not, and they fade while reading. Lines already read are dimmed.
- Tap the text to pause or play, and drag it to move. Keyboards, page turners and foot pedals work too: Space or Page Down plays and pauses, Page Up goes back three lines, and the arrow keys change the speed.

- Sections: every `###` heading is listed with its time, and one tap puts it at the reading line, for retakes.
- Back up and restore: one file with every script and your place in it, saved to Downloads.
- Phone remote: tap Remote on the tablet and scan the QR code with a phone. The phone gets play and pause, speed, back and ahead, and the sections. The two connect directly (WebRTC). [ntfy.sh](https://ntfy.sh) is used only to swap connection details when they first find each other, nothing is stored there, and no script text is ever sent.

Tests: `node --test test/` (the script reader), `node test/ui.mjs [script.txt]` (the whole app in headless Chrome) and `node test/features.mjs [script.txt]` (sections, backup, and the phone remote between two separate browser profiles, which needs the internet).

Credits: [Mukta](https://github.com/EkType/Mukta) by Ek Type and [Cinzel](https://github.com/NDISCOVER/Cinzel) by Natanael Gama, both under the SIL Open Font License (`fonts/OFL.txt`). Icons from [Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons), MIT License. QR codes by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) by Kazuhiko Arase, MIT License. The emblem (`brand/emblem.png`) is the Retired Student channel's own mark and is not covered by these licences.
