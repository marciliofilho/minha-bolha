import { Puzzle, Rss } from 'lucide-react';
import { Button, Modal } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export function QuickAddModal({
  open,
  onClose,
  onSource,
  onAddon
}: {
  open: boolean;
  onClose: () => void;
  onSource: () => void;
  onAddon: () => void;
}) {
  const { t } = useI18n();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('Adicionar conteúdo')}
      description={t('Escolha o que você quer adicionar agora.')}
      footer={
        <Button variant="ghost" onClick={onClose}>
          {t('Cancelar')}
        </Button>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onSource}
          className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-bg/40 p-4 text-left transition hover:border-accent/50 hover:bg-accent/5"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
            <Rss className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-fg">{t('Fonte')}</span>
          <span className="text-[11px] leading-relaxed text-faint">
            {t('YouTube, RSS, novels, filmes, séries, jogos ou links.')}
          </span>
        </button>

        <button
          type="button"
          onClick={onAddon}
          className="group flex flex-col items-start gap-2 rounded-xl border border-line bg-bg/40 p-4 text-left transition hover:border-accent/50 hover:bg-accent/5"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-accent/25 bg-accent/10 text-accent">
            <Puzzle className="h-4 w-4" />
          </span>
          <span className="text-sm font-semibold text-fg">{t('Addon')}</span>
          <span className="text-[11px] leading-relaxed text-faint">
            {t('Catálogos, metadados e streams do Stremio.')}
          </span>
        </button>
      </div>
    </Modal>
  );
}
