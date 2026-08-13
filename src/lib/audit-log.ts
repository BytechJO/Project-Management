const sensitiveKey = /(password|secret|token|api[_-]?key|authorization|cookie|session)/i;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (depth >= 3) return "[Nested data]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 50).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? "[REDACTED]" : sanitizeValue(item, depth + 1),
    ]));
  }
  return String(value);
}

function displayValue(value: unknown) {
  const safe = sanitizeValue(value, 0);
  if (typeof safe === "string") return safe;
  return JSON.stringify(safe);
}

export function auditSnapshotRows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).slice(0, 50).map(([key, item]) => ({
    key,
    value: sensitiveKey.test(key) ? "[REDACTED]" : displayValue(item),
  }));
}

const entityLabels: Record<string, { en: string; ar: string }> = {
  Client: { en: "Client", ar: "عميل" },
  Department: { en: "Department", ar: "قسم" },
  EmployeeLeave: { en: "Leave request", ar: "طلب إجازة" },
  EmployeeLeaveBalance: { en: "Leave balance", ar: "رصيد إجازة" },
  Expense: { en: "Expense", ar: "مصروف" },
  Invoice: { en: "Invoice", ar: "فاتورة" },
  Organization: { en: "Organization", ar: "الشركة" },
  OrganizationHoliday: { en: "Holiday", ar: "عطلة" },
  OneDriveConnection: { en: "OneDrive connection", ar: "اتصال ون درايف" },
  Project: { en: "Project", ar: "مشروع" },
  Quotation: { en: "Quotation", ar: "عرض سعر" },
  Role: { en: "Role", ar: "دور" },
  Subscription: { en: "Subscription", ar: "اشتراك" },
  Task: { en: "Task", ar: "تاسك" },
  TimeEntry: { en: "Time entry", ar: "سجل وقت" },
  Timesheet: { en: "Timesheet", ar: "سجل ساعات" },
  User: { en: "Employee", ar: "موظف" },
};

const operationLabels: Record<string, { en: string; ar: string }> = {
  approved: { en: "Approved", ar: "موافقة" },
  allocations_updated: { en: "Allocations updated", ar: "تحديث التوزيع" },
  attachment_added: { en: "Attachment added", ar: "إضافة مرفق" },
  attachment_uploaded: { en: "Attachment uploaded", ar: "رفع مرفق" },
  billing_settings_updated: { en: "Billing settings updated", ar: "تحديث إعدادات الفوترة" },
  cancelled: { en: "Cancelled", ar: "إلغاء" },
  comment_added: { en: "Comment added", ar: "إضافة تعليق" },
  created: { en: "Created", ar: "إنشاء" },
  connected: { en: "Connected", ar: "ربط" },
  deleted: { en: "Deleted", ar: "حذف" },
  disconnected: { en: "Disconnected", ar: "فصل الربط" },
  member_assigned: { en: "Member assigned", ar: "تعيين عضو" },
  paid: { en: "Marked paid", ar: "تسجيل الدفع" },
  payment_recorded: { en: "Payment recorded", ar: "تسجيل دفعة" },
  rejected: { en: "Rejected", ar: "رفض" },
  returned: { en: "Returned", ar: "إرجاع" },
  schedule_updated: { en: "Schedule updated", ar: "تحديث الجدول" },
  sent: { en: "Sent", ar: "إرسال" },
  started: { en: "Started", ar: "بدء" },
  status_updated: { en: "Status updated", ar: "تحديث الحالة" },
  stopped: { en: "Stopped", ar: "إيقاف" },
  subtask_created: { en: "Subtask created", ar: "إنشاء تاسك فرعية" },
  submitted: { en: "Submitted", ar: "إرسال للموافقة" },
  updated: { en: "Updated", ar: "تعديل" },
  verified: { en: "Verified", ar: "تحقق" },
};

export function auditEntityLabel(entityType: string, locale: "en" | "ar") {
  return entityLabels[entityType]?.[locale] ?? entityType;
}

export function auditActionLabel(action: string, entityType: string, locale: "en" | "ar") {
  const operation = action.split(".").slice(1).join("_");
  const entity = auditEntityLabel(entityType, locale);
  const label = operationLabels[operation]?.[locale]
    ?? operation.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  return locale === "ar" ? `${label} · ${entity}` : `${entity} · ${label}`;
}
