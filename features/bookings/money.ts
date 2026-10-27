export function fixedBookingPrice(value: string) {
  const [dollars, cents = ""] = value.split(".");
  return `${dollars}.${cents.padEnd(2, "0")}`;
}
