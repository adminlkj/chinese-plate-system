'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  Shield,
  Plus,
  Pencil,
  Trash2,
  Lock,
  Check,
  UserPlus,
  Search,
  AlertCircle,
  Mail,
  User as UserIcon,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore, type AccessLevel } from '@/lib/store';
import { useTranslation } from '@/lib/i18n';
import { toast } from 'sonner';

// ─── Screen Definitions ──────────────────────────────────────────
interface ScreenDef {
  id: string;
  nameAr: string;
  nameEn: string;
  group: string;
}

const SCREENS: ScreenDef[] = [
  { id: 'dashboard', nameAr: 'لوحة التحكم', nameEn: 'Dashboard', group: 'عام' },
  { id: 'chart-of-accounts', nameAr: 'دليل الحسابات', nameEn: 'Chart of Accounts', group: 'الحسابات' },
  { id: 'customers', nameAr: 'العملاء', nameEn: 'Customers', group: 'الحسابات' },
  { id: 'suppliers', nameAr: 'الموردين', nameEn: 'Suppliers', group: 'الحسابات' },
  { id: 'transactions', nameAr: 'القيود', nameEn: 'Transactions', group: 'العمليات' },
  { id: 'pos', nameAr: 'نقطة البيع', nameEn: 'POS', group: 'العمليات' },
  { id: 'products-inventory', nameAr: 'المنتجات والمخزون', nameEn: 'Products & Inventory', group: 'العمليات' },
  { id: 'sales-invoices', nameAr: 'فواتير المبيعات', nameEn: 'Sales Invoices', group: 'العمليات' },
  { id: 'journal', nameAr: 'اليومية العامة', nameEn: 'General Journal', group: 'العمليات' },
  { id: 'ledger', nameAr: 'دفتر الأستاذ', nameEn: 'General Ledger', group: 'العمليات' },
  { id: 'trial-balance', nameAr: 'ميزان المراجعة', nameEn: 'Trial Balance', group: 'التقارير' },
  { id: 'financial-center', nameAr: 'المركز المالي', nameEn: 'Financial Center', group: 'التقارير' },
  { id: 'income-statement', nameAr: 'قائمة الدخل', nameEn: 'Income Statement', group: 'التقارير' },
  { id: 'cash-flow', nameAr: 'التدفقات النقدية', nameEn: 'Cash Flow', group: 'التقارير' },
  { id: 'advanced-reports', nameAr: 'التقارير المتقدمة', nameEn: 'Advanced Reports', group: 'التقارير' },
  { id: 'payroll', nameAr: 'الرواتب', nameEn: 'Payroll', group: 'العمليات' },
  { id: 'users', nameAr: 'المستخدمين والصلاحيات', nameEn: 'Users & Permissions', group: 'النظام' },
  { id: 'audit-log', nameAr: 'سجل التدقيق', nameEn: 'Audit Log', group: 'النظام' },
  { id: 'settings', nameAr: 'الإعدادات', nameEn: 'Settings', group: 'النظام' },
];

const ACCESS_LEVELS: { value: AccessLevel; labelAr: string; labelEn: string; color: string }[] = [
  { value: 'NONE', labelAr: 'بدون وصول', labelEn: 'No Access', color: 'bg-gray-500' },
  { value: 'READ', labelAr: 'قراءة فقط', labelEn: 'Read Only', color: 'bg-blue-500' },
  { value: 'EDIT', labelAr: 'تعديل', labelEn: 'Edit', color: 'bg-yellow-500' },
  { value: 'FULL', labelAr: 'وصول كامل', labelEn: 'Full Access', color: 'bg-green-500' },
];

const ROLES = [
  { value: 'ADMIN', labelAr: 'مدير النظام', labelEn: 'System Admin' },
  { value: 'MANAGER', labelAr: 'مدير', labelEn: 'Manager' },
  { value: 'CASHIER', labelAr: 'كاشير', labelEn: 'Cashier' },
  { value: 'VIEWER', labelAr: 'مشاهد', labelEn: 'Viewer' },
];

