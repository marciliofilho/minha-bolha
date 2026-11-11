/** 404. */
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="pt-10">
      <EmptyState
        icon={<Compass className="h-5 w-5" />}
        title={t('Página não encontrada')}
        description={t('O endereço que você abriu não existe neste app.')}
        action={
          <Link
            to="/"
            className="inline-flex h-9 items-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg transition hover:brightness-110"
          >
            {t('Voltar ao feed')}
          </Link>
        }
      />
    </div>
  );
}
