/** Navegador embutido exibido ao lado do card em destaque do Feed. */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  X
} from 'lucide-react';
import { api, type BrowserLiveInput, type BrowserLiveState } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { WebviewElement } from '@/types/electron';

const QUICK_LINKS = [
  { label: 'Google', url: 'https://www.google.com/search?igu=1' },
  { label: 'Wikipédia', url: 'https://pt.wikipedia.org/' },
  { label: 'Bing', url: 'https://www.bing.com/' }
];

const LIVE_WIDTH = 1280;
const LIVE_HEIGHT = 720;
const SESSION_KEY = 'hub.browser.session.v1';

type BrowserMode = 'direct' | 'proxy' | 'live' | 'desktop';

interface BrowserTab {
  id: string;
  url: string;
  title: string;
}

interface BrowserSession {
  tabs: BrowserTab[];
  activeTabId: string | null;
}

const EMPTY_SESSION: BrowserSession = { tabs: [], activeTabId: null };

function newTabId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function readBrowserSession(): BrowserSession {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return EMPTY_SESSION;
    const parsed = JSON.parse(raw) as Partial<BrowserSession>;
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(
          (tab): tab is BrowserTab =>
            Boolean(tab) &&
            typeof tab.id === 'string' &&
            typeof tab.url === 'string' &&
            typeof tab.title === 'string'
        )
      : [];
    // Descarta abas em branco que não chegaram a ser usadas.
    const used = tabs.filter((tab) => tab.url.trim().length > 0);
    if (used.length === 0) return EMPTY_SESSION;
    const active =
      typeof parsed.activeTabId === 'string' && used.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : used[0]?.id ?? null;
    return { tabs: used, activeTabId: active };
  } catch {
    return EMPTY_SESSION;
  }
}

function saveBrowserSession(session: BrowserSession): void {
  try {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        tabs: session.tabs.filter((tab) => tab.url.trim().length > 0),
        activeTabId: session.activeTabId
      })
    );
  } catch {
    // Armazenamento indisponível.
  }
}

function tabLabel(tab: BrowserTab): string {
  return tab.title.trim() || hostLabel(tab.url) || 'Nova aba';
}

