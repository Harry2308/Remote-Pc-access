declare module '@novnc/novnc/lib/rfb' {
  export default class RFB extends EventTarget {
    constructor(
      target: HTMLElement,
      url: string,
      options?: {
        credentials?: { password?: string };
        shared?: boolean;
        repeaterID?: string;
      }
    );
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
    sendCredentials(credentials: { password: string }): void;
    sendKey(keysym: number, code: string, down?: boolean): void;
    clipboardPasteFrom(text: string): void;
  }
}
