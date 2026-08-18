import Link from "next/link";

import styles from "./pagination.module.css";

function hrefFor(basePath: string, page: number, query: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const suffix = params.toString();
  return `${basePath}${suffix ? `?${suffix}` : ""}`;
}

export function Pagination({
  basePath,
  currentPage,
  hasNextPage,
  isArabic,
  query = {},
}: {
  basePath: string;
  currentPage: number;
  hasNextPage: boolean;
  isArabic: boolean;
  query?: Record<string, string | undefined>;
}) {
  if (currentPage === 1 && !hasNextPage) return null;

  return (
    <nav className={styles.pagination} aria-label={isArabic ? "صفحات النتائج" : "Result pages"}>
      {currentPage > 1 ? <Link href={hrefFor(basePath, currentPage - 1, query)}>← {isArabic ? "السابق" : "Previous"}</Link> : <span />}
      <strong>{isArabic ? "صفحة" : "Page"} {currentPage}</strong>
      {hasNextPage ? <Link href={hrefFor(basePath, currentPage + 1, query)}>{isArabic ? "التالي" : "Next"} →</Link> : <span />}
    </nav>
  );
}
