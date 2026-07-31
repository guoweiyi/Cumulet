// @novnc/novnc exposes its RFB class as the bare package entry (its package
// exports map is the string "./core/rfb.js", which disables subpath imports).
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(
      target: Element,
      url: string,
      options?: { credentials?: { username?: string; password?: string; target?: string } },
    );
    disconnect(): void;
    sendCredentials(credentials: { password?: string }): void;
    sendCtrlAltDel(): void;
    clipboardPasteFrom(text: string): void;
    scaleViewport: boolean;
    resizeSession: boolean;
    background: string;
  }
}
