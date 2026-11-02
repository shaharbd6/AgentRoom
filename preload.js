const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The local bridge is offered only to the agents-center page itself
// (it runs inside a *.claudeusercontent.com frame), not to claude.ai's own pages.
const host = location.hostname || '';
if (/\.claudeusercontent\.com$/.test(host)) {
  const call = (ch, arg) => ipcRenderer.invoke(ch, arg);
  contextBridge.exposeInMainWorld('agentsLocal', {
    version: 1,
    pathFor: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
    register: (arg) => call('al:register', arg),   // {filePath} or {bytes:ArrayBuffer, name} + agent
    run: (op, params, agent) => call('al:run', { op, params, agent }),
    info: (id) => call('al:info', id),
    preview: (id) => call('al:preview', id),
    open: (id) => call('al:open', id),
    show: (id) => call('al:show', id),
    openFolder: (agent) => call('al:folder', agent),
    read: (id) => call('al:read', id),
    imagine: (params, agent) => call('al:imagine', { params, agent }),
    imagineStatus: () => call('al:imagine_status'),
    openRefs: () => call('al:refs'),
    browse: (url) => call('al:browse', url),
    webImage: (url, name, agent) => call('al:webimage', { url, name, agent }),
    publicUrl: (id) => call('al:publicurl', id),
    status: () => call('al:status'),
  });
}
