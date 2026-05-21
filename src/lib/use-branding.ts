import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getBranding } from "./branding.functions";

export type Branding = {
  appName: string | null;
  faviconUrl: string | null;
  webLogoUrl: string | null;
  pdfLogoUrl: string | null;
  faviconPath: string | null;
  webLogoPath: string | null;
  pdfLogoPath: string | null;
};

export function useBranding() {
  const fn = useServerFn(getBranding);
  return useQuery<Branding>({
    queryKey: ["branding"],
    queryFn: () => fn() as Promise<Branding>,
    staleTime: 60_000,
  });
}

// Side-effect: keep the document favicon in sync with branding.
export function useApplyFavicon() {
  const { data } = useBranding();
  useEffect(() => {
    if (typeof document === "undefined") return;
    const url = data?.faviconUrl;
    if (!url) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [data?.faviconUrl]);
}
