"use client";

import { useMemo, useState } from "react";

import { createQuotation, updateQuotation } from "@/actions/quotations";
import type { Locale } from "@/i18n/config";

import styles from "@/app/[lang]/operations.module.css";

type LineItem = {
  key: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
};

type InitialQuotation = {
  id: string;
  clientId: string;
  number: string;
  title: string;
  description: string;
  issueDate: string;
  validUntil: string;
  discountType: "NONE" | "PERCENTAGE" | "FIXED";
  discountValue: number;
  notes: string;
  terms: string;
  lineItems: Array<Omit<LineItem, "key">>;
};

type Props = {
  clients: Array<{ id: string; name: string }>;
  currency: string;
  initial?: InitialQuotation;
  locale: Locale;
  suggestedNumber?: string;
  suggestedIssueDate?: string;
  suggestedValidUntil?: string;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function QuotationForm({ clients, currency, initial, locale, suggestedIssueDate, suggestedNumber, suggestedValidUntil }: Props) {
  const isArabic = locale === "ar";
  const [items, setItems] = useState<LineItem[]>(
    initial?.lineItems.length
      ? initial.lineItems.map((item, index) => ({ ...item, key: `existing-${index}` }))
      : [{ key: "initial", description: "", quantity: 1, unitPrice: 0, taxRate: 0 }],
  );
  const [discountType, setDiscountType] = useState<InitialQuotation["discountType"]>(initial?.discountType ?? "NONE");
  const [discountValue, setDiscountValue] = useState(initial?.discountValue ?? 0);

  const totals = useMemo(() => {
    const subtotal = roundMoney(items.reduce((sum, item) => sum + Math.max(item.quantity, 0) * Math.max(item.unitPrice, 0), 0));
    const discountAmount = roundMoney(discountType === "PERCENTAGE" ? subtotal * Math.min(Math.max(discountValue, 0), 100) / 100 : discountType === "FIXED" ? Math.min(Math.max(discountValue, 0), subtotal) : 0);
    const taxAmount = roundMoney(items.reduce((sum, item) => {
      const lineSubtotal = Math.max(item.quantity, 0) * Math.max(item.unitPrice, 0);
      const allocatedDiscount = subtotal > 0 ? discountAmount * lineSubtotal / subtotal : 0;
      return sum + Math.max(lineSubtotal - allocatedDiscount, 0) * Math.max(item.taxRate, 0) / 100;
    }, 0));
    return { subtotal, discountAmount, taxAmount, total: roundMoney(subtotal - discountAmount + taxAmount) };
  }, [discountType, discountValue, items]);

  function updateItem(key: string, field: keyof Omit<LineItem, "key">, value: string) {
    setItems((current) => current.map((item) => item.key === key ? { ...item, [field]: field === "description" ? value : Number(value) } : item));
  }

  function addItem() {
    setItems((current) => [...current, { key: `line-${Date.now()}-${current.length}`, description: "", quantity: 1, unitPrice: 0, taxRate: 0 }]);
  }

  function removeItem(key: string) {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.key !== key));
  }

  const action = initial ? updateQuotation : createQuotation;
  const serializedItems = JSON.stringify(items.map(({ description, quantity, unitPrice, taxRate }) => ({ description, quantity, unitPrice, taxRate })));

  return (
    <form action={action} className={styles.form}>
      <input name="locale" type="hidden" value={locale} />
      {initial ? <input name="quotationId" type="hidden" value={initial.id} /> : null}
      <input name="lineItems" type="hidden" value={serializedItems} />

      <div className={styles.formGrid}>
        <label><span>{isArabic ? "رقم العرض" : "Quotation number"}</span><input name="number" defaultValue={initial?.number ?? suggestedNumber} maxLength={60} required /></label>
        <label><span>{isArabic ? "العميل" : "Client"}</span><select name="clientId" defaultValue={initial?.clientId} required><option value="">—</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className={styles.wide}><span>{isArabic ? "عنوان العرض" : "Quotation title"}</span><input name="title" defaultValue={initial?.title} maxLength={240} required /></label>
        <label className={styles.wide}><span>{isArabic ? "وصف مختصر" : "Summary"}</span><textarea name="description" defaultValue={initial?.description} maxLength={1500} /></label>
        <label><span>{isArabic ? "تاريخ الإصدار" : "Issue date"}</span><input name="issueDate" type="date" defaultValue={initial?.issueDate ?? suggestedIssueDate} required /></label>
        <label><span>{isArabic ? "صالح لغاية" : "Valid until"}</span><input name="validUntil" type="date" defaultValue={initial?.validUntil ?? suggestedValidUntil} required /></label>
      </div>

      <section className={styles.lineItemsSection}>
        <div className={styles.panelHeader}><div><h3>{isArabic ? "بنود عرض السعر" : "Quotation line items"}</h3><p>{isArabic ? "أضف الخدمات والكميات والأسعار والضريبة لكل بند." : "Add services, quantities, unit prices, and tax per line."}</p></div><button className={styles.secondaryButton} onClick={addItem} type="button">{isArabic ? "+ إضافة بند" : "+ Add line"}</button></div>
        <div className={styles.lineItemHeader} aria-hidden="true"><span>{isArabic ? "الوصف" : "Description"}</span><span>{isArabic ? "الكمية" : "Qty"}</span><span>{isArabic ? "سعر الوحدة" : "Unit price"}</span><span>{isArabic ? "الضريبة %" : "Tax %"}</span><span /></div>
        <div className={styles.lineItemList}>
          {items.map((item, index) => <div className={styles.lineItemRow} key={item.key}>
            <label><span className={styles.mobileLabel}>{isArabic ? "الوصف" : "Description"}</span><input aria-label={`Line ${index + 1} description`} value={item.description} onChange={(event) => updateItem(item.key, "description", event.target.value)} maxLength={500} required /></label>
            <label><span className={styles.mobileLabel}>{isArabic ? "الكمية" : "Qty"}</span><input aria-label={`Line ${index + 1} quantity`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(event) => updateItem(item.key, "quantity", event.target.value)} required /></label>
            <label><span className={styles.mobileLabel}>{isArabic ? "سعر الوحدة" : "Unit price"}</span><input aria-label={`Line ${index + 1} unit price`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={(event) => updateItem(item.key, "unitPrice", event.target.value)} required /></label>
            <label><span className={styles.mobileLabel}>{isArabic ? "الضريبة %" : "Tax %"}</span><input aria-label={`Line ${index + 1} tax rate`} type="number" min="0" max="100" step="0.01" value={item.taxRate} onChange={(event) => updateItem(item.key, "taxRate", event.target.value)} required /></label>
            <button className={styles.removeLineButton} disabled={items.length === 1} onClick={() => removeItem(item.key)} type="button" aria-label={isArabic ? `حذف البند ${index + 1}` : `Remove line ${index + 1}`}>×</button>
          </div>)}
        </div>
      </section>

      <div className={styles.quotationTotalsLayout}>
        <div className={styles.formGrid}>
          <label><span>{isArabic ? "نوع الخصم" : "Discount type"}</span><select name="discountType" value={discountType} onChange={(event) => setDiscountType(event.target.value as InitialQuotation["discountType"])}><option value="NONE">{isArabic ? "بدون خصم" : "No discount"}</option><option value="PERCENTAGE">{isArabic ? "نسبة مئوية" : "Percentage"}</option><option value="FIXED">{isArabic ? "مبلغ ثابت" : "Fixed amount"}</option></select></label>
          <label><span>{isArabic ? "قيمة الخصم" : "Discount value"}</span><input name="discountValue" type="number" min="0" max={discountType === "PERCENTAGE" ? 100 : undefined} step="0.01" value={discountType === "NONE" ? 0 : discountValue} onChange={(event) => setDiscountValue(Number(event.target.value))} disabled={discountType === "NONE"} required /></label>
        </div>
        <dl className={styles.liveTotals} aria-live="polite">
          <div><dt>{isArabic ? "المجموع الفرعي" : "Subtotal"}</dt><dd>{totals.subtotal.toFixed(2)} {currency}</dd></div>
          <div><dt>{isArabic ? "الخصم" : "Discount"}</dt><dd>- {totals.discountAmount.toFixed(2)} {currency}</dd></div>
          <div><dt>{isArabic ? "الضريبة" : "Tax"}</dt><dd>{totals.taxAmount.toFixed(2)} {currency}</dd></div>
          <div><dt>{isArabic ? "الإجمالي" : "Total"}</dt><dd>{totals.total.toFixed(2)} {currency}</dd></div>
        </dl>
      </div>

      <div className={styles.formGrid}>
        <label><span>{isArabic ? "الشروط والأحكام" : "Terms & conditions"}</span><textarea name="terms" defaultValue={initial?.terms} maxLength={4000} /></label>
        <label><span>{isArabic ? "ملاحظات" : "Notes"}</span><textarea name="notes" defaultValue={initial?.notes} maxLength={2000} /></label>
      </div>
      <button className={styles.primaryButton} type="submit">{initial ? (isArabic ? "حفظ التعديلات" : "Save changes") : (isArabic ? "إنشاء عرض السعر" : "Create quotation")}</button>
    </form>
  );
}