// ─── Types ──────────────────────────────────────────────────────
interface SafeUser {
  id: string;
  email: string;
  name: string;
  nameEn: string | null;
  role: string;
  allowedBranches: string | null; // JSON string from DB
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  permissions: { id: string; screen: string; accessLevel: string }[];
}

// ─── User Dialog ────────────────────────────────────────────────
function UserDialog({
  open,
  onClose,
  user,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  user: SafeUser | null;
  onSave: (data: any) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('VIEWER');
  const [isActive, setIsActive] = useState(true);
  const [permissions, setPermissions] = useState<{ screen: string; accessLevel: string }[]>([]);
  const [allowedBranches, setAllowedBranches] = useState<string[]>([]);
  const [allBranches, setAllBranches] = useState<{ code: string; name: string; nameEn?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const isEdit = !!user;

  useEffect(() => {
    if (user) {
      setEmail(user.email);
      setName(user.name);
      setNameEn(user.nameEn || '');
      setRole(user.role);
      setIsActive(user.isActive);
      setPassword('');
      setPermissions(user.permissions.map((p) => ({ screen: p.screen, accessLevel: p.accessLevel })));
      // Parse allowedBranches from JSON string
      try {
        const parsed = user.allowedBranches ? JSON.parse(user.allowedBranches) : [];
        setAllowedBranches(Array.isArray(parsed) ? parsed : []);
      } catch {
        setAllowedBranches([]);
      }
    } else {
      setEmail('');
      setName('');
      setNameEn('');
      setRole('VIEWER');
      setIsActive(true);
      setPassword('');
      // Default: READ access to dashboard only
      setPermissions([{ screen: 'dashboard', accessLevel: 'READ' }]);
      setAllowedBranches([]);
    }
  }, [user, open]);

  // Fetch branches when dialog opens
  useEffect(() => {
    if (open) {
      fetch('/api/branches')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setAllBranches(data.map((b: any) => ({ code: b.code, name: b.name, nameEn: b.nameEn })));
          }
        })
        .catch(() => {});
    }
  }, [open]);

  const getAccessLevel = (screenId: string): string => {
    return permissions.find((p) => p.screen === screenId)?.accessLevel || 'NONE';
  };

  const setAccessLevel = (screenId: string, level: string) => {
    setPermissions((prev) => {
      const filtered = prev.filter((p) => p.screen !== screenId);
      if (level !== 'NONE') {
        filtered.push({ screen: screenId, accessLevel: level });
      }
      return filtered;
    });
  };

  const applyToAll = (level: string) => {
    setPermissions(SCREENS.map((s) => ({ screen: s.id, accessLevel: level })));
  };

  const handleSubmit = async () => {
    if (!email || !name) {
      toast.error('البريد الإلكتروني والاسم مطلوبان');
      return;
    }
    if (!isEdit && !password) {
      toast.error('كلمة المرور مطلوبة للمستخدم الجديد');
      return;
    }

    setSaving(true);
    try {
      await onSave({
        email,
        name,
        nameEn: nameEn || null,
        password: password || undefined,
        role,
        isActive,
        allowedBranches: allowedBranches.length > 0 ? JSON.stringify(allowedBranches) : null,
        permissions: permissions.filter((p) => p.accessLevel !== 'NONE'),
      });
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  // Group screens
  const screenGroups = SCREENS.reduce((acc, s) => {
    if (!acc[s.group]) acc[s.group] = [];
    acc[s.group].push(s);
    return acc;
  }, {} as Record<string, ScreenDef[]>);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" />
            {isEdit ? 'تعديل مستخدم' : 'إضافة مستخدم جديد'}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? 'تعديل بيانات المستخدم والصلاحيات' : 'إنشاء حساب جديد مع تحديد الصلاحيات'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">الاسم / Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم بالعربي" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">الاسم بالإنجليزي / Name EN</label>
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="Name in English" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" /> البريد الإلكتروني
              </label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> كلمة المرور {isEdit && '(اتركها فارغة للإبقاء)'}
              </label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">الدور / Role</label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.labelAr} / {r.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">الحالة</label>
              <Select value={isActive ? 'active' : 'inactive'} onValueChange={(v) => setIsActive(v === 'active')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">نشط / Active</SelectItem>
                  <SelectItem value="inactive">معطل / Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Admin note */}
          {role === 'ADMIN' && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 dark:text-yellow-400 text-sm">
              <Shield className="w-4 h-4 shrink-0" />
              <span>مدير النظام لديه وصول كامل لجميع الشاشات والفروع تلقائياً</span>
            </div>
          )}

          {/* Branch Access */}
          {role !== 'ADMIN' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Building2 className="w-4 h-4" />
                  صلاحيات الفروع / Branch Access
                </h3>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setAllowedBranches(allBranches.map(b => b.code))}>
                    كل الفروع
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setAllowedBranches([])}>
                    إزالة الكل
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {allBranches.map((branch) => (
                  <label key={branch.code} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={allowedBranches.includes(branch.code)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setAllowedBranches(prev => [...prev, branch.code]);
                        } else {
                          setAllowedBranches(prev => prev.filter(b => b !== branch.code));
                        }
                      }}
                    />
                    <span className="text-sm">{branch.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {allowedBranches.length === 0
                  ? "لم يتم تحديد فروع - المستخدم يمكنه الوصول لجميع الفروع"
                  : `الفروع المحددة: ${allowedBranches.length}`}
              </p>
            </div>
          )}

          {/* Permissions Table */}
          {role !== 'ADMIN' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  صلاحيات الوصول / Access Permissions
                </h3>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => applyToAll('READ')}>
                    قراءة للكل
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => applyToAll('EDIT')}>
                    تعديل للكل
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => applyToAll('FULL')}>
                    كامل للكل
                  </Button>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => applyToAll('NONE')}>
                    إزالة الكل
                  </Button>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>الشاشة / Screen</TableHead>
                      <TableHead className="text-center w-32">قراءة</TableHead>
                      <TableHead className="text-center w-32">تعديل</TableHead>
                      <TableHead className="text-center w-32">كامل</TableHead>
                      <TableHead className="text-center w-24">بدون</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(screenGroups).map(([group, screens]) => (
                      <Fragment key={group}>
                        <TableRow key={`group-${group}`} className="bg-muted/30">
                          <TableCell colSpan={6} className="font-bold text-xs text-muted-foreground py-1.5">
                            {group}
                          </TableCell>
                        </TableRow>
                        {screens.map((screen, idx) => {
                          const currentLevel = getAccessLevel(screen.id);
                          return (
                            <TableRow key={screen.id}>
                              <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                              <TableCell>
                                <div>
                                  <span className="text-sm font-medium">{screen.nameAr}</span>
                                  <span className="text-xs text-muted-foreground ms-2">{screen.nameEn}</span>
                                </div>
                              </TableCell>
                              {ACCESS_LEVELS.map((level) => (
                                <TableCell key={level.value} className="text-center">
                                  <button
                                    onClick={() => setAccessLevel(screen.id, level.value)}
                                    className={`w-7 h-7 rounded-full border-2 transition-all ${
                                      currentLevel === level.value
                                        ? `${level.color} border-transparent text-white scale-110`
                                        : 'border-muted-foreground/20 hover:border-muted-foreground/50'
                                    } flex items-center justify-center`}
                                  >
                                    {currentLevel === level.value && <Check className="w-3.5 h-3.5" />}
                                  </button>
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button variant="outline" onClick={onClose}>
              إلغاء
            </Button>
            <Button onClick={handleSubmit} disabled={saving} className="gap-2">
              {saving ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {isEdit ? 'حفظ التعديلات' : 'إنشاء المستخدم'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ──────────────────────────────────────────────
export default function UsersPermissions() {
  const { t } = useTranslation();
  const { user: currentUser } = useAppStore();
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SafeUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch {
      toast.error('فشل في تحميل المستخدمين');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = () => {
    setEditingUser(null);
    setDialogOpen(true);
  };

  const handleEdit = (user: SafeUser) => {
    setEditingUser(user);
    setDialogOpen(true);
  };

  const handleSave = async (data: any) => {
    if (editingUser) {
      const res = await fetch(`/api/users/${editingUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل في تحديث المستخدم');
      }
      toast.success('تم تحديث المستخدم بنجاح');
    } else {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل في إنشاء المستخدم');
      }
      toast.success('تم إنشاء المستخدم بنجاح');
    }
    fetchUsers();
  };

  const handleDelete = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'فشل في حذف المستخدم');
      }
      toast.success('تم حذف المستخدم بنجاح');
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeleteConfirm(null);
    }
  };

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.nameEn && u.nameEn.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return <Badge className="bg-red-600 text-white hover:bg-red-700">مدير النظام</Badge>;
      case 'MANAGER':
        return <Badge className="bg-yellow-600 text-white hover:bg-yellow-700">مدير</Badge>;
      default:
        return <Badge variant="secondary">مشاهد</Badge>;
    }
  };

  const getAccessLevelBadge = (screenId: string, permissions: SafeUser['permissions']) => {
    const perm = permissions.find((p) => p.screen === screenId);
    const level = perm?.accessLevel || 'NONE';
    const levelInfo = ACCESS_LEVELS.find((l) => l.value === level);
    if (level === 'NONE') return <span className="text-xs text-muted-foreground">—</span>;
    return (
      <Badge variant="outline" className={`text-white text-xs ${levelInfo?.color || 'bg-gray-500'}`}>
        {levelInfo?.labelAr}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            {t.usersPermissions || 'المستخدمين والصلاحيات'}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            إدارة المستخدمين وتحديد صلاحيات الوصول لكل شاشة
          </p>
        </div>
        <Button onClick={handleCreate} className="gap-2">
          <UserPlus className="w-4 h-4" />
          إضافة مستخدم
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="بحث عن مستخدم..."
          className="ps-9"
        />
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <UserIcon className="w-5 h-5" />
            قائمة المستخدمين
          </CardTitle>
          <CardDescription>
            {filteredUsers.length} مستخدم
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="border rounded-lg overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>المستخدم</TableHead>
                    <TableHead>البريد الإلكتروني</TableHead>
                    <TableHead className="text-center">الدور</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                    <TableHead className="text-center">الصلاحيات</TableHead>
                    <TableHead className="text-center w-28">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        لا يوجد مستخدمين
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                              {u.name?.charAt(0) || 'U'}
                            </div>
                            <div>
                              <p className="font-medium text-sm">{u.name}</p>
                              {u.nameEn && <p className="text-xs text-muted-foreground">{u.nameEn}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{u.email}</TableCell>
                        <TableCell className="text-center">{getRoleBadge(u.role)}</TableCell>
                        <TableCell className="text-center">
                          {u.isActive ? (
                            <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800">
                              نشط
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-red-600 border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800">
                              معطل
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex flex-wrap gap-1 justify-center max-w-[200px]">
                            {u.permissions
                              .filter((p) => p.accessLevel !== 'NONE')
                              .slice(0, 3)
                              .map((p) => (
                                <span key={p.screen} className="text-xs bg-muted px-1.5 py-0.5 rounded">
                                  {SCREENS.find((s) => s.id === p.screen)?.nameAr || p.screen}
                                </span>
                              ))}
                            {u.permissions.filter((p) => p.accessLevel !== 'NONE').length > 3 && (
                              <span className="text-xs text-muted-foreground">
                                +{u.permissions.filter((p) => p.accessLevel !== 'NONE').length - 3}
                              </span>
                            )}
                            {u.role === 'ADMIN' && (
                              <span className="text-xs bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 px-1.5 py-0.5 rounded">
                                الكل
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEdit(u)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            {u.id !== currentUser?.id && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteConfirm(u.id)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Permission Legend */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">مستويات الصلاحيات / Access Levels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {ACCESS_LEVELS.filter((l) => l.value !== 'NONE').map((level) => (
              <div key={level.value} className="flex items-center gap-2">
                <div className={`w-4 h-4 rounded-full ${level.color}`} />
                <span className="text-sm">{level.labelAr}</span>
                <span className="text-xs text-muted-foreground">({level.labelEn})</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* User Dialog */}
      <UserDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingUser(null);
        }}
        user={editingUser}
        onSave={handleSave}
      />

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-5 h-5" />
              تأكيد الحذف
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف هذا المستخدم؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="gap-2"
            >
              <Trash2 className="w-4 h-4" />
              حذف
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
