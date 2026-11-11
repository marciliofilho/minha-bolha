/** Modal para adicionar um jogo manualmente (busca na Steam por nome/appid/link). */
import { useEffect, useState } from 'react';
import { Check, Loader2, Plus, Search } from 'lucide-react';
import type { GameSearchResultDto } from '@hub/shared';
import { Button, ErrorBanner, Field, Modal } from '@/components/ui';
import { useAddGame, useGameSearch } from '@/lib/queries';
import { useI18n } from '@/lib/i18n';
import { cn, parseMoneyInput } from '@/lib/utils';

export function AddGameModal({
  open,
  onClose,
  onAdded
}: {
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useI18n();
  const search = useGameSearch();
  const add = useAddGame();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GameSearchResultDto | null>(null);
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(null);
    setTarget('');
    setError(null);
    search.reset();
    add.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const results = search.data?.results ?? [];

  const runSearch = async (): Promise<void> => {
    if (!query.trim()) return;
    setError(null);
    setSelected(null);
    try {
      await search.mutateAsync(query.trim());
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : t('Não foi possível buscar.'));
    }
  };

  const submit = async (): Promise<void> => {
    if (!selected) return;
    setError(null);
    const cents = target.trim() ? parseMoneyInput(target) : null;
    if (target.trim() && cents === null) {
      setError(t('Preço-alvo inválido. Use algo como 79,90.'));
      return;
    }
    try {
      await add.mutateAsync({ appid: selected.appid, targetPriceCents: cents });
      onAdded();
      onClose();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : t('Não foi possível adicionar o jogo.'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('Adicionar jogo')}
      description={t('Busque pelo nome, cole o appid ou o link da página da Steam.')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!selected}
            loading={add.isPending}
            icon={<Plus className="h-4 w-4" />}
          >
            {t('Adicionar')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label={t('Buscar na Steam')}
          htmlFor="game-search"
          hint={t('Ex.: Hades, 1091500 ou https://store.steampowered.com/app/1091500/')}
        >
          <div className="flex gap-2">
            <input
              id="game-search"
              className="field-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void runSearch();
                }
              }}
              placeholder={t('Nome do jogo, appid ou link')}
              autoFocus
            />
            <Button
              variant="subtle"
              onClick={() => void runSearch()}
              loading={search.isPending}
              disabled={!query.trim()}
              icon={<Search className="h-4 w-4" />}
              className="shrink-0"
            >
              {t('Buscar')}
            </Button>
          </div>
        </Field>

        <ErrorBanner message={error} />

        {search.isPending ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('Buscando na Steam…')}
          </div>
        ) : null}

        {results.length > 0 ? (
          <ul className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line bg-bg/40 p-1.5">
            {results.map((result) => {
              const active = selected?.appid === result.appid;
              return (
                <li key={result.appid}>
                  <button
                    type="button"
                    onClick={() => setSelected(result)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left transition',
                      active ? 'bg-accent/10 ring-1 ring-accent/30' : 'hover:bg-elevated'
                    )}
                  >
                    <span className="h-10 w-16 shrink-0 overflow-hidden rounded bg-elevated">
                      {result.imageUrl ? (
                        <img
                          src={result.imageUrl}
                          alt=""
                          loading="eager"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-fg">{result.name}</span>
                      <span className="block text-[10px] text-faint">
                        App {result.appid}
                        {result.priceLabel ? ` · ${result.priceLabel}` : ''}
                      </span>
                    </span>
                    {active ? <Check className="h-3.5 w-3.5 shrink-0 text-accent" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {search.isSuccess && results.length === 0 ? (
          <p className="py-6 text-center text-xs text-faint">{t('Nenhum jogo encontrado. Tente outro nome ou o link da loja.')}</p>
        ) : null}

        {selected ? (
          <div className="space-y-3 rounded-xl border border-line/70 bg-bg/40 p-3">
            <p className="text-xs font-medium text-fg">{selected.name}</p>
            <Field label={t('Preço-alvo (opcional)')} htmlFor="add-target" hint={t('Avisamos no feed quando o preço oficial ficar abaixo.')}>
              <input
                id="add-target"
                className="field-input w-48"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                placeholder={t('Ex.: 79,90')}
                inputMode="decimal"
              />
            </Field>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
