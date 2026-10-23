# Native terminal surface

`TerminalSurface` accepts a stable `TerminalChannel`, `active`, and `onFailure`.
The parent owns socket authentication, transport bounds/deadlines, and closure.
Every connection/context gets a unique nonsecret channel `id`. `subscribe` must
immediately deliver its latest state. `input` returns false when the connection
cannot accept the complete string; it must not partially accept it. `resize`
receives bounded cell dimensions, including while connecting; the parent must
retain the latest size until its transport is ready.

The surface uses the published xterm/headless 6.0.0 CommonJS parser and public
buffer API. Upstream MIT notice: `docs/third-party/xterm-headless-LICENSE`.
Platform detection temporarily supplies only missing navigator userAgent/platform
strings, then restores exact descriptors. The application Babel configuration must
transform class static blocks before the Expo class transforms.

The renderer uses fixed cells and measured monospace width. It paints default,
ANSI256 and RGB colors; bold/italic/dim/underline/strike/overline/blink; invisible
and inverse cells; wide/combining cells; cursor; alternate screen and retained
scrollback. Passive public parser hooks observe cursor visibility/style and mouse
encoding; they return false so the built-in parser still processes the sequence.
It never opens OSC links or writes an OSC clipboard request to the device.

Typing stays in a memory-only composer. Send + Enter sends a complete line; Paste
text respects bracketed-paste mode and removes ESC to prevent an embedded bracket
terminator. Dedicated keys provide application-mode arrows, control letters,
Escape, Tab, Backspace, navigation and deletion. Touches report a left mouse button
when remote mouse tracking is enabled. History controls send wheel reports in
mouse mode, arrows in alternate-screen mode, and otherwise scroll local history.
There is no private browser mouse service or WheelEvent shim.

Output is ordered through one parser write at a time. Limits are 131072 UTF-16
code units per event, 524288 queued/in-flight units, 8 Mi units per connection,
1000 history lines, 120 columns and 48 rows. Input is at most 16384 units. Exceeding
output bounds closes the surface through onFailure, rather than dropping data.
The cumulative bound also limits persistent combining strings and incomplete
control sequences. The parent must close its transport when onFailure fires.

Hidden/background or replaced channels unsubscribe and dispose the parser,
clearing buffers and composer. Only current ready generations can send. Output
frames do not change the keyboard host; sending/clearing/context transitions do,
so delayed native events cannot restore a previously sent secret or reach another
connection. Password input is hidden by default. Nothing persists to storage.

## Evidence and remaining checks

`bun test src/features/terminal/engine.test.ts` executes the actual dependency,
with synthetic channels, plus native-host ownership models and source bindings.
The separate isolated spike proved Expo 55 Metro resolution/transformation and
Hermes bytecode compilation. This installed hermesc does not execute scripts.

Actual React Native/Hermes execution, font-cell geometry, emoji/complex scripts,
IME, native keyboard/paste and physical pointer behavior still need device checks.
Default Unicode 6 widths have known modern emoji limitations. No Unicode addon,
full VT conformance, arbitrary keyboard protocol, or device acceptance is claimed.
