import "server-only";

import { prisma } from "@/lib/prisma";

export async function getOrganizationReceivables(organizationId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { organizationId },
    include: { payments: { select: { amount: true } } },
  });
  const today = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
  const active = invoices.filter((invoice) => !["DRAFT", "CANCELLED"].includes(invoice.status));

  return active.reduce((totals, invoice) => {
    const total = Number(invoice.totalAmount);
    const collected = invoice.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const balance = Math.max(total - collected, 0);
    const overdue = balance > 0 && invoice.dueDate < today;
    return {
      totalInvoiced: totals.totalInvoiced + total,
      totalCollected: totals.totalCollected + collected,
      outstandingBalance: totals.outstandingBalance + balance,
      overdueBalance: totals.overdueBalance + (overdue ? balance : 0),
      overdueCount: totals.overdueCount + (overdue ? 1 : 0),
      openCount: totals.openCount + (balance > 0 ? 1 : 0),
    };
  }, { totalInvoiced: 0, totalCollected: 0, outstandingBalance: 0, overdueBalance: 0, overdueCount: 0, openCount: 0 });
}
