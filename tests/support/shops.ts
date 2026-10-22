export function shopInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Juniper Barber",
    subdomain: "juniper",
    timeZone: "America/New_York",
    publicContact: "Call 202-555-0142",
    address: "123 Example Street",
    ...overrides,
  };
}
