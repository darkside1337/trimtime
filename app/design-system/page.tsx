"use client";

import dynamic from "next/dynamic";
import { TrimTimeLogo } from "@/components/trimtime-logo";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Heart,
  Info,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { LogoShowcase } from "./logo-showcase";
import "./playground.css";

const SchedulingCalendar = dynamic(() => import("./scheduling-calendar"), {
  ssr: false,
  loading: () => (
    <div className="tt-exhibit tt-wideExhibit">
      Loading the scheduling calendar…
    </div>
  ),
});

const neutrals = [
  {
    name: "Ink",
    token: "foreground / primary",
    value: "#242424",
    usage: "Text & decisive actions",
    variable: "--foreground",
    light: true,
  },
  {
    name: "Paper",
    token: "background / elevated",
    value: "#FFFFFF",
    usage: "Canvas & raised surfaces",
    variable: "--background",
  },
  {
    name: "Cloud",
    token: "surface / muted",
    value: "#F7F7F5",
    usage: "Quiet, supporting surfaces",
    variable: "--surface",
  },
  {
    name: "Pebble",
    token: "muted-foreground",
    value: "#72726E",
    usage: "Secondary text & captions",
    variable: "--muted-foreground",
    light: true,
  },
  {
    name: "Mist",
    token: "border",
    value: "#E6E6E2",
    usage: "Subtle edges & dividers",
    variable: "--border",
  },
  {
    name: "Blue wash",
    token: "secondary",
    value: "#EAF5FF",
    usage: "Low-emphasis actions",
    variable: "--secondary",
  },
];
const accents = [
  {
    name: "Sky",
    token: "accent-sky",
    value: "#62C3FF",
    usage: "Focus & a little energy",
    variable: "--sky",
  },
  {
    name: "Mint",
    token: "accent-mint",
    value: "#B9EED4",
    usage: "Positive, fresh moments",
    variable: "--mint",
  },
  {
    name: "Butter",
    token: "accent-butter",
    value: "#FFE5A3",
    usage: "Warmth & gentle attention",
    variable: "--butter",
  },
  {
    name: "Lilac",
    token: "accent-lilac",
    value: "#D8CBF4",
    usage: "Playful supporting details",
    variable: "--lilac",
  },
];
const semantics = [
  {
    name: "success",
    value: "#21734F",
    label: "All set",
    icon: CheckCircle2,
  },
  {
    name: "warning",
    value: "#986411",
    label: "Needs a look",
    icon: TriangleAlert,
  },
  {
    name: "destructive",
    value: "#C44636",
    label: "Try again",
    icon: Info,
  },
] as const;
const sections = [
  { id: "identity", label: "Identity" },
  { id: "logo", label: "Logo" },
  { id: "colors", label: "Colors" },
  { id: "typography", label: "Typography" },
  { id: "foundations", label: "Foundations" },
  { id: "components", label: "Components" },
];

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="tt-sectionHeading">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function Exhibit({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={`tt-exhibit ${className}`}>
      <div className="tt-exhibitHeading">
        <h3>{title}</h3>
        <span>{subtitle}</span>
      </div>
      {children}
    </article>
  );
}

