# Mobile: installing Outreach as an app

Two ways to get Outreach onto a phone. Both are the same website — there is
no second codebase, and no data lives on the device.

| | PWA (browser install) | APK (Android file) |
|---|---|---|
| How | Visit the site, tap Install | Copy the `.apk`, tap it |
| Works on | Android + iPhone | Android only |
| Updates | Automatic | Automatic |
| App drawer entry | Yes | Yes |
| Needs a file | No | Yes |

## How updates reach the phone

The app is a window pointing at `outreach.openval.ai`. It contains no pages
and no data of its own.

```
edit code -> git push -> make update on the server -> phone shows it
```

**You never rebuild or reinstall the APK for a code change.** The only reason
to rebuild is a change to the app's identity — its name, icon, or start URL.

One caveat: the service worker updates on the next launch, not mid-session.
After deploying, close the app and reopen it. If you were already inside it,
you may be on the previous JavaScript until you relaunch. Data is always live
either way, because none of it is cached.

## Installing

### iPhone
Safari (not Chrome — iOS only allows Safari to do this) → Share → **Add to
Home Screen**. The app prompts with this the first time.

### Android, from the browser
Chrome shows an install prompt, or use ⋮ → **Install app**.

### Android, from the APK
1. Copy `outreach.apk` to the phone
2. Tap it; allow "install from unknown sources" if asked
3. It appears in the app drawer as **Outreach**

## Offline behaviour

Outreach needs a connection. Everything — reading prospects, approving a
draft, signing in — goes to the server. Nothing is stored on the phone.

So the app is explicit rather than silently broken:

- **No connection at launch** → a plain "You're offline" screen
- **Connection lost while open** → an amber banner appears, and every button
  and field dims and stops responding
- **Navigation stays live** — you can still move between pages and sign out
- **Reconnects on its own** — it rechecks every 8 seconds while down, and
  immediately when you switch back to the app

Connectivity is decided by an actual request to `/health`, not by the phone's
own online flag. That flag reports "online" on hotel wifi and captive portals,
which is exactly when the buttons most need to be dead.

**There is deliberately no offline editing.** Queuing an approval to send
later means an email could reach a real prospect minutes after you thought
better of it. "It failed, try again" is the safer failure for this app.

## What is cached

Only the static shell: fonts, CSS, JavaScript, icons. Those filenames contain
a content hash, so a deploy changes the name and the cache misses.

Never cached: any `/api/` response, and any page. Caching a page would let a
signed-out phone render a screen of real prospect names; caching the API would
show data that changed an hour ago. For a CRM both are worse than an error.

## Rebuilding the APK

Only needed if the app's name, icon, package or start URL changes.

```bash
cd android
export JAVA_HOME="/c/Program Files/Java/jdk-17"
export ANDROID_HOME="$HOME/AppData/Local/Android/Sdk"
export OUTREACH_STORE_PASS=...   # the keystore password
export OUTREACH_KEY_PASS=...
./gradlew assembleRelease
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

Bump `appVersionCode` in `android/twa-manifest.json` first, or Android will
refuse to install over the existing app.

### The keystore

`android/outreach-release.keystore` is **gitignored and must stay that way**.
It is the app's identity: anyone holding it can ship an update that Android
accepts as genuine. This repo is public.

Back it up somewhere private. If it is lost, the only way to update the app is
to uninstall and reinstall under a new key.

Its SHA-256 fingerprint is published in
`frontend/public/.well-known/assetlinks.json`, which is what tells Android the
app and the domain are the same party. Without that match Chrome shows its
address bar inside the app and it stops feeling native. If you ever regenerate
the key, update that file and redeploy.

## Push notifications

Not enabled yet. The service worker already handles `push` and
`notificationclick`, so the remaining work is backend-side: VAPID keys, a
subscription endpoint, and a trigger when a reply arrives or a draft needs
approval.

On iOS, push only works **after** the app is added to the Home Screen — Apple
does not allow it for a normal Safari tab.
