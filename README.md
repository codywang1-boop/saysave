# SaySave — Voice File Saver (web app / PWA)

Share a file, say **"Save to my Google Drive"**, and SaySave files it in the right Drive folder.

## What's in this folder

| File | What it does |
|---|---|
| `index.html`, `styles.css` | The app screens |
| `app.js` | Save flow, voice, Commands, Organize, Settings |
| `logic.js` | Figures out the folder from the file name, and understands voice commands |
| `drive.js` | Demo Drive + real Google Drive connection |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Make it installable, and add **SaySave to the Android Share menu** |

## 1. Put it online (GitHub Pages, free)

Voice, Google sign-in and the Share menu need a real `https://` address, so host it:

1. On github.com (account `codywang1-boop`), create a new **public** repository named `saysave`.
2. Click **Add file → Upload files**, drag in **everything in this folder** (all the files), and click **Commit**.
3. Go to **Settings → Pages**. Under Source, pick **Deploy from a branch**, then **main** / **(root)**, and click **Save**.
4. After about a minute, the app is live at **https://codywang1-boop.github.io/saysave/**

## 2. Connect your real Google Drive

**Already done:** Google Cloud project `saysave` is set up, with the Drive API on, the sign-in screen in Testing mode, `codywang1@gmail.com` as a test user, and the Client ID
`298247101034-012g0354ohl99thg8mg9401sb33aag6u.apps.googleusercontent.com`, which is built into the app.
Allowed web address: `https://codywang1-boop.github.io`. Just open Settings → My Google Drive → **Connect**.

To add another tester (e.g. your wife): console.cloud.google.com → project SaySave → Google Auth Platform → Audience → Test users → Add users.

### How it was set up (for reference)

1. Go to https://console.cloud.google.com/ → create a project called **SaySave**.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **OAuth consent screen** → External → app name *SaySave* plus your email.
   Leave it in **Testing**, and add yourself (and your wife) under **Test users**.
4. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
   Under **Authorized JavaScript origins**, add: `https://codywang1-boop.github.io`
5. Copy the **Client ID** → open SaySave → **Settings → My Google Drive** → paste it → **Connect**.

While the app is in Testing mode, only your listed test users can sign in. That's ideal for trying it out.
Opening it to the public later requires Google's app verification (see the spec).

## 3. Install on your phone

- **Android (Chrome):** open the link → ⋮ → **Install app**. Now, in Gmail, Files, Chrome or any other app: **Share → SaySave**.
- **iPhone (Safari):** Share → **Add to Home Screen**. iOS doesn't allow web apps in the Share menu,
  so open SaySave and tap **Choose a file** (it can pick from Files, iCloud and Photos).
  Full share-menu support on iPhone comes with the native app.

## Try it without setup

The app starts in **Demo Drive** mode, with sample folders and loose files, so you can test saving,
voice commands, and **Organize** before connecting Google.

## Voice commands (all editable in the Commands tab)

- "Save to my Google Drive" / "Find the right place" → auto-picks the folder from the file name
- "Save this to my tax folder" → shortcut → `Taxes/{year}`
- "Save this to my medical folder" → searches your folders by name
- "Yes" / "Cancel" on the confirm step

No good folder? SaySave suggests a new one and creates it only after you say yes.
