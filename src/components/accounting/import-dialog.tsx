'use client';

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

import {
  getImportSpec,
  type ImportTypeSpec,
  type ImportColumnSpec,
} from '@/lib/import-specs';
import { useTranslation } from '@/lib/i18n';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transactionType: string; // e.g., 'SALE_CASH'
  transactionLabel: string; // e.g., 'بيع نقدي'
}

interface ImportResult {
  row: number;
  success: boolean;
  entryNumber?: string;
  error?: string;
}

export default function ImportDialog({
  open,
  onOpenChange,
  transactionType,
  transactionLabel,
}: ImportDialogProps) {
  const spec = getImportSpec(transactionType);
  const { t, isRTL } = useTranslation();

  const [parsedData, setParsedData] = useState<{ _rowIdx: number; [key: string]: string | number }[]>([]);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'results'>('upload');
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{
    total: number;
    successCount: number;
    failCount: number;
    results: ImportResult[];
  } | null>(null);
  const [specsOpen, setSpecsOpen] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setParsedData([]);
    setStep('upload');
    setImporting(false);
    setResults(null);
    setSpecsOpen(true);
  }, []);

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) reset();
    onOpenChange(newOpen);
  };

  // ─── Template Download ────────────────────────────────

  async function handleDownloadTemplate() {
    if (!spec) return;

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    // Create header row
    const headerRow = spec.columns.map((c) => c.labelAr);
    // Create sample data row
    const sampleRow = spec.columns.map((c) => getSampleValue(c));
    // Create description row
    const descRow = spec.columns.map((c) => {
      let desc = c.description;
      if (c.required) desc = t.requiredStar + desc;
      else desc = t.optionalPrefix + desc;
      return desc;
    });

    const ws = XLSX.utils.aoa_to_sheet([headerRow, sampleRow, descRow]);

    // Set column widths
    ws['!cols'] = spec.columns.map((c) => ({ wch: c.width || 18 }));

    XLSX.utils.book_append_sheet(wb, ws, t.dataSheet);
    XLSX.writeFile(wb, `${t.importTemplatePrefix}${spec.typeLabelAr}.xlsx`);
  }

  function getSampleValue(col: ImportColumnSpec): string {
    switch (col.key) {
      case 'date': return '2025-01-15';
      case 'amount': return '1000.00';
      case 'branch': return 'NONE';
      case 'applyTax': return t.no;
      case 'discount': return '0';
      case 'description': return '';
      case 'customerName': return t.customerName;
      case 'supplierName': return t.supplierName;
      case 'invoiceNumber': return 'INV-001';
      case 'accountCode': return '5001';
      case 'bankAccountCode': return '1010';
      case 'payableAccountCode': return '2000';
      case 'fromAccountCode': return '1000';
      case 'toAccountCode': return '1010';
      case 'paymentMethod': return col.acceptedValues?.[0] || 'CASH';
      case 'withdrawalMethod': return 'CASH';
      default: return '';
    }
  }

  // ─── File Upload & Parse ──────────────────────────────

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !spec) return;

    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const wsName = wb.SheetNames[0];
      const ws = wb.Sheets[wsName];

      // Convert to JSON with header mapping
      const rawData: Record<string, string>[] = XLSX.utils.sheet_to_json(ws, {
        defval: '',
        raw: false,
      });

      if (rawData.length === 0) {
        toast.error(t.fileEmptyOrNoData);
        return;
      }

      // Map Arabic column headers to internal keys
      const mappedData = rawData.map((row, i) => {
        const mapped: { _rowIdx: number; [key: string]: string | number } = { _rowIdx: i };
        for (const col of spec.columns) {
          // Try Arabic label first, then English, then internal key
          const value = row[col.labelAr] ?? row[col.labelEn] ?? row[col.key] ?? '';
          mapped[col.key] = String(value).trim();
        }
        return mapped;
      });

      setParsedData(mappedData);
      setStep('preview');
    } catch (err: any) {
      toast.error(t.failedToReadFile + ': ' + (err.message || t.unknownError));
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ─── Validate Preview Data ────────────────────────────

  function validateRow(row: { [key: string]: string | number }): string[] {
    if (!spec) return [];
    const errors: string[] = [];

    for (const col of spec.columns) {
      const val = row[col.key];
      if (col.required && !String(val || '').trim()) {
        errors.push(`"${col.labelAr}" ${t.isRequired}`);
      }
    }

    // Validate amount
    const amount = parseFloat(String(row['amount'] || '0'));
    if (row['amount'] && (isNaN(amount) || amount <= 0)) {
      errors.push(t.amountMustBePositive);
    }

    // Validate date
    if (row['date']) {
      const dateStr = String(row['date']);
      const dateMatch = dateStr.match(/^\d{4}-\d{1,2}-\d{1,2}$/);
      if (!dateMatch) {
        errors.push(t.invalidDateFormat);
      }
    }

    return errors;
  }

  // ─── Import ────────────────────────────────────────────

  async function handleImport() {
    if (parsedData.length === 0) return;

    setStep('importing');
    setImporting(true);

    try {
      const res = await fetch('/api/journal-entries/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: transactionType,
          rows: parsedData,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || t.failedToImport);
      }

      const data = await res.json();
      setResults(data);
      setStep('results');

      if (data.failCount === 0) {
        toast.success(`${t.imported} ${data.successCount} ${t.transactionsUnit} ${t.successfully}`);
      } else if (data.successCount > 0) {
        toast.warning(`${t.imported} ${data.successCount} ${t.transactionsUnit} ${t.successfully} ${t.andFailed} ${data.failCount} ${t.transactionsUnit}`);
      } else {
        toast.error(t.importAllFailed);
      }
    } catch (err: any) {
      toast.error(err.message || t.failedToImport);
      setStep('preview');
    } finally {
      setImporting(false);
    }
  }

  // ─── Remove a row from preview ────────────────────────

  function removeRow(index: number) {
    setParsedData((prev) => prev.filter((_, i) => i !== index));
  }

  // ─── Render ────────────────────────────────────────────

  if (!spec) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Upload className="size-5" />
            {t.importTransactions} - {transactionLabel}
          </DialogTitle>
          <DialogDescription>
            {t.importFromExcelDesc}
          </DialogDescription>
        </DialogHeader>

        {/* Column Specifications - Always visible */}
        <Collapsible open={specsOpen} onOpenChange={setSpecsOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between mb-2" size="sm">
              <span className="flex items-center gap-2 font-medium">
                <Info className="size-4 text-blue-500" />
                {t.requiredColumnsAndOrder}
              </span>
              {specsOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border rounded-lg p-3 mb-4 bg-muted/30">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center">#</TableHead>
                    <TableHead>{t.columnName}</TableHead>
                    <TableHead>{t.mandatory}</TableHead>
                    <TableHead>{t.descriptionAndAcceptedValues}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spec.columns.map((col, idx) => (
                    <TableRow key={col.key}>
                      <TableCell className="text-center font-mono text-xs">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{col.labelAr}</TableCell>
                      <TableCell>
                        {col.required ? (
                          <Badge variant="destructive" className="text-xs">{t.mandatory}</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">{t.optional}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-xs">
                        {col.description}
                        {col.acceptedValues && col.acceptedValues.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {col.acceptedValues.map((v) => (
                              <span
                                key={v}
                                className="inline-block px-1.5 py-0.5 bg-muted rounded text-xs font-mono"
                              >
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Separator />

        {/* Step: Upload */}
        {step === 'upload' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-8">
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleDownloadTemplate} className="gap-2">
                <Download className="size-4" />
                {t.downloadTemplate}
              </Button>
              <Button onClick={() => fileInputRef.current?.click()} className="gap-2">
                <Upload className="size-4" />
                {t.selectExcelFile}
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <p className="text-sm text-muted-foreground text-center max-w-md">
              {t.uploadInstructions}
            </p>
          </div>
        )}

        {/* Step: Preview */}
        {step === 'preview' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="size-4 text-emerald-600" />
                <span className="text-sm font-medium">
                  {parsedData.length} {t.transactionsUnit} {t.readyForImport}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setStep('upload')} className="gap-1">
                  <Upload className="size-3.5" />
                  {t.anotherFile}
                </Button>
                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={parsedData.length === 0}
                  className="gap-1"
                >
                  <CheckCircle2 className="size-3.5" />
                  {t.importAll} ({parsedData.length})
                </Button>
              </div>
            </div>

            <ScrollArea className="flex-1 border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8 text-center">#</TableHead>
                    {spec.columns.map((col) => (
                      <TableHead key={col.key} className="whitespace-nowrap">
                        {col.labelAr}
                        {!col.required && (
                          <span className="text-muted-foreground font-normal text-xs"> {t.optionalParens}</span>
                        )}
                      </TableHead>
                    ))}
                    <TableHead className="w-24 text-center">{t.status}</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedData.map((row, idx) => {
                    const errors = validateRow(row);
                    return (
                      <TableRow key={row._rowIdx} className={errors.length > 0 ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                        <TableCell className="text-center font-mono text-xs">{idx + 1}</TableCell>
                        {spec.columns.map((col) => (
                          <TableCell key={col.key} className="text-sm whitespace-nowrap">
                            {String(row[col.key] || '') || <span className="text-muted-foreground">-</span>}
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          {errors.length > 0 ? (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <AlertCircle className="size-3" />
                              {errors.length} {t.errorCount}
                            </Badge>
                          ) : (
                            <Badge variant="default" className="text-xs gap-1 bg-emerald-600">
                              <CheckCircle2 className="size-3" />
                              {t.valid}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => removeRow(idx)}
                          >
                            <XCircle className="size-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </ScrollArea>

            {parsedData.some((row) => validateRow(row).length > 0) && (
              <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium">
                  <AlertCircle className="size-4" />
                  {t.warningRowsWithErrors}
                </div>
                <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
                  {t.rowsWithErrorsSkipped}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step: Importing */}
        {step === 'importing' && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-12">
            <Loader2 className="size-10 animate-spin text-emerald-600" />
            <p className="text-sm font-medium">{t.importingTransactions}</p>
            <Progress className="w-64" />
            <p className="text-xs text-muted-foreground">{t.pleaseWaitDoNotClose}</p>
          </div>
        )}

        {/* Step: Results */}
        {step === 'results' && results && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Summary Cards */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="border rounded-lg p-3 text-center">
                <div className="text-2xl font-bold">{results.total}</div>
                <div className="text-xs text-muted-foreground">{t.totalTransactions}</div>
              </div>
              <div className="border rounded-lg p-3 text-center bg-emerald-50 dark:bg-emerald-950/20">
                <div className="text-2xl font-bold text-emerald-600">{results.successCount}</div>
                <div className="text-xs text-emerald-600">{t.successfully}</div>
              </div>
              <div className="border rounded-lg p-3 text-center bg-red-50 dark:bg-red-950/20">
                <div className="text-2xl font-bold text-red-600">{results.failCount}</div>
                <div className="text-xs text-red-600">{t.failed}</div>
              </div>
            </div>

            {/* Detailed Results */}
            {results.failCount > 0 && (
              <ScrollArea className="flex-1 border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16 text-center">{t.row}</TableHead>
                      <TableHead className="w-24 text-center">{t.status}</TableHead>
                      <TableHead>{t.details}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.results.map((r) => (
                      <TableRow key={r.row} className={r.success ? '' : 'bg-red-50 dark:bg-red-950/20'}>
                        <TableCell className="text-center font-mono text-xs">{r.row}</TableCell>
                        <TableCell className="text-center">
                          {r.success ? (
                            <Badge className="bg-emerald-600 text-xs gap-1">
                              <CheckCircle2 className="size-3" />
                              {r.entryNumber}
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="text-xs gap-1">
                              <XCircle className="size-3" />
                              {t.failed}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.success ? `${t.entryCreated} ${r.entryNumber}` : r.error}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                {t.close}
              </Button>
              {results.successCount > 0 && (
                <Button onClick={() => handleOpenChange(false)} className="gap-1">
                  <CheckCircle2 className="size-4" />
                  {t.done}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
