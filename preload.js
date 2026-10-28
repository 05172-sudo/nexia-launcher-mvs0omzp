const { contextBridge, ipcRenderer } = require("electron");
const INVOKE = ["auth:restore","auth:login","auth:logout","mc:supported","mc:loaderVersions","play","instances:list","instances:play","update:apply","app:version"];
const ON = ["progress","launched","auth-code","update-available"];
contextBridge.exposeInMainWorld("nexia", {
  invoke: (ch, ...a) => INVOKE.includes(ch) ? ipcRenderer.invoke(ch, ...a) : Promise.reject(new Error("blocked")),
  on: (ch, fn) => { if (!ON.includes(ch)) return; const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); }
});
