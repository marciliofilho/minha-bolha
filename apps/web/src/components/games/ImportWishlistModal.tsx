/** Modal de importação da wishlist da Steam. */
import { useEffect, useState } from 'react';
import { Download, Lock } from 'lucide-react';
import { Button, ErrorBanner, Field, Modal } from '@/components/ui';
import { useImportWishlist } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';

export function ImportWishlistModal({
  open,
  onClose,
  onImported
}: {
  open: boolean;
  onClose: () => void;
  onImported: (name: string) => void;
}) {
  const { t } = useI18n();
  const importMutation = useImportWishlist();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setInput('');
    setError(null);
    importMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (): Promise<void> => {
    if (!input.trim()) return;
    setError(null);
    try {
      const result = await importMutation.mutateAsync(input.trim());
      onImported(result.name);
      onClose();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : t('Não foi possível iniciar a importação.'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Importar wishlist da Steam')}
      description={t('A lista é sincronizada a cada 6 horas e pode ser reimportada quando quiser.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={importMutation.isPending}
            disabled={!input.trim()}
            icon={<Download className="h-4 w-4" />}
          >
            {t('Importar')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label={t('Seu perfil')}
          htmlFor="steam-profile"
          hint={t('Aceita o SteamID64 (17 dígitos), o link do perfil ou o nome vanity.')}
        >
          <input
            id="steam-profile"
            className="field-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="https://steamcommunity.com/id/seu-nome/ ou 7656119…"
            autoFocus
            spellCheck={false}
          />
        </Field>

        <div className="rounded-xl border border-line/70 bg-bg/40 p-3 text-[11px] leading-relaxed text-muted">
          <p className="flex items-center gap-1.5 font-medium text-fg">
            <Lock className="h-3.5 w-3.5 text-warning" /> {t('A wishlist precisa estar pública')}
          </p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4">
            <li>{t('Steam → seu perfil → Editar perfil → Privacidade.')}</li>
            <li>{t('Defina “Meu perfil” como Público.')}</li>
            <li>{t('Desative “Sempre manter detalhes do jogo privados”.')}</li>
            <li>{t('Em Detalhes do jogo, deixe a lista de desejos visível.')}</li>
          </ol>
          <p className="mt-2 text-faint">
            {t('Se a lista vier vazia, o Hub mostra o motivo e você pode tentar de novo depois.')}
          </p>
        </div>

        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
