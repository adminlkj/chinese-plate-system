'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2,
  MapPin,
  User,
  Percent,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  UtensilsCrossed,
  Database,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';

// ─── Types ──────────────────────────────────────────────────────────
interface SetupWizardProps {
  onComplete: () => void;
}

interface StepConfig {
  id: number;
  titleAr: string;
  titleEn: string;
  icon: React.ElementType;
}

const STEPS: StepConfig[] = [
  { id: 1, titleAr: 'معلومات الشركة', titleEn: 'Company Info', icon: Building2 },
  { id: 2, titleAr: 'الفرع', titleEn: 'Branch', icon: MapPin },
  { id: 3, titleAr: 'حساب المدير', titleEn: 'Admin Account', icon: User },
  { id: 4, titleAr: 'إعداد الضريبة', titleEn: 'Tax Config', icon: Percent },
  { id: 5, titleAr: 'دليل الحسابات', titleEn: 'Chart of Accounts', icon: BookOpen },
  { id: 6, titleAr: 'اكتمال الإعداد', titleEn: 'Complete', icon: CheckCircle2 },
];

// ─── Animated Background ────────────────────────────────────────────
function SetupBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <motion.div
        className="absolute top-1/4 -start-20 w-72 h-72 rounded-full bg-emerald-900/20 blur-3xl"
        animate={{ scale: [1, 1.2, 1], x: [0, 20, 0] }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-1/4 -end-20 w-72 h-72 rounded-full bg-amber-800/15 blur-3xl"
        animate={{ scale: [1.2, 1, 1.2], x: [0, -20, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full bg-emerald-600/5 blur-3xl"
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      {/* Decorative grid */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.03)_1px,_transparent_1px)] bg-[length:24px_24px]" />
    </div>
  );
}

