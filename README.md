# Parent App · ئامادەبوونی منداڵەکەم

Installable PWA for parents to follow their child's school attendance live.
Companion of the *School Attendance System* (same Firebase project).

## Features

- Bottom-tab navigation: **Children · Alerts · Settings**, plus a child detail screen
- Android/browser **Back button** works like a native app (closes sheets, returns from detail)
- Live attendance status via Firebase Realtime Database, 30-day history and statistics
- Alerts feed + local notifications when a child's status changes
- Installable (Add to Home Screen), works offline (app shell + Firebase SDK cached), offline banner
- Midnight rollover handled while the app stays open

## Structure

```
.
├── index.html
├── manifest.json
├── sw.js                 # service worker (shell cache, notification click)
├── css/style.css
├── js/app.js
└── icons/                # 192, 512, 512-maskable
```

## Deploy (GitHub Pages)

1. Push the contents of this folder to a repository.
2. **Settings → Pages →** branch `main`, folder `/ (root)`.
3. In Firebase: **Authentication → Sign-in method → enable _Anonymous_**, and add your
   `github.io` domain under **Authorized domains**.
4. Open the page on a phone → browser menu → **Install app / Add to Home screen**.

## Firebase rules (recommended)

The app reads `students/<cardId>`, `students` (query by `linkCode`) and
`attendance/<date>/records/<cardId>` after anonymous sign-in. Add an index so the
link-code lookup does not download the whole table:

```json
{
  "rules": {
    "students": { ".indexOn": ["linkCode"] }
  }
}
```

Keep write access restricted to staff accounts (`staff/<uid>`), and make sure
`.read` on `students` is not public to unauthenticated users.

## Notes

- Attendance is keyed by the **UTC date** (`YYYY-MM-DD`), exactly like the school system's scanner/admin pages.
- Notifications work while the app is open or in the background. Notifications while the app
  is fully closed need Firebase Cloud Messaging + a small server/Cloud Function (not included).
- After deploying a new version, bump `VERSION` in `sw.js`.
