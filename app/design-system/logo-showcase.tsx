import { ArrowDown, ArrowUpRight } from "lucide-react";
import { TrimTimeLogo } from "@/components/trimtime-logo";

type Arrangement = "horizontal" | "stacked" | "symbol" | "wordmark";

function LogoArt({
  arrangement = "horizontal",
  version = "primary",
  className = "",
}: {
  arrangement?: Arrangement;
  version?: "primary" | "mono" | "reversed" | "white" | "ink";
  className?: string;
}) {
  if (arrangement === "wordmark") {
    return (
      <TrimTimeLogo
        arrangement="wordmark"
        treatment={version === "white" ? "white" : "ink"}
        className={className}
      />
    );
  }
  return (
    <TrimTimeLogo
      arrangement={arrangement}
      treatment={version === "ink" ? "mono" : version}
      className={className}
    />
  );
}

const surfaces = [
  {
    name: "Primary",
    detail: "Charcoal + mint on warm white",
    version: "primary",
    surface: "warm",
  },
  {
    name: "Monochrome",
    detail: "One color. The same familiar shape.",
    version: "mono",
    surface: "white",
  },
  {
    name: "Reversed",
    detail: "White + mint on charcoal",
    version: "reversed",
    surface: "dark",
  },
  {
    name: "On mint",
    detail: "Charcoal on the brand surface",
    version: "mono",
    surface: "mint",
  },
] as const;

export function LogoShowcase() {
  return (
    <section
      id="logo"
      className="tt-section tt-logoShowcase"
      aria-labelledby="tt-logo-title"
    >
      <div className="tt-signatureHeading">
        <div>
          <span className="tt-signatureEyebrow">TrimTime · Soft Welcome</span>
          <h2 id="tt-logo-title">One familiar signature.</h2>
          <p>A soft chair. An open seat. A warm welcome, wherever it goes.</p>
        </div>
        <a href="#logo-files" className="tt-signatureLink">
          Get the logo files <ArrowDown aria-hidden="true" />
        </a>
      </div>

      <div className="tt-signatureHero">
        <figure className="tt-signaturePrimary">
          <figcaption>
            Primary lockup <span>Horizontal</span>
          </figcaption>
          <LogoArt />
          <div
            className="tt-signaturePalette"
            role="group"
            aria-label="Logo colors: charcoal #242424 and mint #B9EED4"
          >
            <span>
              <i className="tt-signatureInkDot" /> Charcoal <code>#242424</code>
            </span>
            <span>
              <i className="tt-signatureMintDot" /> Mint <code>#B9EED4</code>
            </span>
          </div>
        </figure>
        <figure className="tt-signatureHeroMark">
          <LogoArt arrangement="symbol" version="mono" />
          <figcaption>Small gesture. Lasting recognition.</figcaption>
        </figure>
      </div>

      <div className="tt-signatureSubheading">
        <h3>Same elements. Room to adapt.</h3>
        <p>
          The symbol and wordmark work together, or stand comfortably on their
          own.
        </p>
      </div>
      <div className="tt-signatureConfigurations">
        <figure>
          <div className="tt-signatureArtwork">
            <LogoArt arrangement="symbol" />
          </div>
          <figcaption>
            <strong>Symbol only</strong>
            <span>A recognizable mark for icons and compact spaces.</span>
          </figcaption>
        </figure>
        <figure>
          <div className="tt-signatureArtwork">
            <LogoArt arrangement="wordmark" version="ink" />
          </div>
          <figcaption>
            <strong>Wordmark only</strong>
            <span>The established TrimTime lettering, on its own.</span>
          </figcaption>
        </figure>
        <figure>
          <div className="tt-signatureArtwork">
            <LogoArt arrangement="stacked" />
          </div>
          <figcaption>
            <strong>Stacked lockup</strong>
            <span>A centered arrangement for taller spaces.</span>
          </figcaption>
        </figure>
      </div>

      <div className="tt-signatureSubheading">
        <h3>A welcome on every surface.</h3>
        <p>Light, dark, or mint. The shape and lettering stay consistent.</p>
      </div>
      <div className="tt-signatureSurfaces">
        {surfaces.map((surface) => (
          <figure
            key={surface.name}
            className={`tt-signatureSurface tt-signatureSurface-${surface.surface}`}
          >
            <LogoArt version={surface.version} />
            <figcaption>
              <strong>{surface.name}</strong>
              <span>{surface.detail}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="tt-signatureReversePair">
        <div>
          <LogoArt arrangement="symbol" version="white" />
          <span>One-color white</span>
        </div>
        <div>
          <LogoArt arrangement="wordmark" version="white" />
          <span>Reversed wordmark</span>
        </div>
        <div>
          <LogoArt arrangement="stacked" version="reversed" />
          <span>Reversed stacked lockup</span>
        </div>
      </div>

      <div className="tt-signatureSubheading">
        <h3>From a small hello to a big presence.</h3>
        <p>
          The same artwork, shown at actual icon sizes and in larger
          compositions.
        </p>
      </div>
      <div
        className="tt-signatureScale"
        role="group"
        aria-label="Logo symbol at actual pixel sizes"
      >
        {[16, 24, 32, 48, 64, 96, 128].map((size) => (
          <figure key={size}>
            <div>
              <TrimTimeLogo
                arrangement="symbol"
                width={size}
                label={`Soft Welcome symbol at ${size} pixels`}
              />
            </div>
            <figcaption>{size} px</figcaption>
          </figure>
        ))}
      </div>
      <div className="tt-signatureApplications">
        <figure className="tt-signatureCompact">
          <figcaption>
            Compact signature <span>160 px wide</span>
          </figcaption>
          <LogoArt />
        </figure>
        <figure className="tt-signatureLarge">
          <figcaption>
            Larger presence <span>Scales with the space</span>
          </figcaption>
          <LogoArt />
        </figure>
      </div>

      <div id="logo-files" className="tt-signatureFiles">
        <div>
          <h3>One identity. Every arrangement.</h3>
          <p>Choose the arrangement that fits your space.</p>
          <a
            className="tt-signatureLink tt-signatureAllFiles"
            href="/brand/soft-welcome/trimtime-soft-welcome-svg.zip"
            download
          >
            Download the full SVG set <ArrowDown aria-hidden="true" />
          </a>
        </div>
        <div className="tt-signatureDownloads">
          {[
            ["Primary lockup", "horizontal-primary"],
            ["Symbol", "symbol-primary"],
            ["Wordmark", "wordmark-ink"],
            ["Stacked lockup", "stacked-primary"],
          ].map(([label, file]) => (
            <a key={file} href={`/brand/soft-welcome/${file}.svg`} download>
              {label} <span>SVG</span>
              <ArrowUpRight aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
