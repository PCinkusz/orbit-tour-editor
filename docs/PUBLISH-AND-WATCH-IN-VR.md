# Publishing a tour and watching it in VR

This guide takes you from the editor to a link anyone can open, including in a Meta Quest.

## 1. What an export contains

Press **Export** in the editor (or run `npm run export -- --quality vr`). The result is a folder in `exports/`:

```
index.html, assets/      the viewer (no editor, read-only)
tour.json                your tour
media/                   only the videos and images the tour uses
serve.mjs, serve.py,     tiny local web servers (Node or Python) and one-click launchers
start-windows.bat,
start-mac-linux.sh
HOW-TO-PLAY.txt          the same instructions for whoever receives the folder
```

The folder is completely independent of the editor. You can zip it and send it to anyone.

### Playing it on a computer

Double-click `start-windows.bat` (Windows) or run `./start-mac-linux.sh` (macOS/Linux). You need Node.js 18+ or Python 3 installed. It prints an address such as `http://localhost:8080` and opens it. Do **not** open `index.html` by double-clicking: browsers refuse to play video from `file://` addresses, so the tour would stay empty.

## 2. Publishing on GitHub Pages (free)

GitHub Pages serves static files over HTTPS, which VR requires, and supports the byte-range requests that video seeking needs.

### The easy way

1. Install the [GitHub CLI](https://cli.github.com) and sign in once: `gh auth login`. The script needs a Bash shell (macOS, Linux, WSL, or Git Bash on Windows); without one, use the manual way below.
2. From the Orbit folder run:

   ```bash
   npm run deploy:pages -- exports/<your-export-folder> my-tour
   ```

   `my-tour` is the name of the repository to create (use letters, numbers and dashes).
3. Wait about a minute. It prints the address: `https://<your-github-name>.github.io/my-tour/`.

The script removes the local launchers (not needed online), creates the **public** repository if it does not exist, publishes the files as a single commit on the `gh-pages` branch and turns Pages on. Running it again later **replaces** the previous version without making the repository grow.

### The manual way

1. On GitHub create a new **public** repository (for example `my-tour`), empty.
2. In a terminal go into your export folder and run:

   ```bash
   touch .nojekyll                    # on Windows: type nul > .nojekyll
   git init -b gh-pages
   git add -A
   git commit -m "Publish tour"
   git remote add origin https://github.com/<you>/my-tour.git
   git push -f origin gh-pages
   ```
3. In the repository open **Settings → Pages**, set **Source** to *Deploy from a branch*, branch **gh-pages**, folder **/ (root)**, and save.
4. After a minute your tour is at `https://<you>.github.io/my-tour/`.

### Limits and things to know

These are GitHub's documented limits at the time of writing; check the [current documentation](https://docs.github.com/pages/getting-started-with-github-pages/github-pages-limits).

- A single file larger than **100 MB** is rejected; files over 50 MB give a warning. The *Headset-friendly* export keeps typical videos well under that. If a video is still too big, export as **Compact**.
- A published site should stay under about **1 GB**, with a soft bandwidth limit of about 100 GB per month.
- Free accounts need a **public** repository. Anyone with the link can watch, and also download, your videos. Only publish footage you may share.
- To take the tour down, delete the repository or switch off Pages in **Settings → Pages**.
- After you republish, a browser (and especially the Quest browser) may show the old version for a while. Reload the page, or clear the browser cache.

### Other hosts

Any static host works if it serves **HTTPS** and supports **range requests** (Netlify, Cloudflare Pages, your own server, a university web space). Upload the contents of the export folder as it is, except the launcher scripts, which are optional. Each host has its own file-size and total-size limits (for example Cloudflare Pages limits single files to a few tens of MB), so check before choosing. The tour uses relative paths and works from a sub-folder.

## 3. Watching in a Meta Quest

1. Put on the headset and open the **Meta Quest Browser**.
2. Enter the address of your tour. The first video starts loading (use Wi-Fi: a headset-friendly tour is tens of MB per location).
3. Press **Start tour**.
4. Press the **VR button** at the bottom right of the browser window and accept the permission prompt.
5. In VR: point a controller at a marker to see its hover effect, exactly as on a computer. Info markers show their full card while you point at them. Arrows (links) take you to the next location when you pull the trigger or look at them for about two seconds.

> Developed and tested in a desktop browser. The VR part follows the WebXR standard but has not been verified on a physical headset by the maintainer. If something does not work, please open an issue with the headset model and what you saw.

### Without hosting: USB to your computer

For testing you can use the exported folder directly. `http://localhost` counts as a secure address, so WebXR works on it:

1. Enable **Developer Mode** for the headset (Meta Horizon phone app) and connect it to your computer with a USB cable. Accept the USB-debugging prompt in the headset.
2. Install the Android platform tools (`adb`). Start the tour on the computer with the start script and note the port (for example 8080).
3. Run `adb reverse tcp:8080 tcp:8080` (use your port).
4. In the Quest Browser open `http://localhost:8080` and press the VR button.

An address such as `http://192.168.1.20:8080` (your computer's address on the Wi-Fi) loads in the headset but will **not** offer VR, because it is not HTTPS.

A PC with a Quest Link or Air Link connection should also work: open the tour in desktop Chrome and press the VR button. This has not been tested by the maintainer.

## 4. Troubleshooting

| What you see | Likely cause and fix |
|---|---|
| No VR button, or *VR not supported* | The address is not `https://` (or `http://localhost`), or the browser has no WebXR. Use the GitHub Pages link in the Quest Browser. |
| Black sphere, no video | The video is too large or not H.264. Export with **Headset-friendly**. |
| Video stutters in VR | Resolution or bitrate is too high for the headset. Export with **Compact**. |
| First location takes long to start | Slow connection or large files. Use *Compact*, or host closer to your visitors. |
| Links or markers are hard to hit in VR | Increase the marker *Size* in the editor (1.5× or more) and re-export. |
| The old version still appears after republishing | Browser cache. Reload, or clear the site data. |
| `Push rejected, file larger than 100 MB` | Export with *Headset-friendly* or *Compact*. |
| Markers appear a second or two after a location loads | In a headset each marker is rendered once into an image sequence when the location loads (the first time can take a few seconds when there are many large cards). They then play instantly. |
| Sound does not start | Browsers need a tap first. Press **Start tour**. |

## Converting videos by hand

The export does this automatically when ffmpeg is installed. To convert one file yourself (this is the same command the exporter uses for *Headset-friendly*):

```bash
ffmpeg -i input.mp4 \
  -vf "scale='min(4096,iw)':-2" -r 30 \
  -c:v libx264 -profile:v high -level:v 5.1 -pix_fmt yuv420p \
  -crf 21 -maxrate 35M -bufsize 70M -preset medium -movflags +faststart \
  -c:a aac -b:a 128k output.mp4
```

Why these numbers: standalone headsets decode video in hardware with fixed limits. H.264 level 5.1 allows at most 36,864 macroblocks per frame; a 4096×2048 frame uses 32,768, while a 5376×2688 frame needs more than that.

## Moving or backing up a tour

The editable project is the `data/` folder (see the [editor guide](USING-THE-EDITOR.md)). The export is only for **viewing**: keep your `data/` folder if you want to edit again.

`npm run submit` additionally builds a single folder (and zip) with the export, the original project files, the editor source and an automatically written README that lists locations and connections. It was made for handing in coursework, but works for any hand-over.
