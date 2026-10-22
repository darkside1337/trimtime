import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Design system",
  description:
    "TrimTime's shared Soft Welcome visual system and component reference.",
};

export default function DesignSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
