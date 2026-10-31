# Orbit — free editor for interactive 360° video tours

Orbit lets you build a virtual tour out of **360° videos**: one video per location, clickable arrows that move visitors between locations, and info points that explain what they are looking at. You edit on your own computer, and the finished tour runs in any modern web browser and in a **VR headset (Meta Quest)** through WebXR. Nothing is uploaded anywhere unless you choose to publish it.

Everything is free and open source (MIT). It was built as a free alternative to tools such as Pano2VR for tours made of video.

**What you can do**

- Add any number of locations, each with its own 360° video (MP4 or WebM).
- Place **link** hotspots (go to another location) and **info** hotspots (text and an image) by clicking in the video, then drag them to fine-tune.
- Choose from 11 marker styles, set size, colour, hover content, idle animation and arrow direction.
- Make hotspots appear only during part of a video (timed hotspots).
- Fade, zoom or instant transitions between locations, per tour or per link.
- Preview exactly what a visitor will get; undo and redo every change.
- **Export** a self-contained folder, with videos converted to a headset-safe size, and **publish it for free on GitHub Pages** so anyone can open it from a link, including in a Quest.

> **Status.** Developed and tested in desktop Chromium. The VR code path (WebXR) follows the standard but has **not yet been verified on a physical Meta Quest by the maintainer**. If you try it on a headset, please open an issue and say what worked.

---

## 1. Install and start the editor

You need **Node.js 20.19 or newer** (22 recommended). Get it from <https://nodejs.org> (choose the LTS version). Nothing else is required.

```bash
# 1. get the code (or use the green "Code → Download ZIP" button on GitHub and unzip it)
git clone https://github.com/PCinkusz/orbit-tour-editor.git
cd orbit-tour-editor

# 2. install and build (first time only; takes about a minute)
npm install
npm run build

# 3. start the editor
npm start
```

Now open **<http://127.0.0.1:4174>** in Chrome, Edge or Firefox. Stop the editor with `Ctrl+C` in the terminal.

Your work is saved automatically in the `data/` folder inside the project: `data/project.json` (the tour) and `data/media/` (your videos and images). **Back up that whole folder** and you have backed up your tour. Moving to another computer means copying `data/` into a fresh copy of Orbit.

Other commands:

| Command | What it does |
|---|---|
| `npm start` | Editor on port 4174 |
| `npm run view` | The same tour in **read-only watch mode**: nobody can change it |
| `PORT=5000 npm start` | Use another port (on Windows PowerShell: `$env:PORT=5000; npm start`) |
| `npm test` | Run the automated tests |

The editor has no login. Do not expose it to the internet (leave the default address `127.0.0.1`).

## 2. Prepare your videos

- 360° **equirectangular** video, aspect ratio **2:1** (for example 4096×2048). This is what most 360° cameras and apps produce.
- **MP4 (H.264)** is the safest format. WebM also works.
- **For headsets:** at most **4096 pixels wide** and **30 fps**. Many 360° cameras record 5.7K or 5.8K, which a computer plays fine but a Quest cannot decode, so such videos stutter or stay black in VR. You don't need to convert anything by hand: the **Export** button does it for you if you have ffmpeg installed (below). The editor itself plays the originals.

Install **ffmpeg** (optional but recommended, used only for export and for the video size check): Windows `winget install ffmpeg`, macOS `brew install ffmpeg`, Ubuntu/Debian `sudo apt install ffmpeg`.

## 3. Build a tour

1. Press **Add location**, give it a name, and **Upload video**.
2. Turn the view to where visitors should look on arrival and press **Use current view** (*Starting view*).
3. Press **Add link** or **Add info point**, then click in the video where it should appear. Drag it to move it.
4. Pick a style, colour and size, write the label and text, attach an image. Use **Timing** to show a hotspot only for part of the video.
5. Add the other locations and connect them with links. Use **Preview** to try the tour as a visitor.

The full walkthrough, every setting and the keyboard shortcuts are in the **[editor guide](docs/USING-THE-EDITOR.md)**.

## 4. Export and share

Press **Export** (top right) and choose a quality:

| Quality | Use it when |
|---|---|
| **Headset-friendly** | Your videos are big. Converts only what a headset cannot play (max 4096 px, 30 fps). Recommended. |
| **Compact** | You need small files, for example for a free web host with limits (max 2880 px). |
| **Original** | Your videos are already small enough. Copies them unchanged. |

You get a folder with the viewer, your videos and a one-click launcher. On a computer: double-click `start-windows.bat` (or run `./start-mac-linux.sh`). It needs Node.js or Python 3 and opens the tour in your browser. There is also a command-line version: `npm run export -- --quality vr`.

### Put it online for free (GitHub Pages)

So that anyone, including a Meta Quest, can open your tour from a link:

```bash
npm run deploy:pages -- exports/<your-export-folder> my-tour
```

This needs the [GitHub CLI](https://cli.github.com) (`gh auth login` once) and a Bash shell (macOS, Linux, WSL, or Git Bash on Windows; otherwise use the manual steps in the guide). It creates a public repository `my-tour` on your account, publishes the tour and prints the address, which looks like `https://<your-name>.github.io/my-tour/`. Manual steps, size limits and alternatives are in **[publishing and VR guide](docs/PUBLISH-AND-WATCH-IN-VR.md)**.

Free GitHub Pages needs a **public** repository: anyone with the link can watch (and download) your videos. Do not publish footage you are not allowed to share.

### Watch in a Meta Quest

1. Put on the headset and open the **Meta Quest Browser**.
2. Type your tour's address (`https://…github.io/my-tour/`), wait for it to load, press **Start tour**.
3. Press the **VR button** at the bottom right of the page and accept the prompt.
4. Point a controller at an arrow and pull the trigger, or look at it for about two seconds.

WebXR only works on `https://` addresses (or `http://localhost`). Details, a USB method that needs no hosting, and troubleshooting are in the **[publishing and VR guide](docs/PUBLISH-AND-WATCH-IN-VR.md)**.

---

## For developers

```bash
npm run dev     # Vite dev server on :5173 (run `npm start` too; it proxies /api and /media)
npm test        # node:test suites for the project model, API, export and submission
```

```
src/main.js        start-up and shortcuts          server/app.js      API: project, upload, media, export
src/state.js       project state, undo/redo, save  server/export.js   exporter (copy / ffmpeg), probing
src/viewer.js      360° stage, markers, VR         server/export-templates/  launchers copied into exports
src/editor.js      locations list and inspector    scripts/           export, submission and deploy helpers
src/markers.js     the 11 hotspot marker styles    test/              automated tests
src/project.js     project model and validation (shared by browser and server)
```

Built with [A-Frame](https://aframe.io) (three.js, WebXR), [Vite](https://vitejs.dev), Node.js and Express. Contributions and bug reports are welcome: open an issue or a pull request.

**Not (yet) included:** accounts or cloud hosting, editing on a phone, stereoscopic (3D) video, hotspots that follow moving objects, and a browser-only editor that needs no installation.

## Credits and licence

Orbit is released under the **MIT licence** (see `LICENSE`). Third-party components keep their own licences: A-Frame and three.js (MIT), Express and Multer (MIT), the IBM Plex Sans typeface (SIL Open Font Licence 1.1), and the marker icons and hover behaviour adapted from the [Marzipano](https://github.com/google/marzipano) project (Apache License 2.0, see `src/markers/NOTICE.txt` and `src/markers/LICENSE.txt`).
