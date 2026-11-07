# Getting an installer to testers (no PowerShell)

Testers only ever need **`Audio Visualisation Studio-Setup-<version>.exe`**. They double-click it, and it installs like any other app (Start menu, desktop shortcut, uninstaller). Someone has to *build* that file once per version. There are two ways, and neither needs typed commands.

## Option A: GitHub builds it for you (recommended)

GitHub's own Windows machines build the installer and put it on a download page you can share. Nothing runs on your PC.

**One-time setup (about 10 minutes):**
1. Create a free account at github.com.
2. Install **GitHub Desktop** (desktop.github.com), sign in, and choose **File › Add local repository**, pointing it at the extracted `audio-visualiser` folder. When it asks, choose **create a repository**.
3. Click **Publish repository**. Untick *Keep this code private* if testers should be able to download from your page (see the note below).

**For each version you want testers to have:**
1. On your repository's page on github.com, click **Releases › Draft a new release**.
2. In *Choose a tag*, type the version (for example `v0.20.1`) and choose *Create new tag*. Add a title if you like, then click **Publish release**.
3. Wait about 10–15 minutes. You can watch progress under the **Actions** tab. The installer and the portable app then appear under **Assets** on the release page.
4. Send testers the link to that release page.

**Private repository?** Testers can't download from a private repository. Download the `Setup .exe` from the release yourself and share it some other way: OneDrive, Google Drive, Dropbox, or a file-transfer link. (Email often blocks .exe files.)

**Want to try it without making a release?** Use **Actions › Build installer › Run workflow**. The files appear at the bottom of that run's page, under **Artifacts**, as a zip, and only you can download them.

## Option B: build it on your own PC by double-clicking

1. Install **Node.js** (nodejs.org, the LTS version) and the **.NET 10 SDK** (dot.net), once.
2. Extract the project zip, open the folder, and double-click **`Build Installer.cmd`**.
3. A window shows the progress (a few minutes the first time). When it finishes, the folder containing the installer opens automatically. Share the `Setup .exe` from there.

If something is missing or goes wrong, the window says what, in red, and waits for you to read it.

## What testers will see

Until the app is code-signed, Windows shows **"Windows protected your PC"** when the installer is first run. Tell testers to click **More info**, then **Run anyway**. This is normal for new, unsigned apps. A code-signing certificate removes the warning (see docs/RELEASE.md). With GitHub, add it once as repository secrets, and every build after that is signed automatically.
