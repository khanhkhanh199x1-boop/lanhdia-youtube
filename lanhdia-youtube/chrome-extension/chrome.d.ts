type Tab = { id?: number; url?: string; title?: string; incognito?: boolean };
type Sender = { id?: string; origin?: string; url?: string; frameId?: number; tab?: Tab };
interface Stored { get(keys: string[]): Promise<Record<string, unknown>>; set(value: Record<string, unknown>): Promise<void>; remove(keys: string | string[]): Promise<void> }
declare const chrome: {
  action: {
    onClicked: { addListener(listener: (tab: Tab) => void): void };
    setBadgeText(data: { tabId: number; text: string }): Promise<void>;
    setBadgeBackgroundColor(data: { tabId: number; color: string }): Promise<void>;
  };
  tabs: { create(data: { url: string }): Promise<Tab> };
  storage: { local: Stored; session: Stored };
  runtime: {
    id: string; lastError?: { message?: string }; getURL(path: string): string;
    sendNativeMessage(host: string, data: object, cb: (reply: unknown) => void): void;
    sendMessage(data: object, cb: (reply: unknown) => void): void;
    onMessage: { addListener(listener: (msg: unknown, sender: Sender, reply: (value: unknown) => void) => boolean | void): void };
    onMessageExternal: { addListener(listener: (msg: unknown, sender: Sender, reply: (value: unknown) => void) => boolean | void): void };
  };
};
