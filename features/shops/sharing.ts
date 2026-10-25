import { serverOrigins } from "@/server/config";
import QRCode from "qrcode";
import { subdomainAvailabilitySchema } from "./schemas";

export function getCanonicalShopUrl(subdomain: string) {
  const parsed = subdomainAvailabilitySchema.safeParse({ subdomain });
  if (!parsed.success) throw new Error("Invalid shop subdomain.");
  const origin = new URL(serverOrigins.marketingOrigin);
  origin.hostname = `${parsed.data.subdomain}.${origin.hostname}`;
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin.toString();
}

export function createShopQrSvg(subdomain: string) {
  return QRCode.toString(getCanonicalShopUrl(subdomain), {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 4,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
