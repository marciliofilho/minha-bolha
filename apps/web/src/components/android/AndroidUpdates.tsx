/** Verificação de atualizações do app Android via GitHub Releases. */
import { useEffect, useState } from 'react';
import { Download, RefreshCw, Smartphone } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface UpdateInfo {
  current?: string;
  available?: boolean;
  version?: string;
  url?: string;
  apkUrl?: string | null;
  notes?: string;
  error?: string;
}

const DISMISSED_KEY = 'hub.android.update.dismissed';

function openUpdateLink(info: UpdateInfo): void {
  const url = info.apkUrl || info.url;
  if (!url) return;
  if (window.HubNative?.openExternal) {
    window.HubNative.openExternal(url);
  } else if (window.HubNative?.openBrowser) {
    window.HubNative.openBrowser(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

async function fetchUpdate(force = false): Promise<UpdateInfo> {
  const response = await fetch(`/api/updates/check${force ? '?force=1' : ''}`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as UpdateInfo;
}

/** Aviso automático ao abrir o app quando há uma versão mais nova. */
export function AndroidUpdatePrompt() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.HubNative) return;
    let cancelled = false;
    void fetchUpdate()
      .then((result) => {
        if (cancelled || !result.available) return;
        let dismissed: string | null = null;
        try {
          dismissed = window.localStorage.getItem(DISMISSED_KEY);
        } catch {
          // Armazenamento indisponível.
        }
        if (dismissed === result.version) return;
        setInfo(result);
        setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  const dismiss = (): void => {
    if (info.version) {
      try {
        window.localStorage.setItem(DISMISSED_KEY, info.version);
      } catch {
        // Armazenamento indisponível.
      }
    }
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      onClose={dismiss}
      title={t('Atualização disponível')}
      description={t('Nova versão do Minha Bolha para Android: {version}', {
        version: info.version ?? ''
      })}
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            {t('Depois')}
          </Button>
          <Button
            variant="primary"
            icon={<Download className="h-4 w-4" />}
            onClick={() => {
              openUpdateLink(info);
              dismiss();
            }}
          >
            {t('Baixar atualização')}
          </Button>
        </>
      }
    >
      <p className="text-xs leading-relaxed text-muted">
        {t(
          'O APK será baixado pelo navegador. Ao abrir o arquivo, o Android pedirá para instalar a atualização por cima da versão atual, preservando os dados.'
        )}
      </p>
    </Modal>
  );
}

/** Cartão em Configurações para verificar a atualização manualmente. */
export function AndroidUpdatesPanel() {
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!window.HubNative) return null;

  const check = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setInfo(await fetchUpdate(true));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-fg">{t('Atualizações do Android')}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-faint">
              {t('Versão instalada: {version}', {
                version: info?.current ?? '—'
              })}
            </p>
          </div>
        </div>
        <Button
          variant="subtle"
          size="sm"
          loading={busy}
          onClick={() => void check()}
          icon={<RefreshCw className="h-3.5 w-3.5" />}
        >
          {t('Verificar atualizações')}
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-[11px] text-danger">{error}</p>
      ) : info?.available ? (
        <div className="mt-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
          <p className="text-xs font-semibold text-fg">
            {t('Versão {version} disponível', { version: info.version ?? '' })}
          </p>
          <Button
            variant="primary"
            size="sm"
            className="mt-2"
            icon={<Download className="h-3.5 w-3.5" />}
            onClick={() => openUpdateLink(info)}
          >
            {t('Baixar atualização')}
          </Button>
        </div>
      ) : info ? (
        <p className="mt-3 text-[11px] text-muted">
          {t('Você está na versão mais recente.')}
        </p>
      ) : null}
    </div>
  );
}
