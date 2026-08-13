export function actionErrorMessage(error: unknown, fallback: string) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  if (code === "P2002") return "A record with the same unique value already exists.";
  if (code === "P2003") return "This record is connected to other data and cannot be changed that way.";

  if (error instanceof Error && error.constructor === Error) {
    const safePrefixes = [
      "A ", "Active ", "Add ", "Allocation ", "An ", "Annual ", "Approved ",
      "Attachment ", "Client ", "Discount ", "Due ", "Each ", "Employee ", "Estimated ",
      "Employees ", "End ", "Every ", "Fixed ", "Hours ", "Invalid ",
      "Invoice ", "Invoices ", "Leave ", "Line ", "No ", "Only ", "Paid ",
      "Password ", "Payment ", "Project ", "Quotation ", "Submitted ",
      "OneDrive ",
      "Remaining ", "Schedule ", "Subscription ", "Target ", "Task ", "The ", "This ", "Timesheet ",
      "Timers ", "Valid ", "Weekly ", "Work ", "You ",
    ];
    const safeFieldMessage = /^[A-Za-z][A-Za-z0-9_]* (?:is required|must be|must use|cannot be)/;

    if (
      error.message.length <= 220
      && (safePrefixes.some((prefix) => error.message.startsWith(prefix)) || safeFieldMessage.test(error.message))
    ) {
      return error.message.slice(0, 220);
    }
  }

  return fallback;
}

export function feedbackUrl(
  path: string,
  type: "error" | "success",
  message: string,
) {
  const search = new URLSearchParams({ [type]: message });
  return `${path}${path.includes("?") ? "&" : "?"}${search.toString()}`;
}
