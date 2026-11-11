import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { UpdateCheckResult, UpdateEvent } from '@/types/electron';

type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | {
      kind: 'available';
      mode: 'installed' | 'portable';
      version: string;
      currentVersion: string;
      releaseUrl?: string;
      assetUrl?: string | null;
    }
  | { kind: 'downloading'; percent: number }
  | { kind: 'installing'; version?: string | null }
  | { kind: 'none'; version?: string }
  | { kind: 'dev' | 'not-configured' }
  | { kind: 'manual'; releaseUrl: string | null }
  | { kind: 'error'; message: string };

function stateFromResult(result: UpdateCheckResult): UpdateState {
  switch (result.status) {
    case 'available':
      return {
        kind: 'available',
        mode: result.mode,
        version: result.version,
        currentVersion: result.currentVersion,
        releaseUrl: result.releaseUrl,
        assetUrl: result.assetUrl
      };
    case 'none':
      return { kind: 'none', version: result.version };
    case 'dev':
      return { kind: 'dev' };
    case 'not-configured':
      return { kind: 'not-configured' };
    case 'manual':
      return { kind: 'manual', releaseUrl: result.releaseUrl };
    case 'error':
      return { kind: 'error', message: result.message };
    case 'downloading':
    case 'downloaded':
    case 'installing':
      return { kind: 'installing', version: result.version };
    default:
      return { kind: 'idle' };
  }
}

export function UpdateDialog() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateState>({ kind: 'idle' });

  const applyResult = useCallback((result: UpdateCheckResult) => {
    setState(stateFromResult(result));
  }, []);

  const checkNow = useCallback(async () => {
    const bridge = window.hubDesktop;
    if (!bridge) return;
    setOpen(true);
    setState({ kind: 'checking' });
    try {
      applyResult(await bridge.checkForUpdates());
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }, [applyResult]);

  useEffect(() => {
    const bridge = window.hubDesktop;
    if (!bridge) return;

    bridge.onUpdateEvent((event: UpdateEvent) => {
      if (event.type === 'available') {
        setState({
          kind: 'available',
          mode: event.mode,
          version: event.version,
          currentVersion: event.currentVersion,
          releaseUrl: event.releaseUrl,
          assetUrl: event.assetUrl
        });
        setOpen(true);
        return;
      }
      if (event.type === 'progress') {
        setState((current) =>
          current.kind === 'downloading'
            ? { kind: 'downloading', percent: event.percent }
            : current
        );
        return;
      }
      if (event.type === 'downloaded' || event.type === 'installing') {
        setState({ kind: 'installing', version: event.version });
        setOpen(true);
        return;
      }
      if (event.type === 'error') {
        setState({ kind: 'error', message: event.message });
        setOpen(true);
      }
    });

    const onCheck = () => {
      void checkNow();
    };
    window.addEventListener('hub:check-updates', onCheck);
    return () => window.removeEventListener('hub:check-updates', onCheck);
  }, [checkNow]);

  const download = async (): Promise<void> => {
    const bridge = window.hubDesktop;
    if (!bridge) return;
    setState({ kind: 'downloading', percent: 0 });
    try {
      const result = await bridge.downloadUpdate();
      if (result.status === 'manual' && result.releaseUrl) {
        setState({ kind: 'manual', releaseUrl: result.releaseUrl });
        return;
      }
      if (result.status !== 'downloading' && result.status !== 'installing') {
        applyResult(result);
      }
    } catch (error) {
      setState({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const busy = state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'installing';

  const title =
    state.kind === 'available'
      ? t('Atualização disponível')
      : state.kind === 'downloading'
        ? t('Baixando atualização')
        : state.kind === 'installing'
          ? t('Instalando atualização')
          : state.kind === 'none'
            ? t('Tudo atualizado')
            : state.kind === 'error'
              ? t('Não foi possível atualizar')
              : t('Atualizações');

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) setOpen(false);
      }}
      title={title}
      description={
        state.kind === 'available'
          ? t('Uma versão nova do app está pronta para ser baixada.')
          : undefined
      }
      footer={
        state.kind === 'available' ? (
          <>
            <Button variant="subtle" onClick={() => setOpen(false)}>
              {t('Depois')}
            </Button>
            <Button onClick={() => void download()} icon={<Download className="h-4 w-4" />}>
              {t('Baixar e instalar')}
            </Button>
          </>
        ) : state.kind === 'manual' ? (
          <>
            <Button variant="subtle" onClick={() => setOpen(false)}>
              {t('Fechar')}
            </Button>
            <Button
              onClick={() => {
                if (state.releaseUrl) window.open(state.releaseUrl, '_blank', 'noopener');
              }}
              icon={<ExternalLink className="h-4 w-4" />}
            >
              {t('Abrir página da versão')}
            </Button>
          </>
        ) : (
          <Button variant="subtle" onClick={() => setOpen(false)} disabled={busy}>
            {t('Fechar')}
          </Button>
        )
      }
    >
      <div className="space-y-4 text-sm text-muted">
        {state.kind === 'checking' ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
            <span>{t('Verificando atualizações…')}</span>
          </div>
        ) : null}

        {state.kind === 'available' ? (
          <>
            <p>
              {t(
                'A versão {version} está disponível. Você está na versão {current}. Deseja baixar e instalar agora?',
                { version: state.version, current: state.currentVersion }
              )}
            </p>
            {state.mode === 'portable' ? (
              <p className="rounded-xl border border-line/70 bg-bg/50 p-3 text-xs text-faint">
                {t(
                  'Versão portátil: os arquivos serão substituídos e a pasta data/ com suas configurações será mantida.'
                )}
              </p>
            ) : null}
          </>
        ) : null}

        {state.kind === 'downloading' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span>{t('Baixando atualização…')}</span>
              <span className="font-medium text-fg">{Math.round(state.percent)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.max(0, Math.min(100, state.percent))}%` }}
              />
            </div>
          </div>
        ) : null}

        {state.kind === 'installing' ? (
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-accent" />
            <span>{t('Instalando atualização… O app vai reiniciar.')}</span>
          </div>
        ) : null}

        {state.kind === 'none' ? (
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              {t('Você já está na versão mais recente.')}
              {state.version ? ` (v${state.version})` : ''}
            </span>
          </div>
        ) : null}

        {state.kind === 'dev' ? <p>{t('A verificação de atualizações funciona apenas no app desktop.')}</p> : null}

        {state.kind === 'not-configured' ? (
          <p>
            {t(
              'As atualizações ainda não foram configuradas neste build. Preencha owner/repo em apps/desktop/update-config.cjs.'
            )}
          </p>
        ) : null}

        {state.kind === 'manual' ? (
          <p>{t('Baixe o novo ZIP na página da versão e extraia sobre a pasta atual, mantendo data/.')}</p>
        ) : null}

        {state.kind === 'error' ? (
          <div className="flex items-start gap-2 text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{state.message}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
