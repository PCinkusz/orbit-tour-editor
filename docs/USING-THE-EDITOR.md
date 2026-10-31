# Using the editor

This guide explains every part of the Orbit editor. If you are new, read the quick start in the [README](../README.md) first.

## The screen

| Area | What it is for |
|---|---|
| **Top bar** | Tour title (click to rename), undo and redo, save status, **Edit / Preview**, **Tour settings**, **Export** |
| **Left: Locations** | Every location in your tour. Click one to open it. Use the arrows in the header to move the selected location up or down, and **Add location** at the bottom |
| **Middle: the view** | The 360° video. Drag to look around, scroll to zoom. The transport bar at the bottom plays, pauses and seeks the video |
| **Right: Inspector** | Settings for the selected location, or for the selected hotspot |

Changes are saved automatically a moment after you make them (the top bar says *Saved*). Everything lives in the `data/` folder of the project.

## Locations

- **Add location** creates a new one and selects its name so you can type straight away.
- The **name** appears in the visitor's menu and as the label of links that lead there.
- **Delete** a location with the bin icon in the inspector. A message offers **Undo**; links that pointed to it are removed.
- **Reorder** with the up and down arrows in the Locations header. The order is the order of the visitor's locations menu.

### Video

Press **Upload video** (MP4 or WebM) and wait for the upload bar to finish; this just copies the file into `data/media/`. After the video loads, the inspector shows its size and length. If it is wider than 4096 pixels, a note explains that headsets may not play it; the editor and normal computers still do, and **Export → Headset-friendly** converts it for you.

**Replace video** swaps the file for this location. Your hotspots stay.

### Playback

- **Repeat video:** loop the video when it ends (on by default).
- **Speed** and **Volume** for this location.

### Starting view

Look at the direction visitors should face when they arrive, then press **Use current view**.

## Hotspots

There are two kinds:

- **Link**: takes the visitor to another location.
- **Info point**: opens a panel with a title, text and an optional image.

### Adding and moving

1. Press **Add link** or **Add info point**. A banner appears: *Click in the video where it should appear*.
2. Click the place in the video. The hotspot is created and selected.
3. **Drag the marker** in the view to move it. Press `Esc` while placing to cancel.

Click a hotspot in the list, or its marker in the view, to select it. The **back arrow** at the top of the inspector returns to the location. The bin icon deletes it (with **Undo**).

### Content

- **Link:** a *Label* (shown on hover) and *Leads to* (the destination location).
- **Info point:** a *Label* (the marker's short name), an optional *Panel title*, a *Description* (shown in full, line breaks are kept) and an optional *Image*. The image is shown in the hover card, in the click panel, and as a preview in the inspector.

### Look

Pick one of eleven styles. The picker shows the real marker in your chosen colour.

| Style | Looks like |
|---|---|
| Info disc | solid disc with a white rim; card swings in on hover |
| Plus ring | hollow ring with a plus that turns into a cross while its panel is open |
| Sonar | small dot that sends out ripples; caption pops up above on hover |
| Expanding tile | white tile that grows into a card with all the text and image |
| Reveal card | coloured label card with a panel that slides out under it |
| Bare arrow | just a large arrow (or an info ring) |
| Speech bubble | bubble with a tail and the label |
| Label pill | capsule with icon and label |
| Dot | the quietest marker, a small dot |
| Target ring | two concentric rings |
| Pointer | disc with a pointer that turns to a direction |

- **Size** from 0.5× to 2.5×.
- **Colour:** pick one or type a hex value such as `#25aae1`. Text and icons on the marker switch between dark and white automatically so they stay readable.
- **Arrow direction** appears for arrow-type styles: choose from the compass pad or fine-tune with the slider (0° points up, 90° right, 180° down, 270° left).

### Behaviour

- **On hover show:** title and text, label only, or nothing.
- **Idle animation:** none, pulse, ping ring or glow.
- **Transition** (links only): use the tour default, or fade, zoom or instant for this link.

### Timing

Show a hotspot only during part of the video: scrub the video to the moment, press **Use current time** next to *Show at* or *Hide at*, or type seconds. Leave both empty to show it throughout. In **Edit** mode, hotspots outside their window are shown dimmed so you can still select them; in **Preview** and for visitors they only exist inside their window. **Show throughout** clears the timing.

### Position

Yaw and pitch in degrees, and **Move to centre of view**. Usually you will just drag the marker instead.

## Preview

**Preview** hides the editing panels and shows what a visitor gets: a *Start tour* button, a locations menu (list icon) in the transport bar, play/pause, seek, mute and full screen. Switch back with **Edit**.

## Tour settings

Open with the sliders icon in the top bar.

- **Mouse drag:** *Grab the view* (drag left, scenery follows your hand) or *Move the camera* (the opposite).
- **Moving between locations:** fade, zoom or instant, and the length.
- **Field of view**, and **Sharpness on screen** (renders at a higher resolution on a computer; costs graphics performance and cannot add detail the video does not have).
- **Headset edge quality:** trade sharpness at the edges for speed in VR.
- **Backup:** *Download settings* saves the tour structure (not the videos) as a file; *Import settings* loads one (it can be undone).

## Keyboard

| Keys | Action |
|---|---|
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` or `Ctrl + Y` | Redo |
| `Esc` | Cancel placing a hotspot, or close an open info panel |
| `Space` | Play or pause (when you are not typing in a field) |

## Projects, backups and moving to another computer

- The whole project is the **`data/` folder**: `project.json` plus `media/`.
- Copy `data/` into a fresh Orbit copy on another computer and start the editor there.
- Replaced or deleted videos stay in `data/media/` until you remove them by hand.
- `npm run view` opens the same project read-only, which is useful for demonstrating a finished tour without risking changes.

## Troubleshooting

| Problem | What to try |
|---|---|
| The video stays black or says it is taking a while | The file may be too large or in a format your browser cannot decode. Convert it to H.264 MP4, at most 4096 px wide (see the [publishing guide](PUBLISH-AND-WATCH-IN-VR.md#converting-videos-by-hand)). |
| The page says it cannot reach the server | The editor is not running. Start it with `npm start` and reload. |
| `The app has not been built yet` | Run `npm run build`, then `npm start`. |
| Upload fails | Only MP4, WebM, JPG, PNG and WebP are accepted. |
| Export offers only *Original* | ffmpeg was not found. Install it (see the README) and restart the editor. |
| Port already in use | Start on another port: `PORT=5000 npm start`. |
