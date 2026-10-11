/* ============================================================================
   保险库 · 桌面应用预加载桥
   ============================================================================
   作用：在「页面」和「主进程」之间架一座**只开三个小门**的桥。

   为什么不能直接把整个 Node 给页面：
   页面里跑的代码万一有漏洞，就能直接读写你的整个硬盘。
   所以这里只放行三个明确的能力，而且参数都在主进程里再校验一遍：
     · listDrives()      看看现在插了哪些盘
     · findKeyFiles()    在盘里找密钥文件（这就是桌面版最方便的地方）
     · readFile(path)    读一个小文件的内容（限 1MB，只读）

   页面通过 window.desktop 使用它们；网页版没有这个对象，
   所以同一份页面代码在两边都能跑（见 vault.js 里的判断）。
   ============================================================================ */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,

  // 列出当前存在的盘符
  listDrives: () => ipcRenderer.invoke('list-drives'),

  // 在所有盘的根目录里找密钥文件
  findKeyFiles: () => ipcRenderer.invoke('find-key-files'),

  // 读一个文件的内容（返回 { name, path, bytes }）
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath)
});
