# Send to Google Tasks

Send to Google Tasks adds a context menu action in Zotero 7+ that creates Google Tasks for the selected attachments. Each task can be templated with metadata from the attachment and its parent item, and credentials are stored securely in Zotero's preference system.

## Features
- Send one or many selected attachments to Google Tasks with a single click.
- Configure OAuth client credentials or supply a manual access token.
- Customize task titles and notes with simple `{{placeholder}}` tokens.
- Optional due date offset (in days) applied to every generated task.

## Installation
1. Build the plugin or download the packaged `.xpi`.
2. In Zotero, open `Tools → Add-ons`.
3. Use the gear icon → `Install Add-on From File…` and select the `.xpi`.
4. Restart Zotero if prompted.

## Configuration
Open `Tools → Google Tasks Preferences` and fill in:

- **Access token (optional)** – Use this to paste a short-lived token manually.
- **Client ID / Client secret / Refresh token** – Needed to refresh tokens automatically.
- **Task list ID** – The target Google Task list identifier.
- **Task title/notes templates** – Use placeholders such as `{{attachmentTitle}}`, `{{parentTitle}}`, `{{selectURI}}`.
- **Due date offset (days)** – Leave blank to omit a due date.

Any time you change credentials the cached access token is cleared automatically. Errors will be logged to the Zotero console and surfaced via notifications.

## Building

```bash
npm install
npm run build
```

The compiled files live in `build/`. Run `npm run postbuild` to create an installable `.xpi` archive.