// ─── Step Indicator ──────────────────────────────────────────────────
function StepIndicator({ currentStep, locale }: { currentStep: number; locale: string }) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 mb-6 sm:mb-8">
      {STEPS.map((step, index) => {
        const isActive = step.id === currentStep;
        const isCompleted = step.id < currentStep;
        const Icon = step.icon;

        return (
          <div key={step.id} className="flex items-center">
            <div className="flex flex-col items-center">
              <motion.div
                className={`
                  w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all duration-300
                  ${isCompleted
                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                    : isActive
                      ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 scale-110'
                      : 'bg-muted text-muted-foreground'
                  }
                `}
                animate={isActive ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.5 }}
              >
                {isCompleted ? (
                  <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                ) : (
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                )}
              </motion.div>
              <span className={`text-[10px] sm:text-xs mt-1 hidden sm:block ${isActive ? 'text-amber-600 font-semibold' : isCompleted ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {locale === 'ar' ? step.titleAr : step.titleEn}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div className={`w-4 sm:w-8 h-0.5 mx-0.5 rounded ${step.id < currentStep ? 'bg-emerald-500' : 'bg-muted'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Form Input Helper ──────────────────────────────────────────────
function FormField({
  label,
  labelEn,
  value,
  onChange,
  placeholder,
  placeholderEn,
  type = 'text',
  required = false,
  error,
  dir,
  icon: Icon,
  min,
  max,
}: {
  label: string;
  labelEn?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  placeholderEn?: string;
  type?: string;
  required?: boolean;
  error?: string;
  dir?: string;
  icon?: React.ElementType;
  min?: string;
  max?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
        <span>{label}</span>
        {labelEn && <span className="text-muted-foreground text-xs">/ {labelEn}</span>}
        {required && <span className="text-red-500">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={dir === 'rtl' ? placeholder : (placeholderEn || placeholder)}
        className={`h-10 bg-background/50 ${error ? 'border-red-500 focus:border-red-500' : 'border-border/50 focus:border-amber-500'} transition-colors`}
        dir={dir}
        min={min}
        max={max}
      />
      {error && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
}

// ─── Main Setup Wizard Component ────────────────────────────────────
export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const { locale } = useAppStore();
  const { t } = useTranslation();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const isRTL = locale === 'ar';

  // Step state
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Step 1: Company Info
  const [companyName, setCompanyName] = useState('');
  const [companyNameEn, setCompanyNameEn] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  // Step 2: Branch
  const [branchName, setBranchName] = useState('');
  const [branchNameEn, setBranchNameEn] = useState('');
  const [branchCode, setBranchCode] = useState('MAIN');

  // Step 3: Admin Account
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminNameEn, setAdminNameEn] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step 4: Tax
  const [taxRate, setTaxRate] = useState('15');
  const [supervisorPassword, setSupervisorPassword] = useState('');

  // Step 5: Accounts (auto-seed, no user input)
  const [seedAccounts, setSeedAccounts] = useState(true);

  // Database recovery state
  const [isRecovering, setIsRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');

  // Validation errors
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

  // Clear errors for a field
  const clearError = useCallback((field: string) => {
    setStepErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  // Validate current step
  const validateStep = useCallback((step: number): boolean => {
    const errors: Record<string, string> = {};

    switch (step) {
      case 1:
        if (!companyName.trim()) errors.companyName = isRTL ? 'اسم الشركة مطلوب' : 'Company name is required';
        break;
      case 2:
        if (!branchName.trim()) errors.branchName = isRTL ? 'اسم الفرع مطلوب' : 'Branch name is required';
        if (!branchCode.trim()) errors.branchCode = isRTL ? 'رمز الفرع مطلوب' : 'Branch code is required';
        break;
      case 3:
        if (!adminEmail.trim()) errors.adminEmail = isRTL ? 'البريد الإلكتروني مطلوب' : 'Email is required';
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) errors.adminEmail = isRTL ? 'بريد إلكتروني غير صحيح' : 'Invalid email';
        if (!adminName.trim()) errors.adminName = isRTL ? 'اسم المدير مطلوب' : 'Admin name is required';
        if (!adminPassword) errors.adminPassword = isRTL ? 'كلمة المرور مطلوبة' : 'Password is required';
        else if (adminPassword.length < 6) errors.adminPassword = isRTL ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : 'Password must be at least 6 characters';
        if (adminPassword !== adminConfirmPassword) errors.adminConfirmPassword = isRTL ? 'كلمات المرور غير متطابقة' : 'Passwords do not match';
        break;
      case 4: {
        const rate = Number(taxRate);
        if (isNaN(rate) || rate < 0 || rate > 100) errors.taxRate = isRTL ? 'نسبة الضريبة غير صحيحة (0-100)' : 'Invalid tax rate (0-100)';
        break;
      }
    }

    setStepErrors(errors);
    return Object.keys(errors).length === 0;
  }, [companyName, branchName, branchCode, adminEmail, adminName, adminPassword, adminConfirmPassword, taxRate, isRTL]);

  // Navigation
  const goNext = useCallback(() => {
    if (validateStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, 6));
    }
  }, [currentStep, validateStep]);

  const goBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
    setStepErrors({});
  }, []);

  // Submit setup
  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          companyNameEn: companyNameEn.trim(),
          taxNumber: taxNumber.trim(),
          address: address.trim(),
          phone: phone.trim(),
          branchName: branchName.trim(),
          branchNameEn: branchNameEn.trim(),
          branchCode: branchCode.trim().toUpperCase().replace(/\s+/g, '_'),
          adminEmail: adminEmail.trim(),
          adminName: adminName.trim(),
          adminNameEn: adminNameEn.trim(),
          adminPassword,
          taxRate: Number(taxRate),
          supervisorPassword: supervisorPassword.trim() || undefined,
        }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (res.ok && data.success) {
        setCurrentStep(6); // Go to complete step
      } else {
        // Provide specific error messages based on status code
        if (res.status === 400) {
          setSubmitError(data.error || (isRTL ? 'النظام مهيأ بالفعل' : 'System is already set up'));
        } else if (res.status === 500) {
          const errMsg = data.error || '';
          if (errMsg.includes('malformed') || errMsg.includes('disk image')) {
            setSubmitError(isRTL
              ? 'قاعدة البيانات تالفة. يرجى استخدام أداة الإصلاح من الإعدادات أو إعادة إنشاء قاعدة البيانات.'
              : 'Database is corrupted. Please use the repair tool from Settings or recreate the database.');
          } else if (errMsg.includes('unique') || errMsg.includes('UNIQUE')) {
            setSubmitError(isRTL
              ? 'النظام مهيأ بالفعل. يوجد مستخدم مسجل بهذه البيانات.'
              : 'System is already set up. A user with this data already exists.');
          } else {
            setSubmitError(errMsg || (isRTL ? 'خطأ في الخادم. حاول مرة أخرى.' : 'Server error. Please try again.'));
          }
        } else {
          setSubmitError(data.error || (isRTL ? 'فشل في إعداد النظام' : 'Setup failed'));
        }
      }
    } catch (error: any) {
      // Network/connection error
      if (error.name === 'AbortError') {
        setSubmitError(isRTL ? 'تم إلغاء الطلب' : 'Request was aborted');
      } else if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
        setSubmitError(isRTL
          ? 'لا يمكن الاتصال بالخادم. تأكد أن الخادم يعمل وحاول مرة أخرى.'
          : 'Cannot connect to server. Make sure the server is running and try again.');
      } else {
        setSubmitError(isRTL
          ? `حدث خطأ: ${error.message || 'غير معروف'}`
          : `Error: ${error.message || 'Unknown'}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [companyName, companyNameEn, taxNumber, address, phone, branchName, branchNameEn, branchCode, adminEmail, adminName, adminNameEn, adminPassword, taxRate, supervisorPassword, isRTL]);

  // ─── Render Step Content ────────────────────────────────────────────
  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <motion.div
            key="step1"
            initial={{ opacity: 0, x: isRTL ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRTL ? 30 : -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Building2 className="w-7 h-7 text-amber-600" />
              </div>
              <h2 className="text-xl font-bold">{isRTL ? 'معلومات الشركة' : 'Company Information'}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isRTL ? 'أدخل البيانات الأساسية لشركتك' : 'Enter your company basic information'}
              </p>
            </div>

            <FormField
              label={isRTL ? 'اسم الشركة (عربي)' : 'Company Name (Arabic)'}
              labelEn={isRTL ? 'Company Name' : undefined}
              value={companyName}
              onChange={(v) => { setCompanyName(v); clearError('companyName'); }}
              placeholder={isRTL ? 'مثال: مطاعم الأصيل' : 'e.g. Al-Aseel Restaurants'}
              required
              error={stepErrors.companyName}
              dir="rtl"
              icon={Building2}
            />

            <FormField
              label={isRTL ? 'اسم الشركة (إنجليزي)' : 'Company Name (English)'}
              value={companyNameEn}
              onChange={setCompanyNameEn}
              placeholder="e.g. Al-Aseel Restaurants"
              placeholderEn="e.g. Al-Aseel Restaurants"
              dir="ltr"
            />

            <FormField
              label={isRTL ? 'الرقم الضريبي' : 'Tax Number'}
              labelEn={isRTL ? 'VAT Number' : undefined}
              value={taxNumber}
              onChange={setTaxNumber}
              placeholder={isRTL ? '3000XXXXXXXXXX0003' : '3000XXXXXXXXXX0003'}
              dir="ltr"
            />

            <FormField
              label={isRTL ? 'العنوان' : 'Address'}
              value={address}
              onChange={setAddress}
              placeholder={isRTL ? 'أدخل عنوان الشركة' : 'Enter company address'}
              dir="rtl"
            />

            <FormField
              label={isRTL ? 'الهاتف' : 'Phone'}
              value={phone}
              onChange={setPhone}
              placeholder={isRTL ? '05XXXXXXXX' : '05XXXXXXXX'}
              type="tel"
              dir="ltr"
            />
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            key="step2"
            initial={{ opacity: 0, x: isRTL ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRTL ? 30 : -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <MapPin className="w-7 h-7 text-emerald-600" />
              </div>
              <h2 className="text-xl font-bold">{isRTL ? 'إعداد الفرع' : 'Branch Setup'}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isRTL ? 'أنشئ أول فرع للمطعم' : 'Create your first restaurant branch'}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <UtensilsCrossed className="w-3.5 h-3.5 shrink-0" />
                {isRTL
                  ? 'يمكنك إضافة فروع أخرى لاحقاً من صفحة الإعدادات'
                  : 'You can add more branches later from the Settings page'}
              </p>
            </div>

            <FormField
              label={isRTL ? 'اسم الفرع (عربي)' : 'Branch Name (Arabic)'}
              labelEn={isRTL ? 'Branch Name' : undefined}
              value={branchName}
              onChange={(v) => { setBranchName(v); clearError('branchName'); }}
              placeholder={isRTL ? 'مثال: الفرع الرئيسي' : 'e.g. Main Branch'}
              required
              error={stepErrors.branchName}
              dir="rtl"
              icon={MapPin}
            />

            <FormField
              label={isRTL ? 'اسم الفرع (إنجليزي)' : 'Branch Name (English)'}
              value={branchNameEn}
              onChange={setBranchNameEn}
              placeholder="e.g. Main Branch"
              dir="ltr"
            />

            <FormField
              label={isRTL ? 'رمز الفرع' : 'Branch Code'}
              labelEn={isRTL ? 'Branch Key' : undefined}
              value={branchCode}
              onChange={(v) => { setBranchCode(v.toUpperCase().replace(/\s+/g, '_')); clearError('branchCode'); }}
              placeholder={isRTL ? 'مثال: MAIN' : 'e.g. MAIN'}
              required
              error={stepErrors.branchCode}
              dir="ltr"
            />

            <p className="text-xs text-muted-foreground">
              {isRTL
                ? 'الرمز يُستخدم داخلياً في النظام (أحرف إنجليزية كبيرة، بدون مسافات)'
                : 'Code is used internally (uppercase English letters, no spaces)'}
            </p>
          </motion.div>
        );

      case 3:
        return (
          <motion.div
            key="step3"
            initial={{ opacity: 0, x: isRTL ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRTL ? 30 : -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <User className="w-7 h-7 text-red-600" />
              </div>
              <h2 className="text-xl font-bold">{isRTL ? 'حساب المدير' : 'Admin Account'}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isRTL ? 'أنشئ حساب المدير الرئيسي للنظام' : 'Create the main administrator account'}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <p className="text-xs text-red-700 dark:text-red-300 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {isRTL
                  ? 'هذا الحساب يملك صلاحيات كاملة على النظام'
                  : 'This account has full system permissions'}
              </p>
            </div>

            <FormField
              label={isRTL ? 'البريد الإلكتروني' : 'Email'}
              value={adminEmail}
              onChange={(v) => { setAdminEmail(v); clearError('adminEmail'); }}
              placeholder="admin@company.com"
              type="email"
              required
              error={stepErrors.adminEmail}
              dir="ltr"
              icon={User}
            />

            <FormField
              label={isRTL ? 'الاسم (عربي)' : 'Name (Arabic)'}
              value={adminName}
              onChange={(v) => { setAdminName(v); clearError('adminName'); }}
              placeholder={isRTL ? 'مثال: أحمد محمد' : 'e.g. Ahmed Mohammed'}
              required
              error={stepErrors.adminName}
              dir="rtl"
            />

            <FormField
              label={isRTL ? 'الاسم (إنجليزي)' : 'Name (English)'}
              value={adminNameEn}
              onChange={setAdminNameEn}
              placeholder="e.g. Ahmed Mohammed"
              dir="ltr"
            />

            <div className="space-y-1.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                {isRTL ? 'كلمة المرور' : 'Password'}
                <span className="text-red-500">*</span>
              </Label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => { setAdminPassword(e.target.value); clearError('adminPassword'); }}
                  placeholder={isRTL ? '6 أحرف على الأقل' : 'At least 6 characters'}
                  className={`h-10 bg-background/50 pe-10 ${stepErrors.adminPassword ? 'border-red-500' : 'border-border/50 focus:border-amber-500'} transition-colors`}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute top-1/2 -translate-y-1/2 end-3 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {stepErrors.adminPassword && (
                <p className="text-xs text-red-500 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {stepErrors.adminPassword}
                </p>
              )}
              {/* Password strength indicator */}
              {adminPassword && (
                <div className="flex gap-1 mt-1">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded-full transition-colors ${
                        adminPassword.length >= level * 3
                          ? level <= 2 ? 'bg-red-500' : level === 3 ? 'bg-amber-500' : 'bg-emerald-500'
                          : 'bg-muted'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <FormField
              label={isRTL ? 'تأكيد كلمة المرور' : 'Confirm Password'}
              value={adminConfirmPassword}
              onChange={(v) => { setAdminConfirmPassword(v); clearError('adminConfirmPassword'); }}
              placeholder={isRTL ? 'أعد إدخال كلمة المرور' : 'Re-enter password'}
              type="password"
              required
              error={stepErrors.adminConfirmPassword}
              dir="ltr"
            />
          </motion.div>
        );

      case 4:
        return (
          <motion.div
            key="step4"
            initial={{ opacity: 0, x: isRTL ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRTL ? 30 : -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
                <Percent className="w-7 h-7 text-violet-600" />
              </div>
              <h2 className="text-xl font-bold">{isRTL ? 'إعداد الضريبة' : 'Tax Configuration'}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isRTL ? 'إعدادات ضريبة القيمة المضافة' : 'Value Added Tax settings'}
              </p>
            </div>

            <FormField
              label={isRTL ? 'نسبة ضريبة القيمة المضافة (%)' : 'VAT Rate (%)'}
              labelEn="VAT"
              value={taxRate}
              onChange={(v) => { setTaxRate(v); clearError('taxRate'); }}
              placeholder="15"
              type="number"
              required
              error={stepErrors.taxRate}
              dir="ltr"
              icon={Percent}
              min="0"
              max="100"
            />

            <div className="p-3 rounded-lg bg-muted/50 border border-border">
              <p className="text-xs text-muted-foreground">
                {isRTL
                  ? 'النسبة الافتراضية في المملكة العربية السعودية هي 15%. يمكن تغييرها لاحقاً من الإعدادات.'
                  : 'The default rate in Saudi Arabia is 15%. You can change it later from Settings.'}
              </p>
            </div>

            <FormField
              label={isRTL ? 'كلمة مرور المشرف (اختياري)' : 'Supervisor Password (Optional)'}
              value={supervisorPassword}
              onChange={setSupervisorPassword}
              placeholder={isRTL ? 'كلمة مرور للتأكيدات الحساسة' : 'Password for sensitive confirmations'}
              type="password"
              dir="ltr"
            />

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {isRTL
                  ? 'كلمة مرور المشرف تُستخدم لحماية العمليات الحساسة مثل حذف الفواتير وتعديل البيانات'
                  : 'Supervisor password protects sensitive operations like invoice deletion and data modification'}
              </p>
            </div>
          </motion.div>
        );

      case 5:
        return (
          <motion.div
            key="step5"
            initial={{ opacity: 0, x: isRTL ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: isRTL ? 30 : -30 }}
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            <div className="text-center mb-6">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
                <BookOpen className="w-7 h-7 text-sky-600" />
              </div>
              <h2 className="text-xl font-bold">{isRTL ? 'دليل الحسابات' : 'Chart of Accounts'}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {isRTL ? 'إنشاء دليل الحسابات المحاسبية الافتراضي' : 'Create the default accounting chart of accounts'}
              </p>
            </div>

            <div className={`p-4 rounded-lg border ${seedAccounts ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-muted border-border'}`}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => setSeedAccounts(!seedAccounts)}
                  className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    seedAccounts
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-muted-foreground/30 bg-background'
                  }`}
                >
                  {seedAccounts && <CheckCircle2 className="w-3 h-3" />}
                </button>
                <div>
                  <p className="font-medium text-sm">
                    {isRTL ? 'إنشاء دليل الحسابات الافتراضي' : 'Create default chart of accounts'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isRTL
                      ? 'يشمل: النقدية، البنوك، العملاء، الموردون، المبيعات، المشتريات، الضرائب، وغيرها'
                      : 'Includes: Cash, Banks, Customers, Suppliers, Sales, Purchases, Taxes, and more'}
                  </p>
                </div>
              </div>
            </div>

            {seedAccounts && (
              <div className="space-y-2 p-3 rounded-lg bg-muted/30 border border-border">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  {isRTL ? 'سيتم إنشاء الحسابات التالية:' : 'The following accounts will be created:'}
                </p>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {[
                    { range: '1xxx', label: isRTL ? 'الأصول' : 'Assets', labelEn: 'Cash, Banks, AR, Inventory' },
                    { range: '2xxx', label: isRTL ? 'الالتزامات' : 'Liabilities', labelEn: 'AP, Tax Payable' },
                    { range: '3xxx', label: isRTL ? 'حقوق الملكية' : 'Equity', labelEn: 'Capital, Retained Earnings' },
                    { range: '4xxx', label: isRTL ? 'الإيرادات' : 'Revenue', labelEn: 'Sales by Branch' },
                    { range: '5xxx+', label: isRTL ? 'المصروفات' : 'Expenses', labelEn: 'Purchases, Rent, Salaries' },
                  ].map((group) => (
                    <div key={group.range} className="flex items-center gap-1.5 p-1.5 rounded bg-background/50">
                      <span className="font-mono text-emerald-600 font-bold">{group.range}</span>
                      <span>{group.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {isRTL
                  ? 'يمكنك تعديل أو إضافة حسابات لاحقاً من صفحة دليل الحسابات'
                  : 'You can modify or add accounts later from the Chart of Accounts page'}
              </p>
            </div>

            {/* Summary before submit */}
            <div className="mt-4 p-4 rounded-lg bg-gradient-to-br from-amber-50 to-emerald-50 dark:from-amber-900/20 dark:to-emerald-900/20 border border-amber-200 dark:border-amber-800">
              <h3 className="font-bold text-sm mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {isRTL ? 'ملخص الإعداد' : 'Setup Summary'}
              </h3>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'الشركة' : 'Company'}:</span>
                  <span className="font-medium">{companyName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'الفرع' : 'Branch'}:</span>
                  <span className="font-medium">{branchName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'المدير' : 'Admin'}:</span>
                  <span className="font-medium">{adminName} ({adminEmail})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'الضريبة' : 'Tax'}:</span>
                  <span className="font-medium">{taxRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'دليل الحسابات' : 'Chart of Accounts'}:</span>
                  <span className="font-medium">{seedAccounts ? (isRTL ? 'سيتم إنشاؤه' : 'Will be created') : (isRTL ? 'تخطي' : 'Skip')}</span>
                </div>
              </div>
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p>{submitError}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isSubmitting}
                      className="text-xs underline underline-offset-2 hover:no-underline text-destructive/80 hover:text-destructive transition-colors disabled:opacity-50"
                    >
                      {isSubmitting
                        ? (isRTL ? 'جاري المحاولة...' : 'Retrying...')
                        : (isRTL ? 'إعادة المحاولة' : 'Try again')}
                    </button>
                    {(submitError.includes('تالفة') || submitError.includes('corrupted') || submitError.includes('malformed')) && (
                      <button
                        type="button"
                        onClick={async () => {
                          setIsRecovering(true);
                          setRecoveryMessage('');
                          try {
                            const res = await fetch('/api/system-recover/database', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'rebuild' }),
                            });
                            const data = await res.json();
                            if (data.status === 'ok') {
                              setRecoveryMessage(isRTL ? 'تم إعادة بناء قاعدة البيانات بنجاح! يمكنك الآن إعادة المحاولة.' : 'Database rebuilt successfully! You can now retry.');
                              setSubmitError('');
                            } else {
                              setRecoveryMessage(isRTL ? 'فشل الإصلاح: ' + (data.error || '') : 'Repair failed: ' + (data.error || ''));
                            }
                          } catch (err: any) {
                            setRecoveryMessage(isRTL ? 'فشل الاتصال بخادم الإصلاح' : 'Failed to connect to recovery server');
                          } finally {
                            setIsRecovering(false);
                          }
                        }}
                        disabled={isRecovering}
                        className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-destructive/20 hover:bg-destructive/30 text-destructive transition-colors disabled:opacity-50"
                      >
                        {isRecovering ? (
                          <RefreshCw className="w-3 h-3 animate-spin" />
                        ) : (
                          <Database className="w-3 h-3" />
                        )}
                        {isRecovering
                          ? (isRTL ? 'جاري الإصلاح...' : 'Repairing...')
                          : (isRTL ? 'إصلاح قاعدة البيانات' : 'Repair Database')}
                      </button>
                    )}
                  </div>
                  {recoveryMessage && (
                    <p className={`mt-2 text-xs ${recoveryMessage.includes('نجاح') || recoveryMessage.includes('success') ? 'text-emerald-600' : 'text-destructive'}`}>
                      {recoveryMessage}
                    </p>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        );

      case 6:
        return (
          <motion.div
            key="step6"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="text-center space-y-6 py-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
            >
              <div className="w-20 h-20 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              </div>
            </motion.div>

            <div>
              <h2 className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                {isRTL ? 'تم الإعداد بنجاح!' : 'Setup Complete!'}
              </h2>
              <p className="text-muted-foreground mt-2">
                {isRTL
                  ? 'تم إعداد النظام بنجاح. يمكنك الآن تسجيل الدخول والبدء في استخدام النظام.'
                  : 'System setup completed successfully. You can now sign in and start using the system.'}
              </p>
            </div>

            <div className="p-4 rounded-lg bg-muted/30 border border-border text-start max-w-sm mx-auto">
              <h3 className="font-bold text-sm mb-2">{isRTL ? 'بيانات الدخول' : 'Login Credentials'}</h3>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'البريد' : 'Email'}:</span>
                  <span className="font-mono text-xs">{adminEmail}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'الاسم' : 'Name'}:</span>
                  <span>{adminName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{isRTL ? 'الدور' : 'Role'}:</span>
                  <span className="text-amber-600 font-medium">{isRTL ? 'مدير النظام' : 'System Admin'}</span>
                </div>
              </div>
            </div>

            <Button
              onClick={onComplete}
              className="w-full max-w-sm h-12 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-600 hover:to-emerald-500 text-white font-semibold shadow-lg shadow-emerald-900/30 transition-all duration-300 hover:shadow-emerald-800/40 hover:scale-[1.02] active:scale-[0.98]"
            >
              {isRTL ? 'الذهاب لتسجيل الدخول' : 'Go to Login'}
            </Button>
          </motion.div>
        );

      default:
        return null;
    }
  };

  return (
    <div dir={dir} className="fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <SetupBackground />

      <div className="relative z-10 w-full max-w-lg mx-4">
        <Card className="overflow-hidden border-border/50 shadow-2xl bg-card/90 backdrop-blur-xl">
          {/* Header */}
          <CardHeader className="pb-2 pt-6 px-6">
            <div className="text-center">
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                className="w-14 h-14 mx-auto mb-3 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/30"
              >
                <UtensilsCrossed className="w-7 h-7 text-white" />
              </motion.div>
              <h1 className="text-xl font-bold">
                {isRTL ? 'إعداد النظام' : 'System Setup'}
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isRTL ? 'مرحباً بك! دعنا نهيئ النظام لك' : 'Welcome! Let\'s set up your system'}
              </p>
            </div>
          </CardHeader>

          {/* Step Indicator */}
          <div className="px-6">
            <StepIndicator currentStep={currentStep} locale={locale} />
          </div>

          {/* Content */}
          <CardContent className="px-6 pb-4 min-h-[340px]">
            <AnimatePresence mode="wait">
              {renderStep()}
            </AnimatePresence>
          </CardContent>

          {/* Footer Navigation */}
          {currentStep < 6 && (
            <div className="px-6 pb-6 pt-2 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                onClick={goBack}
                disabled={currentStep === 1}
                className="gap-1.5"
              >
                {isRTL ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                {isRTL ? 'السابق' : 'Previous'}
              </Button>

              <span className="text-xs text-muted-foreground">
                {currentStep} / 5
              </span>

              {currentStep < 5 ? (
                <Button
                  onClick={goNext}
                  className="gap-1.5 bg-gradient-to-r from-amber-700 to-amber-600 hover:from-amber-600 hover:to-amber-500 text-white shadow-md shadow-amber-900/20"
                >
                  {isRTL ? 'التالي' : 'Next'}
                  {isRTL ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="gap-1.5 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-600 hover:to-emerald-500 text-white shadow-md shadow-emerald-900/20"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {isRTL ? 'جاري الإعداد...' : 'Setting up...'}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      {isRTL ? 'إعداد النظام' : 'Setup System'}
                    </>
                  )}
                </Button>
              )}
            </div>
          )}

          {currentStep === 6 && <div className="pb-6" />}
        </Card>

        {/* Copyright */}
        <div className="text-center mt-4">
          <p className="text-xs text-muted-foreground/40">
            {isRTL ? 'نظام المحاسبة والإدارة' : 'Accounting & Management System'} © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
