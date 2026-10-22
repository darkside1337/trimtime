const instant = process.env.TRIMTIME_E2E_NOW;
if (!instant || Number.isNaN(Date.parse(instant)) || !/Z$/.test(instant)) {
  throw new Error("TRIMTIME_E2E_NOW must be a UTC ISO instant ending in Z.");
}

const RealDate = Date;
const epoch = RealDate.parse(instant);
function FixedDate(...args) {
  if (new.target)
    return args.length ? new RealDate(...args) : new RealDate(epoch);
  return new RealDate(epoch).toString();
}
Object.setPrototypeOf(FixedDate, RealDate);
FixedDate.prototype = RealDate.prototype;
FixedDate.now = () => epoch;
FixedDate.parse = RealDate.parse;
FixedDate.UTC = RealDate.UTC;
globalThis.Date = FixedDate;
