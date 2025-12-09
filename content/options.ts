declare const Zotero: any;

class OptionsController {
  public init() {
    this.attachCredentialListeners();
  }

  private attachCredentialListeners() {
    const credentialIds = [
      'zsgt-access-token',
      'zsgt-client-id',
      'zsgt-client-secret',
      'zsgt-refresh-token',
    ];

    credentialIds.forEach(id => {
      const element = document.getElementById(id) as HTMLInputElement | null;
      if (element) {
        element.addEventListener('input', () => this.invalidateCachedToken());
      }
    });
  }

  private invalidateCachedToken() {
    const addon = (Zotero as any).SendToGoogleTasks;
    if (addon && typeof addon.resetTokenCache === 'function') {
      addon.resetTokenCache();
    }
  }
}

if (!(Zotero as any).SendToGoogleTasksOptions) {
  (Zotero as any).SendToGoogleTasksOptions = new OptionsController();
}