function Flower({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 220 220"
      fill="none"
      aria-hidden="true"
    >
      <g fill="currentColor">
        {Array.from({ length: 8 }, (_, i) => (
          <circle
            key={i}
            cx="110"
            cy="46"
            r="42"
            transform={`rotate(${i * 45} 110 110)`}
          />
        ))}
        <circle cx="110" cy="110" r="69" />
      </g>
      <circle cx="110" cy="110" r="37" fill="var(--background)" />
      <path
        d="m95 111 10 10 21-23"
        stroke="var(--foreground)"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DesignSystemPage() {
  const portalContainer = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState("identity");
  const [favorite, setFavorite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailInvalid, setEmailInvalid] = useState(true);
  const [menuStatus, setMenuStatus] = useState("Small menu. Clear choices.");
  const [dialogStatus, setDialogStatus] = useState(
    "A little focus, when you need it.",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [motionPlayed, setMotionPlayed] = useState(0);

  useEffect(() => {
    if (!saving) return;
    const timer = setTimeout(() => {
      setSaving(false);
      setSaved(true);
    }, 900);
    return () => clearTimeout(timer);
  }, [saving]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );
    sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={portalContainer} className="tt-exploration">
      <TooltipProvider delay={250}>
        <header className="tt-header">
          <div className="tt-headerInner">
            <a
              href="#identity"
              className="tt-brand"
              aria-label="TrimTime design system"
            >
              <span className="tt-brandMark">
                <TrimTimeLogo arrangement="symbol" width={32} decorative />
              </span>
              <span>
                TrimTime
                <span className="tt-brandCaption">Design system</span>
              </span>
            </a>
            <nav aria-label="Page sections" className="tt-nav">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  aria-current={
                    activeSection === section.id ? "location" : undefined
                  }
                >
                  {section.label}
                </a>
              ))}
            </nav>
            <Badge variant="secondary" className="tt-experimentBadge">
              <span className="tt-statusDot" />
              Soft Welcome
            </Badge>
          </div>
        </header>

        <main className="tt-main">
          <section
            id="identity"
            className="tt-identity"
            aria-label="Visual identity"
          >
            <div className="tt-hero">
              <div className="tt-heroCopy">
                <h1>
                  A little more
                  <br /> human<span className="tt-period">.</span>
                </h1>
                <p className="tt-heroIntro">
                  Soft shapes. Clear thinking.
                  <br /> A little delight in the everyday.
                </p>
                <p className="tt-heroDescription">
                  TrimTime’s shared visual foundation: approachable by nature,
                  thoughtful in the details.
                </p>
                <Button
                  nativeButton={false}
                  render={<a href="#components" />}
                  size="lg"
                >
                  Meet the components <ArrowDown data-icon="inline-end" />
                </Button>
              </div>
              <div
                className="tt-heroArt"
                aria-label="Blue flower, mint cross, and butter-yellow star: the design system’s playful shape language"
                role="img"
              >
                <div className="tt-artTop">
                  <span>Soft edges. Bright ideas.</span>
                  <Sparkles />
                </div>
                <Flower className="tt-heroFlower" />
                <svg
                  className="tt-heroCross"
                  viewBox="0 0 120 120"
                  aria-hidden="true"
                >
                  <path
                    d="M42 20a18 18 0 0 1 36 0v22h22a18 18 0 0 1 0 36H78v22a18 18 0 0 1-36 0V78H20a18 18 0 0 1 0-36h22Z"
                    fill="currentColor"
                  />
                </svg>
                <svg
                  className="tt-heroStar"
                  viewBox="0 0 120 120"
                  aria-hidden="true"
                >
                  <path
                    d="M60 5C70 42 78 50 115 60 78 70 70 78 60 115 50 78 42 70 5 60 42 50 50 42 60 5Z"
                    fill="currentColor"
                  />
                </svg>
                <span className="tt-artDot" />
                <span className="tt-artLilac" />
                <span className="tt-artTinyDot" />
                <div className="tt-artBottom">
                  <span>Made for people.</span>
                  <div>
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            </div>
            <div className="tt-principles">
              <div>
                <h3>Room to breathe</h3>
                <p>
                  Generous space. Clear hierarchy.
                  <br /> Nothing competing for attention.
                </p>
              </div>
              <div>
                <h3>Soft, not shy</h3>
                <p>
                  Warm neutrals meet confident ink.
                  <br /> Color arrives with a purpose.
                </p>
              </div>
              <div>
                <h3>Details with a smile</h3>
                <p>
                  Rounded corners, friendly shapes,
                  <br /> and a satisfying response to every tap.
                </p>
              </div>
            </div>
          </section>

          <LogoShowcase />

          <section id="colors" className="tt-section">
            <SectionHeading
              title="A calm canvas. A colorful character."
              description="Colors · Neutrals do the work. Accents bring the personality."
            />
            <div className="tt-neutralSwatches">
              {neutrals.map((color) => (
                <div key={color.name} className="tt-swatch">
                  <div
                    className={`tt-colorBlock ${color.light ? "tt-lightInk" : ""}`}
                    style={{ background: `var(${color.variable})` }}
                  >
                    <span>{color.name}</span>
                    <code>{color.value}</code>
                  </div>
                  <strong>{color.token}</strong>
                  <p>{color.usage}</p>
                </div>
              ))}
            </div>
            <div className="tt-accentSwatches">
              {accents.map((color) => (
                <div key={color.name} className="tt-swatch">
                  <div
                    className="tt-colorBlock"
                    style={{ background: `var(${color.variable})` }}
                  >
                    <span>{color.name}</span>
                    <code>{color.value}</code>
                  </div>
                  <strong>{color.token}</strong>
                  <p>{color.usage}</p>
                </div>
              ))}
            </div>
            <div className="tt-semanticRow">
              <span className="tt-smallHeading">Meaning, at a glance</span>
              {semantics.map((color) => (
                <div key={color.name}>
                  <Badge variant={color.name}>
                    <color.icon />
                    {color.label}
                  </Badge>
                  <code>
                    {color.name} · {color.value}
                  </code>
                </div>
              ))}
            </div>
          </section>

          <section id="typography" className="tt-section">
            <SectionHeading
              title="A friendly voice. Always clear."
              description="Typography · Character in the headings, clarity in everything else."
            />
            <div className="tt-typePairing">
              <div className="tt-headingSpecimen">
                <span className="tt-specimenLetters">Aa</span>
                <div>
                  <strong>Manrope</strong>
                  <span>Headings & expressive moments</span>
                </div>
                <p>Geometric, open, and quietly playful.</p>
                <code>600–700 weight · −0.04em to −0.02em</code>
              </div>
              <div className="tt-bodySpecimen">
                <span className="tt-bodyLetters">Aa Bb Cc</span>
                <div>
                  <strong>Inter</strong>
                  <span>Body & interface</span>
                </div>
                <p>
                  Good design gets out of your way. Familiar, readable type
                  makes even the smallest interaction feel effortless.
                </p>
                <code>400–600 weight · 1.6 line height</code>
              </div>
            </div>
            <div className="tt-typeScale">
              {[
                {
                  label: "Display",
                  size: "72 / 77",
                  sample: "Hello, good things.",
                  style: "tt-displayType",
                  details: "700 · −0.04em",
                },
                {
                  label: "Heading",
                  size: "40 / 48",
                  sample: "Make room for better.",
                  style: "tt-headingType",
                  details: "700 · −0.03em",
                },
                {
                  label: "Section",
                  size: "32 / 40",
                  sample: "Every detail, considered.",
                  style: "tt-sectionType",
                  details: "700 · −0.03em",
                },
                {
                  label: "Title",
                  size: "20 / 28",
                  sample: "Small things make a big difference.",
                  style: "tt-titleType",
                  details: "600 · −0.02em",
                },
                {
                  label: "Body",
                  size: "15 / 24",
                  sample: "A familiar interface, with a little more warmth.",
                  style: "tt-bodyType",
                  details: "400 · 0em",
                },
                {
                  label: "Label",
                  size: "13 / 20",
                  sample: "Clear labels. Confident choices.",
                  style: "tt-labelType",
                  details: "500 · 0em",
                },
              ].map((type) => (
                <div className="tt-typeRow" key={type.label}>
                  <div>
                    <strong>{type.label}</strong>
                    <code>
                      {type.size} px
                      <br /> {type.details}
                    </code>
                  </div>
                  <span className={type.style}>{type.sample}</span>
                </div>
              ))}
              <div className="tt-typeRow">
                <div>
                  <strong>Tokens</strong>
                  <code>
                    11 / 18 px
                    <br /> 400 · 0em
                  </code>
                </div>
                <code className="tt-monoSample">
                  Geist Mono · for values, never for decoration.
                </code>
              </div>
            </div>
          </section>

          <section id="foundations" className="tt-section">
            <SectionHeading
              title="The little things that hold it together."
              description="Foundations · A small vocabulary, used consistently."
            />
            <div className="tt-foundationGrid">
              <Exhibit title="Space to breathe" subtitle="A 4 px base rhythm">
                <div className="tt-spacingBars">
                  {[4, 8, 12, 16, 24, 32, 48, 64].map((value) => (
                    <div key={value}>
                      <code>space-{value}</code>
                      <span
                        style={{ width: `calc(var(--space-${value}) * 2)` }}
                      />
                      <code>{value} px</code>
                    </div>
                  ))}
                </div>
              </Exhibit>
              <Exhibit title="Take the edge off" subtitle="Radii & borders">
                <div className="tt-radiusSamples">
                  {[
                    { value: 8, label: "Small" },
                    { value: 12, label: "Control" },
                    { value: 20, label: "Surface" },
                    { value: 999, label: "Pill" },
                  ].map((radius) => (
                    <div key={radius.value}>
                      <span style={{ borderRadius: radius.value }} />
                      <strong>{radius.label}</strong>
                      <code>{radius.value} px</code>
                    </div>
                  ))}
                </div>
                <p className="tt-foundationNote">
                  Edges stay quiet: <code>1 px solid · border</code>
                </p>
              </Exhibit>
              <Exhibit title="Just enough lift" subtitle="Elevation">
                <div className="tt-elevationSamples">
                  {["Flat", "Resting", "Floating"].map((label, i) => (
                    <div key={label}>
                      <span
                        className={["tt-flat", "tt-resting", "tt-floating"][i]}
                      />
                      <strong>{label}</strong>
                      <code>{["none", "0 2px 8px", "0 8px 28px"][i]}</code>
                    </div>
                  ))}
                </div>
                <p className="tt-foundationNote">
                  Soft ink shadows at <code>5% / 10% opacity</code>.
                </p>
              </Exhibit>
              <Exhibit title="Quick, with a soft landing" subtitle="Motion">
                <div className="tt-motionDemo">
                  <span
                    key={motionPlayed}
                    className={
                      motionPlayed ? "tt-motionDotPlayed" : "tt-motionDot"
                    }
                  >
                    <ArrowRight />
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setMotionPlayed((value) => value + 1)}
                  >
                    <RotateCcw data-icon="inline-start" />
                    Replay
                  </Button>
                </div>
                <div className="tt-motionSpecs">
                  <div>
                    <strong>Feedback</strong>
                    <code>120 ms</code>
                  </div>
                  <div>
                    <strong>Transitions</strong>
                    <code>240 ms</code>
                  </div>
                  <div>
                    <strong>Ease out</strong>
                    <code>cubic-bezier(0.16, 1, 0.3, 1)</code>
                  </div>
                </div>
              </Exhibit>
            </div>
          </section>

          <section id="components" className="tt-section">
            <SectionHeading
              title="Familiar pieces. A fresh feeling."
              description="Components · Fourteen shadcn/ui primitives, with a little personality. Go ahead, try them."
            />
            <div className="tt-componentGrid">
              <SchedulingCalendar portalContainer={portalContainer} />
              <Exhibit
                title="Buttons"
                subtitle="Decisive, without shouting"
                className="tt-wideExhibit"
              >
                <div className="tt-buttonExamples">
                  <div>
                    <Button
                      disabled={saving}
                      onClick={() => {
                        setSaved(false);
                        setSaving(true);
                      }}
                    >
                      {saving ? (
                        <LoaderCircle
                          className="tt-spinner"
                          data-icon="inline-start"
                        />
                      ) : saved ? (
                        <Check data-icon="inline-start" />
                      ) : null}
                      {saving
                        ? "Saving…"
                        : saved
                          ? "Changes saved"
                          : "Save changes"}
                    </Button>
                    <code>Primary · try me</code>
                  </div>
                  <div>
                    <Button
                      variant="secondary"
                      nativeButton={false}
                      render={<a href="#colors" />}
                    >
                      Explore colors <ArrowUpRight data-icon="inline-end" />
                    </Button>
                    <code>Secondary</code>
                  </div>
                  <div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSaved(false);
                        setFavorite(false);
                      }}
                    >
                      Start fresh
                    </Button>
                    <code>Outline</code>
                  </div>
                  <div>
                    <Button
                      variant="ghost"
                      nativeButton={false}
                      render={<a href="#typography" />}
                    >
                      Take a look <ArrowRight data-icon="inline-end" />
                    </Button>
                    <code>Ghost</code>
                  </div>
                  <div>
                    <Button disabled>Unavailable</Button>
                    <code>Disabled</code>
                  </div>
                  <div>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={
                              favorite
                                ? "Remove from favorites"
                                : "Add to favorites"
                            }
                            aria-pressed={favorite}
                            onClick={() => setFavorite((value) => !value)}
                          />
                        }
                      >
                        <Heart fill={favorite ? "currentColor" : "none"} />
                      </TooltipTrigger>
                      <TooltipContent container={portalContainer}>
                        {favorite
                          ? "A little favorite"
                          : "Save something you love"}
                      </TooltipContent>
                    </Tooltip>
                    <code>Icon + tooltip</code>
                  </div>
                </div>
                <p className="tt-stateHint" aria-live="polite">
                  {saved
                    ? "Saved. A small confirmation, right where you acted."
                    : "Hover for a soft shift. Tab for a sky-blue focus ring. Press for a little give."}
                </p>
              </Exhibit>

              <Exhibit title="A warm welcome" subtitle="Inputs & textarea">
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="sample-name">Your name</FieldLabel>
                    <Input
                      id="sample-name"
                      placeholder="Jamie Morgan"
                      autoComplete="off"
                    />
                  </Field>
                  <Field data-invalid={emailInvalid || undefined}>
                    <FieldLabel htmlFor="sample-email">
                      Email address
                    </FieldLabel>
                    <Input
                      id="sample-email"
                      type="email"
                      defaultValue="jamie@"
                      aria-invalid={emailInvalid}
                      aria-describedby="sample-email-help"
                      onChange={(event) =>
                        setEmailInvalid(!event.currentTarget.validity.valid)
                      }
                      autoComplete="off"
                    />
                    <FieldDescription id="sample-email-help">
                      {emailInvalid
                        ? "That email looks incomplete. Try jamie@example.com."
                        : "Looks good. You’re all set."}
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sample-note">
                      Anything we should know?
                    </FieldLabel>
                    <Textarea
                      id="sample-note"
                      placeholder="A little off the top, please."
                      rows={3}
                    />
                  </Field>
                  <Field data-disabled>
                    <FieldLabel htmlFor="sample-disabled">
                      Shop address{" "}
                      <span className="tt-inlineNote">Disabled example</span>
                    </FieldLabel>
                    <Input
                      id="sample-disabled"
                      disabled
                      placeholder="Available after setup"
                    />
                  </Field>
                </FieldGroup>
              </Exhibit>

              <Exhibit
                title="Small choices, made simple"
                subtitle="Select, checkbox & switch"
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel id="service-label">Choose a service</FieldLabel>
                    <Select
                      defaultValue="haircut"
                      items={[
                        { value: "haircut", label: "Signature haircut" },
                        { value: "beard", label: "Beard tidy" },
                        { value: "both", label: "Cut & beard" },
                      ]}
                    >
                      <SelectTrigger aria-labelledby="service-label">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        container={portalContainer}
                        alignItemWithTrigger={false}
                      >
                        <SelectGroup>
                          <SelectItem value="haircut">
                            Signature haircut
                          </SelectItem>
                          <SelectItem value="beard">Beard tidy</SelectItem>
                          <SelectItem value="both">Cut & beard</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <FieldSet>
                    <FieldLegend className="tt-choiceLegend">
                      Your preferences
                    </FieldLegend>
                    <FieldGroup>
                      <Field orientation="horizontal">
                        <Checkbox id="sample-remember" defaultChecked />
                        <FieldContent>
                          <FieldLabel htmlFor="sample-remember">
                            Remember my preference
                          </FieldLabel>
                          <FieldDescription>
                            A checked state, with a soft edge.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                      <Field orientation="horizontal">
                        <Checkbox id="sample-extra" />
                        <FieldContent>
                          <FieldLabel htmlFor="sample-extra">
                            Add a little extra
                          </FieldLabel>
                          <FieldDescription>
                            Try checking and unchecking.
                          </FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldGroup>
                  </FieldSet>
                  <div className="tt-switchRows">
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldLabel htmlFor="sample-switch">
                          A little delight
                        </FieldLabel>
                        <FieldDescription>
                          On feels fresh. Off feels quiet.
                        </FieldDescription>
                      </FieldContent>
                      <Switch id="sample-switch" defaultChecked />
                    </Field>
                    <Field orientation="horizontal" data-disabled>
                      <FieldContent>
                        <FieldLabel htmlFor="sample-switch-disabled">
                          Not available yet
                        </FieldLabel>
                        <FieldDescription>
                          Disabled, still understandable.
                        </FieldDescription>
                      </FieldContent>
                      <Switch id="sample-switch-disabled" disabled />
                    </Field>
                  </div>
                </FieldGroup>
              </Exhibit>

              <Exhibit title="A place for the details" subtitle="Card">
                <Card className="tt-sampleCard">
                  <div className="tt-cardArtwork">
                    <Flower />
                    <span>
                      Good things,
                      <br /> well considered.
                    </span>
                  </div>
                  <CardHeader>
                    <CardTitle>A little room for inspiration</CardTitle>
                    <CardDescription>
                      A simple surface for the things that matter.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p>
                      Quiet elevation, generous spacing, and one cheerful
                      moment. The content always comes first.
                    </p>
                  </CardContent>
                  <CardFooter>
                    <Button
                      variant="secondary"
                      nativeButton={false}
                      render={<a href="#foundations" />}
                    >
                      Explore the details <ArrowRight data-icon="inline-end" />
                    </Button>
                  </CardFooter>
                </Card>
              </Exhibit>

              <Exhibit title="Useful at a glance" subtitle="Badges & tabs">
                <div className="tt-badgeExamples">
                  <Badge>New</Badge>
                  <Badge variant="secondary">In progress</Badge>
                  <Badge variant="success">
                    <Check />
                    Confirmed
                  </Badge>
                  <Badge variant="warning">Pending</Badge>
                  <Badge variant="destructive">Cancelled</Badge>
                  <Badge variant="outline">Draft</Badge>
                </div>
                <Tabs defaultValue="overview" className="tt-sampleTabs">
                  <TabsList aria-label="Component specimen details">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="details">Details</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview">
                    <span className="tt-tabIllustration">
                      <Sparkles />
                    </span>
                    <h4>A clear place to start.</h4>
                    <p>
                      One view at a time. A gentle surface shift makes the
                      selected tab feel right at home.
                    </p>
                  </TabsContent>
                  <TabsContent value="details">
                    <span className={`tt-tabIllustration tt-mintIllustration`}>
                      <Check />
                    </span>
                    <h4>Thoughtful by default.</h4>
                    <p>
                      Soft 12 px corners, a 44 px touch target, and a visible
                      focus ring for keyboard navigation.
                    </p>
                  </TabsContent>
                  <TabsContent value="notes">
                    <span className={`tt-tabIllustration tt-lilacIllustration`}>
                      <Heart />
                    </span>
                    <h4>Keep the good bits.</h4>
                    <p>
                      These examples use the same shared components and theme
                      as the application.
                    </p>
                  </TabsContent>
                </Tabs>
              </Exhibit>

              <Exhibit title="A moment of focus" subtitle="Dropdown & dialog">
                <div className="tt-overlayExample">
                  <div className="tt-overlayIcon">
                    <MoreHorizontal />
                  </div>
                  <div>
                    <h4>Just what you need.</h4>
                    <p aria-live="polite">{menuStatus}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="outline" size="sm" />}
                    >
                      Options <ChevronDown data-icon="inline-end" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      container={portalContainer}
                      align="end"
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            setMenuStatus("Added to your inspiration list.")
                          }
                        >
                          <Heart />
                          Save inspiration
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setMenuStatus("Ready for a fresh perspective.")
                          }
                        >
                          <Sparkles />
                          Try something new
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          onClick={() =>
                            setMenuStatus("Small menu. Clear choices.")
                          }
                        >
                          <RotateCcw />
                          Reset example
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="tt-overlayExample">
                  <div className={`tt-overlayIcon tt-lilacIllustration`}>
                    <Sparkles />
                  </div>
                  <div>
                    <h4>Space to pause.</h4>
                    <p aria-live="polite">{dialogStatus}</p>
                  </div>
                  <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger
                      render={<Button variant="outline" size="sm" />}
                    >
                      Open dialog
                    </DialogTrigger>
                    <DialogContent container={portalContainer}>
                      <div className="tt-dialogEmblem">
                        <Flower />
                      </div>
                      <DialogHeader>
                        <DialogTitle>
                          A little change can feel good.
                        </DialogTitle>
                        <DialogDescription>
                          This is a dialog specimen. Try the buttons, Escape, or
                          clicking outside to return to the reference.
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <DialogClose render={<Button variant="outline" />}>
                          Keep exploring
                        </DialogClose>
                        <Button
                          onClick={() => {
                            setDialogStatus("A fresh perspective, confirmed.");
                            setDialogOpen(false);
                          }}
                        >
                          Sounds good <Check data-icon="inline-end" />
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <p className="tt-stateHint">
                  Clear choices. Gentle transitions. Focus stays where it
                  belongs.
                </p>
              </Exhibit>

              <Exhibit
                title="A thoughtful response"
                subtitle="Alerts & skeleton"
              >
                <div className="tt-alertExamples">
                  <Alert variant="success">
                    <CheckCircle2 />
                    <AlertTitle>Everything’s looking good.</AlertTitle>
                    <AlertDescription>
                      A calm confirmation of a completed action.
                    </AlertDescription>
                  </Alert>
                  <Alert variant="warning">
                    <TriangleAlert />
                    <AlertTitle>One small thing to check.</AlertTitle>
                    <AlertDescription>
                      Bring attention to the next helpful step.
                    </AlertDescription>
                  </Alert>
                </div>
                <div
                  className="tt-loadingExample"
                  role="status"
                  aria-label="Loading content specimen"
                >
                  <Skeleton className="tt-skeletonAvatar" />
                  <div>
                    <Skeleton className="h-3 w-36 max-w-full" />
                    <Skeleton className="mt-3 h-3 w-24" />
                  </div>
                  <code>Loading, gently.</code>
                </div>
              </Exhibit>
            </div>
          </section>
          <footer className="tt-footer">
            <div>
              <span className="tt-footerFlower">
                <Flower />
              </span>
              <span>
                A little more human.
                <small>TrimTime · Soft Welcome design system</small>
              </span>
            </div>
            <a href="#identity">
              Back to the good stuff <ArrowUpRight />
            </a>
          </footer>
        </main>
      </TooltipProvider>
    </div>
  );
}
