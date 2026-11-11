/** Painel de conexão e biblioteca do Stremio (somente leitura). */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Clapperboard, ExternalLink, Library, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { StremioImportResultDto } from '@hub/shared';
import { Button, ErrorBanner, Field, SuccessNote } from '@/components/ui';
import { api } from '@/lib/api';
import { useStremioStatus } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, formatRelative } from '@/lib/utils';

type Busy = 'login' | 'key' | 'disconnect' | 'sync' | 'import' | null;

export function StremioPanel() {
  const { t } = useI18n();
  const statusQuery = useStremioStatus();
  const queryClient = useQueryClient();

  const passwordRef = useRef<HTMLInputElement>(null);
  const authKeyRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [importResult, setImportResult] = useState<StremioImportResultDto | null>(null);

  const status = statusQuery.data;
  const connected = Boolean(status?.connected);
  const expired = Boolean(status?.expired);

  useEffect(() => {
    setEmail(status?.email ?? '');
  }, [status?.email]);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['stremio-status'] });
    void queryClient.invalidateQueries({ queryKey: ['stremio-library'] });
    void queryClient.invalidateQueries({ queryKey: ['sources'] });
    void queryClient.invalidateQueries({ queryKey: ['feed'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  };

  const handleLogin = async (): Promise<void> => {
    const password = passwordRef.current?.value ?? '';
    if (!email.trim() || !password) {
      setError(t('Informe e-mail e senha.'));
      return;
    }

    setBusy('login');
    setError(null);
    setMessage(null);
    try {
      const result = await api.stremioLogin({ email: email.trim(), password });
      queryClient.setQueryData(['stremio-status'], result.status);
      await refresh();
      setMessage(t('Conectado ao Stremio. A biblioteca vai sincronizar em instantes.'));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t('Não foi possível conectar.'));
    } finally {
      // A senha só existe no input e nesta variável local; nunca vai para o estado.
      if (passwordRef.current) passwordRef.current.value = '';
      setBusy(null);
    }
  };

  const handleManualKey = async (): Promise<void> => {
    const authKey = authKeyRef.current?.value.trim() ?? '';
    if (!authKey) {
      setError(t('Cole a chave de acesso do Stremio.'));
      return;
    }

    setBusy('key');
    setError(null);
    setMessage(null);
    try {
      const result = await api.stremioAuthKey({
        authKey,
        email: email.trim() || undefined
      });
      queryClient.setQueryData(['stremio-status'], result.status);
      await refresh();
      setMessage(t('Chave salva. A biblioteca vai sincronizar em instantes.'));
    } catch (keyError) {
      setError(keyError instanceof Error ? keyError.message : t('Chave inválida.'));
    } finally {
      if (authKeyRef.current) authKeyRef.current.value = '';
      setBusy(null);
    }
  };

  const handleDisconnect = async (): Promise<void> => {
    setBusy('disconnect');
    setError(null);
    setMessage(null);
    try {
      const result = await api.stremioDisconnect();
      queryClient.setQueryData(['stremio-status'], result);
      await refresh();
      setMessage(t('Conta desconectada. O token foi apagado; a biblioteca local foi preservada.'));
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : t('Não foi possível desconectar.')
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSync = async (): Promise<void> => {
    setBusy('sync');
    setError(null);
    setMessage(null);
    try {
      await api.stremioSync();
      setMessage(t('Sincronização iniciada. Os itens aparecem em instantes.'));
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : t('Não foi possível sincronizar.'));
    } finally {
      setBusy(null);
    }
  };

  const handleImport = async (): Promise<void> => {
    setBusy('import');
    setError(null);
    setMessage(null);
    setImportResult(null);
    try {
      const result = await api.stremioImport();
      setImportResult(result);
      setMessage(
        t('Importação concluída. As fontes novas serão sincronizadas pelo agendador.')
      );
      await refresh();
    } catch (importError) {
      setError(
        importError instanceof Error
          ? importError.message
          : t('Não foi possível importar a biblioteca.')
      );
    } finally {
      setBusy(null);
    }
  };

  if (statusQuery.isLoading) {
    return <p className="text-[11px] text-faint">{t('Carregando status do Stremio…')}</p>;
  }

  const statusLabel = !connected
    ? t('desconectado')
    : expired
      ? t('sessão expirada')
      : t('conectado');
  const statusTone = !connected
    ? 'bg-elevated text-faint'
    : expired
      ? 'bg-warning/15 text-warning'
      : 'bg-success/15 text-success';

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line/70 bg-bg/40 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-fg">
              {connected
                ? status?.email
                  ? `${t('Conectado como')} ${status.email}`
                  : t('Conectado (chave de acesso manual)')
                : t('Desconectado')}
            </p>
            <p className="text-[11px] leading-relaxed text-faint">
              {connected
                ? expired
                  ? t('A sessão expirou. Reconecte para sincronizar novamente.')
                  : `${status?.libraryCount ?? 0} ${t('item(ns) na biblioteca')} · ${t('última sincronização')} ${formatRelative(status?.lastSyncAt)}`
                : t(
                    'Conecte sua conta para sincronizar a biblioteca do Stremio. O Hub funciona normalmente sem ela.'
                  )}
            </p>
          </div>
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', statusTone)}>
            {statusLabel}
          </span>
        </div>

        {connected && !expired ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Link
              to="/library"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elevated px-2.5 text-xs font-medium text-fg transition hover:border-accent/40 hover:bg-elevated/80"
            >
              <Library className="h-3.5 w-3.5 text-accent" /> {t('Abrir biblioteca')}
            </Link>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void handleSync()}
              loading={busy === 'sync'}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              {t('Sincronizar agora')}
            </Button>
            <Button
              variant="subtle"
              size="sm"
              onClick={() => void handleImport()}
              loading={busy === 'import'}
              icon={<Upload className="h-3.5 w-3.5" />}
            >
              {t('Importar títulos para fontes')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleDisconnect()}
              loading={busy === 'disconnect'}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              {t('Desconectar')}
            </Button>
          </div>
        ) : null}

        {connected && expired ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleDisconnect()}
              loading={busy === 'disconnect'}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              {t('Desconectar')}
            </Button>
          </div>
        ) : null}
      </div>

      {!status?.appSecretConfigured ? (
        <ErrorBanner message={t('Defina APP_SECRET no .env (mínimo 16 caracteres) e reinicie a API para conectar o Stremio com segurança.')} />
      ) : null}

      {(!connected || expired) && status?.appSecretConfigured ? (
        <div className="space-y-3 rounded-xl border border-line/70 bg-bg/40 p-3">
          <p className="text-xs font-semibold text-fg">{t('Conectar com e-mail e senha')}</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <input
              type="email"
              className="field-input"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
              aria-label={t('E-mail do Stremio')}
            />
            <input
              ref={passwordRef}
              type="password"
              className="field-input"
              placeholder={t('Senha')}
              autoComplete="current-password"
              aria-label={t('Senha do Stremio')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleLogin()}
              loading={busy === 'login'}
              disabled={!status?.appSecretConfigured}
            >
              {t('Conectar')}
            </Button>
            <span className="text-[11px] text-faint">
              {t('A senha é usada uma única vez e não é armazenada.')}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowManual((value) => !value)}
            className="text-[11px] font-medium text-accent transition hover:underline"
          >
            {showManual ? t('Ocultar chave manual') : t('Usar chave de acesso (Facebook/Apple)')}
          </button>

          {showManual ? (
            <div className="space-y-2 rounded-lg border border-line/70 bg-bg/50 p-2.5">
              <p className="text-[11px] leading-relaxed text-muted">
                {t('Abra')}{' '}
                <a
                  href="https://web.stremio.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
                >
                  web.stremio.com <ExternalLink className="h-3 w-3" />
                </a>
                {t(', faça login, abra o Console (F12) e rode:')}
              </p>
              <code className="block overflow-x-auto rounded bg-black/30 px-2 py-1.5 text-[10px] text-muted">
                JSON.parse(localStorage.getItem(&quot;profile&quot;)).auth.key
              </code>
              <Field label={t('Chave de acesso')} htmlFor="stremio-auth-key">
                <input
                  id="stremio-auth-key"
                  ref={authKeyRef}
                  type="password"
                  className="field-input"
                  placeholder={t('Cole a auth key')}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Button
                variant="subtle"
                size="sm"
                onClick={() => void handleManualKey()}
                loading={busy === 'key'}
              >
                {t('Salvar chave')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ErrorBanner message={error} />
      <SuccessNote message={message} />

      {importResult ? (
        <div className="rounded-xl border border-line/70 bg-bg/40 p-3 text-[11px] leading-relaxed text-muted">
          <p className="font-medium text-fg">
            {t('Importação: {created} fonte(s) criada(s), {skipped} já existente(s).', {
              created: importResult.created,
              skipped: importResult.skipped
            })}
          </p>
          {importResult.errors.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-warning">
              {importResult.errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-[11px] leading-relaxed text-faint">
        <Clapperboard className="h-3.5 w-3.5" />
        {t(
          'A API de conta do Stremio não é oficial e pode mudar. O conector é somente leitura: o Hub nunca adiciona ou remove itens da sua biblioteca.'
        )}
      </p>
    </div>
  );
}
