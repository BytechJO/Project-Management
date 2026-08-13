"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { isLocale } from "@/i18n/config";
import { actionErrorMessage, feedbackUrl } from "@/lib/action-feedback";
import { requireUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";

function routeLocale(formData: FormData) {
  const locale = String(formData.get("locale") ?? "en");
  if (!isLocale(locale)) throw new Error("Invalid locale.");
  return locale;
}

function requiredText(formData: FormData, key: string, maxLength: number) {
  const value = String(formData.get(key) ?? "").trim();
  if (!value || value.length > maxLength) throw new Error(`Invalid ${key}.`);
  return value;
}

export async function updateProfile(formData: FormData) {
  const locale = routeLocale(formData);

  try {
    const actor = await requireUser(locale);
    const name = requiredText(formData, "name", 120);
    const email = requiredText(formData, "email", 160).toLowerCase();
    const phone = String(formData.get("phone") ?? "").trim();
    const preferredLocale = String(formData.get("preferredLocale") ?? "EN");

    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Invalid email address.");
    if (phone.length > 40) throw new Error("Invalid phone number.");
    if (!['EN', 'AR'].includes(preferredLocale)) throw new Error("Invalid preferred language.");

    const duplicateEmail = await prisma.user.findFirst({ where: { email, id: { not: actor.id } } });
    if (duplicateEmail) throw new Error("A user with this email already exists.");

    const [firstName, ...lastNameParts] = name.split(/\s+/);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: actor.id },
        data: {
          name,
          email,
          firstName,
          lastName: lastNameParts.join(" ") || null,
          phone: phone || null,
          locale: preferredLocale as "EN" | "AR",
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: actor.organizationId!,
          actorId: actor.id,
          action: "profile.updated",
          entityType: "User",
          entityId: actor.id,
          before: { name: actor.name, email: actor.email, phone: actor.phone, locale: actor.locale },
          after: { name, email, phone: phone || null, locale: preferredLocale },
        },
      }),
    ]);
    revalidatePath(`/${locale}/profile`);
  } catch (error) {
    redirect(feedbackUrl(`/${locale}/profile`, "error", actionErrorMessage(error, "Profile could not be updated.")));
  }

  redirect(feedbackUrl(`/${locale}/profile`, "success", "Profile updated successfully."));
}
