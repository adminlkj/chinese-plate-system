'use client';

import { useAppStore } from '@/lib/store';
import { formatNumber } from '@/lib/types';

/**
 * CurrencySymbol - Renders the currency symbol as an image (if uploaded) or fallback text
 * Usage: <CurrencySymbol className="w-4 h-4" />
 */
export function CurrencySymbol({ className = 'w-4 h-4 inline-block align-middle' }: { className?: string }) {
  const currencySymbolUrl = useAppStore((s) => s.currencySymbolUrl);

  if (currencySymbolUrl) {
    return (
      <img
        src={currencySymbolUrl}
        alt="ر.س"
        className={className}
        style={{ objectFit: 'contain' }}
      />
    );
  }

  // Fallback: show text symbol
  return (
    <span className="inline-block align-middle text-xs font-medium" style={{ fontFamily: 'inherit' }}>
      ر.س
    </span>
  );
}

/**
 * CurrencyAmount - Formats a number with the currency symbol (image or text)
 * This is the recommended way to display currency amounts in the UI.
 * Usage: <CurrencyAmount amount={150.00} />
 */
export function CurrencyAmount({ 
  amount, 
  className = '',
  symbolClassName = 'w-4 h-4',
  bold = false,
}: { 
  amount: number | null | undefined; 
  className?: string;
  symbolClassName?: string;
  bold?: boolean;
}) {
  const currencySymbolUrl = useAppStore((s) => s.currencySymbolUrl);
  const safeAmount = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;

  return (
    <span className={`inline-flex items-center gap-1 ${bold ? 'font-bold' : ''} ${className}`} dir="ltr">
      {formatNumber(safeAmount)}
      {currencySymbolUrl ? (
        <img
          src={currencySymbolUrl}
          alt="ر.س"
          className={symbolClassName}
          style={{ objectFit: 'contain', verticalAlign: 'middle' }}
        />
      ) : (
        <span className="inline-block align-middle text-xs font-medium">ر.س</span>
      )}
    </span>
  );
}

/**
 * ReceiptCurrencyAmount - For receipt templates that need inline HTML
 * Returns the HTML string with currency symbol image embedded
 */
export function formatReceiptCurrency(amount: number, currencySymbolUrl?: string): string {
  const formatted = formatNumber(amount);
  if (currencySymbolUrl) {
    return `${formatted} <img src="${currencySymbolUrl}" alt="ر.س" style="width:10px;height:10px;object-fit:contain;vertical-align:middle;display:inline;" />`;
  }
  return `${formatted} ر.س`;
}
