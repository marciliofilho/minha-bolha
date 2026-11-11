import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ErrorBanner, Modal, SuccessNote } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function AddAddonModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setUrl('');
    setBusy(false);
    setError(null);
    setMessage(null);
  }, [open]);

  const handleAdd = async (): Promise<void> => {
    const value = url.trim();
    if (!value) {
      setError(t('Cole a URL do manifest.json do addon.'));
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.addStremioAddon(value);
      setUrl('');
      setMessage(`${t('Addon')} "${result.addon.name}" ${t('adicionado.')}`);
      void queryClient.invalidateQueries({ queryKey: ['stremio-addons'] });
      void queryClient.invalidateQueries({ queryKey: ['stremio-catalogs'] });
      void queryClient.invalidateQueries({ queryKey: ['stremio-search'] });
    } catch (addError) {
      setError(
        addError instanceof Error ? addError.message : t('Não foi possível adicionar o addon.')
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Adicionar addon')}
      description={t('Cole a URL do manifest.json de um addon do Stremio.')}
      footer={
        message ? (
          <Button variant="subtle" onClick={onClose}>
            {t('Fechar')}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('Cancelar')}
            </Button>
            <Button onClick={() => void handleAdd()} loading={busy} icon={<Plus className="h-4 w-4" />}>
              {t('Adicionar')}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {error ? <ErrorBanner message={error} /> : null}
        {message ? <SuccessNote message={message} /> : null}
        {!message ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleAdd();
            }}
          >
            <label className="field-label" htmlFor="quick-addon-url">
              {t('URL do manifest.json')}
            </label>
            <input
              id="quick-addon-url"
              type="url"
              className="field-input"
              placeholder="https://exemplo.com/manifest.json"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              autoFocus
            />
            <p className="mt-1 text-[11px] leading-relaxed text-faint">
              {t('Aceita também endereços stremio://.')}
            </p>
          </form>
        ) : null}
      </div>
    </Modal>
  );
}
