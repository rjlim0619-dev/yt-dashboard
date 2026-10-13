# Channel Pulse — YouTube Channel Dashboard

A personal dashboard for your YouTube channel that runs entirely in the browser and is hosted free on **GitHub Pages**.

- Subscribers, lifetime views, video count
- Views, watch time, avg. view duration, net subs, likes, comments, each with % change vs the previous period
- Daily chart (views / watch time / net subs)
- Traffic sources breakdown
- Top 10 videos for the selected range
- 12 most recent uploads
- Date ranges: 7 days, 28 days, 90 days, 1 year
- Light and dark mode

No backend, no database, no cost. You sign in with Google, and the page calls the **YouTube Data API v3** and **YouTube Analytics API** directly with a short-lived token (1 hour) that is never saved anywhere.

Until you add your Client ID, the page runs in **sample-data mode** so you can see how it looks.

---

## Setup (about 15 minutes)

### 1. Put the code on GitHub

1. Create a new **public** repository on GitHub, e.g. `yt-dashboard`.
2. Upload these files to the root of the repo: `index.html`, `style.css`, `app.js`, `config.js`, `README.md`.
3. Go to **Settings → Pages**.
   - Source: **Deploy from a branch**
   - Branch: **main**, folder **/ (root)** → Save
4. After a minute your site will be live at
   `https://YOUR-USERNAME.github.io/yt-dashboard/`

### 2. Create a Google Cloud project

1. Go to <https://console.cloud.google.com/> and create a new project (e.g. "Channel Pulse").
2. Go to **APIs & Services → Library** and **enable** both:
   - **YouTube Data API v3**
   - **YouTube Analytics API**

### 3. Set up the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen** (may be called "Google Auth Platform → Branding / Audience").
2. User type: **External**. Fill in an app name and your email.
3. Under **Audience → Test users**, add the Google account that owns your YouTube channel.
4. Leave the app in **Testing** mode. Since it's only for you, you never need to publish or verify it.

### 4. Create the OAuth Client ID

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Under **Authorized JavaScript origins**, add:
   - `https://YOUR-USERNAME.github.io`  (origin only, with no `/yt-dashboard` path)
   - `http://localhost:8000` (optional, for testing on your PC)
4. Leave "Authorized redirect URIs" empty. Click **Create**.
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).

### 5. Connect it

Open `config.js` in your repo (you can edit it right on GitHub) and paste your Client ID:

```js
window.DASH_CONFIG = {
  CLIENT_ID: "1234567890-abc123.apps.googleusercontent.com",
};
```

Commit, wait about a minute for Pages to redeploy, open your site, and click **Sign in with Google**.

> You'll see **"Google hasn't verified this app."** That's expected for a personal app in Testing mode.
> Click **Continue** (or **Advanced → Go to …**), then allow both permissions.

---

## Notes

- **Is the Client ID safe in a public repo?** Yes. Browser apps' client IDs are public by design, and Google only accepts sign-ins from the origins you listed. **Never** commit a client *secret*.
- **Cost:** the APIs are free. The dashboard uses only a few quota units per load (it never calls `search`), far under the 10,000 units/day limit.
- **Data delay:** YouTube Analytics is typically 1–2 days behind, so the last day or two in the chart may look low.
- **Session:** the Google token lasts about 1 hour. After that, the page asks you to sign in again.
- **Run locally:** inside the folder, run `python -m http.server 8000` and open <http://localhost:8000>. Opening the file directly via `file://` won't work with Google sign-in.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Error 400: redirect_uri_mismatch` / `origin_mismatch` | The JavaScript origin in Google Cloud must exactly match your site, e.g. `https://ryanlim.github.io`, with no trailing slash or path. |
| `Access blocked: … has not completed the Google verification process` | Add your channel's Google account as a **Test user** on the consent screen. |
| "YouTube Analytics API has not been used in project…" | Enable **YouTube Analytics API** in the API Library. |
| "This Google account has no YouTube channel" | You signed in with a different account, or your channel is a Brand Account. Pick the channel's identity in the Google account chooser. |

## Files

| File | What it does |
|---|---|
| `index.html` | Page layout |
| `style.css` | Styling (auto light/dark) |
| `app.js` | Google sign-in, API calls, charts |
| `config.js` | Your OAuth Client ID |

Built with vanilla JS, [Chart.js](https://www.chartjs.org/), and Google Identity Services.

Developed by Ryan James Lim.
