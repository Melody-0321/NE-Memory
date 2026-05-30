/**
 * 全局运行时类型声明 — 这些变量由 TH (Tavern Helper) 运行时注入到 iframe 中。
 * 实际值在运行时由 TH 提供，IDE 无法感知。
 * 仅供 VSCode/IDE 类型检查使用，不影响构建输出。
 */
declare var TavernHelper: {
    _eventOn(event: string, handler: (...args: any[]) => void): void;
    generateRaw(options: { ordered_prompts: any[]; should_stream: boolean }): Promise<string>;
    injectPrompts(prompts: Array<{ id: string; position: string; depth: number; role: string; content: string; should_scan: boolean }>, options?: { once?: boolean }): void;
    generate(options: any): Promise<any>;
    getLorebookEntries(): any[];
    setLorebookEntries(entries: any[]): void;
    createLorebookEntries(entries: any[]): void;
    deleteLorebookEntries(ids: string[]): void;
    tavern_events: {
        MESSAGE_SENT: string;
        MESSAGE_RECEIVED: string;
        GENERATION_AFTER_COMMANDS: string;
        CHAT_CHANGED: string;
        [key: string]: string;
    };
    [key: string]: any;
};

declare var ToolManager: {
    registerFunctionTool(tool: {
        name: string;
        displayName: string;
        description: string;
        parameters: object;
        action: (args: any) => Promise<string>;
    }): void;
    [key: string]: any;
};

declare var SillyTavern: {
    getContext(): {
        chatId: string;
        chat: any[];
        characters: any[];
        characterId: number;
        name1: string;
        name2: string;
        maxContext: number;
        getCurrentLocale?(): string;
        setExtensionPrompt(id: string, content: string, position: number, depth: number, scan: boolean, role: number): void;
        generateQuietPrompt(userMessage: string, systemPrompt?: string): Promise<string>;
        eventSource: any;
        eventTypes: any;
        reloadCurrentChat(): void;
        getRequestHeaders(): Record<string, string>;
        [key: string]: any;
    };
    chat: any[];
    characters: any[];
    name1: string;
    name2: string;
    characterId: number;
    chatMetadata: any;
    eventSource: any;
    eventTypes: any;
    maxContext: number;
    [key: string]: any;
};

declare var toastr: {
    success(msg: string): void;
    error(msg: string): void;
    info(msg: string): void;
    warning(msg: string): void;
    [key: string]: any;
};

declare function t_narrative(key: string, replacements?: Record<string, string>): string;

interface Window {
    __NE_MEMORY_LOADED__?: boolean;
    __ACU_STAR_DB_III_LOADED__?: boolean;
    TavernHelper?: any;
    ToolManager?: any;
    SillyTavern?: any;
    toastr?: any;
    jQuery?: JQueryStatic;
    $?: JQueryStatic;
}
