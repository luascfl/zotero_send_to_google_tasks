declare const Zotero: any;
declare const Components: any;
declare const Services: any;

const globalAny = globalThis as Record<string, any>;
const componentsRoot = typeof Components !== 'undefined' ? Components : globalAny.Components;
const Cc = componentsRoot?.classes ?? globalAny.Cc;
const Ci = componentsRoot?.interfaces ?? globalAny.Ci;

if (!Cc || !Ci) {
  throw new Error('SendToGoogleTasks: XPCOM globals unavailable');
}

let chromeHandle: any = null;

const PREFERENCE_BRANCH = 'extensions.zotero_send_to_google_tasks.';
const PREFERENCE_PANE_ID = 'send_to_google_tasks';
const EXTENSION_ID = 'zotero_send_to_google_tasks@luascfl';
const NOTIFICATION_DURATION = 3000;

function getPref<T = unknown>(name: string, fallback: T | null = null): T | null {
  try {
    const value = Zotero.Prefs.get(`${PREFERENCE_BRANCH}${name}`, true);
    return value === undefined ? fallback : (value as T);
  }
  catch (error) {
    Zotero.logError(`SendToGoogleTasks: failed to read pref ${name}: ${String(error)}`);
    return fallback;
  }
}

interface ProgressHandle {
  changeHeadline(headline: string, icon?: string): void
  addLines(lines: string[], icons?: string[]): void
  show(): void
  startCloseTimer(ms: number): void
}

function getSpinnerIcon(): string {
  return `chrome://zotero/skin/spinner-16px${Zotero.hiDPI ? '@2x' : ''}.png`;
}

function showProgressWindow(headline: string, body: string, icon: string, autoClose = false): ProgressHandle {
  const win = new Zotero.ProgressWindow({ closeOnClick: true });
  win.changeHeadline(`Send to Google Tasks: ${headline}`, icon);
  win.addLines([body], [icon]);
  win.show();
  if (autoClose) {
    win.startCloseTimer(NOTIFICATION_DURATION);
  }
  return win as ProgressHandle;
}

function showError(headline: string, body: string) {
  const icon = 'chrome://zotero/skin/cross.png';
  showProgressWindow(headline, body, icon, true);
}

type TemplateContext = Record<string, string>;

interface TaskPayload {
  title: string
  notes?: string
  due?: string
}

class GoogleTasksClient {
  private cachedToken: string | null = null;
  private tokenExpiry = 0;

  public resetCache() {
    this.cachedToken = null;
    this.tokenExpiry = 0;
  }

