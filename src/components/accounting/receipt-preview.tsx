'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReceiptPreviewProps {
  /** The server-generated complete receipt HTML (includes <html>, <head>, <style>, <body>) */
  serverReceiptHtml: string;
  /** Whether the invoice is finalized */
  finalized: boolean;
  /** Whether finalization is in progress */
  finalizing?: boolean;
  /** Print receipt width in mm */
  receiptWidth?: number;
  /** Callback when print is triggered */
  onPrint?: () => void;
}

/**
 * Unified Receipt Preview Component
 * 
 * Uses react-to-print to ensure the SAME visual component is printed.
 * No separate HTML page or API endpoint for printing — the preview IS the print source.
 * 
 * This solves the architectural problem of having two different receipt formats:
 * - Before: UI Component (preview) ≠ API-generated HTML (print)
 * - After: Single <ReceiptPreview /> component used for BOTH
 */
export default function ReceiptPreview({
  serverReceiptHtml,
  finalized,
  finalizing = false,
  receiptWidth = 80,
  onPrint,
}: ReceiptPreviewProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Wait for Google Fonts to load before allowing print
  useEffect(() => {
    if (!serverReceiptHtml) return;
    
    // Check if fonts are already loaded
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        setFontsLoaded(true);
      });
    } else {
      // Fallback: just wait a bit
      const timer = setTimeout(() => setFontsLoaded(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [serverReceiptHtml]);

  const handlePrint = useCallback(async () => {
    if (!receiptRef.current) return;
    // Wait for fonts to be ready
    if (document.fonts) {
      await document.fonts.ready;
    }
    // Small delay for images/rendering
    await new Promise(r => setTimeout(r, 300));
    window.print();
    onPrint?.();
  }, [onPrint]);

  // Extract the <style> and <body> content from the complete HTML document
  const extractReceiptBody = (html: string): string => {
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const styleContent = styleMatch ? styleMatch[1] : '';
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    return `<style>${styleContent}</style>${bodyContent}`;
  };

  if (!serverReceiptHtml) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Receipt Container — this is what gets printed */}
      <div
        ref={receiptRef}
        className="bg-white shadow-lg receipt-print-container"
        style={{
          width: `${receiptWidth}mm`,
          maxWidth: '100%',
          minHeight: 'auto',
        }}
        dangerouslySetInnerHTML={{ __html: extractReceiptBody(serverReceiptHtml) }}
      />
    </div>
  );
}

/**
 * Receipt Preview with Action Buttons
 * For use inside dialogs — includes Print, Complete, Close buttons
 */
export function ReceiptPreviewWithActions({
  serverReceiptHtml,
  finalized,
  finalizing = false,
  receiptWidth = 80,
  onPrint,
  onComplete,
  onClose,
  printLabel = 'طباعة / Print',
  completeLabel = 'إتمام / Complete',
  closeLabel = 'إغلاق / Close',
}: ReceiptPreviewProps & {
  onComplete?: () => void;
  onClose?: () => void;
  printLabel?: string;
  completeLabel?: string;
  closeLabel?: string;
}) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  useEffect(() => {
    if (!serverReceiptHtml) return;
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => setFontsLoaded(true));
    } else {
      const timer = setTimeout(() => setFontsLoaded(true), 1500);
      return () => clearTimeout(timer);
    }
  }, [serverReceiptHtml]);

  const handlePrintAction = useCallback(async () => {
    if (!receiptRef.current) return;
    if (document.fonts) await document.fonts.ready;
    await new Promise(r => setTimeout(r, 300));
    window.print();
    onPrint?.();
  }, [onPrint]);

  const extractReceiptBody = (html: string): string => {
    const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    const styleContent = styleMatch ? styleMatch[1] : '';
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : html;
    return `<style>${styleContent}</style>${bodyContent}`;
  };

  return (
    <>
      {/* Receipt Content — scrollable area */}
      <div className="flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-900 p-4">
        {serverReceiptHtml ? (
          <div className="flex justify-center">
            <div
              ref={receiptRef}
              className="bg-white dark:bg-white shadow-lg"
              style={{ width: `${receiptWidth}mm`, maxWidth: '100%' }}
              dangerouslySetInnerHTML={{ __html: extractReceiptBody(serverReceiptHtml) }}
            />
          </div>
        ) : (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 p-4 border-t bg-white dark:bg-gray-950 shrink-0">
        {!finalized && onComplete && (
          <Button className="flex-1 gap-2 h-12 text-base" onClick={onComplete} disabled={finalizing}>
            {finalizing ? <Loader2 className="size-5 animate-spin" /> : null}
            {finalizing ? '...' : completeLabel}
          </Button>
        )}
        <Button
          variant="outline"
          className="flex-1 gap-2 h-12 text-base border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
          onClick={handlePrintAction}
          disabled={finalizing || !serverReceiptHtml}
        >
          {finalizing ? <Loader2 className="size-5 animate-spin" /> : <Printer className="size-5" />}
          {printLabel}
        </Button>
        <Button variant="outline" className="flex-1 gap-2 h-12 text-base" onClick={onClose} disabled={finalizing}>
          {closeLabel}
        </Button>
      </div>
    </>
  );
}