const TRANSLATE_LANGUAGES = [
  { value: '', label: 'Original' },
  { value: 'pt', label: 'Português' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-CN', label: '中文' }
];

/** Aceita URL completa, domínio solto ou texto de busca. */
export function normalizeBrowserAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+([/?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  if (/^localhost(?::\d+)?([/?#].*)?$/i.test(trimmed)) return `http://${trimmed}`;
  return `https://www.google.com/search?igu=1&q=${encodeURIComponent(trimmed)}`;
}

function hostLabel(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return value;
  }
}

function proxySrc(url: string, refresh = false): string {
  return `/api/browser/proxy?url=${encodeURIComponent(url)}${refresh ? '&refresh=1' : ''}`;
}

/** Converte o clique no card para coordenadas do viewport 1280x720. */
function imagePoint(stage: HTMLElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = stage.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const imageAspect = LIVE_WIDTH / LIVE_HEIGHT;
  const containerAspect = rect.width / rect.height;

  let width = rect.width;
  let height = rect.height;
  let left = rect.left;
  let top = rect.top;

  if (containerAspect > imageAspect) {
    height = rect.height;
    width = height * imageAspect;
    left = rect.left + (rect.width - width) / 2;
  } else {
    width = rect.width;
    height = width / imageAspect;
    top = rect.top + (rect.height - height) / 2;
  }

  const x = ((clientX - left) / width) * LIVE_WIDTH;
  const y = ((clientY - top) / height) * LIVE_HEIGHT;
  if (x < 0 || y < 0 || x > LIVE_WIDTH || y > LIVE_HEIGHT) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

export function FeedBrowser({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const desktop = typeof window !== 'undefined' && window.hubDesktop?.isDesktop === true;
  const desktopUserAgent = desktop
    ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${
        window.hubDesktop?.chromeVersion ?? '140.0.0.0'
      } Safari/537.36`
    : undefined;

  const initialSessionRef = useRef<BrowserSession | null>(null);
  if (desktop && initialSessionRef.current === null) {
    initialSessionRef.current = readBrowserSession();
  }
  const initialSession = desktop ? initialSessionRef.current ?? EMPTY_SESSION : EMPTY_SESSION;
  const initialActiveUrl =
    initialSession.tabs.find((tab) => tab.id === initialSession.activeTabId)?.url ?? null;

  const [draft, setDraft] = useState(initialActiveUrl ?? '');
  const [src, setSrc] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(initialActiveUrl);
  const [mode, setMode] = useState<BrowserMode>(desktop ? 'desktop' : 'direct');
  const [checking, setChecking] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [reloadKey, setReloadKey] = useState(0);
  const [liveShot, setLiveShot] = useState<string | null>(null);
  const [liveCanBack, setLiveCanBack] = useState(false);
  const [liveCanForward, setLiveCanForward] = useState(false);
  const [desktopSrc, setDesktopSrc] = useState<string | null>(initialActiveUrl);
  const [desktopReady, setDesktopReady] = useState(false);
  const [desktopCanBack, setDesktopCanBack] = useState(false);
  const [desktopCanForward, setDesktopCanForward] = useState(false);
  const [tabs, setTabs] = useState<BrowserTab[]>(initialSession.tabs);
  const [activeTabId, setActiveTabId] = useState<string | null>(initialSession.activeTabId);
  const [translateLanguage, setTranslateLanguage] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const webviewRef = useRef<WebviewElement | null>(null);
  const activeTabIdRef = useRef<string | null>(initialSession.activeTabId);
  const liveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const liveSessionRef = useRef(0);
  const lastWheelRef = useRef(0);

  const applyLiveState = useCallback((state: BrowserLiveState) => {
    if (state.screenshot) setLiveShot(state.screenshot);
    setLiveCanBack(state.canGoBack);
    setLiveCanForward(state.canGoForward);
    if (state.url) {
      setPageUrl(state.url);
      if (document.activeElement !== inputRef.current) setDraft(state.url);
    }
  }, []);

  const stopLive = useCallback((): void => {
    void api.browserLiveStop().catch(() => undefined);
  }, []);

  const enqueueLive = useCallback((task: () => Promise<void>): void => {
    liveQueueRef.current = liveQueueRef.current.then(task, task);
  }, []);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    if (desktop) saveBrowserSession({ tabs, activeTabId });
  }, [desktop, tabs, activeTabId]);

  const updateActiveTab = useCallback((patch: Partial<BrowserTab>): void => {
    const id = activeTabIdRef.current;
    if (!id) return;
    setTabs((previous) =>
      previous.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
    );
  }, []);

  const navigate = async (value: string, pushHistory = true): Promise<void> => {
    const url = normalizeBrowserAddress(value);
    if (!url) return;
    const requestId = ++requestRef.current;
    ++liveSessionRef.current;
    const previousMode = mode;

    setDraft(url);
    setChecking(true);
    setPageLoading(false);
    setPageUrl(null);
    setSrc(null);

    const register = (finalUrl: string): void => {
      if (!pushHistory) return;
      const next = [...history.slice(0, historyIndex + 1), finalUrl];
      setHistory(next);
      setHistoryIndex(next.length - 1);
    };

    // No app desktop, o card usa o <webview> nativo do Electron.
    if (desktop) {
      register(url);
      setPageUrl(url);
      setDraft(url);
      setPageError(null);
      setTranslateLanguage('');
      setTranslationError(null);
      setTranslating(false);
      const currentTab = tabs.find((tab) => tab.id === activeTabIdRef.current);
      if (currentTab) {
        updateActiveTab({ url, title: hostLabel(url) });
      } else {
        const tab: BrowserTab = { id: newTabId(), url, title: hostLabel(url) };
        setTabs((previous) => [...previous, tab]);
        setActiveTabId(tab.id);
        activeTabIdRef.current = tab.id;
      }
      setChecking(false);
      setPageLoading(true);
      setMode('desktop');
      const view = webviewRef.current;
      try {
        if (view) {
          void view.loadURL(url).catch(() => setPageLoading(false));
        } else {
          setDesktopReady(false);
          setDesktopSrc(url);
        }
      } catch {
        setPageLoading(false);
      }
      return;
    }

    try {
      const check = await api.browserCheck(url);
      if (requestId !== requestRef.current) return;
      register(check.url);
      setPageUrl(check.url);

      if (check.embeddable) {
        if (previousMode === 'live') stopLive();
        setMode('direct');
        setSrc(check.url);
        setPageLoading(true);
        setReloadKey(0);
        return;
      }

      // Sem Electron: proxy simplificado (rápido e sem janela externa).
      stopLive();
      setMode('proxy');
      setSrc(proxySrc(check.url));
      setPageLoading(true);
      setReloadKey(0);
    } catch {
      if (requestId !== requestRef.current) return;
      if (previousMode === 'live') stopLive();
      register(url);
      setPageUrl(url);
      setMode('direct');
      setSrc(url);
      setPageLoading(true);
      setReloadKey(0);
    } finally {
      if (requestId === requestRef.current) setChecking(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void navigate(draft);
  };

  const goToHistory = (index: number): void => {
    const url = history[index];
    if (!url) return;
    setHistoryIndex(index);
    void navigate(url, false);
  };

  const runLiveAction = useCallback(
    (action: 'back' | 'forward' | 'reload'): void => {
      const session = liveSessionRef.current;
      setPageLoading(true);
      enqueueLive(async () => {
        try {
          const state = await api.browserLiveAction(action);
          if (session === liveSessionRef.current) applyLiveState(state);
        } catch {
          // Mantém a última imagem visível.
        } finally {
          setPageLoading(false);
        }
      });
    },
    [applyLiveState, enqueueLive]
  );

  const sendLiveInput = useCallback(
    (input: BrowserLiveInput): void => {
      const session = liveSessionRef.current;
      enqueueLive(async () => {
        try {
          const state = await api.browserLiveInput(input);
          if (session === liveSessionRef.current) applyLiveState(state);
        } catch {
          // Mantém a última imagem visível.
        }
      });
    },
    [applyLiveState, enqueueLive]
  );

  const reload = (): void => {
    if (mode === 'desktop') {
      const view = webviewRef.current;
      if (view) {
        setPageLoading(true);
        view.reload();
      }
      return;
    }
    if (mode === 'live') {
      void runLiveAction('reload');
      return;
    }
    if (!src) return;
    setPageLoading(true);
    if (mode === 'proxy' && pageUrl) {
      setSrc(proxySrc(pageUrl, true));
      return;
    }
    setReloadKey((key) => key + 1);
  };

  const tryDirect = (): void => {
    if (!pageUrl) return;
    setMode('direct');
    setSrc(pageUrl);
    setPageLoading(true);
    setReloadKey((key) => key + 1);
  };

  const activateTab = (id: string): void => {
    const tab = tabs.find((item) => item.id === id);
    if (!tab) return;
    setActiveTabId(id);
    activeTabIdRef.current = id;
    setMode('desktop');
    setPageError(null);
    setTranslateLanguage('');
    setTranslationError(null);
    setTranslating(false);
    setDesktopReady(false);
    if (!tab.url) {
      setDesktopSrc(null);
      setPageUrl(null);
      setDraft('');
      setPageLoading(false);
      return;
    }
    setPageUrl(tab.url);
    setDraft(tab.url);
    setPageLoading(true);
    setDesktopSrc(tab.url);
  };

  const addTab = (): void => {
    const tab: BrowserTab = { id: newTabId(), url: '', title: 'Nova aba' };
    setTabs((previous) => [...previous, tab]);
    setActiveTabId(tab.id);
    activeTabIdRef.current = tab.id;
    setMode('desktop');
    setDesktopReady(false);
    setDesktopSrc(null);
    setPageUrl(null);
    setDraft('');
    setPageLoading(false);
    setPageError(null);
    setTranslateLanguage('');
    setTranslationError(null);
    setTranslating(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const closeTab = (id: string): void => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index < 0) return;
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    setTabs(nextTabs);
    if (activeTabIdRef.current !== id) return;

    const nextActive = nextTabs[Math.min(index, nextTabs.length - 1)] ?? null;
    setActiveTabId(nextActive?.id ?? null);
    activeTabIdRef.current = nextActive?.id ?? null;
    setPageError(null);
    setTranslateLanguage('');
    setTranslationError(null);
    setTranslating(false);
    setDesktopReady(false);

    if (!nextActive?.url) {
      setDesktopSrc(null);
      setPageUrl(null);
      setDraft('');
      setPageLoading(false);
      return;
    }
    setPageUrl(nextActive.url);
    setDraft(nextActive.url);
    setPageLoading(true);
    setDesktopSrc(nextActive.url);
  };

  const changeTranslation = (language: string): void => {
    const view = webviewRef.current;
    if (!view) return;

    if (language === '') {
      setTranslateLanguage('');
      setTranslationError(null);
      setPageLoading(true);
      try {
        view.reload();
      } catch {
        setPageLoading(false);
      }
      return;
    }

    setTranslateLanguage(language);
    setTranslationError(null);
    setTranslating(true);

    const script = `(() => {
      const lang = ${JSON.stringify(language)};
      const trigger = () => {
        const combo = document.querySelector('.goog-te-combo');
        if (!combo) return false;
        combo.value = lang;
        combo.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };

      if (trigger()) return Promise.resolve(true);

      if (!window.__hubTranslateInjected) {
        window.__hubTranslateInjected = true;
        const container = document.createElement('div');
        container.id = 'hub-google-translate';
        container.style.display = 'none';
        document.body.appendChild(container);
        window.googleTranslateElementInit = () => {
          try {
            new google.translate.TranslateElement(
              { pageLanguage: '', autoDisplay: false },
              'hub-google-translate'
            );
          } catch {
            // O widget pode ser bloqueado pelo CSP do site.
          }
        };
        const script = document.createElement('script');
        script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
        script.onerror = () => {
          window.__hubTranslateFailed = true;
        };
        document.head.appendChild(script);
      }

      return new Promise((resolve) => {
        let attempts = 0;
        const timer = setInterval(() => {
          if (trigger()) {
            clearInterval(timer);
            resolve(true);
            return;
          }
          attempts += 1;
          if (attempts > 40 || window.__hubTranslateFailed) {
            clearInterval(timer);
            resolve(false);
          }
        }, 250);
      });
    })()`;

    void view
      .executeJavaScript(script, true)
      .then((ok) => {
        if (ok === false) {
          setTranslationError(
            t('Não foi possível traduzir esta página. O site pode bloquear o Google Translate.')
          );
        }
      })
      .catch(() => {
        setTranslationError(t('Não foi possível traduzir esta página.'));
      })
      .finally(() => setTranslating(false));
  };

  const restartLive = async (): Promise<void> => {
    if (!pageUrl) return;
    setPageLoading(true);
    try {
      await api.browserLiveReset();
      await navigate(pageUrl);
    } catch {
      setPageLoading(false);
    }
  };

  const handleLiveClick = (event: MouseEvent<HTMLDivElement>): void => {
    stageRef.current?.focus();
    const point = imagePoint(event.currentTarget, event.clientX, event.clientY);
    if (point) void sendLiveInput({ type: 'click', ...point });
  };

  const handleLiveKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key;
    if (!key) return;
    event.preventDefault();
    event.stopPropagation();

    if (key.length === 1) {
      void sendLiveInput({ type: 'text', text: key });
      return;
    }
    if (
      [
        'Enter',
        'Backspace',
        'Tab',
        'Delete',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'Escape'
      ].includes(key)
    ) {
      void sendLiveInput({ type: 'key', key });
    }
  };

  // A rolagem do card controla o Chromium, sem rolar o Feed.
  useEffect(() => {
    if (mode !== 'live') return;
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const now = Date.now();
      if (now - lastWheelRef.current < 120) return;
      lastWheelRef.current = now;
      const point = imagePoint(stage, event.clientX, event.clientY);
      if (point) {
        void sendLiveInput({ type: 'scroll', ...point, deltaY: event.deltaY });
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [mode, sendLiveInput]);

  // Atualiza a imagem do Chromium enquanto o card estiver aberto.
  useEffect(() => {
    if (mode !== 'live' || checking) return;
    let cancelled = false;
    let timer: number | undefined;
    const session = liveSessionRef.current;

    function schedule(): void {
      if (!cancelled) timer = window.setTimeout(poll, 900);
    }

    function poll(): void {
      if (cancelled) return;
      enqueueLive(async () => {
        if (cancelled) return;
        try {
          const state = await api.browserLiveFrame();
          if (!cancelled && session === liveSessionRef.current) applyLiveState(state);
        } catch {
          // O próximo ciclo tenta novamente.
        }
      });
      void liveQueueRef.current.finally(schedule);
    }

    schedule();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [mode, checking, applyLiveState, enqueueLive]);

  // Ao fechar o card, encerra o Chromium.
  useEffect(
    () => () => {
      void api.browserLiveStop().catch(() => undefined);
    },
    []
  );

  // Eventos do <webview> do Electron: URL, histórico, título e falhas.
  useEffect(() => {
    if (!desktop || !desktopSrc) return;
    const view = webviewRef.current;
    if (!view) return;

    const sync = (): void => {
      try {
        const url = view.getURL();
        if (url && url !== 'about:blank') {
          const title = view.getTitle();
          setPageUrl(url);
          if (document.activeElement !== inputRef.current) setDraft(url);
          updateActiveTab({ url, title: title || hostLabel(url) });
          setDesktopReady(true);
          setPageLoading(false);
        }
        setDesktopCanBack(view.canGoBack());
        setDesktopCanForward(view.canGoForward());
      } catch {
        // Webview ainda inicializando.
      }
    };

    const onNavigate = (event: Event): void => {
      const url = (event as Event & { url?: string }).url;
      if (url) {
        setPageUrl(url);
        if (document.activeElement !== inputRef.current) setDraft(url);
        setTranslateLanguage('');
        setTranslationError(null);
        let title = '';
        try {
          title = view.getTitle();
        } catch {
          // Título ainda indisponível.
        }
        updateActiveTab({ url, title: title || hostLabel(url) });
      }
      setDesktopReady(true);
      setPageLoading(false);
      try {
        setDesktopCanBack(view.canGoBack());
        setDesktopCanForward(view.canGoForward());
      } catch {
        // Ignora durante navegação.
      }
    };

    const onTitle = (event: Event): void => {
      const title = (event as Event & { title?: string }).title;
      if (title) updateActiveTab({ title });
    };

    const onStart = (): void => {
      setPageLoading(true);
      setPageError(null);
    };
    const onStop = (): void => {
      setPageLoading(false);
      sync();
    };

    const onFail = (event: Event): void => {
      const failure = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        isMainFrame?: boolean;
      };
      if (failure.isMainFrame === false) return;
      if (failure.errorCode === -3) return; // navegação cancelada
      setPageLoading(false);
      setDesktopReady(true);
      setPageError(
        failure.errorDescription
          ? t('Não foi possível carregar a página: {error}', {
              error: failure.errorDescription
            })
          : t('Não foi possível carregar a página.')
      );
    };

    const onCrash = (): void => {
      setPageLoading(false);
      setPageError(
        t('O navegador da página travou. Recarregue para tentar novamente.')
      );
    };

    view.addEventListener('did-start-loading', onStart);
    view.addEventListener('did-stop-loading', onStop);
    view.addEventListener('did-navigate', onNavigate);
    view.addEventListener('did-navigate-in-page', onNavigate);
    view.addEventListener('page-title-updated', onTitle);
    view.addEventListener('did-fail-load', onFail);
    view.addEventListener('render-process-gone', onCrash);
    view.addEventListener('dom-ready', sync);

    // Se algum evento se perder durante a montagem, libera o overlay com segurança.
    const fallback = window.setTimeout(() => {
      try {
        const current = view.getURL();
        if (current && current !== 'about:blank') {
          setDesktopReady(true);
          setPageLoading(false);
          sync();
        }
      } catch {
        // Webview ainda inicializando.
      }
    }, 8000);

    return () => {
      window.clearTimeout(fallback);
      view.removeEventListener('did-start-loading', onStart);
      view.removeEventListener('did-stop-loading', onStop);
      view.removeEventListener('did-navigate', onNavigate);
      view.removeEventListener('did-navigate-in-page', onNavigate);
      view.removeEventListener('page-title-updated', onTitle);
      view.removeEventListener('did-fail-load', onFail);
      view.removeEventListener('render-process-gone', onCrash);
      view.removeEventListener('dom-ready', sync);
    };
  }, [desktop, desktopSrc, updateActiveTab]);

  const displayUrl = pageUrl ?? src;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const canBack =
    mode === 'desktop' ? desktopCanBack : mode === 'live' ? liveCanBack : historyIndex > 0;
  const canForward =
    mode === 'desktop'
      ? desktopCanForward
      : mode === 'live'
        ? liveCanForward
        : historyIndex < history.length - 1;

  return (
    <section
      aria-label={t('Navegador do Hub')}
      className="flex aspect-video w-full flex-col overflow-hidden rounded-2xl border border-line bg-elevated"
    >
      {desktop ? (
        <div className="flex items-center gap-1 border-b border-line/70 bg-bg/50 px-1.5 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => activateTab(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    activateTab(tab.id);
                  }}
                  title={tabLabel(tab)}
                  className={cn(
                    'group flex h-6 max-w-[10rem] shrink-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 text-[10px] transition',
                    active
                      ? 'border-accent/40 bg-accent/15 text-fg'
                      : 'border-transparent bg-elevated/50 text-muted hover:bg-elevated hover:text-fg'
                  )}
                >
                  <span className="truncate">{tabLabel(tab)}</span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    aria-label={`${t('Fechar aba')} ${tabLabel(tab)}`}
                    title={t('Fechar aba')}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-faint opacity-70 transition hover:bg-black/20 hover:text-fg group-hover:opacity-100"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              );
            })}
            {tabs.length === 0 ? (
              <span className="px-1 text-[10px] text-faint">{t('Nenhuma aba')}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={addTab}
            aria-label={t('Nova aba')}
            title={t('Nova aba')}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div className="flex shrink-0 items-center gap-1 border-l border-line/60 pl-1">
            {translating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            ) : (
              <Languages className="h-3.5 w-3.5 text-faint" />
            )}
            <select
              value={translateLanguage}
              onChange={(event) => changeTranslation(event.target.value)}
              disabled={!pageUrl || !activeTab || translating}
              aria-label={t('Traduzir página')}
              title={t('Traduzir página')}
              className="h-6 max-w-[5.5rem] rounded border border-line bg-elevated px-1 text-[10px] text-fg outline-none disabled:opacity-40"
            >
              {TRANSLATE_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-1 border-b border-line/70 bg-bg/70 px-1.5 py-1.5 backdrop-blur">
        <button
          type="button"
          onClick={() => {
            if (mode === 'desktop') {
              const view = webviewRef.current;
              if (view) {
                setPageLoading(true);
                view.goBack();
              }
              return;
            }
            if (mode === 'live') {
              void runLiveAction('back');
              return;
            }
            goToHistory(historyIndex - 1);
          }}
          disabled={!canBack}
          aria-label={t('Voltar')}
          title={t('Voltar')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg disabled:cursor-default disabled:opacity-35"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (mode === 'desktop') {
              const view = webviewRef.current;
              if (view) {
                setPageLoading(true);
                view.goForward();
              }
              return;
            }
            if (mode === 'live') {
              void runLiveAction('forward');
              return;
            }
            goToHistory(historyIndex + 1);
          }}
          disabled={!canForward}
          aria-label={t('Avançar')}
          title={t('Avançar')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg disabled:cursor-default disabled:opacity-35"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={reload}
          disabled={mode === 'desktop' ? !desktopSrc : !src && mode !== 'live'}
          aria-label={t('Recarregar página')}
          title={t('Recarregar página')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg disabled:cursor-default disabled:opacity-35"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>

        <form onSubmit={submit} className="min-w-0 flex-1">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder={t('Digite um endereço ou pesquise')}
            aria-label={t('Endereço do navegador')}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="h-7 w-full rounded-md border border-line bg-elevated px-2 text-[11px] text-fg outline-none transition placeholder:text-faint focus:border-accent/50"
          />
        </form>

        {mode === 'desktop' && pageLoading && desktopReady ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
        ) : null}

        {mode === 'desktop' ? (
          <span
            className="hidden shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent xl:block"
            title={t('Navegador integrado do app desktop')}
          >
            app
          </span>
        ) : mode === 'live' ? (
          <span
            className="hidden shrink-0 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-accent xl:block"
            title={t('Navegador real (Chromium)')}
          >
            real
          </span>
        ) : mode === 'proxy' ? (
          <span
            className="hidden shrink-0 rounded bg-warning/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-warning xl:block"
            title={t('Modo simplificado')}
          >
            simples
          </span>
        ) : displayUrl ? (
          <span className="hidden max-w-[9rem] truncate text-[10px] text-faint xl:block">
            {hostLabel(displayUrl)}
          </span>
        ) : null}

        <a
          href={displayUrl ?? undefined}
          target="_blank"
          rel="noreferrer"
          aria-label={t('Abrir em nova aba')}
          title={t('Abrir em nova aba')}
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg',
            !displayUrl && 'pointer-events-none opacity-35'
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Fechar navegador')}
          title={t('Fechar navegador')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-elevated hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {mode === 'proxy' ? (
        <div className="flex items-center gap-1.5 border-b border-line/60 bg-warning/10 px-2 py-1 text-[9px] text-warning">
          <ShieldAlert className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('Modo simplificado: o site bloqueia iframe e os scripts ficam desativados.')}
          </span>
          <button
            type="button"
            onClick={tryDirect}
            className="shrink-0 font-semibold underline decoration-dotted underline-offset-2 transition hover:text-fg"
          >
            {t('Tentar original')}
          </button>
        </div>
      ) : mode === 'live' ? (
        <div className="flex items-center gap-1.5 border-b border-line/60 bg-accent/10 px-2 py-1 text-[9px] text-accent">
          <Globe className="h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {t('Navegador real: clique, role e digite normalmente na página.')}
          </span>
          <button
            type="button"
            onClick={() => void restartLive()}
            title={t('Limpa cookies e reinicia o Chromium')}
            className="shrink-0 font-semibold underline decoration-dotted underline-offset-2 transition hover:text-fg"
          >
            {t('Reiniciar')}
          </button>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 bg-bg">
        {checking ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
            <p className="text-[11px] text-faint">{t('Abrindo site…')}</p>
          </div>
        ) : mode === 'desktop' && desktopSrc ? (
          <div className="relative h-full w-full bg-bg">
            <webview
              ref={webviewRef}
              src={desktopSrc}
              partition="persist:hub-browser"
              useragent={desktopUserAgent}
              className="h-full w-full"
              style={{ display: 'flex', width: '100%', height: '100%', backgroundColor: '#07090e' }}
            />
            {pageError ? (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-bg px-4 text-center">
                <p className="max-w-xs text-[11px] leading-relaxed text-muted">{pageError}</p>
                <button
                  type="button"
                  onClick={reload}
                  className="inline-flex h-7 items-center rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-semibold text-fg transition hover:border-accent/40"
                >
                  {t('Recarregar')}
                </button>
              </div>
            ) : pageLoading && !desktopReady ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg text-center">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <p className="text-[11px] text-faint">{t('Carregando site…')}</p>
              </div>
            ) : null}
            {translationError ? (
              <div className="absolute inset-x-1 bottom-1 z-30 rounded-md border border-warning/40 bg-bg px-2 py-1 text-[10px] leading-relaxed text-warning">
                {translationError}
              </div>
            ) : null}
          </div>
        ) : mode === 'live' ? (
          <div
            ref={stageRef}
            tabIndex={0}
            role="application"
            aria-label={t('Navegador real')}
            onClick={handleLiveClick}
            onKeyDown={handleLiveKeyDown}
            className="relative h-full w-full cursor-default overflow-hidden bg-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
          >
            {liveShot ? (
              <img
                src={`data:image/jpeg;base64,${liveShot}`}
                alt=""
                draggable={false}
                className="pointer-events-none h-full w-full select-none object-contain"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <p className="text-[11px] text-faint">{t('Iniciando navegador real…')}</p>
              </div>
            )}
            {pageLoading ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg/85 text-center backdrop-blur-sm">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <p className="text-[11px] text-faint">{t('Carregando página…')}</p>
              </div>
            ) : null}
          </div>
        ) : src ? (
          <>
            <iframe
              key={`${src}-${reloadKey}`}
              src={src}
              title={`${t('Navegador:')} ${hostLabel(displayUrl ?? src)}`}
              onLoad={(event) => {
                setPageLoading(false);
                if (mode !== 'proxy') return;
                try {
                  const current = new URL(event.currentTarget.contentWindow?.location.href ?? '');
                  const original = current.searchParams.get('url');
                  if (original) {
                    setPageUrl(original);
                    if (document.activeElement !== inputRef.current) setDraft(original);
                  }
                } catch {
                  // Navegação interna indisponível.
                }
              }}
              className="h-full w-full border-0 bg-white"
              referrerPolicy="no-referrer"
              allow="accelerometer; autoplay; clipboard-read; clipboard-write; encrypted-media; fullscreen; geolocation; gyroscope; picture-in-picture; web-share"
              sandbox={
                mode === 'proxy'
                  ? 'allow-popups allow-popups-to-escape-sandbox allow-same-origin'
                  : 'allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts allow-top-navigation-by-user-activation'
              }
            />
            {pageLoading ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg/85 text-center backdrop-blur-sm">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
                <p className="text-[11px] text-faint">
                  {mode === 'proxy' ? t('Preparando versão simplificada…') : t('Carregando site…')}
                </p>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-5 text-center">
            <Globe className="h-7 w-7 text-accent/70" />
            <p className="text-sm font-semibold text-fg">{t('Navegador do Hub')}</p>
            <p className="max-w-xs text-[11px] leading-relaxed text-faint">
              {t('Digite um endereço ou pesquise na barra acima. O site abre aqui, ao lado do destaque.')}
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
              {QUICK_LINKS.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  onClick={() => void navigate(link.url)}
                  className="inline-flex h-7 items-center rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-semibold text-fg transition hover:border-accent/40"
                >
                  {link.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