  public async createTask(taskListId: string, payload: TaskPayload) {
    const accessToken = await this.ensureAccessToken();
    const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(taskListId)}/tasks`;
    const response = await Zotero.HTTP.request('POST', url, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        title: payload.title,
        ...(payload.notes ? { notes: payload.notes } : {}),
        ...(payload.due ? { due: payload.due } : {}),
      }),
    });

    if (!response.ok) {
      const details = typeof response.text === 'string' ? response.text : '';
      throw new Error(`${response.status} ${response.statusText} ${details}`.trim());
    }
  }

  private async ensureAccessToken(): Promise<string> {
    const manualToken = (getPref<string>('access_token', '') || '').trim();
    if (manualToken) {
      return manualToken;
    }

    const now = Date.now();
    if (this.cachedToken && now < this.tokenExpiry - 60_000) {
      return this.cachedToken;
    }

    return await this.refreshAccessToken();
  }

  private async refreshAccessToken(): Promise<string> {
    const clientId = (getPref<string>('client_id', '') || '').trim();
    const clientSecret = (getPref<string>('client_secret', '') || '').trim();
    const refreshToken = (getPref<string>('refresh_token', '') || '').trim();

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Google OAuth credentials are not configured. Please set Client ID, Client Secret, and Refresh Token in the preferences.');
    }

    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await Zotero.HTTP.request('POST', 'https://oauth2.googleapis.com/token', {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const details = typeof response.text === 'string' ? response.text : '';
      throw new Error(`Failed to refresh Google access token: ${response.status} ${response.statusText} ${details}`.trim());
    }

    let data: { access_token: string, expires_in?: number };
    try {
      data = JSON.parse(response.text as string) as { access_token: string, expires_in?: number };
    }
    catch (error) {
      throw new Error(`Failed to parse Google token response: ${String(error)}`);
    }

    if (!data.access_token) {
      throw new Error('Google token response did not contain an access_token.');
    }

    this.cachedToken = data.access_token;
    const expiresInMs = data.expires_in ? data.expires_in * 1000 : 3600 * 1000;
    this.tokenExpiry = Date.now() + expiresInMs;

    return this.cachedToken;
  }
}

class SendToGoogleTasksAddon {
  private client = new GoogleTasksClient();

  public openPreferenceWindow(paneID?: string, action?: string) {
    const targetPane = paneID || PREFERENCE_PANE_ID;
    const panes = Zotero.PreferencePanes;

    try {
      if (panes?.open) {
        panes.open(targetPane, action);
        return;
      }
      if (panes?.show) {
        panes.show(targetPane, action);
        return;
      }
    }
    catch (error) {
      Zotero.logError(`SendToGoogleTasks: failed to open new Preferences API: ${String(error)}`);
    }

    if (Zotero.Utilities?.Internal?.openPreferences) {
      try {
        Zotero.Utilities.Internal.openPreferences(targetPane);
        return;
      }
      catch (error) {
        Zotero.logError(`SendToGoogleTasks: failed to use Utilities.Internal.openPreferences: ${String(error)}`);
      }
    }

    const win = Zotero.getMainWindow();
    if (!win) {
      Zotero.logError('SendToGoogleTasks: Unable to locate main window to open preferences.');
      return;
    }

    win.openDialog(
      'chrome://zotero_send_to_google_tasks/content/options.xhtml',
      'zotero-send-to-google-tasks-options',
      `chrome,titlebar,toolbar,centerscreen${Zotero.Prefs.get('browser.preferences.instantApply', true) ? 'dialog=no' : 'modal'}`,
      { pane: paneID, action }
    );
  }

  public async sendSelectedAttachments() {
    const pane = Zotero.getActiveZoteroPane();
    if (!pane) {
      showError('No active library', 'Could not access the active Zotero pane.');
      return;
    }

    const selectedItems = pane.getSelectedItems();
    const attachments = selectedItems
      .map((item: any) => (typeof item === 'number' ? Zotero.Items.get(item) : item))
      .filter((item: any) => item && (item.isAttachment?.() || item.itemType === 'attachment'));

    if (!attachments.length) {
      showError('Nothing to send', 'Select at least one attachment to create Google Tasks.');
      return;
    }

    const taskListId = (getPref<string>('task_list_id', '') || '').trim();
    if (!taskListId) {
      showError('Missing configuration', 'Set a Google Task list ID in the extension preferences.');
      return;
    }

    const titleTemplate = (getPref<string>('task_title_template', '{{attachmentTitle}}') || '{{attachmentTitle}}');
    const noteTemplate = (getPref<string>('task_notes_template', '') || '');
    const dueOffsetRaw = getPref<string>('due_offset_days', '') || '';
    const dueOffset = dueOffsetRaw === '' ? null : Number(dueOffsetRaw);
    const progress = showProgressWindow('Creating tasks', `Processing ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}...`, getSpinnerIcon());

    const failures: string[] = [];
    let successCount = 0;

    for (const attachment of attachments) {
      const context = this.buildTemplateContext(attachment);
      const taskTitle = this.renderTemplate(titleTemplate, context).trim() || context.attachmentTitle || 'Zotero Attachment';
      const taskNotes = noteTemplate ? this.renderTemplate(noteTemplate, context).trim() : '';
      let dueISO: string | undefined;
      if (dueOffset !== null && Number.isFinite(dueOffset)) {
        dueISO = this.computeDueISO(Number(dueOffset));
      }

      try {
        await this.client.createTask(taskListId, {
          title: taskTitle,
          notes: taskNotes || undefined,
          due: dueISO,
        });
        successCount += 1;
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${taskTitle}: ${message}`);
        Zotero.logError(`SendToGoogleTasks: Failed to create task for ${context.attachmentTitle}: ${message}`);
      }
    }

    const headline = failures.length === 0 ? 'Tasks created' : 'Some tasks failed';
    const summary = failures.length === 0
      ? `Created ${successCount} Google Task${successCount === 1 ? '' : 's'} successfully.`
      : `Created ${successCount} Google Task${successCount === 1 ? '' : 's'}, ${failures.length} failed.`;

    progress.changeHeadline(`Send to Google Tasks: ${headline}`, failures.length === 0 ? 'chrome://zotero/skin/tick.png' : 'chrome://zotero/skin/warning-16px.png');
    progress.addLines([summary], [failures.length === 0 ? 'chrome://zotero/skin/tick.png' : 'chrome://zotero/skin/cross.png']);
    if (failures.length > 0) {
      progress.addLines(failures.slice(0, 5), failures.slice(0, 5).map(() => 'chrome://zotero/skin/cross.png'));
      if (failures.length > 5) {
        progress.addLines([`…and ${failures.length - 5} more.`], ['chrome://zotero/skin/info.png']);
      }
    }
    progress.startCloseTimer(NOTIFICATION_DURATION);
  }

  public resetTokenCache() {
    this.client.resetCache();
  }

  private computeDueISO(offsetDays: number): string {
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + offsetDays);
    due.setUTCHours(0, 0, 0, 0);
    return due.toISOString();
  }

  private buildTemplateContext(attachment: any): TemplateContext {
    const attachmentTitle = attachment.getField?.('title', false, true) || attachment.attachmentFilename || attachment.getDisplayTitle?.() || 'Attachment';
    const attachmentFilename = attachment.attachmentFilename || '';
    const parent = attachment.parentItem ?? (attachment.parentItemID ? Zotero.Items.get(attachment.parentItemID) : null);
    const parentTitle = parent?.getField?.('title', false, true) || '';
    const parentCreators = parent?.getCreators?.() || [];
    const parentAuthors = parentCreators
      .map((creator: any) => `${creator.firstName || ''} ${creator.lastName || ''}`.trim())
      .filter((name: string) => name.length > 0)
      .join(', ');
    const firstAuthor = parentCreators.length > 0
      ? `${parentCreators[0].firstName || ''} ${parentCreators[0].lastName || ''}`.trim()
      : '';
    const itemURL = parent?.getField?.('url', false, true) || '';
    const doi = parent?.getField?.('DOI', false, true) || '';
    const libraryPath = Zotero.URI?.getLibraryPath?.(attachment.libraryID) || 'library';
    const selectURI = `zotero://select/${libraryPath}/items/${attachment.key}`;
    let openURI = '';
    const mimeType = attachment.getField?.('mimeType', false, true) || attachment.attachmentContentType || '';
    if (mimeType.startsWith('application/pdf')) {
      openURI = `zotero://open-pdf/${libraryPath}/items/${attachment.key}`;
    }

    return {
      attachmentTitle,
      attachmentFilename,
      parentTitle,
      parentAuthors,
      firstAuthor,
      itemURL,
      doi,
      selectURI,
      openURI,
    };
  }

  private renderTemplate(template: string, context: TemplateContext): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_match: string, token: string) => {
      if (Object.prototype.hasOwnProperty.call(context, token) && context[token]) {
        return context[token];
      }
      return '';
    });
  }
}

