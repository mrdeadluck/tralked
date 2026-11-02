/**
 * The Steam store's review label, as its Brazilian page writes it: by the share of positive
 * reviews and how many there are. Under 10 reviews Steam shows only the count.
 */
export function steamReviewLabel(positive: number, total: number): string {
  if (total < 10) return total === 1 ? "1 análise" : `${total} análises`;
  const pct = (positive / total) * 100;
  if (pct >= 80) return total >= 500 && pct >= 95 ? "Extremamente positivas" : total >= 50 ? "Muito positivas" : "Positivas";
  if (pct >= 70) return "Ligeiramente positivas";
  if (pct >= 40) return "Neutras";
  if (pct >= 20) return "Ligeiramente negativas";
  return total >= 500 ? "Extremamente negativas" : total >= 50 ? "Muito negativas" : "Negativas";
}
