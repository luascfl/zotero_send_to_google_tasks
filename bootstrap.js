(() => {
  let Services;
  try {
    if (typeof globalThis.Services !== 'undefined') {
      Services = globalThis.Services;
    }
    else if (typeof ChromeUtils !== 'undefined' && typeof ChromeUtils.importESModule === 'function') {
      ({ Services } = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs'));
    }
    else if (typeof Components !== 'undefined' && Components.utils?.import) {
      ({ Services } = Components.utils.import('resource://gre/modules/Services.jsm'));
    }
  }
  catch (error) {
    dump(`SendToGoogleTasks bootstrap failed to import Services: ${String(error)}\n`);
  }

  if (!Services || !Services.scriptloader) {
    throw new Error('SendToGoogleTasks bootstrap: Services.scriptloader unavailable');
  }

  let scope = null;

  function resolveBaseURI(data) {
    if (data && typeof data === 'object') {
      if (data.resourceURI?.spec) {
        return data.resourceURI.spec;
      }
      if (typeof data.rootURI === 'string') {
        return data.rootURI;
      }
      if (data.rootURI?.spec) {
        return data.rootURI.spec;
      }
      if (typeof data.baseURI === 'string') {
        return data.baseURI;
      }
      if (data.installPath) {
        try {
          const file = data.installPath;
          const fileURI = Services.io.newFileURI(file);
          if (file && typeof file.isDirectory === 'function' && file.isDirectory()) {
            let spec = fileURI.spec;
            if (!spec.endsWith('/')) {
              spec += '/';
            }
            return spec;
          }
          return `jar:${fileURI.spec}!/`;
        }
        catch (error) {
          dump(`SendToGoogleTasks bootstrap: failed to resolve installPath URI: ${String(error)}\n`);
        }
      }
    }
    throw new Error('SendToGoogleTasks bootstrap: unable to resolve base URI');
  }

  function load(data) {
    if (!scope) {
      let baseURI;
      try {
        baseURI = resolveBaseURI(data);
      }
      catch (error) {
        dump(`SendToGoogleTasks bootstrap: ${String(error)}\n`);
        return null;
      }

      const newScope = {};
      newScope.globalThis = newScope;
      newScope.window = newScope;
      newScope.Zotero = globalThis.Zotero;
      newScope.Components = typeof globalThis.Components !== 'undefined' ? globalThis.Components : undefined;
      newScope.Services = Services;
      if (typeof ChromeUtils !== 'undefined') {
        newScope.ChromeUtils = ChromeUtils;
      }

      Services.scriptloader.loadSubScript(`${baseURI}content/googleTasks.js`, newScope);
      scope = newScope;
    }
    if (scope.globalThis && scope.globalThis.SendToGoogleTasksBootstrap) {
      return scope.globalThis.SendToGoogleTasksBootstrap;
    }
    return scope.SendToGoogleTasksBootstrap || null;
  }

  function call(method, data, reason) {
    const exports = load(data);
    if (!exports) {
      dump(`SendToGoogleTasks bootstrap: exports unavailable for ${method}\n`);
      return;
    }
    if (exports && typeof exports[method] === 'function') {
      return exports[method](data, reason);
    }
    throw new Error(`SendToGoogleTasks bootstrap: method ${method} not found on module exports`);
  }

  const bootstrap = {
    install(data, reason) {
      try {
        call('install', data, reason);
      }
      catch (error) {
        dump(`SendToGoogleTasks bootstrap install error: ${String(error)}\n`);
        throw error;
      }
    },
    uninstall(data, reason) {
      try {
        call('uninstall', data, reason);
      }
      catch (error) {
        dump(`SendToGoogleTasks bootstrap uninstall error: ${String(error)}\n`);
        throw error;
      }
    },
    startup(data, reason) {
      try {
        call('startup', data, reason);
      }
      catch (error) {
        dump(`SendToGoogleTasks bootstrap startup error: ${String(error)}\n`);
        throw error;
      }
    },
    shutdown(data, reason) {
      try {
        call('shutdown', data, reason);
      }
      catch (error) {
        dump(`SendToGoogleTasks bootstrap shutdown error: ${String(error)}\n`);
        throw error;
      }
    },
  };

  const target = (typeof globalThis !== 'undefined' ? globalThis : this);
  target.install = bootstrap.install;
  target.uninstall = bootstrap.uninstall;
  target.startup = bootstrap.startup;
  target.shutdown = bootstrap.shutdown;
})();