let addonInstance: SendToGoogleTasksAddon | null = null;
const services: { aomStartup?: any } = {};
let preferencePaneRegistered = false;

const mainWindowObserver = {
  notify: (event: string, type: string, ids: string[], extraData: any) => {
    if (type !== 'window') return;
    if (event === 'add') {
      ids.forEach(id => {
        if (extraData && extraData[id]) {
          const win = Zotero.getMainWindows().find((w: any) => w.document.documentElement.id === id);
          if (win) {
            onMainWindowLoad({ window: win });
          }
        }
      });
    }
    else if (event === 'remove' && extraData) {
      onMainWindowUnload({ window: extraData });
    }
  },
};

export function startup({ version, rootURI: root }: { version: string, rootURI: string }, reason: unknown) {
  Zotero.debug(`SendToGoogleTasks: startup ${version}, reason: ${String(reason)}`);
  services.aomStartup = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(`${root}manifest.json`);

  chromeHandle = services.aomStartup.registerChrome(manifestURI, [
    ['content', 'zotero_send_to_google_tasks', 'content/'],
    ['locale', 'zotero_send_to_google_tasks', 'en-US', 'locale/en-US/'],
    ['skin', 'zotero_send_to_google_tasks', 'default', 'skin/default/'],
  ]);

  addonInstance = new SendToGoogleTasksAddon();
  (Zotero as any).SendToGoogleTasks = addonInstance;

  if (Zotero.PreferencePanes?.register) {
    try {
      const paneOptions = {
        id: PREFERENCE_PANE_ID,
        pluginID: EXTENSION_ID,
        src: `${root}content/options.xhtml`,
        scripts: [`${root}content/options.js`],
        label: 'Send to Google Tasks',
        defaultXUL: true,
      };
      Zotero.PreferencePanes.register(paneOptions);
      preferencePaneRegistered = true;
    }
    catch (error) {
      Zotero.logError(`SendToGoogleTasks: failed to register preference pane: ${String(error)}`);
    }
  }

  Zotero.getMainWindows().forEach((win: any) => onMainWindowLoad({ window: win }));
  Zotero.Notifier.registerObserver(mainWindowObserver, ['window'], 'SendToGoogleTasks-window-observer', true);
}

export function shutdown(reason: unknown) {
  Zotero.debug(`SendToGoogleTasks: shutdown ${String(reason)}`);
  Zotero.Notifier.unregisterObserver('SendToGoogleTasks-window-observer');

  Zotero.getMainWindows().forEach((win: any) => onMainWindowUnload({ window: win }));

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }

  if (preferencePaneRegistered && Zotero.PreferencePanes?.unregister) {
    try {
      Zotero.PreferencePanes.unregister(PREFERENCE_PANE_ID);
    }
    catch (error) {
      Zotero.logError(`SendToGoogleTasks: failed to unregister preference pane: ${String(error)}`);
    }
  }
  preferencePaneRegistered = false;

  if ((Zotero as any).SendToGoogleTasks) {
    (Zotero as any).SendToGoogleTasks = null;
  }
  addonInstance = null;
}

