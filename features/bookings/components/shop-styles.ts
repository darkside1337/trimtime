export const shop = {
  page: "min-h-dvh bg-white font-sans text-[#242424]",
  wrap: "mx-auto w-[calc(100%-96px)] max-w-[1280px] max-[1024px]:w-[calc(100%-64px)] max-[767px]:w-[calc(100%-40px)]",
  noticeBar:
    "flex justify-between gap-4 border-b border-[#e6e6e2] bg-[#f7f7f5] px-[max(24px,calc((100vw-1280px)/2))] py-[9px] max-[1024px]:px-8 max-[767px]:px-5 text-[11px] text-[#72726e] max-[767px]:justify-center max-[767px]:text-center [&>span:last-child]:max-[767px]:hidden",
  siteHeader:
    "flex min-h-[78px] items-center justify-between gap-6 border-b border-[#242424] py-3 max-[767px]:min-h-16 max-[767px]:gap-3 max-[767px]:py-2",
  wordmark:
    "min-w-0 flex-1 wrap-anywhere font-[family-name:var(--font-shop-display)] text-[40px] font-bold uppercase leading-none text-[#242424] no-underline max-[767px]:text-[36px]",
  greenDot: "text-[#21734f]",
  siteNav:
    "flex min-w-0 flex-wrap items-center justify-end gap-8 text-[13px] font-semibold max-[900px]:gap-5 max-[767px]:gap-3.5 max-[767px]:text-[11px] [&>a]:text-inherit [&>a]:no-underline [&>span]:max-w-[26ch] [&>span]:wrap-anywhere [&>span]:border-l [&>span]:border-[#e6e6e2] [&>span]:pl-6 [&>span]:text-right max-[767px]:[&>span]:hidden",
  hero: "grid grid-cols-2 items-center gap-14 py-16 max-[900px]:gap-8 max-[767px]:grid-cols-1 max-[767px]:gap-[30px] max-[767px]:py-9",
  heroCopy: "flex flex-col items-start",
  eyebrow:
    "mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-[#72726e]",
  heroTitle:
    "m-0 max-w-[11ch] font-[family-name:var(--font-shop-display)] text-[clamp(76px,7.5vw,108px)] font-bold uppercase leading-[0.91] tracking-[-0.035em] max-[767px]:max-w-full max-[767px]:text-[clamp(48px,19.5vw,76px)]",
  heroText:
    "my-[22px] max-w-[38ch] text-base leading-[1.65] text-[#72726e] max-[767px]:my-[18px] max-[767px]:text-[15px]",
  primaryLink:
    "inline-flex min-h-12 items-center justify-center gap-3.5 rounded-[2px] border border-[#21734f] bg-[#21734f] px-[22px] text-sm font-semibold text-white no-underline transition-colors hover:bg-[#185e43] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#21734f] motion-reduce:transition-none",
  addressLine:
    "relative mt-6 pl-3.5 text-xs before:absolute before:left-0 before:top-1/2 before:size-1.5 before:-translate-y-1/2 before:rounded-full before:bg-[#21734f] before:content-[''] max-[767px]:mt-[18px]",
  heroPhoto: "m-0 min-w-0",
  heroImage: "block aspect-[1.5] w-full object-cover grayscale",
  photoCaption:
    "flex justify-between gap-4 pt-3 text-[10px] [&>span:first-child]:font-bold [&>span:first-child]:uppercase [&>span:last-child]:text-[#72726e]",
  promiseBar:
    "flex min-h-16 items-center justify-between gap-6 bg-[#242424] px-[max(24px,calc((100vw-1280px)/2))] py-3 text-xs max-[1024px]:px-8 max-[767px]:px-5 text-white max-[767px]:min-h-[72px] max-[767px]:flex-wrap max-[767px]:justify-start max-[767px]:gap-x-[18px] max-[767px]:gap-y-2 max-[767px]:px-5 [&>strong]:mr-auto [&>strong]:font-[family-name:var(--font-shop-display)] [&>strong]:text-xl [&>strong]:uppercase max-[767px]:[&>strong]:w-full max-[767px]:[&>strong]:text-[19px]",
  bookingSection: "scroll-mt-5 py-16 max-[767px]:py-10",
  bookingIntro:
    "mb-8 flex items-end justify-between gap-6 max-[767px]:mb-6 max-[767px]:block",
  displayHeading:
    "m-0 font-[family-name:var(--font-shop-display)] text-[52px] font-bold uppercase leading-none tracking-[-0.02em] max-[1024px]:text-[40px] max-[767px]:text-[36px]",
  stepHeading:
    "m-0 font-[family-name:var(--font-shop-display)] text-[36px] font-bold uppercase leading-none tracking-[-0.02em] focus:outline-none",
  bookingLead: "mt-2.5 text-[#72726e]",
  disclosure:
    "m-0 text-right text-xs leading-[1.7] text-[#72726e] max-[767px]:mt-3.5 max-[767px]:text-left",
  footerCallout:
    "grid grid-cols-2 gap-12 scroll-mt-5 bg-[#f7f7f5] px-[max(24px,calc((100vw-1280px)/2))] py-14 max-[1024px]:px-8 max-[767px]:grid-cols-1 max-[767px]:gap-7 max-[767px]:px-5 max-[767px]:py-10",
  footerCalloutTitle:
    "m-0 max-w-[15ch] font-[family-name:var(--font-shop-display)] text-[clamp(48px,6vw,76px)] font-bold uppercase leading-[0.95]",
  footerInfoTitle:
    "mb-[18px] font-[family-name:var(--font-shop-display)] text-[26px] font-bold uppercase",
  footerText: "my-3",
  supporting: "text-[13px] text-[#72726e]",
  footer:
    "flex min-h-[88px] items-center justify-between gap-6 py-4 max-[767px]:min-h-[72px] max-[767px]:flex-wrap max-[767px]:gap-4 max-[767px]:py-3.5",
  footerWordmark:
    "min-w-0 wrap-anywhere font-[family-name:var(--font-shop-display)] text-[26px] font-bold uppercase leading-none max-[767px]:text-[22px]",
  footerNote: "text-[11px] text-[#72726e]",
  signInLink:
    "text-xs text-[#72726e] underline underline-offset-4 hover:text-[#242424] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#21734f]",
  heroPhotoCaption:
    "flex justify-between gap-4 pt-3 text-[10px] [&>span:first-child]:font-bold [&>span:first-child]:uppercase [&>span:last-child]:text-[#72726e]",
  paused:
    "mt-10 bg-[#f7f7f5] px-6 py-[72px] pb-24 max-[767px]:mt-6 max-[767px]:px-5 max-[767px]:py-[42px] max-[767px]:pb-14",
  messagePanel: "py-[72px] pb-24 max-[767px]:py-[42px] max-[767px]:pb-14",
  pausedText: "mt-5 max-w-[66ch] leading-[1.65]",
  bookingLayout:
    "grid grid-cols-[minmax(0,1fr)_360px] items-start gap-9 max-[900px]:grid-cols-[minmax(0,1fr)_280px] max-[900px]:gap-6 max-[767px]:flex max-[767px]:flex-col max-[767px]:gap-5",
  stepper:
    "col-span-full grid grid-cols-4 border-b border-[#e6e6e2] max-[767px]:w-full",
  step: "flex min-h-[58px] min-w-0 items-center gap-3 border-b-2 border-transparent px-3 py-2 text-left text-[13px] text-[#72726e] disabled:cursor-default max-[900px]:gap-2 max-[900px]:px-1.5 max-[900px]:text-[11px] max-[767px]:min-h-[62px] max-[767px]:flex-col max-[767px]:justify-center max-[767px]:gap-[5px] max-[767px]:px-px max-[767px]:py-[5px] max-[767px]:text-center max-[767px]:text-[9px]",
  stepActive:
    "flex min-h-[58px] min-w-0 items-center gap-3 border-b-2 border-[#21734f] px-3 py-2 text-left text-[13px] font-bold text-[#242424] max-[900px]:gap-2 max-[900px]:px-1.5 max-[900px]:text-[11px] max-[767px]:min-h-[62px] max-[767px]:flex-col max-[767px]:justify-center max-[767px]:gap-[5px] max-[767px]:px-px max-[767px]:py-[5px] max-[767px]:text-center max-[767px]:text-[9px]",
  stepComplete:
    "flex min-h-[58px] min-w-0 items-center gap-3 border-b-2 border-transparent px-3 py-2 text-left text-[13px] text-[#242424] max-[900px]:gap-2 max-[900px]:px-1.5 max-[900px]:text-[11px] max-[767px]:min-h-[62px] max-[767px]:flex-col max-[767px]:justify-center max-[767px]:gap-[5px] max-[767px]:px-px max-[767px]:py-[5px] max-[767px]:text-center max-[767px]:text-[9px]",
  stepNumber:
    "grid size-7 shrink-0 place-items-center rounded-full border border-[#e6e6e2] text-[11px] max-[767px]:size-6 max-[767px]:text-[9px]",
  stepNumberActive:
    "grid size-7 shrink-0 place-items-center rounded-full border border-[#21734f] bg-[#21734f] text-[11px] text-white max-[767px]:size-6 max-[767px]:text-[9px]",
  stepNumberComplete:
    "grid size-7 shrink-0 place-items-center rounded-full border border-[#21734f] text-[11px] text-[#21734f] max-[767px]:size-6 max-[767px]:text-[9px]",
  stepContent: "min-w-0 max-[767px]:w-full",
  stepLead:
    "mb-7 mt-2.5 leading-[1.5] text-[#72726e] max-[767px]:mb-5 text-[13px]",
  choiceList: "m-0 min-w-0 border-0 p-0",
  choice:
    "flex min-h-24 cursor-pointer items-center gap-[22px] border-t border-[#e6e6e2] px-3.5 py-5 last:border-b max-[767px]:min-h-[84px] max-[767px]:gap-3 max-[767px]:px-1 max-[767px]:py-4",
  choiceSelected:
    "flex min-h-24 cursor-pointer items-center gap-[22px] border-t border-[#e6e6e2] bg-[#f7f7f5] px-3.5 py-5 last:border-b max-[767px]:min-h-[84px] max-[767px]:gap-3 max-[767px]:px-1 max-[767px]:py-4",
  radio:
    "size-[18px] shrink-0 accent-[#21734f] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#21734f]",
  choiceText: "grid min-w-0 gap-1.5",
  choiceTitle:
    "font-[family-name:var(--font-shop-display)] text-2xl font-bold leading-[1.05] max-[767px]:text-[21px]",
  barberAvatar:
    "grid size-[54px] shrink-0 place-items-center bg-[#242424] font-[family-name:var(--font-shop-display)] text-2xl font-bold uppercase text-white",
  choiceDetail: "text-[11px] text-[#72726e]",
  choicePrice:
    "ml-auto grid gap-[3px] text-right font-[family-name:var(--font-shop-display)] text-[29px] font-bold max-[767px]:text-2xl",
  choicePriceCurrency: "font-sans text-[9px] font-normal text-[#72726e]",
  choiceHint: "ml-auto text-xs text-[#72726e] max-[767px]:text-[10px]",
  stepActions:
    "mt-7 flex items-center justify-between gap-4 max-[767px]:mt-[22px] max-[767px]:items-start",
  stepHint:
    "text-[11px] text-[#72726e] max-[767px]:max-w-[11ch] max-[767px]:self-center",
  actionButton:
    "ml-auto inline-flex min-h-12 items-center justify-center gap-3.5 rounded-[2px] border border-[#21734f] bg-[#21734f] px-[22px] text-sm font-semibold text-white transition-colors hover:bg-[#185e43] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#21734f] disabled:cursor-not-allowed disabled:border-[#21734f] disabled:bg-[#21734f] motion-reduce:transition-none max-[767px]:min-h-[46px] max-[767px]:max-w-[65%] max-[767px]:px-[13px] max-[767px]:text-xs",
  textButton:
    "min-h-10 cursor-pointer border-0 bg-transparent px-0 py-1.5 text-[13px] text-[#242424] underline decoration-1 underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#21734f] disabled:cursor-not-allowed",
  dateField: "mt-7 grid gap-2.5 text-sm font-semibold max-[767px]:mt-[18px]",
  dateInput:
    "min-h-12 rounded-[2px] border border-[#e6e6e2] bg-white px-3 text-base text-[#242424] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#21734f]",
  timeZoneNote: "mb-6 mt-3 text-xs text-[#72726e]",
  dateRailHeader: "mb-4 flex items-center justify-between gap-3",
  dateMonth:
    "font-[family-name:var(--font-shop-display)] text-[22px] font-bold",
  railButton:
    "grid size-10 place-items-center rounded-[2px] border border-[#e6e6e2] bg-white text-[#242424] hover:bg-[#f7f7f5] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#21734f]",
  dateRail: "mb-6 grid grid-cols-7 gap-2 max-[767px]:gap-1.5",
  dateOption:
    "grid min-h-[92px] cursor-pointer content-center justify-items-center gap-1 rounded-[2px] border border-[#e6e6e2] bg-white px-1 py-2 text-center text-[11px] hover:border-[#21734f] max-[767px]:min-h-[78px] max-[767px]:text-[9px]",
  dateOptionSelected:
    "grid min-h-[92px] cursor-pointer content-center justify-items-center gap-1 rounded-[2px] border border-[#21734f] bg-[#21734f] px-1 py-2 text-center text-[11px] text-white max-[767px]:min-h-[78px] max-[767px]:text-[9px]",
  dateWeekday: "text-[#72726e]",
  dateNumber:
    "font-[family-name:var(--font-shop-display)] text-[24px] font-bold max-[767px]:text-[20px]",
  dateNativeFallback:
    "mb-5 grid gap-2 text-xs font-semibold text-[#72726e] [&>input]:min-h-11 [&>input]:rounded-[2px] [&>input]:border [&>input]:border-[#e6e6e2] [&>input]:bg-white [&>input]:px-3 [&>input]:text-[#242424]",
  slotGroups: "grid min-w-0 gap-[26px] border-0 p-0",
  groupHeading: "mb-2.5 text-[13px] font-medium",
  slotGrid:
    "grid grid-cols-4 gap-2 max-[900px]:grid-cols-3 max-[767px]:gap-[7px]",
  slot: "relative grid min-h-[45px] cursor-pointer place-items-center rounded-[3px] border border-[#e6e6e2] p-[5px] text-xs max-[767px]:min-h-[43px] max-[767px]:text-[11px] [&>input]:absolute [&>input]:inset-0 [&>input]:m-0 [&>input]:size-full [&>input]:cursor-pointer [&>input]:opacity-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f] [&>input]:focus-visible:outline-2",
  slotSelected:
    "relative grid min-h-[45px] cursor-pointer place-items-center rounded-[3px] border border-[#21734f] bg-[#21734f] p-[5px] text-xs text-white max-[767px]:min-h-[43px] max-[767px]:text-[11px] [&>input]:absolute [&>input]:inset-0 [&>input]:m-0 [&>input]:size-full [&>input]:cursor-pointer [&>input]:opacity-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#21734f] [&>input]:focus-visible:outline-2",
  slotOffset: "block text-[9px]",
  emptyState:
    "mt-6 grid justify-items-start gap-3.5 bg-[#f7f7f5] p-7 [&>h4]:m-0 [&>h4]:font-[family-name:var(--font-shop-display)] [&>h4]:text-[30px] [&>p]:m-0 [&>p]:max-w-[58ch] [&>p]:leading-[1.6]",
  summary:
    "sticky top-5 min-w-0 border-t-[3px] border-[#242424] bg-[#f7f7f5] [&>h3]:m-0 [&>h3]:px-[22px] [&>h3]:pb-5 [&>h3]:pt-2 [&>h3]:font-[family-name:var(--font-shop-display)] [&>h3]:text-[32px] [&>h3]:font-bold [&>h3]:uppercase [&>h3]:leading-none [&_dl]:m-0 [&_dl]:grid [&_dl]:gap-[18px] [&_dl]:px-[22px] [&_dl]:pb-5 [&_dl>div]:flex [&_dl>div]:justify-between [&_dl>div]:gap-4 [&_dl>div]:text-xs [&_dt]:text-[#72726e] [&_dd]:m-0 [&_dd]:text-right max-[767px]:static",
  summaryKicker: "m-0 px-[22px] pb-3 pt-[22px] text-xs font-semibold",
  summaryTotal:
    "mx-[22px] flex items-baseline justify-between gap-3 border-t border-[#e6e6e2] py-[18px] pb-1 text-xs [&>strong]:font-[family-name:var(--font-shop-display)] [&>strong]:text-[34px]",
  summaryCaption: "m-0 px-[22px] pb-5 text-[10px] text-[#72726e]",
  summaryHelp:
    "mx-[22px] border-t border-[#e6e6e2] py-[18px] text-[11px] leading-[1.6] [&>p]:mt-2 [&>p]:text-[#72726e]",
  summaryEnd:
    "m-0 border-t border-dashed border-[#e6e6e2] px-2 py-[15px] text-center font-[family-name:var(--font-shop-display)] text-base font-bold uppercase tracking-[0.12em]",
  desktopSummary: "max-[767px]:hidden",
  mobileSummary: "hidden w-full max-[767px]:block",
  mobileSummaryDetails:
    "bg-[#f7f7f5] [&>summary]:cursor-pointer [&>summary]:p-4 [&>summary]:text-xs [&>summary]:font-semibold",
  mobileSummaryPanel: "static border-t bg-[#f7f7f5]",
  status:
    "my-5 bg-[#f7f7f5] px-4 py-3.5 text-[13px] leading-[1.6] text-[#242424]",
  error:
    "my-5 grid gap-2.5 rounded-[10px] border border-[#c44636] bg-[#fff0ed] px-4 py-3.5 text-[13px] leading-[1.6] text-[#a23125]",
  inlineAction:
    "w-fit cursor-pointer border-0 bg-transparent p-0 font-bold text-inherit underline underline-offset-[3px]",
  contactFields: "grid gap-6",
  field:
    "grid gap-[9px] text-xs font-semibold [&>span>small]:text-[11px] [&>span>small]:font-normal [&>span>small]:text-[#72726e] [&>small]:text-[11px] [&>small]:font-normal [&>small]:text-[#72726e] [&>input]:min-h-12 [&>input]:rounded-[2px] [&>input]:border [&>input]:border-[#e6e6e2] [&>input]:bg-white [&>input]:px-3 [&>input]:text-base [&>input]:font-normal [&>input]:text-[#242424] [&>input]:focus-visible:outline-2 [&>input]:focus-visible:outline-offset-2 [&>input]:focus-visible:outline-[#21734f]",
  consent:
    "flex items-start gap-3 text-xs [&>input]:mt-0 [&>input]:size-[18px] [&>input]:shrink-0 [&>input]:accent-[#21734f] [&>span]:grid [&>span]:gap-[7px] [&_small]:text-[11px] [&_small]:font-normal [&_small]:text-[#72726e]",
  deliveryNote:
    "my-5 bg-[#f7f7f5] px-4 py-3.5 text-[13px] leading-[1.6] text-[#242424]",
  shortNotice:
    "my-4 border-l-2 border-[#21734f] bg-[#f7f7f5] px-4 py-3 text-[13px] leading-[1.6] text-[#242424]",
  contactHelp: "mt-3.5 text-[11px] text-[#72726e]",
  visuallyHidden:
    "absolute m-[-1px] size-px overflow-hidden whitespace-nowrap border-0 p-0 [clip:rect(0,0,0,0)]",
  receipt: "mx-auto max-w-[760px] py-10 pb-5 max-[767px]:pt-2.5",
  receiptMark:
    "mb-6 grid size-[54px] place-items-center rounded-full border border-[#21734f] text-[25px] text-[#21734f]",
  receiptHeading:
    "m-0 font-[family-name:var(--font-shop-display)] text-[clamp(34px,5vw,52px)] font-bold uppercase leading-none",
  receiptIntro: "my-3.5 mb-6 text-[#72726e]",
  receiptDetails:
    "m-0 grid border-t border-[#e6e6e2] [&>div]:flex [&>div]:justify-between [&>div]:gap-4 [&>div]:border-b [&>div]:border-[#e6e6e2] [&>div]:py-4 [&>div]:text-xs [&_dt]:text-[#72726e] [&_dd]:m-0 [&_dd]:max-w-[65%] [&_dd]:wrap-anywhere [&_dd]:text-right max-[767px]:[&>div]:text-[11px]",
  linkPanel:
    "mt-6 grid justify-items-start gap-3 [&>h3]:m-0 [&>h3]:text-[13px] [&>p]:m-0 [&>p]:text-xs [&>p]:leading-[1.6] [&>p]:text-[#72726e]",
  footerCalloutMobile: "max-[767px]:text-[54px]",
} as const;

export const bookingStyles = {
  ...shop,
  primaryButton: shop.actionButton,
  secondaryButton: shop.primaryLink,
  errorMessage: shop.error,
  inlineStatus: shop.status,
  consentField: shop.consent,
} as const;
