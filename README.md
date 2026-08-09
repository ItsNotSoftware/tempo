# tempo

**A desktop app for running your day.** Three things in one small window: a time
tracker, a schedule for what's coming, and a notebook for what happened. It's
macOS only, and nothing ever leaves your machine.

- **Track your time.** Add the tasks you're working on and start one. Only one
  timer runs at a time, so switching never double-counts. Group tasks by ticket
  or project, give them an expected time, and get a notification when you go
  past it.
- **Fix a timer you forgot to stop.** Click the clock and type what it should
  have been. `1:00`, `45m` and `1:30:15` all work, and the record behind it is
  corrected to match.
- **Book your meetings.** Put them on the day and see it laid out hour by hour,
  so you know what time you've actually got. You get told five minutes before
  one starts and again when it does, and you can start a timer for it right
  from there.
- **Write things down.** Every day gets a notebook page, and it shows what you
  tracked that day next to what you wrote. You can also keep named notes for the
  things you look up over and over, like deploy steps or an on-call rota.
- **It keeps going when the window is shut.** Closing it just hides it. The
  running timer sits in the menu bar, where you can pause, finish, or start
  something else without opening the app again.

## Running it

You'll need [Node](https://nodejs.org) with [pnpm](https://pnpm.io), and
[Rust](https://www.rust-lang.org/tools/install) with the Xcode command line
tools.

```bash
pnpm install
pnpm tauri dev
```

That opens the app with live reload, so your edits show up as you save.

To build a real app instead:

```bash
pnpm tauri build
```

You'll find `tempo.app` in `src-tauri/target/release/bundle/macos/`. Drag it to
your Applications folder and that's it. Worth knowing: notification buttons only
appear in a properly signed build, so in dev mode you'll get the notification
without the **Start timer** button on it. The menu bar does the same job in the
meantime.