export function install(reason: unknown) {
  Zotero.debug(`SendToGoogleTasks: install ${String(reason)}`);
}

export function uninstall(reason: unknown) {
  Zotero.debug(`SendToGoogleTasks: uninstall ${String(reason)}`);
}

function onMainWindowLoad({ window }: { window: any }) {
  const doc = window.document;
  const createXULElement = doc.createXULElement
    ? doc.createXULElement.bind(doc)
    : (tag: string) => doc.createElementNS('http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', tag);

  if (window.MozXULElement?.insertFTLIfNeeded) {
    try {
      window.MozXULElement.insertFTLIfNeeded('send_to_google_tasks.ftl');
    }
    catch (error) {
      Zotero.logError(`SendToGoogleTasks: failed to load Fluent bundle: ${String(error)}`);
    }
  }

  const itemMenu = doc.getElementById('zotero-itemmenu');
  if (itemMenu && !doc.getElementById('send-to-google-tasks-menuitem')) {
    let separator = doc.getElementById('send-to-google-tasks-separator');
    if (!separator) {
      separator = createXULElement('menuseparator');
      separator.id = 'send-to-google-tasks-separator';
      itemMenu.appendChild(separator);
    }

    const menuItem = createXULElement('menuitem');
    menuItem.id = 'send-to-google-tasks-menuitem';
    menuItem.setAttribute('label', 'Send to Google Tasks');
    menuItem.setAttribute('data-l10n-id', 'send-to-google-tasks-menu-item');
    menuItem.addEventListener('command', () => {
      if (addonInstance && typeof addonInstance.sendSelectedAttachments === 'function') {
        void addonInstance.sendSelectedAttachments();
      }
    });

    const updateMenuState = () => {
      try {
        const pane = window.ZoteroPane || Zotero.getActiveZoteroPane?.();
        const selectedItems: any[] = pane?.getSelectedItems?.() || [];
        const hasAttachment = selectedItems.some((item: any) => {
          const zoteroItem = typeof item === 'number' ? Zotero.Items.get(item) : item;
          return zoteroItem && (zoteroItem.isAttachment?.() || zoteroItem.itemType === 'attachment');
        });
        menuItem.hidden = !hasAttachment;
      }
      catch (error) {
        Zotero.logError(`SendToGoogleTasks: failed to evaluate selection: ${String(error)}`);
        menuItem.hidden = true;
      }
    };

    (itemMenu as any)._sendToGoogleTasksPopupHandler = updateMenuState;
    itemMenu.addEventListener('popupshowing', updateMenuState);

    itemMenu.appendChild(menuItem);
  }

  const toolsMenu = doc.getElementById('menu_ToolsPopup');
  if (toolsMenu && !doc.getElementById('send-to-google-tasks-preferences')) {
    const menuItem = createXULElement('menuitem');
    menuItem.id = 'send-to-google-tasks-preferences';
    menuItem.setAttribute('label', 'Google Tasks Preferences');
    menuItem.setAttribute('data-l10n-id', 'send-to-google-tasks-tools-preferences');
    menuItem.addEventListener('command', () => {
      if (addonInstance && typeof addonInstance.openPreferenceWindow === 'function') {
        addonInstance.openPreferenceWindow();
      }
    });

    toolsMenu.appendChild(menuItem);
  }
}

function onMainWindowUnload({ window }: { window: any }) {
  const doc = window.document;

  const itemMenuItem = doc.getElementById('send-to-google-tasks-menuitem');
  if (itemMenuItem) {
    itemMenuItem.remove();
  }

  const itemMenu = doc.getElementById('zotero-itemmenu');
  if (itemMenu) {
    const handler = (itemMenu as any)._sendToGoogleTasksPopupHandler;
    if (handler) {
      itemMenu.removeEventListener('popupshowing', handler);
      delete (itemMenu as any)._sendToGoogleTasksPopupHandler;
    }
  }

  const separator = doc.getElementById('send-to-google-tasks-separator');
  if (separator) {
    separator.remove();
  }

  const toolsMenuItem = doc.getElementById('send-to-google-tasks-preferences');
  if (toolsMenuItem) {
    toolsMenuItem.remove();
  }
}

Zotero.debug('SendToGoogleTasks: module loaded');

const bootstrapExports = {
  install,
  uninstall,
  startup,
  shutdown,
};

(globalThis as any).SendToGoogleTasksBootstrap = bootstrapExports;
