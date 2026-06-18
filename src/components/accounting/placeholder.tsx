'use client';

import { Construction } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface PlaceholderProps {
  title: string;
}

export function Placeholder({ title }: PlaceholderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-muted-foreground">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
        <Construction className="size-10 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{t.sectionUnderDevelopment}</p>
    </div>
  );
}
