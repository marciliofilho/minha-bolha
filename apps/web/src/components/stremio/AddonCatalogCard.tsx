/** Card de pôster usado nos resultados de catálogo/busca dos addons. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Compass, Star } from 'lucide-react';
import type { AddonCatalogItemDto } from '@hub/shared';
import { IconButton } from '@/components/ui';
import { CardHoverPreview } from '@/components/stremio/CardHoverPreview';
import { LibraryToggleButton, useLibraryEntry } from '@/components/stremio/LibraryToggleButton';
import { useI18n } from '@/lib/i18n';
import { streamTargetFromAddonItem } from '@/lib/stream-target';

export function AddonCatalogCard({ item }: { item: AddonCatalogItemDto }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const target = streamTargetFromAddonItem(item);
  const open = (): void => {
    navigate('/', { state: { streamTarget: target } });
  };
  const [posterIndex, setPosterIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const kitsuNumber = /^kitsu:(\d+)/i.exec(item.id)?.[1] ?? null;
  const candidates = [
    item.poster,
    item.id.startsWith('tt')
      ? `https://images.metahub.space/poster/medium/${item.id}/img`
      : null,
    kitsuNumber
      ? `https://media.kitsu.app/anime/poster_images/${kitsuNumber}/medium.jpg`
      : null
  ].filter((value): value is string => Boolean(value));
  const uniquePosters = [...new Set(candidates)];
  const src = uniquePosters[posterIndex] ?? null;
  const libraryType: 'movie' | 'series' = item.type === 'movie' ? 'movie' : 'series';
  const library = useLibraryEntry({
    type: libraryType,
    metaId: item.id,
    name: item.name,
    poster: item.poster
  });

  return (
    <CardHoverPreview
      type={libraryType}
      metaId={item.id}
      name={item.name}
      poster={item.poster}
      onPlay={open}
      playLabel={t('Assistir')}
      inLibrary={library.inLibrary}
      isFavorite={library.isFavorite}
      isWatchLater={library.isWatchLater}
      onAddToLibrary={library.available ? library.add : undefined}
      onRemoveFromLibrary={library.canRemove ? library.remove : undefined}
      onToggleFavorite={library.available ? library.toggleFavorite : undefined}
      onToggleWatchLater={library.available ? library.toggleWatchLater : undefined}
    >
      <button
        type="button"
        onClick={open}
        className="group block w-full min-w-0 text-left"
        title={`${t('Assistir')} ${item.name} ${t('no Feed')}`}
      >
        <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl border border-line bg-elevated">
        {src ? (
          <>
            {!loaded ? (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-accent/10 to-transparent text-accent/50">
                <Compass className="h-6 w-6 animate-pulse" />
              </div>
            ) : null}
            <img
              src={src}
              alt=""
              loading="eager"
              decoding="async"
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => setPosterIndex((index) => index + 1)}
              className={`h-full w-full object-cover transition duration-500 group-hover:scale-[1.03] ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent/15 to-transparent text-accent/60">
            <Compass className="h-6 w-6" />
          </div>
        )}
        {item.imdbRating ? (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5 text-[9px] font-semibold text-white backdrop-blur-sm">
            <Star className="h-2.5 w-2.5 fill-current text-warning" />
            {item.imdbRating}
          </span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-fg">{item.name}</p>
      <p className="mt-0.5 truncate text-[10px] text-faint">
        {[item.year, item.addonName].filter(Boolean).join(' · ')}
      </p>
      </button>
      <div className="absolute left-1.5 top-1.5 z-10 flex items-center gap-0.5 rounded-lg bg-black/55 p-0.5 backdrop-blur-sm">
        <LibraryToggleButton
          type={libraryType}
          metaId={item.id}
          name={item.name}
          poster={item.poster}
          className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
        />
        <IconButton
          label={library.isFavorite ? t('Remover dos favoritos') : t('Adicionar aos favoritos')}
          onClick={library.toggleFavorite}
          active={library.isFavorite}
          className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
        >
          <Star
            className={`h-3.5 w-3.5 ${library.isFavorite ? 'fill-current text-warning' : ''}`}
          />
        </IconButton>
        <IconButton
          label={library.isWatchLater ? t('Remover de ver depois') : t('Salvar para ver depois')}
          onClick={library.toggleWatchLater}
          active={library.isWatchLater}
          tone="accent"
          className="h-7 w-7 text-white/80 hover:bg-white/15 hover:text-white"
        >
          <Clock className="h-3.5 w-3.5" />
        </IconButton>
      </div>
    </CardHoverPreview>
  );
}
